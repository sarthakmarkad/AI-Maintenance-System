import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  MaintenanceFrequency,
  Prisma,
  Role,
  WorkOrderPriority,
  type MaintenancePlan,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { technicianMembership } from "../role-access";
import { WorkOrdersService, plannedFingerprint } from "../work-orders/service";
import { strictDate } from "../production/parser";
import {
  dayStart,
  dueAt,
  horizon,
  localDate,
  nextDay,
  openOccurrence,
  phase,
} from "./recurrence";
const text = z.string().trim().min(3).max(4000),
  version = z.number().int().min(1).max(2147483646);
export const planInput = z
  .object({
    requestId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    instructions: text,
    frequency: z.nativeEnum(MaintenanceFrequency),
    interval: z.number().int().min(1).max(12),
    firstDueAt: z.string().datetime({ offset: true }),
    technicianId: z.string().uuid(),
    priority: z.nativeEnum(WorkOrderPriority),
    remindDays: z.number().int().min(1).max(14),
  })
  .strict();
export const planState = z
  .object({ version, active: z.boolean(), reason: text })
  .strict();
export const releaseInput = z
  .object({ version, technicianId: z.string().uuid() })
  .strict();
export const skipInput = z.object({ version, reason: text }).strict();
export const calendarQuery = z
  .object({
    from: z.string().refine(strictDate),
    to: z.string().refine(strictDate),
    status: z
      .enum(["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "SKIPPED"])
      .optional(),
    after: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (q) =>
      q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 61 * 86400000,
    "Choose an ordered range of at most 62 days.",
  );
export const reminderQuery = z
  .object({ after: z.string().uuid().optional() })
  .strict();
const include = {
  technician: {
    select: { userId: true, user: { select: { displayName: true } } },
  },
  workOrder: {
    select: { id: true, status: true, technicianId: true, closedAt: true },
  },
  plan: { select: { active: true } },
} satisfies Prisma.MaintenanceOccurrenceInclude;
type Occurrence = Prisma.MaintenanceOccurrenceGetPayload<{
  include: typeof include;
}>;
@Injectable()
export class CalendarService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  lastJobAt: string | null = null;
  jobFailed = false;
  private head(user: Principal) {
    if (user.role !== Role.MAINTENANCE_HEAD)
      throw new ForbiddenException(
        "Only the maintenance head can manage maintenance plans and scheduled tasks.",
      );
  }
  private async audit(
    tx: Prisma.TransactionClient,
    scope: { orgId: string },
    entityId: string,
    action: string,
    detail: Prisma.InputJsonObject,
    user?: Principal,
  ) {
    await tx.auditEvent.create({
      data: {
        orgId: scope.orgId,
        entityId,
        action,
        actorId: user?.userId ?? null,
        detail: {
          ...detail,
          actorRole: user?.role ?? null,
          actorName: user?.displayName ?? null,
          source: user ? "MAINTENANCE_CALENDAR" : "SCHEDULE_WORKER",
        },
      },
    });
  }
  private planView(
    p: MaintenancePlan & { technician?: { user: { displayName: string } } },
    now: Date,
  ) {
    return {
      id: p.id,
      requestId: p.requestId,
      title: p.title,
      instructions: p.instructions,
      frequency: p.frequency,
      interval: p.interval,
      technicianId: p.technicianId,
      technicianName: p.technician?.user.displayName ?? "Assigned technician",
      priority: p.priority,
      remindDays: p.remindDays,
      active: p.active,
      version: p.version,
      pauseReason: p.pauseReason,
      nextSequence: p.nextSequence,
      firstDueAt: p.firstDueAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      lastGeneratedAt: p.lastGeneratedAt?.toISOString() ?? null,
      nextDueAt: dueAt(
        p.firstDueAt,
        p.frequency,
        p.interval,
        p.nextSequence,
      ).toISOString(),
      catchingUp:
        p.active &&
        dueAt(p.firstDueAt, p.frequency, p.interval, p.nextSequence) <=
          horizon(now),
    };
  }
  private occurrenceView(o: Occurrence, now: Date) {
    return {
      id: o.id,
      planId: o.planId,
      sequence: o.sequence,
      title: o.title,
      instructions: o.instructions,
      dueAt: o.dueAt.toISOString(),
      priority: o.priority,
      version: o.version,
      technician: {
        userId: o.technician.userId,
        displayName: o.technician.user.displayName,
      },
      workOrderId: o.workOrder?.id ?? null,
      workOrderStatus: o.workOrder?.status ?? null,
      status: o.skippedAt
        ? "SKIPPED"
        : o.workOrder?.status === "CLOSED"
          ? "COMPLETED"
          : phase(o.dueAt, now),
      skippedAt: o.skippedAt?.toISOString() ?? null,
      skipReason: o.skipReason,
      planActive: o.plan.active,
    };
  }
  async plans(user: Principal, code: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      const plans = await tx.maintenancePlan.findMany({
        where: c.scope,
        include: {
          technician: { select: { user: { select: { displayName: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        items: plans.map((p) => this.planView(p, new Date())),
        canManage: c.user.role === Role.MAINTENANCE_HEAD,
      };
    });
  }
  async create(
    user: Principal,
    code: string,
    input: z.output<typeof planInput>,
  ) {
    const first = new Date(input.firstDueAt),
      now = new Date();
    if (
      first.getTime() < dayStart(localDate(now)).getTime() - 31 * 86400000 ||
      first.getTime() > now.getTime() + 366 * 86400000
    )
      throw new BadRequestException(
        "First due time must be within the last 31 days or the next 366 days.",
      );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...input,
          firstDueAt: first.toISOString(),
          requestId: undefined,
        }),
      )
      .digest("hex");
    const execute = async (tx: Prisma.TransactionClient, replay = false) => {
      const c = await this.orders.context(tx, user, code);
      this.head(c.user);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.scope.orgId + "/" + c.scope.machineId},0))`;
      const existing = await tx.maintenancePlan.findFirst({
        where: {
          ...c.scope,
          createdBy: c.user.userId,
          requestId: input.requestId,
        },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException(
            "This request key was already used for a different plan.",
          );
        return this.planView(existing, now);
      }
      if (replay)
        throw new ConflictException(
          "Plan creation changed. Reload before retrying.",
        );
      const technician = await tx.membership.findFirst({
        where: {
          orgId: c.user.orgId,
          userId: input.technicianId,
          active: true,
          ...technicianMembership,
          machineAccess: {
            some: { orgId: c.user.orgId, machineId: c.machine.id },
          },
        },
      });
      if (!technician)
        throw new BadRequestException(
          "Select an active technician with machine access.",
        );
      if ((await tx.maintenancePlan.count({ where: c.scope })) >= 100)
        throw new ConflictException(
          "The local pilot supports at most 100 plans per machine.",
        );
      const {
        requestId,
        title,
        instructions,
        frequency,
        interval,
        technicianId,
        priority,
        remindDays,
      } = input;
      const p = await tx.maintenancePlan.create({
        data: {
          ...c.scope,
          requestId,
          title,
          instructions,
          frequency,
          interval,
          firstDueAt: first,
          technicianId,
          priority,
          remindDays,
          fingerprint,
          createdBy: c.user.userId,
        },
      });
      await this.audit(
        tx,
        c.scope,
        p.id,
        "MAINTENANCE_PLAN_CREATED",
        {
          frequency,
          interval,
          firstDueAt: first.toISOString(),
          technicianId,
          remindDays,
        },
        c.user,
      );
      await this.generate(tx, p, now);
      return this.planView(
        await tx.maintenancePlan.findUniqueOrThrow({ where: { id: p.id } }),
        now,
      );
    };
    try {
      return await this.db.$transaction((tx) => execute(tx), {
        timeout: 15000,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return this.db.$transaction((tx) => execute(tx, true));
      throw e;
    }
  }
  async state(
    user: Principal,
    code: string,
    id: string,
    input: z.output<typeof planState>,
  ) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      this.head(c.user);
      const p = await tx.maintenancePlan.findFirst({
        where: { ...c.scope, id },
      });
      if (!p) throw new NotFoundException("Maintenance plan not found.");
      if (p.version !== input.version || p.active === input.active)
        throw new ConflictException(
          "The plan changed or is already in that state. Reload before trying again.",
        );
      const changed = await tx.maintenancePlan.updateMany({
        where: { ...c.scope, id, version: input.version },
        data: {
          active: input.active,
          pauseReason: input.active ? null : input.reason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Plan changed. Reload before trying again.",
        );
      await this.audit(
        tx,
        c.scope,
        id,
        input.active ? "MAINTENANCE_PLAN_RESUMED" : "MAINTENANCE_PLAN_PAUSED",
        { reason: input.reason, version: input.version + 1 },
        c.user,
      );
      return this.planView(
        await tx.maintenancePlan.findUniqueOrThrow({ where: { id } }),
        new Date(),
      );
    });
  }
  private async lockOccurrence(
    tx: Prisma.TransactionClient,
    scope: { orgId: string; machineId: string },
    id: string,
  ) {
    await tx.$queryRaw`SELECT id FROM maintenance."MaintenanceOccurrence" WHERE id=${id}::uuid AND "orgId"=${scope.orgId}::uuid AND "machineId"=${scope.machineId}::uuid FOR UPDATE`;
    const o = await tx.maintenanceOccurrence.findFirst({
      where: { ...scope, id },
      include: { workOrder: true },
    });
    if (!o) throw new NotFoundException("Scheduled task not found.");
    return o;
  }
  async release(
    user: Principal,
    code: string,
    id: string,
    input: z.output<typeof releaseInput>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        this.head(c.user);
        const o = await this.lockOccurrence(tx, c.scope, id);
        if (o.workOrder) {
          if (
            o.workOrder.reportFingerprint !==
            plannedFingerprint(id, input.technicianId)
          )
            throw new ConflictException(
              "This task already has a work order. Open it to review assignment.",
            );
          return { orderId: o.workOrder.id, alreadyReleased: true };
        }
        if (o.skippedAt || o.version !== input.version)
          throw new ConflictException(
            "The scheduled task changed. Reload before trying again.",
          );
        const orderId = await this.orders.createPlanned(
          tx,
          c.user,
          code,
          o,
          input.technicianId,
        );
        await tx.maintenanceOccurrence.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await this.audit(
          tx,
          c.scope,
          id,
          "MAINTENANCE_TASK_RELEASED",
          { orderId, version: o.version + 1 },
          c.user,
        );
        return { orderId, alreadyReleased: false };
      },
      { timeout: 15000 },
    );
  }
  async skip(
    user: Principal,
    code: string,
    id: string,
    input: z.output<typeof skipInput>,
  ) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      this.head(c.user);
      const o = await this.lockOccurrence(tx, c.scope, id);
      if (o.workOrder || o.skippedAt || o.version !== input.version)
        throw new ConflictException(
          "Only an unreleased, unchanged task can be skipped. Reload before trying again.",
        );
      await tx.maintenanceOccurrence.update({
        where: { id },
        data: {
          version: { increment: 1 },
          skippedAt: new Date(),
          skippedBy: c.user.userId,
          skipReason: input.reason,
        },
      });
      await this.audit(
        tx,
        c.scope,
        id,
        "MAINTENANCE_TASK_SKIPPED",
        { reason: input.reason, version: o.version + 1 },
        c.user,
      );
      return { skipped: true };
    });
  }
  async calendar(
    user: Principal,
    code: string,
    q: z.output<typeof calendarQuery>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code),
          now = new Date(),
          start = dayStart(q.from),
          end = new Date(dayStart(q.to).getTime() + 86400000),
          tomorrow = nextDay(now);
        const scope = { ...c.scope, dueAt: { gte: start, lt: end } };
        const states: Record<string, Prisma.MaintenanceOccurrenceWhereInput> = {
          UPCOMING: { AND: [openOccurrence, { dueAt: { gte: tomorrow } }] },
          DUE: { AND: [openOccurrence, { dueAt: { gte: now, lt: tomorrow } }] },
          OVERDUE: { AND: [openOccurrence, { dueAt: { lt: now } }] },
          COMPLETED: { workOrder: { is: { status: "CLOSED" } } },
          SKIPPED: { skippedAt: { not: null } },
        };
        let cursor: Prisma.MaintenanceOccurrenceWhereInput = {};
        if (q.after) {
          const previous = await tx.maintenanceOccurrence.findFirst({
            where: { ...c.scope, id: q.after },
          });
          if (!previous)
            throw new BadRequestException("Invalid calendar cursor.");
          cursor = {
            OR: [
              { dueAt: { gt: previous.dueAt } },
              { dueAt: previous.dueAt, id: { gt: previous.id } },
            ],
          };
        }
        const rows = await tx.maintenanceOccurrence.findMany({
          where: { AND: [scope, q.status ? states[q.status] : {}, cursor] },
          include,
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: 101,
        });
        const counts: Record<string, number> = {};
        for (const [key, where] of Object.entries(states))
          counts[key] = await tx.maintenanceOccurrence.count({
            where: { AND: [scope, where] },
          });
        const grouped = await tx.maintenanceOccurrence.groupBy({
            by: ["dueAt"],
            where: scope,
            _count: { _all: true },
          }),
          dayCounts: Record<string, number> = {};
        for (const g of grouped) {
          const day = localDate(g.dueAt);
          dayCounts[day] = (dayCounts[day] ?? 0) + g._count._all;
        }
        const plans = await tx.maintenancePlan.findMany({
          where: { ...c.scope, active: true },
          take: 100,
        });
        return {
          items: rows.slice(0, 100).map((o) => this.occurrenceView(o, now)),
          nextCursor: rows.length > 100 ? rows[99].id : null,
          counts,
          dayCounts,
          canManage: c.user.role === Role.MAINTENANCE_HEAD,
          serverTime: now.toISOString(),
          scheduling: {
            lastJobAt: this.lastJobAt,
            failed: this.jobFailed,
            catchingUp: plans.some(
              (p) =>
                dueAt(p.firstDueAt, p.frequency, p.interval, p.nextSequence) <=
                horizon(now),
            ),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private reminderWhere(
    scope: { orgId: string; machineId: string },
    user: Principal,
    now: Date,
  ): Prisma.MaintenanceReminderWhereInput {
    if (
      ![Role.MAINTENANCE_HEAD, Role.SUPERVISOR, Role.TECHNICIAN].includes(
        user.role as "MAINTENANCE_HEAD" | "SUPERVISOR" | "TECHNICIAN",
      )
    )
      return { ...scope, id: "00000000-0000-0000-0000-000000000000" };
    const tomorrow = nextDay(now);
    return {
      ...scope,
      occurrence: {
        is: {
          AND: [
            openOccurrence,
            ...(user.role === Role.TECHNICIAN
              ? [
                  {
                    OR: [
                      { workOrder: { is: { technicianId: user.userId } } },
                      { workOrder: { is: null }, technicianId: user.userId },
                    ],
                  },
                ]
              : []),
          ],
        },
      },
      OR: [
        { kind: "OVERDUE", occurrence: { is: { dueAt: { lt: now } } } },
        {
          kind: "DUE",
          occurrence: { is: { dueAt: { gte: now, lt: tomorrow } } },
        },
        {
          kind: "UPCOMING",
          occurrence: {
            is: { dueAt: { gte: tomorrow }, remindAt: { lte: now } },
          },
        },
      ],
    };
  }
  async reminders(
    user: Principal,
    code: string,
    q: z.output<typeof reminderQuery>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code),
          now = new Date(),
          where = this.reminderWhere(c.scope, c.user, now),
          unread = { userId: c.user.userId, role: c.user.role };
        let cursor: Prisma.MaintenanceReminderWhereInput = {};
        if (q.after) {
          const prior = await tx.maintenanceReminder.findFirst({
            where: { AND: [where, { id: q.after }] },
            include: { occurrence: { select: { dueAt: true } } },
          });
          if (!prior)
            throw new BadRequestException(
              "Reminder list changed. Reload reminders.",
            );
          cursor = {
            OR: [
              { occurrence: { is: { dueAt: { gt: prior.occurrence.dueAt } } } },
              {
                occurrence: { is: { dueAt: prior.occurrence.dueAt } },
                id: { gt: prior.id },
              },
            ],
          };
        }
        const rows = await tx.maintenanceReminder.findMany({
          where: { AND: [where, cursor] },
          include: {
            occurrence: { include: { workOrder: { select: { id: true } } } },
            receipts: { where: unread, take: 1 },
          },
          orderBy: [{ occurrence: { dueAt: "asc" } }, { id: "asc" }],
          take: 26,
        });
        return {
          unread: await tx.maintenanceReminder.count({
            where: { AND: [where, { receipts: { none: unread } }] },
          }),
          items: rows.slice(0, 25).map((r) => ({
            id: r.id,
            kind: r.kind,
            occurrenceId: r.occurrenceId,
            title: r.occurrence.title,
            dueAt: r.occurrence.dueAt.toISOString(),
            orderId: r.occurrence.workOrder?.id ?? null,
            read: !!r.receipts.length,
            createdAt: r.createdAt.toISOString(),
          })),
          nextCursor: rows.length > 25 ? rows[24].id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async read(user: Principal, code: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      const r = await tx.maintenanceReminder.findFirst({
        where: {
          AND: [this.reminderWhere(c.scope, c.user, new Date()), { id }],
        },
      });
      if (!r)
        throw new NotFoundException(
          "Reminder not found or no longer actionable.",
        );
      await tx.maintenanceReminderReceipt.createMany({
        data: [
          {
            ...c.scope,
            reminderId: id,
            userId: c.user.userId,
            role: c.user.role,
          },
        ],
        skipDuplicates: true,
      });
      return { read: true };
    });
  }
  private async generate(
    tx: Prisma.TransactionClient,
    p: MaintenancePlan,
    now: Date,
  ) {
    if (!p.active) return;
    const data: Prisma.MaintenanceOccurrenceCreateManyInput[] = [];
    let sequence = p.nextSequence;
    while (data.length < 128) {
      const due = dueAt(p.firstDueAt, p.frequency, p.interval, sequence);
      if (due > horizon(now)) break;
      data.push({
        orgId: p.orgId,
        machineId: p.machineId,
        planId: p.id,
        sequence,
        dueAt: due,
        remindAt: new Date(due.getTime() - p.remindDays * 86400000),
        title: p.title,
        instructions: p.instructions,
        technicianId: p.technicianId,
        priority: p.priority,
      });
      sequence++;
    }
    if (!data.length) return;
    const inserted = await tx.maintenanceOccurrence.createMany({
      data,
      skipDuplicates: true,
    });
    await tx.maintenancePlan.update({
      where: { id: p.id },
      data: { nextSequence: sequence, lastGeneratedAt: now },
    });
    await this.audit(tx, p, p.id, "MAINTENANCE_OCCURRENCES_CREATED", {
      fromSequence: p.nextSequence,
      nextSequence: sequence,
      count: inserted.count,
    });
  }
  private planCursor: string | undefined;
  async runJobs(
    now = new Date(),
    scope?: { orgId: string; machineId: string },
  ) {
    const plans = await this.db.maintenancePlan.findMany({
      where: {
        active: true,
        ...scope,
        ...(!scope && this.planCursor ? { id: { gt: this.planCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!scope)
      this.planCursor = plans.length === 100 ? plans.at(-1)!.id : undefined;
    for (const p of plans)
      await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM maintenance."MaintenancePlan" WHERE id=${p.id}::uuid FOR UPDATE`;
          const current = await tx.maintenancePlan.findUniqueOrThrow({
            where: { id: p.id },
          });
          await this.generate(tx, current, now);
        },
        { timeout: 15000 },
      );
    const tomorrow = nextDay(now),
      candidates = await this.db.maintenanceOccurrence.findMany({
        where: {
          ...scope,
          AND: [
            openOccurrence,
            {
              OR: [
                {
                  dueAt: { lt: now },
                  reminders: { none: { kind: "OVERDUE" } },
                },
                {
                  dueAt: { gte: now, lt: tomorrow },
                  reminders: { none: { kind: "DUE" } },
                },
                {
                  dueAt: { gte: tomorrow },
                  remindAt: { lte: now },
                  reminders: { none: { kind: "UPCOMING" } },
                },
              ],
            },
          ],
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 250,
      });
    const grouped = new Map<string, typeof candidates>();
    for (const o of candidates) {
      const key = o.orgId + "/" + o.machineId;
      grouped.set(key, [...(grouped.get(key) ?? []), o]);
    }
    for (const group of grouped.values())
      await this.db.$transaction(async (tx) => {
        const created = await tx.maintenanceReminder.createMany({
          data: group.map((o) => ({
            orgId: o.orgId,
            machineId: o.machineId,
            occurrenceId: o.id,
            kind: phase(o.dueAt, now),
            createdAt: now,
          })),
          skipDuplicates: true,
        });
        if (created.count)
          await this.audit(
            tx,
            group[0],
            group[0].machineId,
            "MAINTENANCE_REMINDERS_CREATED",
            { count: created.count, occurrences: group.map((o) => o.id) },
          );
      });
    this.lastJobAt = now.toISOString();
    this.jobFailed = false;
  }
}
