import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AnomalyDecision, Prisma, type AnomalyReview } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import {
  WorkOrdersService,
  investigationFingerprint,
} from "../work-orders/service";
import { trendQuery } from "../readings/service";
import { localDayStart, localTime } from "../readings/parser";
import { StatisticalEngine, POLICY, parameter, kind } from "./engine";
export const anomalyQuery = trendQuery
  .innerType()
  .extend({
    parameter: parameter.optional(),
    kind: kind.optional(),
    status: z.enum(["PENDING", "REVIEWED"]).optional(),
    after: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const result = trendQuery.safeParse({ from: q.from, to: q.to });
    if (!result.success)
      ctx.addIssue({
        code: "custom",
        message: "Choose both dates, in order, spanning at most 31 days.",
      });
  });
export const reviewInput = z
  .object({
    key: z.string().regex(/^[0-9a-f]{64}$/),
    measuredAt: z.string().datetime({ offset: true }),
    decision: z.nativeEnum(AnomalyDecision),
    reason: z.string().trim().min(3).max(2000),
    technicianId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.decision === "DISMISSED" && input.technicianId)
      ctx.addIssue({
        code: "custom",
        path: ["technicianId"],
        message: "A dismissed flag cannot be assigned to a technician.",
      });
  });
export const investigationInput = z
  .object({ technicianId: z.string().uuid() })
  .strict();
export const reviewHistoryQuery = z
  .object({ after: z.string().uuid().optional() })
  .strict();
const selection = {
  id: true,
  measuredAt: true,
  receivedAt: true,
  hotTempC: true,
  coldTempC: true,
  pressureBar: true,
  sourceId: true,
  sourceRow: true,
  importId: true,
} as const;
type Reading = Prisma.ProcessReadingGetPayload<{ select: typeof selection }>;
const labels = {
  hotTempC: ["Hot temperature", "°C assumed"],
  coldTempC: ["Cold temperature", "°C assumed"],
  pressureBar: ["Pressure", "bar"],
};
@Injectable()
export class AnomaliesService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly access: WorkOrdersService,
    @Inject(StatisticalEngine) private readonly engine: StatisticalEngine,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async readings(
    tx: Prisma.TransactionClient,
    scope: { orgId: string; machineId: string },
    start: Date,
    end: Date,
  ) {
    return tx.processReading.findMany({
      where: {
        ...scope,
        source: "SYNTHETIC",
        measuredAt: { gte: new Date(start.getTime() - 30 * 3600000), lt: end },
      },
      select: selection,
      orderBy: { measuredAt: "asc" },
      take: 775,
    });
  }
  private async calculate(rows: Reading[], start: Date, end: Date) {
    if (rows.length > 774)
      throw new BadRequestException(
        "Too many readings in this analysis window.",
      );
    const result = await this.engine.run(
      rows.map((r) => ({
        id: r.id,
        measuredAt: r.measuredAt.toISOString(),
        hotTempC: Number(r.hotTempC),
        coldTempC: Number(r.coldTempC),
        pressureBar: Number(r.pressureBar),
      })),
      start,
      end,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const sample = (
      id: string,
      key: "hotTempC" | "coldTempC" | "pressureBar",
    ) => {
      const r = byId.get(id);
      if (!r)
        throw new ServiceUnavailableException(
          "Pattern evidence is unavailable.",
        );
      return {
        id: r.id,
        sourceId: r.sourceId,
        sourceRow: r.sourceRow,
        importId: r.importId,
        measuredAt: r.measuredAt.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
        value: Number(r[key]),
      };
    };
    return {
      eligible: result.eligible,
      flags: result.flags
        .map((f) => {
          const key = createHash("sha256")
            .update(
              JSON.stringify([
                POLICY,
                f.parameter,
                f.kind,
                f.direction,
                f.baselineIds,
                f.sampleIds,
              ]),
            )
            .digest("hex");
          const baseline = f.baselineIds.map((id) => sample(id, f.parameter)),
            samples = f.sampleIds.map((id) => sample(id, f.parameter));
          const { baselineIds: _, sampleIds: __, ...values } = f;
          return {
            ...values,
            key,
            policyVersion: POLICY,
            name: labels[f.parameter][0],
            unit: labels[f.parameter][1],
            baseline,
            samples,
            availableAt: [...baseline, ...samples]
              .map((r) => r.receivedAt)
              .sort()
              .at(-1)!,
          };
        })
        .sort(
          (a, b) =>
            b.measuredAt.localeCompare(a.measuredAt) ||
            a.key.localeCompare(b.key),
        ),
    };
  }
  private receipt(
    r: AnomalyReview & {
      workOrder?: {
        id: string;
        status: string;
        technicianId: string | null;
      } | null;
    },
    displayName: string,
  ) {
    return {
      id: r.id,
      key: r.key,
      decision: r.decision,
      reason: r.reason,
      reviewedBy: r.reviewedBy,
      reviewerName: displayName,
      actorRole: r.actorRole,
      createdAt: r.createdAt.toISOString(),
      workOrderId: r.workOrder?.id ?? null,
      workOrderStatus: r.workOrder?.status ?? null,
      technicianId: r.workOrder?.technicianId ?? null,
    };
  }
  async list(
    user: Principal,
    code: string,
    query: z.infer<typeof anomalyQuery>,
  ) {
    const snapshot = await this.db.$transaction(
      async (tx) => {
        const { scope } = await this.access.context(tx, user, code);
        const latest = await tx.processReading.findFirst({
          where: { ...scope, source: "SYNTHETIC" },
          orderBy: { measuredAt: "desc" },
          select: { measuredAt: true },
        });
        const to =
          query.to ?? localTime(latest?.measuredAt ?? new Date()).slice(0, 10);
        const from =
          query.from ??
          new Date(Date.parse(to + "T00:00:00Z") - 13 * 86400000)
            .toISOString()
            .slice(0, 10);
        const start = localDayStart(from),
          end = new Date(localDayStart(to).getTime() + 86400000);
        return {
          scope,
          from,
          to,
          start,
          end,
          rows: await this.readings(tx, scope, start, end),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const result = await this.calculate(
      snapshot.rows,
      snapshot.start,
      snapshot.end,
    );
    return this.db.$transaction(async (tx) => {
      // Recheck current role/scope after the separate worker finishes.
      const { user: live, scope } = await this.access.context(tx, user, code);
      const reviews = await tx.anomalyReview.findMany({
        where: { ...scope, key: { in: result.flags.map((f) => f.key) } },
        include: {
          reviewer: { select: { user: { select: { displayName: true } } } },
          workOrder: { select: { id: true, status: true, technicianId: true } },
        },
      });
      const byKey = new Map(
        reviews.map((r) => [
          r.key,
          this.receipt(r, r.reviewer.user.displayName),
        ]),
      );
      const flags = result.flags.map((f) => ({
        ...f,
        review: byKey.get(f.key) ?? null,
      }));
      const filtered = flags.filter(
        (f) =>
          (!query.parameter || f.parameter === query.parameter) &&
          (!query.kind || f.kind === query.kind) &&
          (!query.status ||
            (query.status === "PENDING" ? !f.review : !!f.review)),
      );
      const index = query.after
        ? filtered.findIndex((f) => f.key === query.after)
        : -1;
      if (query.after && index < 0)
        throw new ConflictException(
          "Pattern results changed. Reload the analysis before continuing.",
        );
      const items = filtered.slice(index + 1, index + 6);
      const markers = [
        ...new Map(
          filtered.map((f) => [
            f.parameter + f.measuredAt,
            {
              parameter: f.parameter,
              measuredAt: f.measuredAt,
              value: f.value,
            },
          ]),
        ).values(),
      ];
      const observations = snapshot.rows.filter(
        (r) => r.measuredAt >= snapshot.start,
      ).length;
      return {
        source: "SYNTHETIC",
        timezone: "Asia/Kolkata",
        policyVersion: POLICY,
        from: snapshot.from,
        to: snapshot.to,
        evaluatedAt: new Date().toISOString(),
        canReview: live.role === "MAINTENANCE_HEAD",
        observations,
        eligible: result.eligible,
        insufficientHistory: observations - result.eligible.SUDDEN_CHANGE,
        total: flags.length,
        pending: flags.filter((f) => !f.review).length,
        reviewed: flags.filter((f) => !!f.review).length,
        matching: filtered.length,
        markers,
        items,
        nextCursor:
          index + 1 + items.length < filtered.length ? items.at(-1)!.key : null,
      };
    });
  }
  async review(
    user: Principal,
    code: string,
    input: z.infer<typeof reviewInput>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const { user: live, scope } = await this.access.context(tx, user, code);
        if (live.role !== "MAINTENANCE_HEAD")
          throw new ForbiddenException(
            "Only the Maintenance head can review statistical flags.",
          );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope.orgId + scope.machineId + input.key},0))`;
        const existing = await tx.anomalyReview.findUnique({
          where: { orgId_machineId_key: { ...scope, key: input.key } },
          include: {
            reviewer: { select: { user: { select: { displayName: true } } } },
            workOrder: {
              select: { id: true, status: true, technicianId: true },
            },
          },
        });
        if (existing) {
          const order = await tx.workOrder.findFirst({
            where: { ...scope, anomalyReviewId: existing.id },
            select: { id: true, reportFingerprint: true },
          });
          if (
            existing.reviewedBy !== live.userId ||
            existing.decision !== input.decision ||
            existing.reason !== input.reason ||
            existing.measuredAt.getTime() !== Date.parse(input.measuredAt) ||
            (input.technicianId &&
              order?.reportFingerprint !==
                investigationFingerprint(existing.id, input.technicianId))
          )
            throw new ConflictException(
              "This evidence has already been reviewed. Reload to see the decision.",
            );
          return {
            ...this.receipt(existing, existing.reviewer.user.displayName),
            workOrderId: order?.id ?? null,
          };
        }
        const start = new Date(input.measuredAt),
          end = new Date(start.getTime() + 3600000);
        if (start > new Date())
          throw new BadRequestException("Future readings cannot be reviewed.");
        const result = await this.calculate(
          await this.readings(tx, scope, start, end),
          start,
          end,
        );
        const evidence = result.flags.find(
          (f) => f.key === input.key && f.measuredAt === start.toISOString(),
        );
        if (!evidence)
          throw new ConflictException(
            "Pattern evidence changed or is unavailable. Reload before reviewing.",
          );
        const r = await tx.anomalyReview.create({
          data: {
            ...scope,
            key: input.key,
            policyVersion: POLICY,
            measuredAt: start,
            decision: input.decision,
            reason: input.reason,
            reviewedBy: live.userId,
            actorRole: live.role,
            evidence: evidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: scope.orgId,
            actorId: live.userId,
            entityId: r.id,
            action: "ANOMALY_REVIEWED",
            detail: {
              machineId: scope.machineId,
              key: input.key,
              decision: input.decision,
              actorRole: live.role,
              policyVersion: POLICY,
            },
          },
        });
        let workOrderId: string | null = null;
        if (input.decision === "INVESTIGATE" && input.technicianId) {
          workOrderId = await this.access.createInvestigation(
            tx,
            user,
            code,
            {
              id: r.id,
              key: input.key,
              measuredAt: start,
              reason: input.reason,
            },
            input.technicianId!,
            `Investigate ${labels[evidence.parameter as keyof typeof labels][0]} ${evidence.kind.toLowerCase().replaceAll("_", " ")}`,
          );
        }
        return {
          ...this.receipt(r, live.displayName),
          workOrderId,
          workOrderStatus: workOrderId ? "ASSIGNED" : null,
          technicianId: workOrderId ? input.technicianId : null,
        };
      },
      { timeout: 10000 },
    );
  }
  async openInvestigation(
    user: Principal,
    code: string,
    id: string,
    technicianId: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const { user: live, scope } = await this.access.context(tx, user, code);
        if (live.role !== "MAINTENANCE_HEAD")
          throw new ForbiddenException(
            "Only the Maintenance head can open investigations.",
          );
        const review = await tx.anomalyReview.findFirst({
          where: { ...scope, id },
          include: {
            reviewer: { select: { user: { select: { displayName: true } } } },
          },
        });
        if (!review) throw new NotFoundException("Review not found.");
        if (review.decision !== "INVESTIGATE")
          throw new ConflictException(
            "A dismissed review cannot open an investigation.",
          );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope.orgId + scope.machineId + review.key},0))`;
        const existing = await tx.workOrder.findFirst({
          where: { ...scope, anomalyReviewId: id },
        });
        if (existing) {
          if (
            existing.reportFingerprint !==
            investigationFingerprint(id, technicianId)
          )
            throw new ConflictException(
              "This review already has an investigation. Open its work order to reassign it.",
            );
          return this.receipt(
            { ...review, workOrder: existing },
            review.reviewer.user.displayName,
          );
        }
        const evidence = review.evidence as { name?: string; kind?: string };
        const orderId = await this.access.createInvestigation(
          tx,
          live,
          code,
          review,
          technicianId,
          `Investigate ${evidence.name ?? "statistical flag"} ${(evidence.kind ?? "").toLowerCase().replaceAll("_", " ")}`.trim(),
        );
        return {
          ...this.receipt(review, review.reviewer.user.displayName),
          workOrderId: orderId,
          workOrderStatus: "ASSIGNED",
          technicianId,
        };
      },
      { timeout: 10000 },
    );
  }
  async history(user: Principal, code: string, after?: string) {
    return this.db.$transaction(async (tx) => {
      const { user: live, scope } = await this.access.context(tx, user, code);
      const cursor = after
        ? await tx.anomalyReview.findFirst({ where: { ...scope, id: after } })
        : null;
      if (after && !cursor)
        throw new NotFoundException("Review history cursor is unavailable.");
      const rows = await tx.anomalyReview.findMany({
        where: {
          ...scope,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
        include: {
          reviewer: { select: { user: { select: { displayName: true } } } },
          workOrder: { select: { id: true, status: true, technicianId: true } },
        },
      });
      return {
        canOpenInvestigation: live.role === "MAINTENANCE_HEAD",
        items: rows.slice(0, 25).map((r) => ({
          ...this.receipt(r, r.reviewer.user.displayName),
          evidence: r.evidence,
        })),
        nextCursor: rows.length > 25 ? rows[24].id : null,
      };
    });
  }
}
