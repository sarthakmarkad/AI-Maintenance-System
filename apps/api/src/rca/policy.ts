import { createHash } from "node:crypto";
import { z } from "zod";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { WorkOrder, WorkOrderEvent } from "@prisma/client";
import type { Principal } from "../repository";

export const RCA_POLICY = "recorded-text-rca-v1";
export const RCA_FIELDS = [
  "findings",
  "rootCause",
  "correctiveAction",
  "preventiveAction",
] as const;
export type RcaField = (typeof RCA_FIELDS)[number];
const humanText = z
  .string()
  .trim()
  .max(4000)
  .refine((v) => v === "" || v.length >= 3);
export const humanFieldsSchema = z
  .object({
    findings: humanText.default(""),
    rootCause: humanText.default(""),
    correctiveAction: humanText.default(""),
    preventiveAction: humanText.default(""),
  })
  .strict();
export const generateRcaSchema = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().min(1).max(2147483646),
    human: humanFieldsSchema,
  })
  .strict();
export type RcaInput = z.output<typeof generateRcaSchema>;
export type HumanFields = z.output<typeof humanFieldsSchema>;
export type RcaSource = {
  id: string;
  attribution: string;
  text: string;
  origin: "ORIGINAL_REPORT" | "RETAINED_HISTORY" | "CURRENT_HUMAN_INPUT";
  eventId: string | null;
  eventVersion: number | null;
  recordedAt: string | null;
};
export type RcaSnapshot = {
  policy: string;
  orderId: string;
  version: number;
  kind: "BREAKDOWN";
  machineCode: string;
  capturedAt: string;
  report: {
    priority: string;
    impact: string;
    reportedBy: string;
    reportedAt: string;
    observedAt: string | null;
  };
  history: {
    id: string;
    version: number;
    action: string;
    actorId: string;
    actorRole: string;
    at: string;
  }[];
  sources: RcaSource[];
  coverage: string;
};
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assertCanGenerate(
  order: Pick<WorkOrder, "kind" | "status" | "technicianId" | "version">,
  user: Principal,
  version: number,
) {
  if (user.role !== "TECHNICIAN" || order.technicianId !== user.userId)
    throw new ForbiddenException(
      "Only the assigned technician in the active Technician role can draft RCA.",
    );
  if (order.kind !== "BREAKDOWN" || order.status !== "IN_PROGRESS")
    throw new ConflictException(
      "AI RCA drafting is available only for a breakdown in progress.",
    );
  if (order.version !== version)
    throw new ConflictException(
      "This work order changed. Reload before drafting RCA.",
    );
}
export function snapshot(
  order: WorkOrder,
  events: WorkOrderEvent[],
  human: HumanFields,
  at = new Date(),
  machineCode = "WH-C",
): RcaSnapshot {
  if (events.length > 100)
    throw new ConflictException(
      "Recorded history exceeds the RCA pilot limit. Continue manually.",
    );
  const sources: RcaSource[] = [];
  const add = (
    text: string | null,
    attribution: string,
    origin: RcaSource["origin"],
    event?: WorkOrderEvent,
  ) => {
    if (!text) return;
    sources.push({
      id: `S${sources.length + 1}`,
      text,
      attribution,
      origin,
      eventId: event?.id ?? null,
      eventVersion: event?.version ?? null,
      recordedAt:
        event?.at.toISOString() ??
        (origin === "ORIGINAL_REPORT" ? order.reportedAt.toISOString() : null),
    });
  };
  add(order.title, "Original operator report: title", "ORIGINAL_REPORT");
  add(
    order.description,
    "Original operator report: observed symptoms (unverified human report)",
    "ORIGINAL_REPORT",
  );
  // No attachment contents, anomaly/readings payloads, provider replies or SOP claims enter context.
  for (const event of events) {
    if (
      !["SUBMIT", "RETURN", "ASSIGN", "APPROVE", "CLOSE"].includes(event.action)
    )
      continue;
    const detail = event.detail as Record<string, unknown>;
    for (const key of [...RCA_FIELDS, "reason", "note"]) {
      const value = detail?.[key];
      if (typeof value === "string")
        add(
          value,
          `Retained ${event.action} v${event.version}: ${key}; ${event.actorRole}; historical human statement, not independent verification`,
          "RETAINED_HISTORY",
          event,
        );
    }
  }
  for (const field of RCA_FIELDS)
    add(
      human[field],
      `Current technician input: ${field}; unsubmitted and unverified`,
      "CURRENT_HUMAN_INPUT",
    );
  const result: RcaSnapshot = {
    policy: RCA_POLICY,
    orderId: order.id,
    version: order.version,
    kind: "BREAKDOWN",
    machineCode,
    capturedAt: at.toISOString(),
    report: {
      priority: order.priority,
      impact: order.impact,
      reportedBy: order.reportedBy,
      reportedAt: order.reportedAt.toISOString(),
      observedAt: order.observedAt?.toISOString() ?? null,
    },
    history: events.map((e) => ({
      id: e.id,
      version: e.version,
      action: e.action,
      actorId: e.actorId,
      actorRole: e.actorRole,
      at: e.at.toISOString(),
    })),
    sources,
    coverage:
      "Recorded work-order text and explicitly supplied current human fields only. No attachments, OCR, image interpretation, process readings, production records or SOP retrieval. Human statements may be wrong; causes remain unconfirmed.",
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 48000 || sources.length > 100)
    throw new ConflictException(
      "Recorded text exceeds the RCA pilot context limit. Continue manually; no evidence was silently omitted.",
    );
  return result;
}
const refs = z
  .array(z.string().regex(/^S[1-9][0-9]{0,2}$/))
  .min(1)
  .max(4);
const advisory = z
  .object({ text: z.string().trim().min(3).max(600), sourceIds: refs })
  .strict();
export const rcaOutputSchema = z
  .object({
    status: z.enum(["LIMITED_EVIDENCE", "INSUFFICIENT_EVIDENCE"]),
    factSourceIds: z.array(z.string()).min(1).max(6),
    hypotheses: z.array(advisory).max(4),
    missingChecks: z.array(advisory).min(1).max(6),
    correctiveProposals: z.array(advisory).max(4),
    preventiveProposals: z.array(advisory).max(4),
  })
  .strict();
export type RcaOutput = z.output<typeof rcaOutputSchema>;
export type RcaDraft = RcaOutput & {
  facts: RcaSource[];
  proposed: HumanFields;
  limitations: string;
};
export class RcaProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const numbers = (s: string): string[] => s.match(/[-+]?\d+(?:[.,]\d+)*/g) ?? [];
export function validateRcaOutput(
  raw: unknown,
  evidence: RcaSnapshot,
): RcaDraft {
  const parsed = rcaOutputSchema.safeParse(raw);
  if (!parsed.success) throw new RcaProviderError("RCA_INVALID_RESPONSE");
  const output = parsed.data,
    sources = new Map(evidence.sources.map((s) => [s.id, s]));
  if (
    new Set(output.factSourceIds).size !== output.factSourceIds.length ||
    output.factSourceIds.some((id) => !sources.has(id))
  )
    throw new RcaProviderError("RCA_INVALID_EVIDENCE");
  for (const item of [
    ...output.hypotheses,
    ...output.missingChecks,
    ...output.correctiveProposals,
    ...output.preventiveProposals,
  ]) {
    if (
      new Set(item.sourceIds).size !== item.sourceIds.length ||
      item.sourceIds.some((id) => !sources.has(id))
    )
      throw new RcaProviderError("RCA_INVALID_EVIDENCE");
    const support = item.sourceIds.map((id) => sources.get(id)!.text).join(" ");
    if (numbers(item.text).some((n) => !numbers(support).includes(n)))
      throw new RcaProviderError("RCA_UNSUPPORTED_NUMBER");
    if (
      /\b(confirmed|definitive|proven|caused by|root cause is|service restored|restored at|approved|verified SOP|current SOP|per SOP|according to (?:the )?(?:SOP|manual)|image shows|photo shows|OCR)\b/i.test(
        item.text,
      ) ||
      /\d{4}-\d\d-\d\d|\d\d:\d\d/.test(item.text)
    )
      throw new RcaProviderError("RCA_UNSUPPORTED_CLAIM");
  }
  if (output.status === "INSUFFICIENT_EVIDENCE" && output.hypotheses.length)
    throw new RcaProviderError("RCA_INVALID_RESPONSE");
  const facts = output.factSourceIds.map((id) => sources.get(id)!);
  // Human-source excerpts stay verbatim and attributed, never rewritten as verified facts.
  const findings = facts
    .map(
      (s) =>
        `[${s.id}; ${s.origin === "CURRENT_HUMAN_INPUT" ? "unsubmitted human input" : "recorded human statement"}] ${s.text}`,
    )
    .join("\n\n");
  const join = (items: RcaOutput["hypotheses"]) =>
    items.map((x) => `${x.text} [${x.sourceIds.join(", ")}]`).join("\n");
  const proposed = {
    findings,
    rootCause: output.hypotheses.length
      ? "Unconfirmed possibilities requiring human investigation:\n" +
        join(output.hypotheses)
      : "Insufficient recorded evidence to establish a root cause. Complete the listed checks and record human conclusions.",
    correctiveAction: output.correctiveProposals.length
      ? "Proposed checks/actions only; not recorded as performed:\n" +
        join(output.correctiveProposals)
      : "No corrective repair established by this draft. Record only checks/actions actually performed.",
    preventiveAction: output.preventiveProposals.length
      ? "Proposed preventive actions for human review:\n" +
        join(output.preventiveProposals)
      : "Insufficient evidence for a specific preventive action. Record a human-reviewed follow-up plan.",
  };
  if (Object.values(proposed).some((v) => v.length > 4000))
    throw new RcaProviderError("RCA_RESPONSE_LIMIT");
  return {
    ...output,
    facts,
    proposed,
    limitations:
      evidence.coverage +
      " AI advisory draft. It cannot confirm a cause, record a repair/restoration, submit, approve or close work. Synthetic statements cannot establish authentic production-loss causes.",
  };
}
