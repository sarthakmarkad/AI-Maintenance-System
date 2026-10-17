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
  Prisma,
  Role,
  WorkOrderStatus,
  WorkOrderPriority,
  ReportedImpact,
  type MaintenanceOccurrence,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { transition, type Action, type Issue } from "../domain/workflow";
import { resolveRole, technicianMembership } from "../role-access";
const text = z.string().trim().min(3).max(4000),
  version = z.number().int().min(1).max(2147483646);
export const reportSchema = z
  .object({
    requestId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: text,
    priority: z.nativeEnum(WorkOrderPriority),
    impact: z.nativeEnum(ReportedImpact),
    observedAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const actionName = z.enum([
  "assign",
  "start",
  "submit",
  "approve",
  "return",
  "close",
]);
export const actionSchemas = {
  assign: z
    .object({
      version,
      technicianId: z.string().uuid(),
      reason: text.optional(),
    })
    .strict(),
  start: z.object({ version }).strict(),
  submit: z
    .object({
      version,
      findings: text,
      rootCause: text.optional(),
      correctiveAction: text,
      preventiveAction: text.optional(),
      restoredAt: z.string().datetime({ offset: true }).optional(),
      performedAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  approve: z.object({ version, note: text.optional() }).strict(),
  return: z.object({ version, reason: text }).strict(),
  close: z.object({ version, note: text.optional() }).strict(),
};
export const listQuery = z
  .object({
    status: z.nativeEnum(WorkOrderStatus).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    after: z.string().uuid().optional(),
  })
  .strict();
export const historyQuery = z
  .object({
    beforeVersion: z.coerce.number().int().min(1).max(2147483647).optional(),
  })
  .strict();
const person = {
  select: { userId: true, user: { select: { displayName: true } } },
} as const;
const include = {
  reporter: person,
  technician: person,
  reviewer: person,
  closer: person,
  occurrence: { select: { id: true, planId: true, dueAt: true } },
} satisfies Prisma.WorkOrderInclude;
type Order = Prisma.WorkOrderGetPayload<{ include: typeof include }>;
const ref = (p: Order["technician"]) =>
  p ? { userId: p.userId, displayName: p.user.displayName } : null;
export const plannedFingerprint = (
  occurrenceId: string,
  technicianId: string,
) =>
  createHash("sha256").update(`${occurrenceId}:${technicianId}`).digest("hex");
export function allowedActions(
  order: Pick<Issue, "status" | "technicianId">,
  user: Principal,
): Action[] {
  const result: Action[] = [];
  if (
    user.role === Role.MAINTENANCE_HEAD &&
    ["REPORTED", "ASSIGNED", "IN_PROGRESS"].includes(order.status)
  )
    result.push("assign");
  if (user.role === Role.TECHNICIAN && order.technicianId === user.userId) {
    if (order.status === "ASSIGNED") result.push("start");
    if (order.status === "IN_PROGRESS") result.push("submit");
  }
  if (user.role === Role.MAINTENANCE_HEAD && order.status === "AWAITING_REVIEW")
    result.push("approve", "return");
  if (
    [Role.MAINTENANCE_HEAD, Role.SUPERVISOR].includes(
      user.role as "MAINTENANCE_HEAD" | "SUPERVISOR",
    ) &&
    order.status === "APPROVED"
  )
    result.push("close");
  return result;
}
@Injectable()
export class WorkOrdersService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  async context(tx: Prisma.TransactionClient, user: Principal, code: string) {
    const member = await tx.membership.findUnique({
      where: { userId: user.userId },
      include: { user: true },
    });
    if (!member?.active || member.orgId !== user.orgId)
      throw new ForbiddenException(
        "Workspace access changed. Refresh and try again.",
      );
    const selectedRole = await resolveRole(tx, member, user.role);
    if (!selectedRole)
      throw new ForbiddenException(
        "Your selected role is no longer available. Return to your default role.",
      );
    const live: Principal = {
      ...user,
      role: selectedRole,
      membershipId: member.id,
      displayName: member.user.displayName,
    };
    const machine =
      code === "WH-C"
        ? await tx.machine.findFirst({
            where: {
              orgId: live.orgId,
              code,
              ...([Role.OPERATOR, Role.TECHNICIAN].includes(
                live.role as "OPERATOR" | "TECHNICIAN",
              )
                ? {
                    access: {
                      some: {
                        orgId: live.orgId,
                        membershipId: live.membershipId,
                      },
                    },
                  }
                : {}),
            },
            select: { id: true },
          })
        : null;
    if (!machine)
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return {
      user: live,
      machine,
      scope: { orgId: live.orgId, machineId: machine.id },
    };
  }
  private summary(o: Order, user: Principal) {
    return {
      id: o.id,
      kind: o.kind,
      maintenanceOccurrence: o.occurrence
        ? {
            id: o.occurrence.id,
            planId: o.occurrence.planId,
            dueAt: o.occurrence.dueAt.toISOString(),
          }
        : null,
      title: o.title,
      status: o.status,
      version: o.version,
      priority: o.priority,
      impact: o.impact,
      reportedAt: o.reportedAt.toISOString(),
      observedAt: o.observedAt?.toISOString() ?? null,
      reporter: ref(o.reporter)!,
      technician: ref(o.technician),
      restoredAt: o.restoredAt?.toISOString() ?? null,
      closedAt: o.closedAt?.toISOString() ?? null,
      allowedActions: allowedActions(o, user),
    };
  }
  private events(rows: Prisma.WorkOrderEventGetPayload<object>[]) {
    return rows.map((e) => ({
      id: e.id,
      version: e.version,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: { userId: e.actorId, displayName: e.actorName },
      actorRole: e.actorRole,
      at: e.at.toISOString(),
      detail: e.detail,
    }));
  }
  private async detail(
    tx: Prisma.TransactionClient,
    o: Order,
    user: Principal,
  ) {
    const events = await tx.workOrderEvent.findMany({
      where: { orgId: o.orgId, machineId: o.machineId, orderId: o.id },
      orderBy: { version: "desc" },
      take: 51,
    });
    return {
      ...this.summary(o, user),
      description: o.description,
      startedAt: o.startedAt?.toISOString() ?? null,
      performedAt: o.performedAt?.toISOString() ?? null,
      findings: o.findings,
      rootCause: o.rootCause,
      correctiveAction: o.correctiveAction,
      preventiveAction: o.preventiveAction,
      submittedAt: o.submittedAt?.toISOString() ?? null,
      returnReason: o.returnReason,
      reviewedAt: o.reviewedAt?.toISOString() ?? null,
      reviewer: ref(o.reviewer),
      closer: ref(o.closer),
      updatedAt: o.updatedAt.toISOString(),
      events: this.events(events.slice(0, 50)),
      historyNextVersion: events.length > 50 ? events[49].version : null,
    };
  }
  private async event(
    tx: Prisma.TransactionClient,
    o: Order,
    user: Principal,
    action: string,
    fromStatus: WorkOrderStatus | null,
    detail: Prisma.InputJsonObject,
    now: Date,
  ) {
    await tx.workOrderEvent.create({
      data: {
        orgId: o.orgId,
        machineId: o.machineId,
        orderId: o.id,
        version: o.version,
        action,
        fromStatus,
        toStatus: o.status,
        actorId: user.userId,
        actorName: user.displayName,
        actorRole: user.role,
        detail,
        at: now,
      },
    });
    await tx.auditEvent.create({
      data: {
        orgId: o.orgId,
        actorId: user.userId,
        entityId: o.id,
        action: "WORK_ORDER_" + action,
        detail: {
          version: o.version,
          fromStatus,
          toStatus: o.status,
          actorRole: user.role,
        },
        at: now,
      },
    });
  }
  async report(
    user: Principal,
    code: string,
    input: z.output<typeof reportSchema>,
  ) {
    const observedAt = input.observedAt ? new Date(input.observedAt) : null;
    if (observedAt && observedAt.getTime() > Date.now())
      throw new BadRequestException(
        "First observed time cannot be in the future.",
      );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          title: input.title,
          description: input.description,
          priority: input.priority,
          impact: input.impact,
          observedAt: observedAt?.toISOString() ?? null,
        }),
      )
      .digest("hex");
    const run = async (tx: Prisma.TransactionClient, replayOnly = false) => {
      const c = await this.context(tx, user, code);
      if (c.user.role !== Role.OPERATOR)
        throw new ForbiddenException("Only an operator can report an issue.");
      const existing = await tx.workOrder.findFirst({
        where: {
          ...c.scope,
          reportedBy: c.user.userId,
          requestId: input.requestId,
        },
        include,
      });
      if (existing) {
        if (existing.reportFingerprint !== fingerprint)
          throw new ConflictException(
            "This report request was already used for different details. Start a new report.",
          );
        return {
          ...(await this.detail(tx, existing, c.user)),
          alreadyReported: true,
        };
      }
      if (replayOnly)
        throw new ConflictException(
          "Another request changed this report. Refresh before retrying.",
        );
      const now = new Date();
      const o = await tx.workOrder.create({
        data: {
          ...c.scope,
          requestId: input.requestId,
          reportFingerprint: fingerprint,
          title: input.title,
          description: input.description,
          priority: input.priority,
          impact: input.impact,
          observedAt,
          reportedBy: c.user.userId,
          reportedAt: now,
          updatedAt: now,
        },
        include,
      });
      await this.event(
        tx,
        o,
        c.user,
        "REPORT",
        null,
        {
          priority: o.priority,
          impact: o.impact,
          observedAt: o.observedAt?.toISOString() ?? null,
        },
        now,
      );
      return { ...(await this.detail(tx, o, c.user)), alreadyReported: false };
    };
    try {
      return await this.db.$transaction((tx) => run(tx), { timeout: 15000 });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return this.db.$transaction((tx) => run(tx, true));
      throw e;
    }
  }
  async createPlanned(
    tx: Prisma.TransactionClient,
    user: Principal,
    code: string,
    occurrence: MaintenanceOccurrence,
    technicianId: string,
  ) {
    const c = await this.context(tx, user, code);
    if (c.user.role !== Role.MAINTENANCE_HEAD)
      throw new ForbiddenException(
        "Only the maintenance head can release planned work.",
      );
    if (
      occurrence.orgId !== c.scope.orgId ||
      occurrence.machineId !== c.scope.machineId
    )
      throw new NotFoundException("Scheduled task not found.");
    const technician = await tx.membership.findFirst({
      where: {
        orgId: c.user.orgId,
        userId: technicianId,
        active: true,
        ...technicianMembership,
        machineAccess: {
          some: { orgId: c.user.orgId, machineId: c.machine.id },
        },
      },
      include: { user: true },
    });
    if (!technician)
      throw new BadRequestException(
        "Select an active technician with machine access.",
      );
    const now = new Date();
    const order = await tx.workOrder.create({
      data: {
        ...c.scope,
        requestId: randomUUID(),
        reportFingerprint: plannedFingerprint(occurrence.id, technicianId),
        title: occurrence.title,
        description: occurrence.instructions,
        kind: "PLANNED",
        occurrenceId: occurrence.id,
        impact: "OBSERVATION",
        priority: occurrence.priority,
        status: "ASSIGNED",
        technicianId,
        reportedBy: c.user.userId,
        reportedAt: now,
        updatedAt: now,
      },
      include,
    });
    await this.event(
      tx,
      order,
      c.user,
      "SCHEDULE",
      null,
      {
        planId: occurrence.planId,
        occurrenceId: occurrence.id,
        dueAt: occurrence.dueAt.toISOString(),
        technicianId,
        technicianName: technician.user.displayName,
      },
      now,
    );
    return order.id;
  }
  async list(user: Principal, code: string, q: z.output<typeof listQuery>) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.context(tx, user, code);
        let cursor: Prisma.WorkOrderWhereInput = {};
        if (q.after) {
          const previous = await tx.workOrder.findFirst({
            where: { ...c.scope, id: q.after },
            select: { reportedAt: true, id: true },
          });
          if (!previous)
            throw new BadRequestException("Invalid work-order page cursor.");
          cursor = {
            OR: [
              { reportedAt: { lt: previous.reportedAt } },
              { reportedAt: previous.reportedAt, id: { lt: previous.id } },
            ],
          };
        }
        const rows = await tx.workOrder.findMany({
          where: {
            ...c.scope,
            ...(q.status ? { status: q.status } : {}),
            ...cursor,
          },
          include,
          orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
          take: q.limit + 1,
        });
        const grouped = await tx.workOrder.groupBy({
          by: ["status"],
          where: c.scope,
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          Object.values(WorkOrderStatus).map((s) => [
            s,
            grouped.find((g) => g.status === s)?._count._all ?? 0,
          ]),
        );
        return {
          items: rows.slice(0, q.limit).map((o) => this.summary(o, c.user)),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          counts,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(user: Principal, code: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.context(tx, user, code);
        const o = await tx.workOrder.findFirst({
          where: { ...c.scope, id },
          include,
        });
        if (!o) throw new NotFoundException("Work order not found.");
        return this.detail(tx, o, c.user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async history(
    user: Principal,
    code: string,
    id: string,
    beforeVersion?: number,
  ) {
    return this.db.$transaction(async (tx) => {
      const c = await this.context(tx, user, code);
      if (
        !(await tx.workOrder.findFirst({
          where: { ...c.scope, id },
          select: { id: true },
        }))
      )
        throw new NotFoundException("Work order not found.");
      const rows = await tx.workOrderEvent.findMany({
        where: {
          ...c.scope,
          orderId: id,
          ...(beforeVersion ? { version: { lt: beforeVersion } } : {}),
        },
        orderBy: { version: "desc" },
        take: 51,
      });
      return {
        items: this.events(rows.slice(0, 50)),
        nextBeforeVersion: rows.length > 50 ? rows[49].version : null,
      };
    });
  }
  async technicians(user: Principal, code: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.context(tx, user, code);
      if (c.user.role !== Role.MAINTENANCE_HEAD)
        throw new ForbiddenException(
          "Only the maintenance head can assign technicians.",
        );
      const members = await tx.membership.findMany({
        where: {
          orgId: c.user.orgId,
          active: true,
          ...technicianMembership,
          machineAccess: {
            some: { orgId: c.user.orgId, machineId: c.machine.id },
          },
        },
        select: { userId: true, user: { select: { displayName: true } } },
        orderBy: { userId: "asc" },
        take: 201,
      });
      if (members.length > 200)
        throw new ConflictException(
          "Technician directory exceeds the pilot limit. Narrow the eligible roster through trusted administration.",
        );
      return {
        items: members.map((m) => ({
          userId: m.userId,
          displayName: m.user.displayName,
        })),
      };
    });
  }
  async act(
    user: Principal,
    code: string,
    id: string,
    action: Action,
    input: Record<string, unknown>,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const c = await this.context(tx, user, code),
            o = await tx.workOrder.findFirst({
              where: { ...c.scope, id },
              include,
            });
          if (!o) throw new NotFoundException("Work order not found.");
          const technicians: Principal[] = [];
          if (action === "assign") {
            if (c.user.role !== Role.MAINTENANCE_HEAD)
              throw new ForbiddenException(
                "Only the maintenance head can assign technicians.",
              );
            const member = await tx.membership.findFirst({
              where: {
                userId: String(input.technicianId),
                orgId: c.user.orgId,
                ...technicianMembership,
                active: true,
                machineAccess: {
                  some: { orgId: c.user.orgId, machineId: c.machine.id },
                },
              },
              include: { user: true },
            });
            if (!member)
              throw new BadRequestException(
                "Select an active technician with access to this machine.",
              );
            technicians.push({
              ...c.user,
              userId: member.userId,
              membershipId: member.id,
              role: Role.TECHNICIAN,
              displayName: member.user.displayName,
            });
          }
          const iso = (v: Date | null) => v?.toISOString() ?? null,
            now = new Date();
          const next = transition(
            {
              ...o,
              reportedAt: o.reportedAt.toISOString(),
              restoredAt: iso(o.restoredAt),
              performedAt: iso(o.performedAt),
              reviewedAt: iso(o.reviewedAt),
              closedAt: iso(o.closedAt),
            },
            c.user,
            action,
            input,
            technicians,
            now,
          );
          const date = (v: string | null) => (v ? new Date(v) : null);
          const updated = await tx.workOrder.updateMany({
            where: { ...c.scope, id, version: o.version },
            data: {
              status: next.status,
              version: { increment: 1 },
              technicianId: next.technicianId,
              findings: next.findings,
              rootCause: next.rootCause,
              correctiveAction: next.correctiveAction,
              preventiveAction: next.preventiveAction,
              restoredAt: date(next.restoredAt),
              performedAt: date(next.performedAt ?? null),
              reviewedAt: date(next.reviewedAt),
              reviewedBy: next.reviewedBy,
              closedAt: date(next.closedAt),
              closedBy: next.closedBy,
              updatedAt: now,
              ...(action === "assign"
                ? { startedAt: null, submittedAt: null, returnReason: null }
                : {}),
              ...(action === "start" ? { startedAt: now } : {}),
              ...(action === "submit"
                ? { submittedAt: now, returnReason: null }
                : {}),
              ...(action === "return"
                ? { returnReason: String(input.reason) }
                : {}),
            },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              "This work order changed. Reload before trying again.",
            );
          const saved = await tx.workOrder.findFirstOrThrow({
            where: { ...c.scope, id },
            include,
          });
          const detail: Prisma.InputJsonObject =
            action === "assign"
              ? {
                  previousTechnicianId: o.technicianId,
                  technicianId: next.technicianId,
                  technicianName: technicians[0].displayName,
                  reason:
                    input.reason === undefined ? null : String(input.reason),
                }
              : action === "submit"
                ? {
                    findings: next.findings,
                    preventiveAction: next.preventiveAction,
                    ...(o.kind === "PLANNED"
                      ? {
                          performedAt: next.performedAt,
                          workPerformed: next.correctiveAction,
                        }
                      : {
                          rootCause: next.rootCause,
                          correctiveAction: next.correctiveAction,
                          restoredAt: next.restoredAt,
                        }),
                  }
                : action === "return"
                  ? { reason: String(input.reason) }
                  : action === "approve" || action === "close"
                    ? {
                        note:
                          input.note === undefined ? null : String(input.note),
                      }
                    : {};
          await this.event(
            tx,
            saved,
            c.user,
            action.toUpperCase(),
            o.status,
            detail,
            now,
          );
          return this.detail(tx, saved, c.user);
        },
        { timeout: 15000, maxWait: 5000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(e.code)
      )
        throw new ConflictException(
          "Another update won. Reload the work order before retrying.",
        );
      throw e;
    }
  }
}
