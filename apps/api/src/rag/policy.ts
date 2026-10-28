import { createHash } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config";
export const DIMENSIONS = 1536;
export const LOCAL_MODEL = "nomic-embed-text:v1.5";
export const LOCAL_DIMENSIONS = 768;
export const LOCAL_DIGEST =
  "0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f";
export const MAX_PAGES = 200;
export const MAX_CHUNKS = 500;
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 180;
export const MAX_TEXT = 500000;
export const POLICY = "approved-documents-v3";
export const askSchema = z
  .object({ question: z.string().trim().min(3).max(1000) })
  .strict();
export const emptySchema = z.object({}).strict();
export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function settings(config: Config) {
  const provider =
    config.DOCUMENT_AI_PROVIDER ??
    (config.COMMANDCODE_API_KEY ? "commandcode" : "openai");
  const local = provider === "commandcode";
  const embeddingModel = local
    ? LOCAL_MODEL
    : (config.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small");
  const profile = local
    ? `nomic15:${config.LOCAL_EMBEDDING_DIGEST ?? LOCAL_DIGEST}:768-pad1536:task1:poppler-v1:page-chunks-v1`
    : `${embeddingModel}:${DIMENSIONS}:poppler-v1:page-chunks-v1`;
  return {
    provider,
    configured:
      Boolean(local ? config.COMMANDCODE_API_KEY : config.OPENAI_API_KEY) &&
      (!local ||
        /^[a-f0-9]{64}$/.test(config.LOCAL_EMBEDDING_DIGEST ?? LOCAL_DIGEST)) &&
      config.DOCUMENT_AI_ENABLED !== "false",
    embeddingModel,
    answerModel: local
      ? (config.COMMANDCODE_MODEL ?? "deepseek/deepseek-v4.1-flash")
      : (config.OPENAI_ANSWER_MODEL ?? "gpt-5.4-mini-2026-03-17"),
    profile,
  };
}
export class RagError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export type TextChunk = {
  ordinal: number;
  page: number;
  text: string;
  hash: string;
};
export function chunkPages(pages: string[]): TextChunk[] {
  if (pages.length > MAX_PAGES) throw new RagError("PDF_PAGE_LIMIT");
  if (pages.reduce((n, p) => n + p.length, 0) > MAX_TEXT)
    throw new RagError("PDF_TEXT_LIMIT");
  const chunks: TextChunk[] = [];
  pages.forEach((raw, i) => {
    const text = normalize(raw.replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, ""));
    for (let start = 0; start < text.length; ) {
      let end = Math.min(text.length, start + CHUNK_SIZE);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + CHUNK_SIZE / 2) end = boundary;
      }
      if (
        end < text.length &&
        /[\uDC00-\uDFFF]/.test(text[end]) &&
        /[\uD800-\uDBFF]/.test(text[end - 1])
      )
        end--;
      const value = text.slice(start, end).trim();
      if (value)
        chunks.push({
          ordinal: chunks.length,
          page: i + 1,
          text: value,
          hash: sha256(value),
        });
      if (chunks.length > MAX_CHUNKS) throw new RagError("PDF_CHUNK_LIMIT");
      if (end >= text.length) break;
      start = Math.max(start + 1, end - CHUNK_OVERLAP);
      if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
    }
  });
  if (chunks.reduce((n, c) => n + c.text.length, 0) < 40)
    throw new RagError("OCR_REQUIRED");
  return chunks;
}
export function validateVectors(
  vectors: number[][],
  count: number,
  dimensions = DIMENSIONS,
) {
  if (
    !Array.isArray(vectors) ||
    vectors.length !== count ||
    vectors.some(
      (v) =>
        !Array.isArray(v) ||
        v.length !== dimensions ||
        v.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6) ||
        !v.some((n) => n !== 0),
    )
  )
    throw new RagError("INVALID_EMBEDDINGS");
  return vectors;
}
export const answerSchema = z
  .object({
    status: z.enum([
      "ANSWERED",
      "INSUFFICIENT_EVIDENCE",
      "CONFLICTING_SOURCES",
    ]),
    statements: z
      .array(
        z
          .object({
            text: z.string().trim().min(3).max(700),
            citations: z
              .array(
                z
                  .object({
                    sourceId: z.string().regex(/^S[1-8]$/),
                    quote: z.string().trim().min(10).max(CHUNK_SIZE),
                  })
                  .strict(),
              )
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type DraftAnswer = z.infer<typeof answerSchema>;
export type Passage = {
  id: string;
  chunkId: string;
  indexId: string;
  documentId: string;
  fileId: string;
  title: string;
  filename: string;
  fileNumber: number;
  documentVersion: number;
  approvalId: string;
  page: number;
  text: string;
  hash: string;
  similarity: number;
};
export function validateCitations(draft: DraftAnswer, sources: Passage[]) {
  if (draft.status === "INSUFFICIENT_EVIDENCE") {
    if (draft.statements.length) throw new RagError("INVALID_CITATIONS");
    return draft;
  }
  if (!draft.statements.length) throw new RagError("INVALID_CITATIONS");
  if (
    draft.status === "CONFLICTING_SOURCES" &&
    new Set(draft.statements.flatMap((s) => s.citations.map((c) => c.sourceId)))
      .size < 2
  )
    throw new RagError("INVALID_CITATIONS");
  for (const statement of draft.statements) {
    for (const c of statement.citations) {
      const source = sources.find((s) => s.id === c.sourceId);
      if (!source || !normalize(source.text).includes(normalize(c.quote)))
        throw new RagError("INVALID_CITATIONS");
    }
    const supportedNumbers = new Set(
      statement.citations.flatMap(
        (c) => c.quote.match(/-?\d+(?:[.,]\d+)*/g) ?? [],
      ),
    );
    if (
      (
        statement.text
          .replace(/^\s*\d+[.)]\s+/, "")
          .match(/-?\d+(?:[.,]\d+)*/g) ?? []
      ).some((n) => !supportedNumbers.has(n))
    )
      throw new RagError("UNSUPPORTED_NUMBERS");
  }
  return draft;
}

export type ChatContext = {
  question: string;
  answer: string;
  mode?: "GENERAL" | "DOCUMENTS";
  referenceIds?: string[];
};
export const conversationSchema = z
  .object({
    mode: z.enum(["GENERAL", "DOCUMENTS"]),
    reply: z.string().trim().max(4000),
  })
  .strict()
  .refine((v) => v.mode !== "GENERAL" || v.reply.length > 0)
  // A provider may draft text while requesting lookup. Discard that ungrounded
  // draft; only the selected mode survives into the retrieval path.
  .transform((v) => (v.mode === "DOCUMENTS" ? { ...v, reply: "" } : v));
export type ConversationReply = z.infer<typeof conversationSchema>;
// Explicit local-reference requests cannot be downgraded to ungrounded advice.
// Generic questions such as "what is an SOP?" remain conversational.
export function requiresDocuments(question: string) {
  if (/^(?:write|draft|translate|rewrite|proofread|compose)\b/i.test(question))
    return false;
  return (
    /\b(?:according to|as per|check|search|read|summari[sz]e)\b.{0,80}\b(?:sops?|manuals?|uploaded documents?|approved references?)\b/i.test(
      question,
    ) ||
    /\b(?:our|my|this)\s+(?:sop|manual|machine|line|plant)\b/i.test(question) ||
    /\bWH[\s-]?C\b/i.test(question)
  );
}
