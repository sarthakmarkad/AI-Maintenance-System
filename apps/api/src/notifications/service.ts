import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";

export const notificationQuery = z
  .object({ after: z.string().uuid().optional() })
  .strict();
export const notificationRead = z.object({}).strict();

export type NotificationAction =
  | "ASSIGN"
  | "SCHEDULE"
  | "INVESTIGATE"
  | "SUBMIT"
  | "RETURN";
export function notificationMessage(
  action: NotificationAction,
  reassigned: boolean,
) {
  switch (action) {
    case "SUBMIT":
      return "Submitted for maintenance-head review. Review the technician’s findings.";
    case "RETURN":
      return "Returned by the maintenance head. Read the return reason and submit updated findings.";
    case "SCHEDULE":
      return "Planned maintenance released to you. Open the work order to start maintenance.";
    case "INVESTIGATE":
      return "Investigation released to you. Inspect the retained synthetic evidence; no fault is inferred.";
    case "ASSIGN":
      return `${reassigned ? "Reassigned" : "Assigned"} to you. Open the work order to start work.`;
  }
}
type Row = {
  id: string;
  orderId: string;
  title: string;
  kind: string;
  action: NotificationAction;
  version: number;
  at: Date;
  readAt: Date | null;
  reassigned: boolean;
  actorName: string;
};

// Source events and audit already commit atomically with every workflow path.
// ATTACH adds evidence/version without replacing the current workflow stage.
function eligible(
  user: Principal,
  scope: { orgId: string; machineId: string },
) {
  const recipient =
    user.role === Role.TECHNICIAN
      ? Prisma.sql`o."technicianId" = ${user.userId}::uuid AND (
        (e.action IN ('ASSIGN','SCHEDULE','INVESTIGATE') AND o.status = 'ASSIGNED') OR
        (e.action = 'RETURN' AND o.status = 'IN_PROGRESS'))`
      : user.role === Role.MAINTENANCE_HEAD
        ? Prisma.sql`e.action = 'SUBMIT' AND o.status = 'AWAITING_REVIEW'`
        : Prisma.sql`FALSE`;
  return Prisma.sql`e."orgId" = ${scope.orgId}::uuid AND e."machineId" = ${scope.machineId}::uuid
    AND (${recipient}) AND NOT EXISTS (
      SELECT 1 FROM maintenance."WorkOrderEvent" newer
      WHERE newer."orderId" = e."orderId" AND newer.version > e.version AND newer.action <> 'ATTACH'
    )`;
}
const source = Prisma.sql`FROM maintenance."WorkOrderEvent" e
  JOIN maintenance."WorkOrder" o ON o.id = e."orderId" AND o."orgId" = e."orgId" AND o."machineId" = e."machineId"`;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  async list(
    user: Principal,
    code: string,
    q: z.output<typeof notificationQuery>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        const where = eligible(c.user, c.scope);
        let cursor = Prisma.sql`TRUE`;
        if (q.after) {
          const prior = await tx.$queryRaw<
            { at: Date; id: string }[]
          >(Prisma.sql`
          SELECT e.at, e.id ${source} WHERE ${where} AND e.id = ${q.after}::uuid`);
          if (!prior[0])
            throw new BadRequestException(
              "Notification list changed. Refresh notifications.",
            );
          cursor = Prisma.sql`(e.at, e.id) < (${prior[0].at}, ${prior[0].id}::uuid)`;
        }
        const receipt = Prisma.sql`LEFT JOIN maintenance."WorkOrderNotificationReceipt" r
        ON r."eventId" = e.id AND r."userId" = ${c.user.userId}::uuid AND r.role = ${c.user.role}::maintenance."Role"`;
        const counts = await tx.$queryRaw<{ unread: number }[]>(Prisma.sql`
        SELECT count(*)::integer AS unread ${source} ${receipt} WHERE ${where} AND r.id IS NULL`);
        const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT e.id, e."orderId", o.title, o.kind, e.action, e.version, e.at, e."actorName", r."readAt",
          (e.action = 'ASSIGN' AND e."fromStatus" <> 'REPORTED') AS reassigned
        ${source} ${receipt} WHERE ${where} AND ${cursor} ORDER BY e.at DESC, e.id DESC LIMIT 26`);
        return {
          unread: counts[0].unread,
          items: rows.slice(0, 25).map((r) => ({
            id: r.id,
            orderId: r.orderId,
            title: r.title,
            kind: r.kind,
            action: r.action,
            eventVersion: r.version,
            actorName: r.actorName,
            message: notificationMessage(r.action, r.reassigned),
            createdAt: r.at.toISOString(),
            readAt: r.readAt?.toISOString() ?? null,
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
      // Serialize against workflow changes without advancing its version. A
      // waiting reader rechecks current stage after the action commits.
      await tx.$queryRaw(Prisma.sql`SELECT o.id ${source}
        WHERE e.id = ${id}::uuid AND e."orgId" = ${c.scope.orgId}::uuid
          AND e."machineId" = ${c.scope.machineId}::uuid FOR SHARE OF o`);
      const live = await this.orders.context(tx, user, code);
      const current = await tx.$queryRaw<
        { id: string; orderId: string }[]
      >(Prisma.sql`
        SELECT e.id, e."orderId" ${source} WHERE ${eligible(live.user, live.scope)} AND e.id = ${id}::uuid`);
      if (!current[0])
        throw new NotFoundException(
          "Notification not found or no longer actionable. Refresh notifications.",
        );
      const inserted = await tx.$queryRaw<{ readAt: Date }[]>(Prisma.sql`
        INSERT INTO maintenance."WorkOrderNotificationReceipt" (id,"orgId","machineId","eventId","userId",role)
        VALUES (${randomUUID()}::uuid,${live.scope.orgId}::uuid,${live.scope.machineId}::uuid,${id}::uuid,
          ${live.user.userId}::uuid,${live.user.role}::maintenance."Role")
        ON CONFLICT ("eventId","userId",role) DO NOTHING RETURNING "readAt"`);
      if (inserted.length)
        await tx.auditEvent.create({
          data: {
            orgId: live.scope.orgId,
            actorId: live.user.userId,
            entityId: id,
            action: "WORK_ORDER_NOTIFICATION_READ",
            detail: { actorRole: live.user.role, orderId: current[0].orderId },
          },
        });
      const receipts = inserted.length
        ? inserted
        : await tx.$queryRaw<{ readAt: Date }[]>(Prisma.sql`
        SELECT "readAt" FROM maintenance."WorkOrderNotificationReceipt"
        WHERE "eventId"=${id}::uuid AND "userId"=${live.user.userId}::uuid AND role=${live.user.role}::maintenance."Role"`);
      return { read: true, readAt: receipts[0].readAt.toISOString() };
    });
  }
}
