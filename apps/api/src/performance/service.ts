import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, WorkOrderKind, WorkOrderStatus } from "@prisma/client";
import { z } from "zod";
import { Database } from "../database";
import { WorkOrdersService } from "../work-orders/service";
import { CalendarService } from "../calendar/service";
import {
  dayStart,
  dueAt,
  localDate,
  openOccurrence,
} from "../calendar/recurrence";
import { strictDate } from "../production/parser";
import type { Principal } from "../repository";
import {
  dailyActivity,
  elapsed,
  PERFORMANCE_POLICY,
  summarizeOrders,
} from "./calculations";
export const performanceQuery = z
  .object({
    from: z.string().refine(strictDate).optional(),
    to: z.string().refine(strictDate).optional(),
    kind: z.nativeEnum(WorkOrderKind).optional(),
  })
  .strict()
  .refine(
    (q) =>
      (!q.from && !q.to) ||
      (!!q.from &&
        !!q.to &&
        q.from <= q.to &&
        Date.parse(q.to) - Date.parse(q.from) <= 365 * 86400000),
    "Choose both dates in order, spanning at most 366 days.",
  );
const LIMIT = 10000;
@Injectable()
export class PerformanceService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly access: WorkOrdersService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
  ) {}
  async dashboard(
    user: Principal,
    code: string,
    query: z.infer<typeof performanceQuery>,
  ) {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client.$transaction(
      async (tx) => {
        const { user: live, scope } = await this.access.context(tx, user, code);
        const now = new Date(),
          today = localDate(now),
          to = query.to ?? today,
          from =
            query.from ??
            new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
        if (to > today)
          throw new BadRequestException(
            "Performance dates cannot extend beyond today in IST.",
          );
        const start = dayStart(from),
          end = new Date(dayStart(to).getTime() + 86400000);
        const filter = {
          ...scope,
          ...(query.kind ? { kind: query.kind } : {}),
        };
        const rows = await tx.workOrder.findMany({
          where: { ...filter, reportedAt: { gte: start, lt: end, lte: now } },
          select: {
            kind: true,
            status: true,
            reportedAt: true,
            submittedAt: true,
            investigationOutcome: true,
          },
          take: LIMIT + 1,
        });
        const closures = await tx.workOrder.findMany({
          where: { ...filter, closedAt: { gte: start, lt: end, lte: now } },
          select: { closedAt: true },
          take: LIMIT + 1,
        });
        if (rows.length > LIMIT || closures.length > LIMIT)
          throw new BadRequestException(
            "Performance range exceeds 10,000 work orders. Choose a shorter date range or work type.",
          );
        const openWhere = {
          ...filter,
          status: { not: "CLOSED" as const },
          reportedAt: { lte: now },
        };
        const grouped = await tx.workOrder.groupBy({
          by: ["status"],
          where: openWhere,
          _count: { _all: true },
          _min: { reportedAt: true },
        });
        const oldest = grouped
          .flatMap((g) => (g._min.reportedAt ? [g._min.reportedAt] : []))
          .sort((a, b) => a.getTime() - b.getTime())[0];
        const items = await tx.workOrder.findMany({
          where: openWhere,
          orderBy: [{ reportedAt: "asc" }, { id: "asc" }],
          take: 10,
          select: {
            id: true,
            title: true,
            kind: true,
            status: true,
            reportedAt: true,
            technician: { select: { user: { select: { displayName: true } } } },
          },
        });
        const overdueWhere = {
          ...scope,
          ...openOccurrence,
          dueAt: { lt: now },
        };
        const overduePlanned =
          !query.kind || query.kind === "PLANNED"
            ? await tx.maintenanceOccurrence.count({ where: overdueWhere })
            : null;
        const plannedApplicable = !query.kind || query.kind === "PLANNED";
        const occurrences = plannedApplicable
          ? await tx.maintenanceOccurrence.findMany({
              where: { ...scope, dueAt: { gte: start, lt: end, lte: now } },
              select: {
                dueAt: true,
                skippedAt: true,
                workOrder: { select: { status: true, closedAt: true } },
              },
              take: LIMIT + 1,
            })
          : [];
        if (occurrences.length > LIMIT)
          throw new BadRequestException(
            "Performance range exceeds 10,000 scheduled tasks. Choose a shorter date range.",
          );
        const plans = plannedApplicable
          ? await tx.maintenancePlan.findMany({
              where: { ...scope, active: true },
              select: {
                firstDueAt: true,
                frequency: true,
                interval: true,
                nextSequence: true,
              },
              take: 1001,
            })
          : [];
        if (plans.length > 1000)
          throw new ServiceUnavailableException(
            "Schedule coverage exceeds the pilot dashboard limit.",
          );
        const catchingUp = plans.some(
          (p) =>
            dueAt(p.firstDueAt, p.frequency, p.interval, p.nextSequence) <= now,
        );
        const skipped = occurrences.filter((o) => !!o.skippedAt).length;
        const completed = occurrences.filter(
          (o) =>
            !o.skippedAt &&
            o.workOrder?.status === "CLOSED" &&
            o.workOrder.closedAt &&
            o.workOrder.closedAt <= now,
        );
        const onTime = completed.filter(
          (o) => o.workOrder!.closedAt! <= o.dueAt,
        ).length;
        const eligible = occurrences.length - skipped;
        return {
          policyVersion: PERFORMANCE_POLICY,
          timezone: "Asia/Kolkata",
          from,
          to,
          kind: query.kind ?? null,
          generatedAt: now.toISOString(),
          ...summarizeOrders(rows),
          closedInRange: closures.length,
          activity: dailyActivity(from, to, rows, closures),
          current: {
            overduePlanned,
            total: grouped.reduce((s, g) => s + g._count._all, 0),
            statuses: Object.values(WorkOrderStatus)
              .filter((s) => s !== "CLOSED")
              .map((status) => ({
                key: status,
                count:
                  grouped.find((g) => g.status === status)?._count._all ?? 0,
              })),
            oldestAgeHours: oldest ? elapsed(oldest, now, now).hours : null,
            myOpen:
              live.role === "TECHNICIAN"
                ? await tx.workOrder.count({
                    where: { ...openWhere, technicianId: live.userId },
                  })
                : null,
            items: items.map((o) => ({
              id: o.id,
              title: o.title,
              kind: o.kind,
              status: o.status,
              reportedAt: o.reportedAt.toISOString(),
              ageHours: elapsed(o.reportedAt, now, now).hours!,
              technicianName: o.technician?.user.displayName ?? null,
            })),
          },
          planned: {
            applicable: plannedApplicable,
            due: occurrences.length,
            skipped,
            eligible,
            completed: completed.length,
            onTime,
            late: completed.length - onTime,
            open: eligible - completed.length,
            completionPercent:
              eligible && !catchingUp && !this.calendar.jobFailed
                ? Math.round((completed.length / eligible) * 1000) / 10
                : null,
            onTimePercent:
              eligible && !catchingUp && !this.calendar.jobFailed
                ? Math.round((onTime / eligible) * 1000) / 10
                : null,
            scheduling: {
              lastJobAt: this.calendar.lastJobAt,
              failed: this.calendar.jobFailed,
              catchingUp,
            },
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
