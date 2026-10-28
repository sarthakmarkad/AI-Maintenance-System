import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CONFIG, type Config } from "../config";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import { RCA_AI, rcaSettings, type RcaAi } from "./provider";
import {
  assertCanGenerate,
  digest,
  generateRcaSchema,
  RCA_POLICY,
  RcaProviderError,
  snapshot,
  validateRcaOutput,
  type RcaDraft,
  type RcaInput,
  type RcaSnapshot,
} from "./policy";
export type RcaReceipt = {
  id: string;
  requestId: string;
  orderId: string;
  version: number;
  sourceHash: string;
  model: string;
  policy: string;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
  status: "GENERATED" | "FAILED" | "STALE" | "PENDING";
  reason: string | null;
  draft: RcaDraft | null;
  snapshot: RcaSnapshot;
  stale: boolean;
};
type RequestRow = {
  id: string;
  orgId: string;
  machineId: string;
  orderId: string;
  userId: string;
  requestId: string;
  fingerprint: string;
  version: number;
  sourceHash: string;
  model: string;
  policy: string;
  snapshot: RcaSnapshot;
  createdAt: Date;
};
type TerminalRow = {
  status: "GENERATED" | "FAILED" | "STALE";
  reason: string | null;
  draft: RcaDraft | null;
  completedAt: Date;
};
@Injectable()
export class RcaService {
  private active = 0;
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RCA_AI) private readonly ai: RcaAi,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async order(
    tx: Prisma.TransactionClient,
    scope: { orgId: string; machineId: string },
    id: string,
  ) {
    // Short row lock serializes final evidence/version checks with ordinary workflow/attachment CAS.
    await tx.$queryRaw`SELECT id FROM maintenance."WorkOrder" WHERE "orgId"=${scope.orgId}::uuid AND "machineId"=${scope.machineId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const order = await tx.workOrder.findFirst({ where: { ...scope, id } });
    if (!order) throw new NotFoundException("Work order not found.");
    return order;
  }
  private async evidence(
    tx: Prisma.TransactionClient,
    order: Awaited<ReturnType<RcaService["order"]>>,
    input: RcaInput,
    code: string,
    at?: Date,
  ) {
    const events = await tx.workOrderEvent.findMany({
      where: {
        orgId: order.orgId,
        machineId: order.machineId,
        orderId: order.id,
      },
      orderBy: { version: "asc" },
      take: 101,
    });
    return snapshot(order, events, input.human, at, code);
  }
  private async terminal(tx: Prisma.TransactionClient, id: string) {
    return (
      await tx.$queryRaw<
        TerminalRow[]
      >`SELECT status, reason, draft, "completedAt" FROM maintenance."RcaDraftReceipt" WHERE "requestId"=${id}::uuid`
    )[0];
  }
  private receipt(
    row: RequestRow,
    terminal: TerminalRow | undefined,
    version: number,
  ): RcaReceipt {
    return {
      id: row.id,
      requestId: row.requestId,
      orderId: row.orderId,
      version: row.version,
      sourceHash: row.sourceHash,
      model: row.model,
      policy: row.policy,
      requestedBy: row.userId,
      createdAt: row.createdAt.toISOString(),
      completedAt: terminal?.completedAt.toISOString() ?? null,
      status: terminal?.status ?? "PENDING",
      reason:
        terminal?.reason ??
        (!terminal && Date.now() - row.createdAt.getTime() > 75000
          ? "RCA_REQUEST_UNCERTAIN"
          : null),
      draft: terminal?.draft ?? null,
      snapshot: row.snapshot,
      stale: row.version !== version,
    };
  }
  private async audit(
    tx: Prisma.TransactionClient,
    row: RequestRow,
    action: string,
    status: string,
  ) {
    await tx.auditEvent.create({
      data: {
        orgId: row.orgId,
        actorId: row.userId,
        entityId: row.id,
        action,
        detail: {
          orderId: row.orderId,
          version: row.version,
          sourceHash: row.sourceHash,
          requestId: row.requestId,
          model: row.model,
          policy: row.policy,
          actorRole: "TECHNICIAN",
          status,
        },
      },
    });
  }
  private async saveTerminal(
    tx: Prisma.TransactionClient,
    row: RequestRow,
    status: TerminalRow["status"],
    reason: string | null,
    draft: RcaDraft | null,
  ) {
    await tx.$executeRaw`INSERT INTO maintenance."RcaDraftReceipt" ("requestId",status,reason,draft) VALUES (${row.id}::uuid,${status},${reason},${draft ? JSON.stringify(draft) : null}::jsonb)`;
    await this.audit(tx, row, "RCA_DRAFT_" + status, status);
    return (await this.terminal(tx, row.id))!;
  }
  async generate(
    user: Principal,
    code: string,
    orderId: string,
    raw: RcaInput,
  ): Promise<RcaReceipt> {
    // Validate at service boundary too; callers cannot inject sources/roles/metadata.
    const input = generateRcaSchema.parse(raw),
      fingerprint = digest({ orderId, ...input });
    const reserved = await this.db.$transaction(
      async (tx) => {
        let c = await this.orders.context(tx, user, code);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rca-user:${c.scope.orgId}:${c.user.userId}`}))`;
        const order = await this.order(tx, c.scope, orderId);
        c = await this.orders.context(tx, user, code);
        // Exact receipts can be read after evidence changes, but generation still requires live stage/assignment.
        assertCanGenerate(order, c.user, order.version);
        const previous = (
          await tx.$queryRaw<
            RequestRow[]
          >`SELECT * FROM maintenance."RcaDraftRequest" WHERE "orgId"=${c.scope.orgId}::uuid AND "userId"=${c.user.userId}::uuid AND "requestId"=${input.requestId}::uuid`
        )[0];
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ConflictException(
              "This RCA request ID was used for different inputs. Start a new draft explicitly.",
            );
          return {
            row: previous,
            retained: this.receipt(
              previous,
              await this.terminal(tx, previous.id),
              order.version,
            ),
          };
        }
        assertCanGenerate(order, c.user, input.version);
        if (!rcaSettings(this.config).enabled)
          throw new ServiceUnavailableException(
            "AI RCA drafting is unavailable. Continue with the manual completion form.",
          );
        if (this.active >= 2)
          throw new ConflictException(
            "AI RCA drafting is busy. Try again explicitly later.",
          );
        const pending = await tx.$queryRaw<
          { id: string }[]
        >`SELECT r.id FROM maintenance."RcaDraftRequest" r LEFT JOIN maintenance."RcaDraftReceipt" t ON t."requestId"=r.id WHERE r."orgId"=${c.scope.orgId}::uuid AND r."userId"=${c.user.userId}::uuid AND r."createdAt">now()-interval '75 seconds' AND t."requestId" IS NULL LIMIT 1`;
        if (pending.length)
          throw new ConflictException(
            "An RCA draft is already being generated for this technician. Retry its original request to retrieve the receipt.",
          );
        const counts = await tx.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM maintenance."RcaDraftRequest" WHERE "orgId"=${c.scope.orgId}::uuid AND "userId"=${c.user.userId}::uuid AND "createdAt">now()-interval '10 minutes'`;
        if (Number(counts[0].count) >= 10)
          throw new ConflictException(
            "RCA draft request limit reached. Continue manually or try later.",
          );
        const evidence = await this.evidence(tx, order, input, code),
          row: RequestRow = {
            id: randomUUID(),
            ...c.scope,
            orderId,
            userId: c.user.userId,
            requestId: input.requestId,
            fingerprint,
            version: order.version,
            sourceHash: digest(evidence),
            model: rcaSettings(this.config).model,
            policy: RCA_POLICY,
            snapshot: evidence,
            createdAt: new Date(),
          };
        await tx.$executeRaw`INSERT INTO maintenance."RcaDraftRequest" (id,"orgId","machineId","orderId","userId","requestId",fingerprint,version,"sourceHash",model,policy,snapshot,"createdAt") VALUES (${row.id}::uuid,${row.orgId}::uuid,${row.machineId}::uuid,${row.orderId}::uuid,${row.userId}::uuid,${row.requestId}::uuid,${row.fingerprint},${row.version},${row.sourceHash},${row.model},${row.policy},${JSON.stringify(row.snapshot)}::jsonb,${row.createdAt})`;
        await this.audit(tx, row, "RCA_DRAFT_REQUESTED", "PENDING");
        return { row, retained: null };
      },
      { timeout: 10000 },
    );
    if (reserved.retained) return reserved.retained;
    const row = reserved.row;
    if (this.active >= 2) {
      return this.db.$transaction(async (tx) => {
        const initial = await this.orders.context(tx, user, code);
        const order = await this.order(tx, initial.scope, orderId);
        const c = await this.orders.context(tx, user, code);
        assertCanGenerate(order, c.user, input.version);
        return this.receipt(
          row,
          await this.saveTerminal(tx, row, "FAILED", "RCA_BUSY", null),
          order.version,
        );
      });
    }
    this.active++;
    let draft: RcaDraft;
    try {
      try {
        draft = validateRcaOutput(
          await this.ai.generate(row.snapshot),
          row.snapshot,
        );
      } catch (error) {
        const reason =
          error instanceof RcaProviderError
            ? error.code
            : "RCA_PROVIDER_UNAVAILABLE";
        // A failed attempt is terminal. Explicit same-key retries never make another paid call.
        return await this.db.$transaction(async (tx) => {
          const c = await this.orders.context(tx, user, code),
            order = await this.order(tx, c.scope, orderId);
          await this.orders.context(tx, user, code);
          assertCanGenerate(order, c.user, input.version);
          return this.receipt(
            row,
            await this.saveTerminal(tx, row, "FAILED", reason, null),
            order.version,
          );
        });
      }
      return await this.db.$transaction(
        async (tx) => {
          const initial = await this.orders.context(tx, user, code),
            order = await this.order(tx, initial.scope, orderId);
          const c = await this.orders.context(tx, user, code);
          assertCanGenerate(order, c.user, input.version);
          const current = await this.evidence(
            tx,
            order,
            input,
            code,
            new Date(row.snapshot.capturedAt),
          );
          if (digest(current) !== row.sourceHash)
            throw new ConflictException(
              "Recorded evidence changed during generation. Reload and review before starting a new draft.",
            );
          return this.receipt(
            row,
            await this.saveTerminal(tx, row, "GENERATED", null, draft),
            order.version,
          );
        },
        { timeout: 10000 },
      );
    } catch (error) {
      // Retain only a safe terminal marker on access/version/audit failure. No generated content is delivered.
      // If this audit also fails, the reservation stays pending/uncertain, never eligible for another paid attempt.
      await this.db
        .$transaction(async (tx) => {
          if (!(await this.terminal(tx, row.id)))
            await this.saveTerminal(
              tx,
              row,
              "STALE",
              "RCA_RESULT_NOT_DELIVERED",
              null,
            );
        })
        .catch(() => undefined);
      throw error;
    } finally {
      this.active--;
    }
  }
  async list(user: Principal, code: string, orderId: string, before?: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        const order = await tx.workOrder.findFirst({
          where: { ...c.scope, id: orderId },
        });
        if (!order) throw new NotFoundException("Work order not found.");
        const cursor = before
          ? (
              await tx.$queryRaw<
                RequestRow[]
              >`SELECT * FROM maintenance."RcaDraftRequest" WHERE id=${before}::uuid AND "orgId"=${c.scope.orgId}::uuid AND "machineId"=${c.scope.machineId}::uuid AND "orderId"=${orderId}::uuid`
            )[0]
          : null;
        if (before && !cursor)
          throw new NotFoundException("RCA history cursor not found.");
        const rows = await tx.$queryRaw<RequestRow[]>(
          Prisma.sql`SELECT * FROM maintenance."RcaDraftRequest" WHERE "orgId"=${c.scope.orgId}::uuid AND "machineId"=${c.scope.machineId}::uuid AND "orderId"=${orderId}::uuid ${cursor ? Prisma.sql`AND ("createdAt",id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty} ORDER BY "createdAt" DESC,id DESC LIMIT 21`,
        );
        const items = await Promise.all(
          rows
            .slice(0, 20)
            .map(async (row) =>
              this.receipt(row, await this.terminal(tx, row.id), order.version),
            ),
        );
        return { items, nextCursor: rows.length > 20 ? rows[19].id : null };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
