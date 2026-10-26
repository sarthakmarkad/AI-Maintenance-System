import type { ChatContext } from "./policy";
import type { Approved } from "./store";
export const summaryRequest = (q: string) =>
  /summar|all\s+(?:the\s+)?(?:instructions?|steps|checks)|entire|full\s+(?:sop|manual|reference|document)|what is mentioned|what does|overview|explain (?:that|it)|simplify (?:that|it)|make (?:that|it) (?:shorter|simpler)/i.test(
    q,
  ) ||
  /\b(?:show|list|review|explain|what is)\s+(?:the |this |full |complete )?checklist\b/i.test(
    q,
  ) ||
  /\b(?:mention|list|show|provide|give)\b.{0,60}\binstruct(?:ion|on)/i.test(q);
export const explicitDocumentSummary = (q: string) =>
  summaryRequest(q) &&
  /\b(?:sops?|manuals?|references?|refercne|documents?|checklist)\b/i.test(q) &&
  !/^(?:write|create|draft|compose)\b|\b(?:definition|in general|general concept)\b/i.test(
    q,
  );
export const catalogRequest = (q: string) =>
  /\b(?:what|which)\b.{0,40}\b(?:sops?|manuals?|mauals?|references?|documents?)\b.{0,50}\b(?:have|available|currently|uploaded|access)\b/i.test(
    q,
  ) ||
  /^(?:list|show)(?: me)?(?: all| the| available| uploaded| approved| current| our)*\s+(?:sops?|manuals?|references?|documents?)\s*[?.!]*$/i.test(
    q,
  );
export function selectReference(
  q: string,
  sources: Approved[],
  history: ChatContext[],
) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const question = norm(q);
  const named = sources.filter(
    (s) =>
      question.includes(norm(s.title)) || question.includes(norm(s.filename)),
  );
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  const words = new Set(question.split(" "));
  const distinctive = sources.filter((s) =>
    norm(s.title)
      .split(" ")
      .some(
        (w) =>
          w.length > 2 &&
          ![
            "test",
            "sop",
            "manual",
            "reference",
            "document",
            "training",
            "instructions",
            "checklist",
            "guide",
            "procedure",
            "maintenance",
            "inspection",
            "approved",
            "the",
            "and",
          ].includes(w) &&
          words.has(w),
      ),
  );
  if (distinctive.length === 1) return distinctive[0];
  if (distinctive.length > 1) return null;

  if (sources.length === 1) return sources[0];
  if (
    /\b(?:all|both|every|other|another)\s+(?:the\s+)?(?:sops?|manuals?|references?|documents?)\b/i.test(
      q,
    )
  )
    return null;
  for (const h of [...history].reverse()) {
    if (h.mode === "GENERAL") break;
    const related = sources.filter((s) =>
      h.referenceIds?.includes(s.documentId),
    );
    if (related.length === 1) return related[0];
    if (related.length > 1) break;
  }
  return null;
}
