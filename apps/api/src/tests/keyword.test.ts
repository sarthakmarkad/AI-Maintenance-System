import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../config";
import { settings, KEYWORD_PROFILE } from "../rag/policy";
import { keywordQuery } from "../rag/keyword";
import { DocumentAiProvider } from "../rag/provider";

test("keyword configuration uses only the selected answer credential and preserves separate vector profiles", () => {
  const config = parseConfig({
    DOCUMENT_AI_PROVIDER: "commandcode",
    DOCUMENT_RETRIEVAL_MODE: "keyword",
    COMMANDCODE_API_KEY: "TEST-private-answer-provider-key",
  });
  const selected = settings(config);
  assert(selected.configured);
  assert.equal(selected.retrievalMode, "keyword");
  assert.equal(selected.profile, KEYWORD_PROFILE);
  assert.equal(selected.embeddingModel, "not-required");
  assert.equal(selected.answerModel, "deepseek/deepseek-v4.1-flash");
  assert(!settings({ ...config, COMMANDCODE_API_KEY: undefined }).configured);
  assert(!settings({ ...config, DOCUMENT_AI_ENABLED: "false" }).configured);
  assert.equal(
    settings({ ...config, COMMANDCODE_MODEL: "z-ai/glm-5.3-flash" }).profile,
    selected.profile,
  );
  assert.notEqual(
    settings({ ...config, DOCUMENT_RETRIEVAL_MODE: "hybrid" }).profile,
    selected.profile,
  );
  assert.throws(() => parseConfig({ DOCUMENT_RETRIEVAL_MODE: "unknown" }));
});

test("keyword queries normalize and quote bounded words rather than accepting search operators", () => {
  assert.equal(
    keywordQuery("How should I check PRESSURE gauges in our approved SOP?"),
    '"check" OR "pressure" OR "gauges"',
  );
  assert.equal(
    keywordQuery('pressure | !temperature:*; DROP TABLE "Machine" --'),
    '"pressure" OR "temperature" OR "drop" OR "table" OR "machine"',
  );
  assert.equal(keywordQuery("What does our approved manual say?"), "");
  assert.equal(
    keywordQuery("ＰＲＥＳＳＵＲＥ pressure gauges"),
    '"pressure" OR "gauges"',
  );
  assert.equal(
    keywordQuery(
      Array.from({ length: 100 }, (_, i) => `term${i}`).join(" "),
    ).split(" OR ").length,
    24,
  );
  assert.equal(keywordQuery("ZX-73 pressure"), '"zx" OR "73" OR "pressure"');
});

test("keyword mode never calls an embedding endpoint, including accidental direct embedding requests", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    throw Error("No request expected");
  };
  try {
    const ai = new DocumentAiProvider(
      parseConfig({
        DOCUMENT_RETRIEVAL_MODE: "keyword",
        COMMANDCODE_API_KEY: "TEST-private-answer-provider-key",
      }),
    );
    await assert.rejects(ai.embed(["TEST passage"]), /EMBEDDINGS_DISABLED/);
    assert.equal(calls, 0);
  } finally {
    global.fetch = original;
  }
});
