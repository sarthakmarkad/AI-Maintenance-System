import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { WorkOrderKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { strictDate } from "../production/parser";
import { localDate } from "../calendar/recurrence";
export const REPORT_LIMIT = 500,
  PREVIEW_LIMIT = 50,
  HISTORY_LIMIT = 500;
export const reportTypes = [
  "work-orders",
  "planned-maintenance",
  "investigations",
] as const;
const fields = {
  report: z.enum(reportTypes).default("work-orders"),
  from: z.string().refine(strictDate).optional(),
  to: z.string().refine(strictDate).optional(),
  basis: z.enum(["created", "closed"]).default("created"),
  status: z.enum(["ALL", "OPEN", "CLOSED"]).default("ALL"),
  kind: z.nativeEnum(WorkOrderKind).optional(),
};
function refine(q: z.output<z.ZodObject<typeof fields>>, ctx: z.RefinementCtx) {
  if (
    !!q.from !== !!q.to ||
    (q.from &&
      q.to &&
      (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 365 * 86400000))
  )
    ctx.addIssue({
      code: "custom",
      message: "Choose both dates in order, spanning at most 366 days.",
    });
  if (q.basis === "closed" && q.status === "OPEN")
    ctx.addIssue({
      code: "custom",
      message: "A closed-date report cannot use the open-status filter.",
    });
  if (q.report !== "work-orders" && q.kind)
    ctx.addIssue({
      code: "custom",
      message: "Work type applies only to the work-order report.",
    });
  if (q.report === "planned-maintenance" && q.basis !== "created")
    ctx.addIssue({
      code: "custom",
      message: "Planned reports use the fixed due date.",
    });
}
export const reportQuery = z.object(fields).strict().superRefine(refine);
export const exportQuery = z
  .object({
    ...fields,
    format: z.enum(["pdf", "xlsx"]),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine(refine);
export const detailExportQuery = z
  .object({
    format: z.enum(["pdf", "xlsx"]),
    version: z.coerce.number().int().min(1).max(2147483647),
  })
  .strict();
export type ReportQuery = z.output<typeof reportQuery>;
export function reportWindow(q: ReportQuery, now: Date) {
  const today = localDate(now),
    planned = q.report === "planned-maintenance";
  const add = (d: string, n: number) =>
    new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  const from = q.from ?? (planned ? today : add(today, -29)),
    to = q.to ?? (planned ? add(today, 29) : today);
  if (to > (planned ? add(today, 365) : today))
    throw new BadRequestException(
      planned
        ? "Planned report dates can extend at most 365 days ahead."
        : "Work-order report dates cannot extend beyond today in IST.",
    );
  return {
    from,
    to,
    basis: planned
      ? "Due date"
      : q.basis === "closed"
        ? "Closed date"
        : "Created date",
  };
}
export const label = (v: string) =>
  v
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const reference = (id: string) => "WO-" + id.slice(0, 8).toUpperCase();
export const ist = (value: Date | string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(value)) + " IST"
    : "Not recorded";
export type Sheet = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
};
export type Section = {
  title: string;
  fields: { label: string; value: string }[];
};
export type ReportSnapshot = {
  recordId?: string;
  recordVersion?: number;
  report: string;
  title: string;
  organization: string;
  machineCode: string;
  machineName: string;
  generatedAt: string;
  requestedBy: string;
  requestedRole: string;
  from: string;
  to: string;
  basis: string;
  status: string;
  kind: string | null;
  total: number;
  counts: { open: number; closed: number; skipped: number };
  warning: string | null;
  notes: string[];
  columns: string[];
  rows: { id: string; orderId: string | null; cells: string[] }[];
  fingerprint: string;
  sheets: Sheet[];
  sections?: Section[];
};
export function finish(
  snapshot: Omit<ReportSnapshot, "fingerprint">,
): ReportSnapshot {
  const text =
    JSON.stringify(snapshot.sheets) + JSON.stringify(snapshot.sections ?? []);
  if (text.length > 4_000_000)
    throw new UnprocessableEntityException(
      "This report contains too much text for an interactive download. Choose a narrower report or request an archival export.",
    );
  const { generatedAt, requestedBy, requestedRole, ...stable } = snapshot;
  return {
    ...snapshot,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(stable))
      .digest("hex"),
  };
}
export function preview(s: ReportSnapshot) {
  const { sheets, sections, rows, ...metadata } = s;
  return {
    ...metadata,
    previewLimit: PREVIEW_LIMIT,
    rows: rows.slice(0, PREVIEW_LIMIT),
  };
}
export function literal(value: string) {
  // Preserve unsupported XML control characters visibly instead of silently losing evidence.
  return value.replace(
    /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,
    (c) => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}]`,
  );
}

export function historyText(detail: unknown, kind: string) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return JSON.stringify(detail);
  const names: Record<string, string> = {
    findings: "Inspection findings",
    rootCause: "Human root-cause analysis",
    correctiveAction:
      kind === "BREAKDOWN" ? "Corrective action" : "Checks / work performed",
    preventiveAction:
      kind === "BREAKDOWN" ? "Preventive action" : "Follow-up recommendations",
    workPerformed: "Checks / work performed",
    performedAt: "Performed (IST)",
    restoredAt: "Service restored (IST)",
    observedAt: "First observed (IST)",
    dueAt: "Fixed due (IST)",
    measuredAt: "Flag measurement (IST)",
    investigationOutcome: "Investigation outcome",
    technicianName: "Assigned technician",
    technicianId: "Assigned technician ID",
    previousTechnicianId: "Previous technician ID",
    filename: "File name",
    byteSize: "File size (bytes)",
    sha256: "SHA-256",
    anomalyReviewId: "Source review ID",
    key: "Evidence fingerprint",
  };
  return Object.entries(detail)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => {
      const name = names[key] ?? label(key.replace(/([a-z])([A-Z])/g, "$1 $2"));
      const display =
        typeof value === "string" &&
        [
          "performedAt",
          "restoredAt",
          "observedAt",
          "dueAt",
          "measuredAt",
        ].includes(key) &&
        Number.isFinite(Date.parse(value))
          ? ist(value)
          : key === "investigationOutcome" && typeof value === "string"
            ? label(value)
            : typeof value === "string"
              ? value
              : JSON.stringify(value);
      return `${name}: ${display}`;
    })
    .join("\n");
}
