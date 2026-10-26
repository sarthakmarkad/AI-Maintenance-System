import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { MAX_PAGES, RagError, chunkPages } from "./policy";
export const PDF_EXTRACTOR = Symbol("PDF_EXTRACTOR");
export interface PdfTextExtractor {
  extract(
    bytes: Uint8Array,
  ): Promise<{ pages: number; chunks: ReturnType<typeof chunkPages> }>;
}
function command(
  name: string,
  args: string[],
  bytes: Uint8Array,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, {
      env: { PATH: process.env.PATH, LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parts: Buffer[] = [];
    let length = 0,
      settled = false;
    const finish = (error?: RagError, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new RagError("PDF_EXTRACTION_TIMEOUT")),
      10000,
    );
    child.on("error", () => finish(new RagError("PDF_EXTRACTOR_UNAVAILABLE")));
    child.stdin.on("error", () => {
      /* Parser errors are reported by exit status. */
    });
    child.stdout.on("data", (part: Buffer) => {
      length += part.length;
      if (length > maxBytes) finish(new RagError("PDF_TEXT_LIMIT"));
      else parts.push(part);
    });
    child.stderr.on("data", () => {
      /* Never log PDF text/parser diagnostics. */
    });
    child.on("close", (code) =>
      code === 0
        ? finish(undefined, Buffer.concat(parts).toString("utf8"))
        : finish(new RagError("PDF_EXTRACTION_FAILED")),
    );
    child.stdin.end(Buffer.from(bytes));
  });
}
@Injectable()
export class PopplerExtractor implements PdfTextExtractor {
  async extract(bytes: Uint8Array) {
    const info = await command("pdfinfo", ["-"], bytes, 32000);
    const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1]);
    if (!Number.isInteger(pages) || pages < 1)
      throw new RagError("PDF_EXTRACTION_FAILED");
    if (pages > MAX_PAGES) throw new RagError("PDF_PAGE_LIMIT");
    if (/^Encrypted:\s+yes/im.test(info)) throw new RagError("PDF_ENCRYPTED");
    const text = await command(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", "-", "-"],
      bytes,
      2 * 1024 * 1024,
    );
    const split = text.split("\f");
    if (!split[split.length - 1]?.trim()) split.pop();
    if (split.length !== pages) throw new RagError("PDF_PAGE_MAPPING_FAILED");
    return { pages, chunks: chunkPages(split) };
  }
}
