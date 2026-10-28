// Optional, exactly one paid provider request with synthetic text only, no DB.
// Parent coordinates execution. Never imported by normal test globs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { parseConfig } from "../config";
import { RcaAiProvider, rcaSettings } from "../rca/provider";
import { RcaProviderError, snapshot, validateRcaOutput } from "../rca/policy";
import { rcaInput, rcaOrder } from "./rca-fixtures";
async function main() {
  if (process.env.RCA_LIVE_FIXTURE !== "1")
    throw new Error(
      "Explicit RCA_LIVE_FIXTURE=1 is required; this performs one potentially billed call.",
    );
  const config = parseConfig({ ...process.env, NODE_ENV: "test" }),
    selected = rcaSettings(config);
  if (!selected.enabled)
    throw new Error("Configured CommandCode RCA provider is required.");
  const evidence = snapshot(rcaOrder(), [], rcaInput().human),
    started = Date.now();
  let report: Record<string, unknown>;
  try {
    const draft = validateRcaOutput(
      await new RcaAiProvider(config).generate(evidence),
      evidence,
    );
    assert(!("restoredAt" in draft.proposed));
    assert(
      draft.facts.every((f) =>
        evidence.sources.some((s) => s.id === f.id && s.text === f.text),
      ),
    );
    report = {
      success: true,
      model: selected.model,
      policy: evidence.policy,
      calls: 1,
      elapsedMs: Date.now() - started,
      status: draft.status,
      factCount: draft.facts.length,
      hypothesisCount: draft.hypotheses.length,
      missingCheckCount: draft.missingChecks.length,
      databaseAccess: false,
      operationalData: false,
    };
  } catch (e) {
    report = {
      success: false,
      model: selected.model,
      policy: evidence.policy,
      calls: 1,
      elapsedMs: Date.now() - started,
      reason: e instanceof RcaProviderError ? e.code : "RCA_FIXTURE_FAILED",
      databaseAccess: false,
      operationalData: false,
    };
    process.exitCode = 1;
  }
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/rca-live-fixture.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify(report) + "\n");
}
main().catch(() => {
  process.stderr.write(
    "RCA live fixture could not start. Check opt-in and backend provider configuration.\n",
  );
  process.exitCode = 1;
});
