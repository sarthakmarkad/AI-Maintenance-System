import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
export const POLICY = "synthetic-rolling-mad-v1";
export const parameter = z.enum(["hotTempC", "coldTempC", "pressureBar"]);
export const kind = z.enum(["SUDDEN_CHANGE", "SUSTAINED_SHIFT", "DRIFT"]);
const finite = z.number().finite();
const resultSchema = z
  .object({
    policyVersion: z.literal(POLICY),
    eligible: z
      .object({
        SUDDEN_CHANGE: z.number().int().min(0).max(744),
        SUSTAINED_SHIFT: z.number().int().min(0).max(744),
        DRIFT: z.number().int().min(0).max(744),
      })
      .strict(),
    flags: z
      .array(
        z
          .object({
            parameter,
            kind,
            direction: z.enum(["UP", "DOWN"]),
            measuredAt: z.string().datetime(),
            value: finite,
            baselineMedian: finite,
            baselineMad: finite.nonnegative(),
            scale: finite.positive(),
            threshold: finite.positive(),
            change: finite,
            slope: finite.nullable(),
            baselineIds: z.array(z.string().uuid()).length(24),
            sampleIds: z.array(z.string().uuid()).min(1).max(6),
          })
          .strict(),
      )
      .max(6696),
  })
  .strict();
export type EngineResult = z.infer<typeof resultSchema>;
export type EngineRow = {
  id: string;
  measuredAt: string;
  hotTempC: number;
  coldTempC: number;
  pressureBar: number;
};
@Injectable()
export class StatisticalEngine {
  private active = 0;
  async run(rows: EngineRow[], from: Date, to: Date): Promise<EngineResult> {
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        "Pattern analysis is busy. Try again shortly.",
      );
    this.active++;
    try {
      return await new Promise((done, fail) => {
        const child = spawn(
          "python3",
          [
            "-I",
            resolve(__dirname, "../../../../services/statistics/worker.py"),
          ],
          {
            shell: false,
            stdio: ["pipe", "pipe", "ignore"],
            // Worker does not inherit database/Auth credentials.
            env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
          },
        );
        let output = "",
          bytes = 0,
          settled = false;
        const finish = (error?: unknown, value?: EngineResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) {
            child.kill("SIGKILL");
            fail(
              new ServiceUnavailableException(
                "Pattern analysis is temporarily unavailable. Try again.",
              ),
            );
          } else done(value!);
        };
        const timer = setTimeout(() => finish(new Error("timeout")), 5000);
        child.on("error", finish);
        child.stdin.on("error", finish);
        child.stdout.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 16 * 1024 * 1024)
            return finish(new Error("output limit"));
          output += chunk.toString("utf8");
        });
        child.on("close", (code) => {
          if (code !== 0) return finish(new Error("worker failed"));
          try {
            finish(undefined, resultSchema.parse(JSON.parse(output)));
          } catch {
            finish(new Error("invalid result"));
          }
        });
        child.stdin.end(
          JSON.stringify({
            rows,
            from: from.toISOString(),
            to: to.toISOString(),
          }),
        );
      });
    } finally {
      this.active--;
    }
  }
}
