// Parent executes after isolated preparation. Never use operational persistence.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { postgresClient } from "../postgres";
import { RCA_AI } from "../rca/provider";
import { RcaProviderError } from "../rca/policy";
import { rcaConfig, rcaOutput } from "./rca-fixtures";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname ||
  new URL(owner).host !== new URL(runtimeUrl).host
)
  throw new Error(
    "RCA integration requires matching isolated *_test databases.",
  );
const db = postgresClient(owner),
  runtime = postgresClient(runtimeUrl);
const roles = {
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  pilot: Role.ADMINISTRATOR,
  noMachine: Role.TECHNICIAN,
  foreign: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((key) => [key, randomUUID()]),
) as Record<Who, string>;
let orgId: string,
  machineId: string,
  pilotMember: string,
  app: INestApplication,
  calls = 0;
let provider: () => Promise<unknown> = async () => rcaOutput();
const base = "/api/machines/WH-C/work-orders";
const headers = (who: Who, role?: Role) => ({
  Authorization: `Bearer ${ids[who]}`,
  ...(role ? { "X-Workspace-Role": role } : {}),
});
const post = (path: string, who: Who = "tech", role?: Role) =>
  request(app.getHttpServer())
    .post(base + path)
    .set(headers(who, role));
const get = (path: string, who: Who = "tech", role?: Role) =>
  request(app.getHttpServer())
    .get(base + path)
    .set(headers(who, role));
const input = (o: any, requestId = randomUUID()) => ({
  requestId,
  version: o.version,
  human: {
    findings: "TEST current unsubmitted human observation only",
    rootCause: "",
    correctiveAction: "",
    preventiveAction: "",
  },
});
const act = async (
  o: any,
  action: string,
  who: Who,
  data: Record<string, unknown> = {},
  role?: Role,
) =>
  (
    await post(`/${o.id}/actions/${action}`, who, role)
      .send({ version: o.version, ...data })
      .expect(200)
  ).body;
async function progress(technician: Who = "tech") {
  let o = (
    await post("", "operator")
      .send({
        requestId: randomUUID(),
        title: "TEST RCA isolated fixture",
        description:
          "TEST synthetic fixture only: vibration reported; no authentic fault or cause.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  o = await act(o, "assign", "head", { technicianId: ids[technician] });
  return act(
    o,
    "start",
    technician,
    {},
    technician === "pilot" ? Role.TECHNICIAN : undefined,
  );
}
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "rca-test-" + randomUUID(), name: "TEST isolated RCA" },
    })
  ).id;
  const foreignOrg = (
    await db.organization.create({
      data: { slug: "rca-foreign-" + randomUUID(), name: "TEST foreign RCA" },
    })
  ).id;
  machineId = (
    await db.machine.create({
      data: {
        orgId,
        code: "WH-C",
        name: "TEST RCA machine",
        manufacturer: "Fixture",
      },
    })
  ).id;
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST RCA " + who },
    });
    const member = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "foreign" ? foreignOrg : orgId,
        role: roles[who],
      },
    });
    if (["operator", "tech", "tech2", "pilot"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: member.id },
      });
    if (who === "pilot") {
      pilotMember = member.id;
      await db.membershipRoleGrant.create({
        data: { orgId, membershipId: member.id, role: Role.TECHNICIAN },
      });
    }
  }
  const config = {
    ...rcaConfig,
    DATABASE_URL: runtimeUrl,
    EXTERNAL_NOTIFICATIONS_ENABLED: "false" as const,
  };
  const module = await Test.createTestingModule({
    imports: [appModule(config)],
  })
    .overrideProvider(VERIFIER)
    .useValue({
      async verify(token: string) {
        if (!Object.values(ids).includes(token))
          throw new UnauthorizedException();
        return token;
      },
    })
    .overrideProvider(RCA_AI)
    .useValue({
      async generate() {
        calls++;
        return provider();
      },
    })
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
});
after(async () => {
  await app?.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});

test("RCA HTTP six-role policy, actual assignment, machine/org scope and forged inputs fail closed", async () => {
  const o = await progress(),
    body = input(o),
    before = calls;
  await request(app.getHttpServer())
    .post(`${base}/${o.id}/rca-drafts`)
    .send(body)
    .expect(401);
  for (const who of [
    "operator",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[])
    await post(`/${o.id}/rca-drafts`, who).send(body).expect(403);
  await post(`/${o.id}/rca-drafts`, "tech2").send(body).expect(403);
  await post(`/${o.id}/rca-drafts`, "noMachine").send(body).expect(404);
  await post(`/${o.id}/rca-drafts`, "foreign").send(body).expect(404);
  for (const patch of [
    { orgId },
    { role: "MAINTENANCE_HEAD" },
    { sources: [] },
    { context: "override" },
    { restoredAt: o.reportedAt },
  ])
    await post(`/${o.id}/rca-drafts`)
      .send({ ...body, ...patch })
      .expect(400);
  assert.equal(calls, before);
});
test("RCA exact retries/concurrency retain one receipt/audit pair and leave work order/history untouched", async () => {
  const o = await progress(),
    body = input(o),
    before = calls;
  const responses = await Promise.all([
    post(`/${o.id}/rca-drafts`).send(body),
    post(`/${o.id}/rca-drafts`).send(body),
  ]);
  assert(responses.every((r) => r.status === 200));
  const retained = (await post(`/${o.id}/rca-drafts`).send(body).expect(200))
    .body;
  assert.equal(retained.status, "GENERATED");
  assert.equal(calls, before + 1);
  await post(`/${o.id}/rca-drafts`)
    .send({
      ...body,
      human: { ...body.human, findings: "TEST changed payload" },
    })
    .expect(409);
  const after = (await get(`/${o.id}`).expect(200)).body;
  assert.equal(after.version, o.version);
  assert.deepEqual(after.events, o.events);
  for (const field of [
    "findings",
    "rootCause",
    "correctiveAction",
    "preventiveAction",
    "restoredAt",
    "submittedAt",
    "reviewedAt",
    "closedAt",
  ])
    assert.equal(after[field], o[field]);
  const audit = await db.auditEvent.findMany({
    where: { orgId, entityId: retained.id },
  });
  assert.deepEqual(audit.map((a) => a.action).sort(), [
    "RCA_DRAFT_GENERATED",
    "RCA_DRAFT_REQUESTED",
  ]);
  for (const who of [
    "operator",
    "tech",
    "tech2",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const history = (await get(`/${o.id}/rca-drafts`, who).expect(200)).body;
    assert.equal(history.items[0].id, retained.id);
  }
  await get(`/${o.id}/rca-drafts`, "foreign").expect(404);
});
test("RCA request and receipt direct INSERT without exact protected audit roll back at commit", async () => {
  const o = await progress();
  const receipt = (await post(`/${o.id}/rca-drafts`).send(input(o)).expect(200))
    .body;
  const copy = randomUUID(),
    copyRequest = randomUUID();
  await assert.rejects(
    runtime.$executeRaw`INSERT INTO maintenance."RcaDraftRequest" (id,"orgId","machineId","orderId","userId","requestId",fingerprint,version,"sourceHash",model,policy,snapshot) SELECT ${copy}::uuid,"orgId","machineId","orderId","userId",${copyRequest}::uuid,fingerprint,version,"sourceHash",model,policy,snapshot FROM maintenance."RcaDraftRequest" WHERE id=${receipt.id}::uuid`,
  );
  assert.equal(
    (
      await db.$queryRaw<
        any[]
      >`SELECT id FROM maintenance."RcaDraftRequest" WHERE id=${copy}::uuid`
    ).length,
    0,
  );
  const reserved = randomUUID(),
    reservedRequest = randomUUID();
  await runtime.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO maintenance."RcaDraftRequest" (id,"orgId","machineId","orderId","userId","requestId",fingerprint,version,"sourceHash",model,policy,snapshot) SELECT ${reserved}::uuid,"orgId","machineId","orderId","userId",${reservedRequest}::uuid,fingerprint,version,"sourceHash",model,policy,snapshot FROM maintenance."RcaDraftRequest" WHERE id=${receipt.id}::uuid`;
    await tx.auditEvent.create({
      data: {
        orgId,
        actorId: ids.tech,
        entityId: reserved,
        action: "RCA_DRAFT_REQUESTED",
        detail: {
          orderId: o.id,
          requestId: reservedRequest,
          version: o.version,
          sourceHash: receipt.sourceHash,
          model: receipt.model,
          policy: receipt.policy,
          actorRole: "TECHNICIAN",
          status: "PENDING",
        },
      },
    });
  });
  await assert.rejects(
    runtime.$executeRaw`INSERT INTO maintenance."RcaDraftReceipt" ("requestId",status,reason) VALUES (${reserved}::uuid,'STALE','TEST_NO_AUDIT')`,
  );
  assert.equal(
    (
      await db.$queryRaw<
        any[]
      >`SELECT "requestId" FROM maintenance."RcaDraftReceipt" WHERE "requestId"=${reserved}::uuid`
    ).length,
    0,
  );
  await runtime.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO maintenance."RcaDraftReceipt" ("requestId",status,reason) VALUES (${reserved}::uuid,'STALE','TEST_RELEASE_RESERVATION')`;
    await tx.auditEvent.create({
      data: {
        orgId,
        actorId: ids.tech,
        entityId: reserved,
        action: "RCA_DRAFT_STALE",
        detail: {
          orderId: o.id,
          requestId: reservedRequest,
          version: o.version,
          sourceHash: receipt.sourceHash,
          model: receipt.model,
          policy: receipt.policy,
          actorRole: "TECHNICIAN",
          status: "STALE",
        },
      },
    });
  });
  await assert.rejects(
    runtime.$executeRaw`UPDATE maintenance."RcaDraftRequest" SET version=version+1 WHERE id=${receipt.id}::uuid`,
  );
  await assert.rejects(
    runtime.$executeRaw`DELETE FROM maintenance."RcaDraftReceipt" WHERE "requestId"=${receipt.id}::uuid`,
  );
});
test("provider failures are retained as terminal failures and same payload never repays", async () => {
  const o = await progress(),
    body = input(o),
    before = calls;
  provider = async () => {
    throw new RcaProviderError("RCA_PROVIDER_UNAVAILABLE");
  };
  try {
    const one = (await post(`/${o.id}/rca-drafts`).send(body).expect(200)).body;
    assert.equal(one.status, "FAILED");
    assert.equal(one.draft, null);
    assert.deepEqual(
      (await post(`/${o.id}/rca-drafts`).send(body).expect(200)).body,
      one,
    );
    assert.equal(calls, before + 1);
  } finally {
    provider = async () => rcaOutput();
  }
});
test("revoked trusted Technician grant denies receipt history and in-flight generated content", async () => {
  const o = await progress("pilot"),
    body = input(o);
  let release!: (value: unknown) => void;
  provider = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const before = calls,
    pending = post(`/${o.id}/rca-drafts`, "pilot", Role.TECHNICIAN)
      .send(body)
      .then((r) => r);
  try {
    for (let i = 0; i < 100 && calls === before; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, before + 1);
    await db.membershipRoleGrant.update({
      where: {
        membershipId_role: { membershipId: pilotMember, role: Role.TECHNICIAN },
      },
      data: { active: false },
    });
    release(rcaOutput());
    assert.equal((await pending).status, 403);
    await post(`/${o.id}/rca-drafts`, "pilot", Role.TECHNICIAN)
      .send(body)
      .expect(403);
    await get(`/${o.id}/rca-drafts`, "pilot", Role.TECHNICIAN).expect(403);
    const rows = await db.$queryRaw<
      any[]
    >`SELECT t.status,t.draft FROM maintenance."RcaDraftReceipt" t JOIN maintenance."RcaDraftRequest" r ON r.id=t."requestId" WHERE r."orderId"=${o.id}::uuid`;
    assert.equal(rows[0].status, "STALE");
    assert.equal(rows[0].draft, null);
  } finally {
    provider = async () => rcaOutput();
    await db.membershipRoleGrant.update({
      where: {
        membershipId_role: { membershipId: pilotMember, role: Role.TECHNICIAN },
      },
      data: { active: true },
    });
  }
});
test("audit failure rolls back reservation before provider and generated receipt before delivery", async () => {
  const o = await progress(),
    trigger = `rca_audit_test_${randomUUID().replaceAll("-", "")}`;
  let rejected = "RCA_DRAFT_REQUESTED";
  const install = async () => {
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION maintenance.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orgId"='${orgId}'::uuid AND NEW.action='${rejected}' THEN RAISE EXCEPTION 'TEST RCA audit failure'; END IF; RETURN NEW; END $$`,
    );
  };
  await install();
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.${trigger}()`,
  );
  try {
    const before = calls;
    await post(`/${o.id}/rca-drafts`).send(input(o)).expect(503);
    assert.equal(calls, before);
    rejected = "RCA_DRAFT_GENERATED";
    await install();
    const body = input(o);
    await post(`/${o.id}/rca-drafts`).send(body).expect(503);
    assert.equal(calls, before + 1);
    const retry = (await post(`/${o.id}/rca-drafts`).send(body).expect(200))
      .body;
    assert.equal(retry.status, "STALE");
    assert.equal(retry.draft, null);
    assert.equal(calls, before + 1);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${trigger} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${trigger}()`);
  }
});
test("submission and closed stages reject generation while existing approval workflow stays human", async () => {
  let o = await progress();
  o = await act(o, "submit", "tech", {
    findings: "TEST human reviewed findings",
    rootCause: "TEST human uncertain analysis",
    correctiveAction: "TEST actual inspection",
    preventiveAction: "TEST follow-up",
    restoredAt: o.reportedAt,
  });
  await post(`/${o.id}/rca-drafts`).send(input(o)).expect(409);
  o = await act(o, "approve", "head");
  o = await act(o, "close", "supervisor");
  await post(`/${o.id}/rca-drafts`).send(input(o)).expect(409);
});

test("concurrent reassignment invalidates in-flight draft and retains only a no-content stale marker", async () => {
  const o = await progress(),
    body = input(o);
  let release!: (value: unknown) => void;
  const before = calls;
  provider = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = post(`/${o.id}/rca-drafts`)
    .send(body)
    .then((r) => r);
  try {
    for (let i = 0; i < 100 && calls === before; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, before + 1);
    await act(o, "assign", "head", {
      technicianId: ids.tech2,
      reason: "TEST assignment changed during generation",
    });
    release(rcaOutput());
    assert.equal((await pending).status, 403);
    const rows = await db.$queryRaw<
      any[]
    >`SELECT t.status,t.draft FROM maintenance."RcaDraftReceipt" t JOIN maintenance."RcaDraftRequest" r ON r.id=t."requestId" WHERE r."orderId"=${o.id}::uuid`;
    assert.equal(rows[0].status, "STALE");
    assert.equal(rows[0].draft, null);
  } finally {
    provider = async () => rcaOutput();
  }
});
