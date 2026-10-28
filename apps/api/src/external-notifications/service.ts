import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type Role } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { CONFIG } from "../config";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import type { NotificationAction } from "../notifications/service";
import { NOTIFICATION_CONTACT, type VerifiedContactResolver } from "./contact";
import {
  emailConfigured,
  emailPayload,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  RETRY_HORIZON_MS,
  retryDelay,
  supportsEmail,
  type EmailConfig,
  type EmailPayload,
  type PreferenceInput,
} from "./policy";
import {
  NOTIFICATION_EMAIL,
  type DeliveryResult,
  type NotificationEmailProvider,
} from "./provider";

type Preference = {
  id: string;
  orgId: string;
  machineId: string;
  userId: string;
  role: Role;
  version: number;
  enabled: boolean;
  destination: string | null;
  enabledAt: Date | null;
  verifiedAt: Date | null;
  requestId: string;
  fingerprint: string;
};
type Queue = {
  id: string;
  eventId: string;
  preferenceId: string;
  payload: EmailPayload;
  attemptCount: number;
  firstAttemptAt: Date | null;
  leaseToken: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  code: string | null;
  nextAttemptAt: Date;
};
const owned = (c: {
  user: Principal;
  scope: { orgId: string; machineId: string };
}) =>
  Prisma.sql`"orgId"=${c.scope.orgId}::uuid AND "machineId"=${c.scope.machineId}::uuid AND "userId"=${c.user.userId}::uuid AND role=${c.user.role}::maintenance."Role"`;
const current = Prisma.sql`NOT EXISTS (SELECT 1 FROM maintenance."ExternalNotificationPreference" n WHERE n."orgId"=p."orgId" AND n."machineId"=p."machineId" AND n."userId"=p."userId" AND n.role=p.role AND n.version>p.version)`;

@Injectable()
export class ExternalNotificationsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(CONFIG) private readonly config: EmailConfig,
    @Inject(NOTIFICATION_CONTACT)
    private readonly contacts: VerifiedContactResolver,
    @Inject(NOTIFICATION_EMAIL)
    private readonly provider: NotificationEmailProvider,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  async settings(user: Principal, code: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        const supported = supportsEmail(c.user.role);
        const preferences = supported
          ? await tx.$queryRaw<Preference[]>(
              Prisma.sql`SELECT * FROM maintenance."ExternalNotificationPreference" WHERE ${owned(c)} ORDER BY version DESC LIMIT 1`,
            )
          : [];
        const p = preferences[0];
        const rows = supported
          ? await tx.$queryRaw<
              (Queue & {
                orderId: string;
                action: NotificationAction;
                at: Date;
              })[]
            >(Prisma.sql`
        SELECT q.id,q."eventId",q.status,q."attemptCount",q.code,q."createdAt",q."updatedAt",q."nextAttemptAt", e."orderId",e.action,e.at
        FROM maintenance."ExternalNotificationOutbox" q JOIN maintenance."WorkOrderEvent" e ON e.id=q."eventId"
        WHERE q."orgId"=${c.scope.orgId}::uuid AND q."machineId"=${c.scope.machineId}::uuid AND q."userId"=${c.user.userId}::uuid AND q.role=${c.user.role}::maintenance."Role"
        ORDER BY q."createdAt" DESC,q.id DESC LIMIT 25`)
          : [];
        const attempts = rows.length
          ? await tx.$queryRaw<
              {
                id: string;
                outboxId: string;
                attempt: number;
                status: string;
                code: string | null;
                at: Date;
                late: boolean;
              }[]
            >(Prisma.sql`
        SELECT a.id,a."outboxId",a.attempt,a.status,a.code,a.at,a.late FROM maintenance."ExternalNotificationAttempt" a
        WHERE a."outboxId" IN (${Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`))}) ORDER BY a.at,a.id`)
          : [];
        return {
          supported,
          configured: emailConfigured(this.config),
          role: c.user.role,
          preference: {
            enabled: p?.enabled ?? false,
            version: p?.version ?? 0,
            destination: p?.destination ?? null,
            enabledAt: p?.enabledAt?.toISOString() ?? null,
            verifiedAt: p?.verifiedAt?.toISOString() ?? null,
          },
          deliveries: rows.map((r) => ({
            id: r.id,
            eventId: r.eventId,
            orderId: r.orderId,
            action: r.action,
            eventAt: r.at.toISOString(),
            status: r.status,
            attemptCount: r.attemptCount,
            code: r.code,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            nextAttemptAt:
              r.status === "PENDING" ? r.nextAttemptAt.toISOString() : null,
            attempts: attempts
              .filter((a) => a.outboxId === r.id)
              .map((a) => ({
                id: a.id,
                attempt: a.attempt,
                status: a.status,
                code: a.code,
                at: a.at.toISOString(),
                late: a.late,
              })),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async save(
    user: Principal,
    code: string,
    input: PreferenceInput,
    bearer: string,
  ) {
    // Trusted context first: unsupported/revoked views do not contact Auth for an address.
    await this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      if (!supportsEmail(c.user.role))
        throw new ForbiddenException(
          "Email handoffs are available only in your active Technician or Maintenance head role.",
        );
    });
    if (input.enabled && !emailConfigured(this.config))
      throw new ServiceUnavailableException(
        "Email notifications are not configured. You can still disable an existing preference.",
      );
    const destination = input.enabled
      ? await this.contacts.resolve(bearer, user.userId)
      : null;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          enabled: input.enabled,
          version: input.version,
          destination,
        }),
      )
      .digest("hex");
    await this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      const key = `${c.scope.orgId}:${c.scope.machineId}:${c.user.userId}:${c.user.role}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},270021))`;
      // Recheck access after waiting for the preference lock.
      await this.orders.context(tx, user, code);
      const replay = await tx.$queryRaw<Preference[]>(
        Prisma.sql`SELECT * FROM maintenance."ExternalNotificationPreference" WHERE ${owned(c)} AND "requestId"=${input.requestId}::uuid`,
      );
      if (replay[0]) {
        if (replay[0].fingerprint !== fingerprint)
          throw new ConflictException(
            "This preference request was already used with different settings. Refresh and try again.",
          );
        return;
      }
      const rows = await tx.$queryRaw<Preference[]>(
        Prisma.sql`SELECT * FROM maintenance."ExternalNotificationPreference" WHERE ${owned(c)} ORDER BY version DESC LIMIT 1`,
      );
      const prior = rows[0];
      if ((prior?.version ?? 0) !== input.version)
        throw new ConflictException(
          "Email settings changed. Refresh and try again.",
        );
      if (
        prior &&
        prior.enabled === input.enabled &&
        prior.destination === destination
      )
        return;
      await tx.$executeRaw(Prisma.sql`INSERT INTO maintenance."ExternalNotificationPreference"
        (id,"orgId","machineId","userId",role,version,enabled,destination,"enabledAt","verifiedAt","requestId",fingerprint)
        VALUES(${randomUUID()}::uuid,${c.scope.orgId}::uuid,${c.scope.machineId}::uuid,${c.user.userId}::uuid,${c.user.role}::maintenance."Role",${input.version + 1},${input.enabled},${destination},
          ${input.enabled ? Prisma.sql`clock_timestamp()` : Prisma.sql`NULL`},${input.enabled ? Prisma.sql`clock_timestamp()` : Prisma.sql`NULL`},${input.requestId}::uuid,${fingerprint})`);
      // Suppression commits atomically with disable/destination change, even while delivery is globally off.
      await tx.$executeRaw(Prisma.sql`UPDATE maintenance."ExternalNotificationOutbox" SET status='SUPPRESSED',code='STALE_OR_DISABLED',"leaseToken"=NULL,"leaseUntil"=NULL
        WHERE ${owned(c)} AND status IN ('PENDING','SENDING')`);
    });
    return this.settings(user, code);
  }
  async enqueue() {
    if (!emailConfigured(this.config)) return 0;
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        (Preference & {
          eventId: string;
          machineCode: string;
          orderId: string;
          action: NotificationAction;
          at: Date;
        })[]
      >(Prisma.sql`
        SELECT p.*,m.code AS "machineCode",e.id AS "eventId",e."orderId",e.action,e.at
        FROM maintenance."ExternalNotificationPreference" p
        JOIN maintenance."Machine" m ON m.id=p."machineId" AND m."orgId"=p."orgId"
        JOIN maintenance."WorkOrderEvent" e ON e."orgId"=p."orgId" AND e."machineId"=p."machineId" AND e.at>p."enabledAt"
        JOIN maintenance."WorkOrder" o ON o.id=e."orderId"
        WHERE p.enabled AND ${current} AND e.action IN ('REPORT','ASSIGN','SCHEDULE','INVESTIGATE','SUBMIT','RETURN')
         AND maintenance.external_notification_actionable(p."orgId",p."machineId",e.id,p."userId",p.role)
         AND NOT EXISTS(SELECT 1 FROM maintenance."ExternalNotificationOutbox" q WHERE q."preferenceId"=p.id AND q."eventId"=e.id)
        ORDER BY e.at,e.id,p.id LIMIT 100 FOR SHARE OF o SKIP LOCKED`);
      let count = 0;
      for (const r of rows) {
        const payload = emailPayload({
          from: this.config.NOTIFICATION_EMAIL_FROM!,
          destination: r.destination!,
          origin: this.config.WEB_ORIGIN,
          orderId: r.orderId,
          machineCode: r.machineCode,
          action: r.action,
          at: r.at,
        });
        count +=
          await tx.$executeRaw(Prisma.sql`INSERT INTO maintenance."ExternalNotificationOutbox"
          (id,"orgId","machineId","userId",role,"preferenceId","eventId",destination,payload)
          SELECT ${randomUUID()}::uuid,${r.orgId}::uuid,${r.machineId}::uuid,${r.userId}::uuid,${r.role}::maintenance."Role",${r.id}::uuid,${r.eventId}::uuid,${r.destination},${JSON.stringify(payload)}::jsonb
          WHERE maintenance.external_notification_actionable(${r.orgId}::uuid,${r.machineId}::uuid,${r.eventId}::uuid,${r.userId}::uuid,${r.role}::maintenance."Role")
          ON CONFLICT ("orgId","machineId","userId",role,"eventId","preferenceId") DO NOTHING`);
      }
      return count;
    });
  }
  private async reclaim() {
    // Bounded maintenance and SKIP LOCKED allow multiple API workers safely.
    await this.db.$executeRaw`WITH stale AS (
      SELECT id FROM maintenance."ExternalNotificationOutbox" WHERE status='SENDING' AND "leaseUntil"<=clock_timestamp()
      ORDER BY "leaseUntil",id LIMIT 20 FOR UPDATE SKIP LOCKED
    ) UPDATE maintenance."ExternalNotificationOutbox" q SET
      status=CASE WHEN q."firstAttemptAt"<=clock_timestamp()-interval '20 hours' OR q."attemptCount">=6 THEN 'FAILED' ELSE 'PENDING' END,
      code=CASE WHEN q."firstAttemptAt"<=clock_timestamp()-interval '20 hours' THEN 'IDEMPOTENCY_WINDOW_EXPIRED'
        WHEN q."attemptCount">=6 THEN 'ATTEMPTS_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,
      "nextAttemptAt"=clock_timestamp(),"leaseToken"=NULL,"leaseUntil"=NULL FROM stale WHERE q.id=stale.id`;
  }
  private async claim(): Promise<Queue | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        (Queue & { expired: boolean })[]
      >`SELECT *, "firstAttemptAt"<=clock_timestamp()-interval '20 hours' AS expired FROM maintenance."ExternalNotificationOutbox"
        WHERE status='PENDING' AND "nextAttemptAt"<=clock_timestamp() ORDER BY "nextAttemptAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const row = rows[0];
      if (!row) return null;
      await tx.$queryRaw`SELECT o.id FROM maintenance."WorkOrder" o JOIN maintenance."WorkOrderEvent" e ON e."orderId"=o.id
        WHERE e.id=${row.eventId}::uuid FOR SHARE OF o`;
      const valid = await tx.$queryRaw<
        { valid: boolean }[]
      >`SELECT maintenance.external_notification_current(${row.id}::uuid) AS valid`;
      const expired = row.expired;
      if (!valid[0]?.valid || row.attemptCount >= MAX_ATTEMPTS || expired) {
        const status = !valid[0]?.valid ? "SUPPRESSED" : "FAILED";
        const code = !valid[0]?.valid
          ? "STALE_OR_DISABLED"
          : expired
            ? "IDEMPOTENCY_WINDOW_EXPIRED"
            : "ATTEMPTS_EXHAUSTED";
        await tx.$executeRaw`UPDATE maintenance."ExternalNotificationOutbox" SET status=${status},code=${code} WHERE id=${row.id}::uuid`;
        return null;
      }
      const lease = randomUUID();
      const claimed = await tx.$queryRaw<
        Queue[]
      >(Prisma.sql`UPDATE maintenance."ExternalNotificationOutbox" SET status='SENDING',code='CLAIMED',
        "attemptCount"="attemptCount"+1,"firstAttemptAt"=coalesce("firstAttemptAt",clock_timestamp()),"leaseToken"=${lease}::uuid,
        "leaseUntil"=clock_timestamp()+${LEASE_SECONDS}*interval '1 second' WHERE id=${row.id}::uuid RETURNING *`);
      return claimed[0];
    });
  }
  private async beforeSend(row: Queue) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { valid: boolean }[]
      >`SELECT maintenance.external_notification_current(id) AND "leaseUntil">clock_timestamp() AND "firstAttemptAt">clock_timestamp()-interval '20 hours' AS valid
        FROM maintenance."ExternalNotificationOutbox" WHERE id=${row.id}::uuid AND status='SENDING' AND "leaseToken"=${row.leaseToken}::uuid FOR UPDATE`;
      if (rows[0]?.valid && emailConfigured(this.config)) return true;
      await tx.$executeRaw`UPDATE maintenance."ExternalNotificationOutbox" SET status='SUPPRESSED',code='STALE_OR_DISABLED',"leaseToken"=NULL,"leaseUntil"=NULL
        WHERE id=${row.id}::uuid AND status='SENDING' AND "leaseToken"=${row.leaseToken}::uuid`;
      return false;
    });
  }
  private async finish(row: Queue, result: DeliveryResult) {
    const delay =
      result.outcome === "RETRY"
        ? retryDelay(row.attemptCount, result.retryAfterSeconds)
        : 0;
    const expires = row.firstAttemptAt!.getTime() + RETRY_HORIZON_MS;
    const exhausted = row.attemptCount >= MAX_ATTEMPTS;
    const horizon = Date.now() + delay * 1000 >= expires;
    const status =
      result.outcome === "RETRY"
        ? exhausted || horizon
          ? "FAILED"
          : "PENDING"
        : result.outcome;
    const code =
      result.outcome === "SENT"
        ? "ACCEPTED"
        : result.outcome === "RETRY" && exhausted
          ? "ATTEMPTS_EXHAUSTED"
          : result.outcome === "RETRY" && horizon
            ? "IDEMPOTENCY_WINDOW_EXPIRED"
            : result.code;
    await this.db.$transaction(async (tx) => {
      const changed =
        await tx.$executeRaw`UPDATE maintenance."ExternalNotificationOutbox" SET status=${status},code=${code},"providerId"=${result.outcome === "SENT" ? result.providerId : null},
        "nextAttemptAt"=clock_timestamp()+${delay}*interval '1 second',"leaseToken"=NULL,"leaseUntil"=NULL
        WHERE id=${row.id}::uuid AND status='SENDING' AND "leaseToken"=${row.leaseToken}::uuid AND "leaseUntil">clock_timestamp()`;
      if (!changed)
        await tx.$executeRaw`INSERT INTO maintenance."ExternalNotificationAttempt"("outboxId",attempt,status,code,"providerId","leaseToken",late)
        VALUES(${row.id}::uuid,${row.attemptCount},${status},${code},${result.outcome === "SENT" ? result.providerId : null},${row.leaseToken}::uuid,true)
        ON CONFLICT ("outboxId",attempt,status,"leaseToken") WHERE late DO NOTHING`;
    });
  }
  async runJobs() {
    if (!emailConfigured(this.config)) return;
    await this.enqueue();
    await this.reclaim();
    // One bounded send per 30-second tick: intentionally modest pilot throughput.
    const row = await this.claim();
    if (!row || !(await this.beforeSend(row))) return;
    let result: DeliveryResult;
    try {
      result = await this.provider.send(row.id, row.payload);
    } catch {
      result = { outcome: "RETRY", code: "NETWORK_UNCERTAIN" };
    }
    await this.finish(row, result);
  }
}
