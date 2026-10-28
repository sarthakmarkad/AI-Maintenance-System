import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { Database } from "../database";
import { WorkOrdersService } from "../work-orders/service";
import { RcaService } from "../rca/service";
import { RcaProviderError } from "../rca/policy";
import {
  rcaConfig,
  rcaEvent,
  rcaInput,
  rcaOrder,
  rcaOutput,
  rcaUser,
} from "./rca-fixtures";

// Transaction/SQL fixture only. Uses the real WorkOrdersService.context and
// resolveRole implementation; PostgreSQL semantics are covered separately.
function fixture() {
  const order = rcaOrder();
  const state = {
    order,
    events: [rcaEvent(order)],
    requests: [] as any[],
    receipts: [] as any[],
    audits: [] as any[],
    memberActive: true,
    primaryRole: "TECHNICIAN",
    technicianGrant: false,
    machineAccess: true,
    failAudit: "",
    calls: 0,
    afterTransaction: null as null | (() => void),
  };
  const tx: any = {
    membership: {
      async findUnique() {
        return {
          id: rcaUser.membershipId,
          orgId: rcaUser.orgId,
          role: state.primaryRole,
          active: state.memberActive,
          user: { displayName: rcaUser.displayName },
        };
      },
    },
    membershipRoleGrant: {
      async findFirst(q: any) {
        return state.technicianGrant && q.where.role === "TECHNICIAN"
          ? { id: "trusted-grant" }
          : null;
      },
    },
    machine: {
      async findFirst(q: any) {
        return q.where.orgId === rcaUser.orgId &&
          q.where.code === "WH-C" &&
          (!q.where.access || state.machineAccess)
          ? { id: order.machineId }
          : null;
      },
    },
    workOrder: {
      async findFirst(q: any) {
        return q.where.id === order.id &&
          q.where.orgId === order.orgId &&
          q.where.machineId === order.machineId
          ? { ...state.order }
          : null;
      },
    },
    workOrderEvent: {
      async findMany() {
        return structuredClone(state.events);
      },
    },
    auditEvent: {
      async create(q: any) {
        if (
          state.failAudit &&
          (state.failAudit === "ALL_TERMINALS"
            ? q.data.action !== "RCA_DRAFT_REQUESTED"
            : q.data.action === state.failAudit)
        )
          throw new Error("TEST audit rollback");
        state.audits.push(q.data);
        return q.data;
      },
    },
    async $queryRaw(parts: TemplateStringsArray | Prisma.Sql, ...args: any[]) {
      const sql = Array.isArray(parts)
        ? parts.join("?")
        : (parts as Prisma.Sql).sql;
      if (sql.includes('FROM maintenance."WorkOrder"'))
        return [{ id: order.id }];
      if (sql.includes('FROM maintenance."RcaDraftReceipt"'))
        return state.receipts
          .filter((r) => r.requestId === args[0])
          .map(({ requestId, ...r }) => r);
      if (sql.includes("count(*)"))
        return [{ count: BigInt(state.requests.length) }];
      if (sql.includes("LEFT JOIN"))
        return state.requests
          .filter(
            (r) =>
              r.orgId === args[0] &&
              r.userId === args[1] &&
              !state.receipts.some((t) => t.requestId === r.id) &&
              Date.now() - r.createdAt.getTime() < 75000,
          )
          .slice(0, 1);
      if (sql.includes('"requestId"=?::uuid'))
        return state.requests.filter(
          (r) =>
            r.orgId === args[0] &&
            r.userId === args[1] &&
            r.requestId === args[2],
        );
      throw new Error("Unhandled TEST query: " + sql);
    },
    async $executeRaw(parts: TemplateStringsArray, ...args: any[]) {
      const sql = parts.join("?");
      if (sql.includes("pg_advisory_xact_lock")) return 1;
      if (sql.includes('INSERT INTO maintenance."RcaDraftRequest"')) {
        const [
          id,
          orgId,
          machineId,
          orderId,
          userId,
          requestId,
          fingerprint,
          version,
          sourceHash,
          model,
          policy,
          snapshot,
          createdAt,
        ] = args;
        state.requests.push({
          id,
          orgId,
          machineId,
          orderId,
          userId,
          requestId,
          fingerprint,
          version,
          sourceHash,
          model,
          policy,
          snapshot: JSON.parse(snapshot),
          createdAt,
        });
        return 1;
      }
      if (sql.includes('INSERT INTO maintenance."RcaDraftReceipt"')) {
        const [requestId, status, reason, draft] = args;
        assert(
          !state.receipts.some((r) => r.requestId === requestId),
          "unique terminal fixture",
        );
        state.receipts.push({
          requestId,
          status,
          reason,
          draft: draft ? JSON.parse(draft) : null,
          completedAt: new Date(),
        });
        return 1;
      }
      throw new Error("Unhandled TEST mutation: " + sql);
    },
  };
  let queue = Promise.resolve();
  const client = {
    $transaction: async (fn: (t: Prisma.TransactionClient) => Promise<any>) => {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const saved = structuredClone({
        requests: state.requests,
        receipts: state.receipts,
        audits: state.audits,
      });
      try {
        const result = await fn(tx);
        const after = state.afterTransaction;
        state.afterTransaction = null;
        after?.();
        return result;
      } catch (e) {
        Object.assign(state, saved);
        throw e;
      } finally {
        release();
      }
    },
  };
  const database = { client } as unknown as Database;
  let produce: () => Promise<unknown> = async () => rcaOutput();
  const service = new RcaService(
    database,
    new WorkOrdersService(database),
    rcaConfig,
    {
      async generate() {
        state.calls++;
        return produce();
      },
    },
  );
  return {
    state,
    service,
    setProvider(fn: typeof produce) {
      produce = fn;
    },
    run(input = rcaInput(), user = rcaUser, code = "WH-C") {
      return service.generate(user, code, order.id, input);
    },
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function providerStarted(f: ReturnType<typeof fixture>) {
  for (let i = 0; i < 50 && f.state.calls === 0; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.calls, 1);
}

test("durable RCA exact retries return original receipt without paid call; changed payload conflicts", async () => {
  const f = fixture(),
    input = rcaInput(),
    original = structuredClone({
      order: f.state.order,
      events: f.state.events,
    });
  const one = await f.run(input),
    two = await f.run(input);
  assert.deepEqual(two, one);
  assert.equal(f.state.calls, 1);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.audits.length, 2);
  assert.deepEqual({ order: f.state.order, events: f.state.events }, original);
  assert(!("restoredAt" in one.draft!.proposed));
  await assert.rejects(
    f.run({
      ...input,
      human: { ...input.human, findings: "Changed human input" },
    }),
    /different inputs/,
  );
  assert.equal(f.state.calls, 1);
  f.state.order.version++;
  const old = await f.run(input);
  assert.equal(old.stale, true);
  assert.equal(old.sourceHash, one.sourceHash);
  assert.equal(f.state.calls, 1);
});
test("pending concurrent exact requests and different-key generation do not create additional calls", async () => {
  const f = fixture(),
    hold = deferred(),
    input = rcaInput();
  f.setProvider(() => hold.promise);
  const first = f.run(input);
  await providerStarted(f);
  const retry = await f.run(input);
  assert.equal(retry.status, "PENDING");
  assert.equal(retry.draft, null);
  await assert.rejects(f.run(), /already being generated/);
  assert.equal(f.state.calls, 1);
  hold.resolve(rcaOutput());
  const complete = await first;
  assert.equal(complete.status, "GENERATED");
  assert.equal(f.state.audits.length, 2);
});
test("provider failure/malformed output creates terminal failed receipt and no paid retry", async () => {
  for (const fail of [
    async () => {
      throw new RcaProviderError("RCA_PROVIDER_UNAVAILABLE");
    },
    async () => ({ ...rcaOutput(), surprise: "untrusted" }),
  ]) {
    const f = fixture(),
      input = rcaInput(),
      original = structuredClone(f.state.order);
    f.setProvider(fail);
    const receipt = await f.run(input);
    assert.equal(receipt.status, "FAILED");
    assert.equal(receipt.draft, null);
    assert.deepEqual(await f.run(input), receipt);
    assert.equal(f.state.calls, 1);
    assert.deepEqual(f.state.order, original);
  }
});
test("revoked membership/grant/machine, foreign scope and other assignment deny before paid call", async () => {
  const scenarios = [
    (f: ReturnType<typeof fixture>) => {
      f.state.memberActive = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.primaryRole = "ADMINISTRATOR";
      f.state.technicianGrant = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.machineAccess = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.order.technicianId = "other";
    },
  ];
  for (const mutate of scenarios) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.run());
    assert.equal(f.state.calls, 0);
    assert.equal(f.state.requests.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.run(rcaInput(), { ...rcaUser, orgId: "foreign" }));
  await assert.rejects(f.run(rcaInput(), rcaUser, "WH-B"));
  assert.equal(f.state.calls, 0);
});
test("active additional Technician grant is trusted, revoked grant prevents original receipt delivery", async () => {
  const f = fixture(),
    input = rcaInput();
  f.state.primaryRole = "ADMINISTRATOR";
  f.state.technicianGrant = true;
  await f.run(input);
  assert.equal(f.state.calls, 1);
  f.state.technicianGrant = false;
  await assert.rejects(f.run(input));
  assert.equal(f.state.calls, 1);
});
test("live access/assignment/version changes during provider call discard result with no workflow edits", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.state.memberActive = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.machineAccess = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.primaryRole = "ADMINISTRATOR";
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.order.technicianId = "other";
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.order.version++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.events.push(
        rcaEvent(f.state.order, {
          action: "RETURN",
          version: 4,
          detail: { reason: "TEST new recorded evidence" },
        }),
      );
    },
  ]) {
    const f = fixture(),
      hold = deferred();
    f.setProvider(() => hold.promise);
    const pending = f.run();
    await providerStarted(f);
    mutate(f);
    hold.resolve(rcaOutput());
    await assert.rejects(pending);
    assert.equal(f.state.receipts[0].status, "STALE");
    assert.equal(f.state.receipts[0].draft, null);
    assert.equal(f.state.order.status, "IN_PROGRESS");
    assert.equal(f.state.order.restoredAt, null);
    assert.equal(f.state.calls, 1);
  }
});
test("reservation audit failure prevents provider; generation audit rollback cannot return unretained draft", async () => {
  const before = fixture();
  before.state.failAudit = "RCA_DRAFT_REQUESTED";
  await assert.rejects(before.run(), /audit/);
  assert.equal(before.state.calls, 0);
  assert.equal(before.state.requests.length, 0);
  const after = fixture();
  after.state.failAudit = "RCA_DRAFT_GENERATED";
  await assert.rejects(after.run(), /audit/);
  assert.equal(after.state.calls, 1);
  assert.equal(after.state.receipts.length, 1);
  assert.equal(after.state.receipts[0].status, "STALE");
  assert.equal(
    after.state.audits.filter((a) => a.action === "RCA_DRAFT_GENERATED").length,
    0,
  );
});
test("uncertain request after terminal audit failure never repays; expiration is explicit and still no same-key call", async () => {
  const f = fixture(),
    input = rcaInput();
  f.state.failAudit = "ALL_TERMINALS";
  await assert.rejects(f.run(input), /audit/);
  assert.equal(f.state.receipts.length, 0);
  f.state.requests[0].createdAt = new Date(Date.now() - 80000);
  const retry = await f.run(input);
  assert.equal(retry.status, "PENDING");
  assert.equal(retry.reason, "RCA_REQUEST_UNCERTAIN");
  assert.equal(retry.draft, null);
  assert.equal(f.state.calls, 1);
});
test("post-reservation busy path rechecks live access before returning original snapshot", async () => {
  const f = fixture();
  f.state.afterTransaction = () => {
    (f.service as unknown as { active: number }).active = 2;
    f.state.memberActive = false;
  };
  await assert.rejects(f.run());
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.receipts.length, 0);
});
