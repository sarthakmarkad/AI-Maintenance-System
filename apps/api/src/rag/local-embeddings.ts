import type { Config } from "../config";
import {
  DIMENSIONS,
  LOCAL_MODEL,
  LOCAL_DIMENSIONS,
  LOCAL_DIGEST,
  RagError,
  validateVectors,
} from "./policy";
import { readAiJson } from "./transport";
export class LocalEmbeddings {
  constructor(private readonly config: Config) {}
  async embed(texts: string[], purpose: "document" | "query" = "document") {
    try {
      // Fixed loopback endpoint. Cloud/API authorization headers are never sent here.
      const tags = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!tags.ok) throw new RagError("LOCAL_EMBEDDINGS_UNAVAILABLE");
      const catalog = await readAiJson(tags),
        expected = this.config.LOCAL_EMBEDDING_DIGEST ?? LOCAL_DIGEST;
      const installed = catalog.models?.find(
        (m: any) => m.name === LOCAL_MODEL || m.model === LOCAL_MODEL,
      );
      if (!installed) throw new RagError("LOCAL_EMBEDDING_MODEL_MISSING");
      if (installed.digest !== expected)
        throw new RagError("LOCAL_EMBEDDING_MODEL_CHANGED");
      const result: number[][] = [],
        deadline = Date.now() + 240000;
      for (let start = 0; start < texts.length; start += 16) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new RagError("LOCAL_EMBEDDINGS_UNAVAILABLE");
        const batch = texts.slice(start, start + 16);
        const response = await fetch("http://127.0.0.1:11434/api/embed", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(30000, remaining)),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: LOCAL_MODEL,
            input: batch.map(
              (t) =>
                `${purpose === "query" ? "search_query" : "search_document"}: ${t}`,
            ),
            truncate: false,
            keep_alive: "10m",
          }),
        });
        const payload = await readAiJson(response);
        if (!response.ok) throw new RagError("LOCAL_EMBEDDING_FAILED");
        if (!Array.isArray(payload.embeddings))
          throw new RagError("INVALID_EMBEDDINGS");
        const native = validateVectors(
          payload.embeddings,
          batch.length,
          LOCAL_DIMENSIONS,
        );
        // Zero padding preserves cosine similarity, while retaining existing immutable 1536-dimension storage.
        result.push(
          ...native.map((v) => [
            ...v,
            ...Array(DIMENSIONS - LOCAL_DIMENSIONS).fill(0),
          ]),
        );
      }
      return result;
    } catch (e) {
      throw e instanceof RagError
        ? e
        : new RagError("LOCAL_EMBEDDINGS_UNAVAILABLE");
    }
  }
}
