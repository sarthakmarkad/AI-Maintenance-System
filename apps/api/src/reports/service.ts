import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "../database";
import { WorkOrdersService } from "../work-orders/service";
import { CalendarService } from "../calendar/service";
import { dayStart, dueAt } from "../calendar/recurrence";
import type { Principal } from "../repository";
import { attachmentSelect } from "../attachments/policy";
import {
  finish,
  historyText,
  HISTORY_LIMIT,
  ist,
  label,
  preview,
  reference,
  REPORT_LIMIT,
  reportWindow,
  type ReportQuery,
  type ReportSnapshot,
  type Section,
} from "./model";
import { renderPdf, renderWorkbook } from "./render";
const person = { select: { user: { select: { displayName: true } } } } as const;
const include = {
  reporter: person,
  technician: person,
  reviewer: person,
  closer: person,
  occurrence: { select: { id: true, planId: true, dueAt: true } },
  anomalyReview: { include: { reviewer: person } },
  _count: { select: { attachments: true } },
} satisfies Prisma.WorkOrderInclude;
type Order = Prisma.WorkOrderGetPayload<{ include: typeof include }>;
const orderHeaders = [
  "Work order ID",
  "Reference",
  "Title",
  "Type",
  "Current status",
  "Priority",
  "Reported impact (human observation)",
  "Reporter / opened by",
  "Current technician",
  "Created (IST)",
  "Created (UTC)",
  "First observed / flag time (IST)",
  "Started (IST)",
  "Work performed (IST)",
  "Service restored (IST)",
  "Submitted (IST)",
  "Reviewed (IST)",
  "Closed (IST)",
  "Closed (UTC)",
  "Reviewer",
  "Closer",
  "Description / instructions",
  "Current findings",
  "Human RCA (breakdown only)",
  "Corrective action / checks performed",
  "Preventive action / follow-up",
  "Return reason",
  "Investigation outcome",
  "Fixed planned due (IST)",
  "Attachment count",
  "Current version",
];
const orderRow = (o: Order) => [
  o.id,
  reference(o.id),
  o.title,
  label(o.kind),
  label(o.status),
  label(o.priority),
  label(o.impact),
  o.reporter.user.displayName,
  o.technician?.user.displayName ?? "Not assigned",
  ist(o.reportedAt),
  o.reportedAt.toISOString(),
  ist(o.observedAt),
  ist(o.startedAt),
  ist(o.performedAt),
  ist(o.restoredAt),
  ist(o.submittedAt),
  ist(o.reviewedAt),
  ist(o.closedAt),
  o.closedAt?.toISOString() ?? null,
  o.reviewer?.user.displayName ?? null,
  o.closer?.user.displayName ?? null,
  o.description,
  o.findings,
  o.kind === "BREAKDOWN" ? o.rootCause : null,
  o.correctiveAction,
  o.preventiveAction,
  o.returnReason,
  o.investigationOutcome
    ? label(o.investigationOutcome)
    : o.kind === "INVESTIGATION" && o.submittedAt
      ? "Not recorded in earlier submission"
      : null,
  ist(o.occurrence?.dueAt),
  o._count.attachments,
  o.version,
];
const reviewRow = (o: Order) =>
  o.anomalyReview
    ? [
        o.id,
        o.anomalyReview.id,
        "SYNTHETIC statistical review; not a confirmed fault or production-loss cause",
        o.anomalyReview.reviewer.user.displayName,
        ist(o.anomalyReview.createdAt),
        o.anomalyReview.createdAt.toISOString(),
        o.anomalyReview.reason,
        o.anomalyReview.key,
        JSON.stringify(o.anomalyReview.evidence),
      ]
    : null;
@Injectable()
export class ReportsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly access: WorkOrdersService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async metadata(
    tx: Prisma.TransactionClient,
    user: Principal,
    scope: { orgId: string; machineId: string },
    now: Date,
  ) {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: scope.orgId },
      select: { name: true },
    });
    const machine = await tx.machine.findFirstOrThrow({
      where: { id: scope.machineId, orgId: scope.orgId },
      select: { code: true, name: true },
    });
    return {
      organization: org.name,
      machineCode: machine.code,
      machineName: machine.name,
      generatedAt: now.toISOString(),
      requestedBy: user.displayName,
      requestedRole: label(user.role),
    };
  }
  async snapshot(user: Principal, code: string, q: ReportQuery) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.access.context(tx, user, code),
          now = new Date(),
          window = reportWindow(q, now);
        const start = dayStart(window.from),
          end = new Date(dayStart(window.to).getTime() + 86400000);
        const meta = await this.metadata(tx, c.user, c.scope, now);
        if (q.report === "planned-maintenance") {
          const occurrences = await tx.maintenanceOccurrence.findMany({
            where: {
              ...c.scope,
              dueAt: { gte: start, lt: end },
              ...(q.status === "CLOSED"
                ? { workOrder: { is: { status: "CLOSED" as const } } }
                : q.status === "OPEN"
                  ? {
                      skippedAt: null,
                      OR: [
                        { workOrder: null },
                        {
                          workOrder: {
                            is: { status: { not: "CLOSED" as const } },
                          },
                        },
                      ],
                    }
                  : {}),
            },
            include: {
              technician: person,
              plan: { select: { active: true } },
              workOrder: {
                select: {
                  id: true,
                  status: true,
                  performedAt: true,
                  closedAt: true,
                  version: true,
                  technician: person,
                },
              },
            },
            orderBy: [{ dueAt: "asc" }, { id: "asc" }],
            take: REPORT_LIMIT + 1,
          });
          if (occurrences.length > REPORT_LIMIT)
            throw new UnprocessableEntityException(
              "More than 500 planned tasks match these dates. Choose a shorter date range.",
            );
          const selected = occurrences;
          const plans = await tx.maintenancePlan.findMany({
            where: { ...c.scope, active: true },
            select: {
              firstDueAt: true,
              frequency: true,
              interval: true,
              nextSequence: true,
            },
            take: 1001,
          });
          const incomplete =
            this.calendar.jobFailed ||
            plans.length > 1000 ||
            plans.some(
              (p) =>
                dueAt(p.firstDueAt, p.frequency, p.interval, p.nextSequence) <=
                now,
            );
          const futureGap = plans.some(
            (p) =>
              dueAt(p.firstDueAt, p.frequency, p.interval, p.nextSequence) <
              end,
          );
          const rows = selected.map((o) => {
            const status = o.skippedAt
              ? "Skipped"
              : o.workOrder
                ? label(o.workOrder.status)
                : "Not released";
            return {
              id: o.id,
              orderId: o.workOrder?.id ?? null,
              cells: [
                ist(o.dueAt),
                o.title,
                o.workOrder?.technician?.user.displayName ??
                  o.technician.user.displayName,
                status,
                ist(o.workOrder?.performedAt),
                ist(o.workOrder?.closedAt),
              ],
            };
          });
          return finish({
            ...meta,
            ...window,
            report: q.report,
            title: "Planned maintenance report",
            status: q.status,
            kind: null,
            total: selected.length,
            counts: {
              open: selected.filter(
                (o) => !o.skippedAt && o.workOrder?.status !== "CLOSED",
              ).length,
              closed: selected.filter((o) => o.workOrder?.status === "CLOSED")
                .length,
              skipped: selected.filter((o) => !!o.skippedAt).length,
            },
            warning: incomplete
              ? "Scheduling is incomplete or unavailable. This report contains generated tasks only and may omit due tasks."
              : futureGap
                ? "Some future recurrences in this date range have not been generated yet. This report lists generated tasks only."
                : null,
            notes: [
              "Dates select fixed due times in IST. Only generated tasks are included; later recurrences may not exist yet.",
              "Completed means the linked work order is CLOSED. Physical performed time is separate from review and closure.",
              "Open excludes skipped tasks and includes unreleased, assigned, in-progress, awaiting-review and approved tasks.",
            ],
            columns: [
              "Fixed due (IST)",
              "Task",
              "Current / planned technician",
              "Current stage",
              "Performed (IST)",
              "Closed (IST)",
            ],
            rows,
            sheets: [
              {
                name: "Planned tasks",
                headers: [
                  "Occurrence ID",
                  "Plan ID",
                  "Fixed due (IST)",
                  "Fixed due (UTC)",
                  "Title",
                  "Instructions",
                  "Snapshot technician",
                  "Current technician",
                  "Priority",
                  "Plan currently active",
                  "Current stage",
                  "Work order ID",
                  "Performed (IST)",
                  "Closed (IST)",
                  "Closure timing",
                  "Skipped (IST)",
                  "Skip reason",
                  "Occurrence version",
                  "Work order version",
                ],
                rows: selected.map((o) => [
                  o.id,
                  o.planId,
                  ist(o.dueAt),
                  o.dueAt.toISOString(),
                  o.title,
                  o.instructions,
                  o.technician.user.displayName,
                  o.workOrder?.technician?.user.displayName ?? null,
                  label(o.priority),
                  o.plan.active ? "Yes" : "No",
                  o.skippedAt
                    ? "Skipped"
                    : o.workOrder
                      ? label(o.workOrder.status)
                      : "Not released",
                  o.workOrder?.id ?? null,
                  ist(o.workOrder?.performedAt),
                  ist(o.workOrder?.closedAt),
                  o.skippedAt
                    ? "Skipped"
                    : o.workOrder?.status === "CLOSED" && o.workOrder.closedAt
                      ? o.workOrder.closedAt <= o.dueAt
                        ? "On time"
                        : "Late"
                      : "Not closed",
                  ist(o.skippedAt),
                  o.skipReason,
                  o.version,
                  o.workOrder?.version ?? null,
                ]),
              },
            ],
          });
        }
        const date =
          q.basis === "closed"
            ? { closedAt: { gte: start, lt: end, lte: now } }
            : { reportedAt: { gte: start, lt: end, lte: now } };
        const orders = await tx.workOrder.findMany({
          where: {
            ...c.scope,
            ...date,
            ...(q.report === "investigations"
              ? { kind: "INVESTIGATION" as const }
              : q.kind
                ? { kind: q.kind }
                : {}),
            ...(q.status === "OPEN"
              ? { status: { not: "CLOSED" as const } }
              : q.status === "CLOSED"
                ? { status: "CLOSED" as const }
                : {}),
          },
          include,
          orderBy: [
            q.basis === "closed"
              ? { closedAt: "desc" }
              : { reportedAt: "desc" },
            { id: "desc" },
          ],
          take: REPORT_LIMIT + 1,
        });
        if (orders.length > REPORT_LIMIT)
          throw new UnprocessableEntityException(
            "More than 500 work orders match these filters. Choose a shorter date range or work type.",
          );
        const reviews = orders.flatMap((o) => {
          const row = reviewRow(o);
          return row ? [row] : [];
        });
        const investigation = q.report === "investigations";
        return finish({
          ...meta,
          ...window,
          report: q.report,
          title: investigation
            ? "Investigation outcomes report"
            : "Maintenance work-order report",
          status: q.status,
          kind: q.kind ?? null,
          total: orders.length,
          counts: {
            open: orders.filter((o) => o.status !== "CLOSED").length,
            closed: orders.filter((o) => o.status === "CLOSED").length,
            skipped: 0,
          },
          warning: investigation
            ? "Source flags use synthetic process readings. Findings are human submissions; approval or closure does not complete recommended follow-up work."
            : null,
          notes: [
            `${window.basis} selects records; statuses, assignments and findings are current at generation.`,
            "PDF is a register summary. Excel includes current findings; use an individual work-order report for complete action history.",
            "Attachment files are excluded. Individual reports list their retained metadata only.",
            ...(investigation
              ? [
                  "Unsubmitted outcomes and outcomes from returned work are provisional; only APPROVED/CLOSED records have current head approval.",
                ]
              : []),
          ],
          columns: investigation
            ? [
                "Reference / title",
                "Current stage",
                "Technician",
                "Current outcome",
                "Created (IST)",
                "Closed (IST)",
              ]
            : [
                "Reference / title",
                "Type",
                "Current stage",
                "Technician",
                "Created (IST)",
                "Closed (IST)",
              ],
          rows: orders.map((o) => ({
            id: o.id,
            orderId: o.id,
            cells: [
              `${reference(o.id)}\n${o.title}`,
              ...(investigation
                ? [
                    label(o.status),
                    o.technician?.user.displayName ?? "Not assigned",
                    o.investigationOutcome
                      ? label(o.investigationOutcome)
                      : o.submittedAt
                        ? "Not recorded in earlier submission"
                        : "Not submitted",
                  ]
                : [
                    label(o.kind),
                    label(o.status),
                    o.technician?.user.displayName ?? "Not assigned",
                  ]),
              ist(o.reportedAt),
              ist(o.closedAt),
            ],
          })),
          sheets: [
            {
              name: "Work orders",
              headers: orderHeaders,
              rows: orders.map(orderRow),
            },
            ...(reviews.length
              ? [
                  {
                    name: "Source reviews",
                    headers: [
                      "Work order ID",
                      "Review ID",
                      "Provenance",
                      "Reviewer",
                      "Reviewed (IST)",
                      "Reviewed (UTC)",
                      "Retained reason",
                      "Evidence fingerprint",
                      "Retained evidence JSON",
                    ],
                    rows: reviews,
                  },
                ]
              : []),
          ],
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
  async detail(user: Principal, code: string, id: string, version: number) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.access.context(tx, user, code),
          now = new Date();
        const o = await tx.workOrder.findFirst({
          where: { ...c.scope, id },
          include,
        });
        if (!o) throw new NotFoundException("Work order not found.");
        if (o.version !== version)
          throw new ConflictException(
            "This work order changed. Reload it before downloading its report.",
          );
        const events = await tx.workOrderEvent.findMany({
          where: { ...c.scope, orderId: id },
          orderBy: { version: "asc" },
          take: HISTORY_LIMIT + 1,
        });
        if (events.length > HISTORY_LIMIT)
          throw new UnprocessableEntityException(
            "This order exceeds the 500-event interactive report limit. Request an archival export to retain its complete history.",
          );
        const attachments = await tx.workOrderAttachment.findMany({
          where: { ...c.scope, orderId: id },
          select: attachmentSelect,
          orderBy: { orderVersion: "asc" },
          take: 21,
        });
        if (attachments.length > 20)
          throw new UnprocessableEntityException(
            "Attachment history exceeds the supported report limit.",
          );
        const sections: Section[] = [
          {
            title: "Original report / instructions",
            fields: [
              { label: "Work order", value: reference(o.id) + " / " + o.id },
              { label: "Title", value: o.title },
              {
                label: "Work type / current stage",
                value: `${label(o.kind)} / ${label(o.status)} / version ${o.version}`,
              },
              {
                label: "Priority / reported impact",
                value: `${label(o.priority)} / ${label(o.impact)} (human observation)`,
              },
              { label: "Description / instructions", value: o.description },
              {
                label: "Reported / opened by",
                value: o.reporter.user.displayName,
              },
              { label: "Created", value: ist(o.reportedAt) },
              {
                label: "First observed / flag measurement",
                value: ist(o.observedAt),
              },
            ],
          },
          {
            title: "Responsibility and independent times",
            fields: [
              {
                label: "Current technician",
                value: o.technician?.user.displayName ?? "Not assigned",
              },
              { label: "Started", value: ist(o.startedAt) },
              ...(o.kind === "PLANNED"
                ? [
                    {
                      label: "Fixed planned due",
                      value: ist(o.occurrence?.dueAt),
                    },
                  ]
                : []),
              ...(o.kind === "BREAKDOWN"
                ? [{ label: "Service restored", value: ist(o.restoredAt) }]
                : [
                    {
                      label:
                        o.kind === "PLANNED"
                          ? "Maintenance performed"
                          : "Investigation completed",
                      value: ist(o.performedAt),
                    },
                  ]),
              { label: "Submitted", value: ist(o.submittedAt) },
              { label: "Reviewed", value: ist(o.reviewedAt) },
              {
                label: "Reviewer",
                value: o.reviewer?.user.displayName ?? "Not recorded",
              },
              { label: "Closed", value: ist(o.closedAt) },
              {
                label: "Closer",
                value: o.closer?.user.displayName ?? "Not recorded",
              },
            ],
          },
          {
            title: "Current human findings",
            fields: [
              {
                label: "Inspection findings",
                value: o.findings ?? "Not submitted",
              },
              ...(o.kind === "BREAKDOWN"
                ? [
                    {
                      label: "Human root-cause analysis",
                      value: o.rootCause ?? "Not submitted",
                    },
                  ]
                : []),
              {
                label:
                  o.kind === "BREAKDOWN"
                    ? "Corrective action"
                    : "Checks / work performed",
                value: o.correctiveAction ?? "Not submitted",
              },
              {
                label:
                  o.kind === "BREAKDOWN"
                    ? "Preventive action"
                    : "Follow-up recommendations",
                value: o.preventiveAction ?? "Not recorded",
              },
              {
                label: "Current return reason",
                value: o.returnReason ?? "None",
              },
              ...(o.kind === "INVESTIGATION"
                ? [
                    {
                      label: "Investigation outcome",
                      value: o.investigationOutcome
                        ? label(o.investigationOutcome)
                        : o.submittedAt
                          ? "Not recorded in earlier submission"
                          : "Not submitted",
                    },
                  ]
                : []),
            ],
          },
        ];
        if (o.anomalyReview)
          sections.push({
            title: "Retained synthetic source review",
            fields: [
              {
                label: "Provenance",
                value:
                  "SYNTHETIC statistical evidence. Not a confirmed fault or cause of actual production loss.",
              },
              {
                label: "Review ID / fingerprint",
                value: o.anomalyReview.id + " / " + o.anomalyReview.key,
              },
              {
                label: "Reviewer and time",
                value:
                  o.anomalyReview.reviewer.user.displayName +
                  " / " +
                  ist(o.anomalyReview.createdAt),
              },
              { label: "Retained reason", value: o.anomalyReview.reason },
              {
                label: "Retained evidence (JSON)",
                value: JSON.stringify(o.anomalyReview.evidence, null, 2),
              },
            ],
          });
        sections.push({
          title: `Complete action history (${events.length} events, oldest first)`,
          fields: events.map((e) => ({
            label: `v${e.version} ${label(e.action)} / ${ist(e.at)}`,
            value: `${e.actorName} (${label(e.actorRole)})\n${e.fromStatus ? label(e.fromStatus) + " -> " : ""}${label(e.toStatus)}\n${historyText(e.detail, o.kind)}`,
          })),
        });
        sections.push({
          title: `Attachment manifest (${attachments.length} files)`,
          fields: attachments.map((a) => ({
            label: a.filename,
            value: `${a.description}\n${a.mediaType}; ${a.byteSize} bytes; SHA-256 ${a.sha256}\n${a.uploaderName} (${label(a.actorRole)}), ${ist(a.createdAt)}, v${a.orderVersion}`,
          })),
        });
        const meta = await this.metadata(tx, c.user, c.scope, now),
          review = reviewRow(o);
        return finish({
          ...meta,
          report: "work-order-detail",
          recordId: o.id,
          recordVersion: o.version,
          title: "Individual maintenance report",
          from: "",
          to: "",
          basis: `Work order ${reference(id)} / version ${version}`,
          status: o.status,
          kind: o.kind,
          total: 1,
          counts: {
            open: o.status === "CLOSED" ? 0 : 1,
            closed: o.status === "CLOSED" ? 1 : 0,
            skipped: 0,
          },
          warning:
            o.kind === "INVESTIGATION"
              ? "Investigation approval/closure covers the investigation, not completion of recommended repairs. Synthetic readings do not establish authentic fault causes."
              : o.status !== "APPROVED" && o.status !== "CLOSED"
                ? "This work is not currently approved. Findings are provisional."
                : null,
          notes: [
            "Current fields and the complete immutable action history are separate. Earlier submissions remain in history.",
            "Times are displayed in IST. Upload times are receipt times, not when a photo was taken. Attachment bytes are excluded.",
            "Findings are provisional unless the current stage is APPROVED or CLOSED.",
          ],
          columns: [],
          rows: [],
          sections,
          sheets: [
            { name: "Work order", headers: orderHeaders, rows: [orderRow(o)] },
            {
              name: "Action history",
              headers: [
                "Event ID",
                "Version",
                "Action",
                "Actor name snapshot",
                "Actor role",
                "From stage",
                "To stage",
                "Time (IST)",
                "Time (UTC)",
                "Retained detail JSON",
              ],
              rows: events.map((e) => [
                e.id,
                e.version,
                e.action,
                e.actorName,
                label(e.actorRole),
                e.fromStatus ? label(e.fromStatus) : null,
                label(e.toStatus),
                ist(e.at),
                e.at.toISOString(),
                JSON.stringify(e.detail),
              ]),
            },
            {
              name: "Attachments",
              headers: [
                "Attachment ID",
                "Filename",
                "Description",
                "Media type",
                "Bytes",
                "SHA-256",
                "Uploader snapshot",
                "Actor role",
                "Uploaded (IST)",
                "Uploaded (UTC)",
                "Work-order version",
              ],
              rows: attachments.map((a) => [
                a.id,
                a.filename,
                a.description,
                a.mediaType,
                a.byteSize,
                a.sha256,
                a.uploaderName,
                label(a.actorRole),
                ist(a.createdAt),
                a.createdAt.toISOString(),
                a.orderVersion,
              ]),
            },
            ...(review
              ? [
                  {
                    name: "Source review",
                    headers: [
                      "Work order ID",
                      "Review ID",
                      "Provenance",
                      "Reviewer",
                      "Reviewed (IST)",
                      "Reviewed (UTC)",
                      "Reason",
                      "Evidence fingerprint",
                      "Retained evidence JSON",
                    ],
                    rows: [review],
                  },
                ]
              : []),
          ],
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
  async preview(user: Principal, code: string, q: ReportQuery) {
    return preview(await this.snapshot(user, code, q));
  }
  async export(
    user: Principal,
    code: string,
    s: ReportSnapshot,
    format: "pdf" | "xlsx",
    fingerprint?: string,
  ) {
    if (fingerprint && fingerprint !== s.fingerprint)
      throw new ConflictException(
        "Report records changed after preview. Refresh the report before downloading.",
      );
    const bytes = await (format === "pdf" ? renderPdf(s) : renderWorkbook(s));
    // Recheck live access after rendering, before recording generation or delivering bytes.
    await this.db.$transaction(async (tx) => {
      const c = await this.access.context(tx, user, code);
      await tx.auditEvent.create({
        data: {
          orgId: c.scope.orgId,
          actorId: c.user.userId,
          entityId: s.recordId ?? c.scope.machineId,
          action: "REPORT_EXPORTED",
          detail: {
            report: s.report,
            format,
            from: s.from,
            to: s.to,
            basis: s.basis,
            status: s.status,
            kind: s.kind,
            count: s.total,
            fingerprint: s.fingerprint,
            machineId: c.scope.machineId,
            orderId: s.recordId ?? null,
            version: s.recordVersion ?? null,
            actorRole: c.user.role,
          },
          at: new Date(),
        },
      });
    });
    return {
      bytes,
      filename: s.recordId
        ? `${s.machineCode}-${reference(s.recordId)}-v${s.recordVersion}.${format}`
        : `${s.machineCode}-${s.report}-${s.from}-${s.to}.${format}`,
    };
  }
}
