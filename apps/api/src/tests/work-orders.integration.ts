import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname
)
  throw new Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } }),
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const roles = {
  operator: Role.OPERATOR,
  head: Role.MAINTENANCE_HEAD,
  head2: Role.MAINTENANCE_HEAD,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  noGrant: Role.TECHNICIAN,
  inactive: Role.TECHNICIAN,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  outsider: Role.OPERATOR,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let orgId: string, machineId: string, app: INestApplication, main: any;
const base = "/api/machines/WH-C/work-orders";
const get = (path = "", who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (path = "", who: Who = "operator") =>
  request(app.getHttpServer())
    .post(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const body = (id = randomUUID()) => ({
  requestId: id,
  title: "TEST fixture vibration report",
  description: "Synthetic integration fixture; not a real machine incident.",
  priority: "NORMAL",
  impact: "OBSERVATION",
  observedAt: null,
});
const action = (
  o: any,
  name: string,
  who: Who,
  input: Record<string, unknown> = {},
) =>
  post(`/${o.id}/actions/${name}`, who).send({ version: o.version, ...input });
const repair = (o: any, rootCause = "TEST inspection finding") => ({
  findings: "TEST inspection completed",
  rootCause,
  correctiveAction: "TEST component checked",
  preventiveAction: "TEST inspection scheduled",
  restoredAt: o.reportedAt,
});
async function reported() {
  return (await post().send(body()).expect(201)).body;
}
before(async () => {
  const org = await db.organization.create({
    data: {
      slug: "orders-test-" + randomUUID(),
      name: "Work order test fixture",
    },
  });
  orgId = org.id;
  const other = await db.organization.create({
    data: { slug: "orders-other-" + randomUUID(), name: "Other test fixture" },
  });
  machineId = (
    await db.machine.create({
      data: {
        orgId,
        code: "WH-C",
        name: "TEST machine",
        manufacturer: "Fixture",
      },
    })
  ).id;
  for (const key of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[key], displayName: "TEST " + key },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[key],
        orgId: key === "outsider" ? other.id : orgId,
        role: roles[key],
        active: key !== "inactive",
      },
    });
    if (["operator", "tech", "tech2", "inactive"].includes(key))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
      });
  }
  const config = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtimeUrl,
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
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});
test("work-order reporting and technician directory enforce trusted roles and machine/org scope", async () => {
  await request(app.getHttpServer()).get(base).expect(401);
  for (const who of [
    "admin",
    "management",
    "head",
    "tech",
    "supervisor",
  ] as Who[])
    await post("", who).set("x-role", "OPERATOR").send(body()).expect(403);
  await get("", "outsider").expect(404);
  await get("", "noGrant").expect(404);
  await get("", "inactive").expect(403);
  const directory = (await get("/technicians").expect(200)).body;
  assert.deepEqual(
    directory.items.map((p: any) => p.userId).sort(),
    [ids.tech, ids.tech2].sort(),
  );
  await get("/technicians", "admin").expect(403);
  const invalid = body();
  for (const patch of [
    { orgId: randomUUID() },
    { status: "APPROVED" },
    { observedAt: "2026-02-30T12:00:00Z" },
    { observedAt: "2099-01-01T00:00:00Z" },
  ])
    await post()
      .send({ ...invalid, ...patch })
      .expect(400);
});
test("simultaneous report retries create one original report, event and audit; changed retries conflict", async () => {
  const data = body(),
    responses = await Promise.all([post().send(data), post().send(data)]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  assert.equal(responses.filter((r) => r.body.alreadyReported).length, 1);
  main = responses[0].body;
  assert.equal(main.status, "REPORTED");
  assert.equal(main.reporter.userId, ids.operator);
  assert.equal(main.events.length, 1);
  assert.equal(
    await db.workOrder.count({ where: { orgId, requestId: data.requestId } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: main.id, action: "WORK_ORDER_REPORT" },
    }),
    1,
  );
  await post()
    .send({ ...data, title: "A changed report under the same key" })
    .expect(409);
  await get("/" + main.id, "outsider").expect(404);
});
test("assignment checks active machine-granted technicians and records reasoned reassignments", async () => {
  for (const id of [ids.outsider, ids.noGrant, ids.inactive, ids.admin])
    await action(main, "assign", "head", { technicianId: id }).expect(400);
  main = (
    await action(main, "assign", "head", { technicianId: ids.tech }).expect(200)
  ).body;
  await action(main, "assign", "head", { technicianId: ids.tech }).expect(409);
  await action(main, "assign", "head", { technicianId: ids.tech2 }).expect(400);
  main = (
    await action(main, "assign", "head", {
      technicianId: ids.tech2,
      reason: "TEST change in availability",
    }).expect(200)
  ).body;
  assert.equal(main.technician.userId, ids.tech2);
  assert.equal(main.events[0].detail.previousTechnicianId, ids.tech);
  await action(main, "start", "tech").expect(403);
  main = (await action(main, "start", "tech2").expect(200)).body;
  assert(main.startedAt);
});
test("repair submission requires full human RCA, assigned authority and a valid independent restoration time", async () => {
  for (const patch of [
    { rootCause: "" },
    { preventiveAction: "" },
    { restoredAt: "2026-02-30T12:00:00Z" },
    { restoredAt: "2099-01-01T00:00:00Z" },
    { restoredAt: "2001-01-01T00:00:00Z" },
    { reviewedBy: ids.head },
  ])
    await action(main, "submit", "tech2", { ...repair(main), ...patch }).expect(
      400,
    );
  await action(main, "submit", "tech", repair(main)).expect(403);
  main = (await action(main, "submit", "tech2", repair(main)).expect(200)).body;
  assert.equal(main.status, "AWAITING_REVIEW");
  assert.equal(main.reviewedAt, null);
  assert.equal(main.closedAt, null);
  assert.equal(main.restoredAt, main.reportedAt);
});
test("return/resubmission preserve earlier evidence and only head review precedes authorized closure", async () => {
  await action(main, "approve", "admin").expect(403);
  await action(main, "approve", "supervisor").expect(403);
  await action(main, "close", "supervisor").expect(409);
  await action(main, "return", "head", { reason: "" }).expect(400);
  main = (
    await action(main, "return", "head", {
      reason: "TEST add inspection evidence",
    }).expect(200)
  ).body;
  assert.equal(main.returnReason, "TEST add inspection evidence");
  assert.equal(main.status, "IN_PROGRESS");
  main = (
    await action(
      main,
      "submit",
      "tech2",
      repair(main, "TEST updated human finding"),
    ).expect(200)
  ).body;
  assert.equal(main.returnReason, null);
  const snapshots = main.events.filter((e: any) => e.action === "SUBMIT");
  assert.equal(snapshots.length, 2);
  assert.notEqual(snapshots[0].detail.rootCause, snapshots[1].detail.rootCause);
  main = (
    await action(main, "approve", "head", {
      note: "TEST engineering review completed",
    }).expect(200)
  ).body;
  assert(main.reviewedAt);
  assert.equal(main.closedAt, null);
  await action(main, "close", "admin").expect(403);
  main = (
    await action(main, "close", "supervisor", {
      note: "TEST administrative closure",
    }).expect(200)
  ).body;
  assert.equal(main.status, "CLOSED");
  assert.equal(main.reviewer.userId, ids.head);
  assert.equal(main.closer.userId, ids.supervisor);
  assert.equal(main.restoredAt, main.reportedAt);
  assert(Date.parse(main.reviewedAt) >= Date.parse(main.submittedAt));
  assert(Date.parse(main.closedAt) >= Date.parse(main.reviewedAt));
  assert.equal(main.allowedActions.length, 0);
  await action(main, "assign", "head", {
    technicianId: ids.tech,
    reason: "TEST cannot reopen",
  }).expect(409);
});
test("competing optimistic updates persist exactly one version and one matching history/audit entry", async () => {
  const o = await reported();
  const results = await Promise.all([
    action(o, "assign", "head", { technicianId: ids.tech }),
    action(o, "assign", "head2", { technicianId: ids.tech2 }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const saved = (await get("/" + o.id).expect(200)).body;
  assert.equal(saved.version, 2);
  assert.equal(saved.events.length, 2);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: o.id, action: "WORK_ORDER_ASSIGN" },
    }),
    1,
  );
  await action(o, "assign", "head", { technicianId: ids.tech }).expect(409);
});
test("audit failures roll back both operational state and immutable history", async () => {
  let o = await reported();
  o = (
    await action(o, "assign", "head", { technicianId: ids.tech }).expect(200)
  ).body;
  const fn = "order_fail_" + orgId.replace(/-/g, "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='WORK_ORDER_START') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await action(o, "start", "tech").expect(503);
    const still = (await get("/" + o.id).expect(200)).body;
    assert.equal(still.version, 2);
    assert.equal(still.status, "ASSIGNED");
    assert.equal(still.events.length, 2);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
});
test("scoped list/history pagination, revocation and SQL protections retain complete evidence", async () => {
  const first = (await get("?limit=1").expect(200)).body;
  assert.equal(first.items.length, 1);
  const next = (await get("?limit=1&after=" + first.nextCursor).expect(200))
    .body;
  assert.notEqual(next.items[0].id, first.items[0].id);
  assert(first.total >= 3);
  const closed = (await get("?status=CLOSED").expect(200)).body;
  assert.equal(closed.items.length, 1);
  for (const q of ["limit=0", "orgId=forged", "status=BAD", "after=bad"])
    await get("?" + q).expect(400);
  const history = (
    await get(`/${main.id}/history?beforeVersion=${main.version}`).expect(200)
  ).body;
  assert(history.items.every((e: any) => e.version < main.version));
  const event = await db.workOrderEvent.findFirstOrThrow({
    where: { orderId: main.id },
  });
  await assert.rejects(
    runtime.workOrderEvent.update({
      where: { id: event.id },
      data: { detail: { forged: true } },
    }),
  );
  await assert.rejects(
    db.workOrderEvent.update({
      where: { id: event.id },
      data: { detail: { forged: true } },
    }),
  );
  await assert.rejects(runtime.workOrder.delete({ where: { id: main.id } }));
  await assert.rejects(
    runtime.workOrder.update({
      where: { id: main.id },
      data: { title: "Changed original report" },
    }),
  );
  await assert.rejects(
    db.workOrder.update({
      where: { id: main.id },
      data: { version: { increment: 1 } },
    }),
  );
  const membership = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech2 },
  });
  await db.machineAccess.deleteMany({ where: { membershipId: membership.id } });
  await get("/" + main.id, "tech2").expect(404);
});

test("returned work can be reassigned without erasing submissions; long history is paged completely", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech2 },
  });
  await db.machineAccess.upsert({
    where: { machineId_membershipId: { machineId, membershipId: member.id } },
    create: { orgId, machineId, membershipId: member.id },
    update: {},
  });
  let o = await reported();
  o = (
    await action(o, "assign", "head", { technicianId: ids.tech }).expect(200)
  ).body;
  o = (await action(o, "start", "tech").expect(200)).body;
  for (let i = 0; i < 26; i++) {
    o = (
      await action(
        o,
        "submit",
        "tech",
        repair(o, "TEST history evidence " + i),
      ).expect(200)
    ).body;
    o = (
      await action(o, "return", "head", {
        reason: "TEST review iteration " + i,
      }).expect(200)
    ).body;
  }
  const before = o.version;
  await action(o, "assign", "head", { technicianId: ids.tech2 }).expect(400);
  o = (
    await action(o, "assign", "head", {
      technicianId: ids.tech2,
      reason: "TEST handover to another technician",
    }).expect(200)
  ).body;
  assert.equal(o.status, "ASSIGNED");
  assert.equal(o.startedAt, null);
  assert.equal(o.findings, null);
  assert.equal(o.restoredAt, null);
  assert.equal(o.events.length, 50);
  assert(o.historyNextVersion);
  const older = (
    await get(`/${o.id}/history?beforeVersion=${o.historyNextVersion}`).expect(
      200,
    )
  ).body;
  const all = [...o.events, ...older.items];
  assert.equal(all.length, before + 1);
  assert.equal(new Set(all.map((e: any) => e.version)).size, before + 1);
  assert.equal(older.nextBeforeVersion, null);
  assert(
    all.some(
      (e: any) =>
        e.action === "SUBMIT" &&
        e.detail.rootCause === "TEST history evidence 0",
    ),
  );
});

test("one verified account selects only granted roles; permissions never combine and events retain the acting role", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  const requested = Object.values(Role).filter(
    (role) => role !== Role.ADMINISTRATOR,
  );
  await db.membershipRoleGrant.createMany({
    data: requested.map((role) => ({ orgId, membershipId: member.id, role })),
  });
  await db.machineAccess.create({
    data: { orgId, membershipId: member.id, machineId },
  });
  for (const role of Object.values(Role)) {
    const me = await request(app.getHttpServer())
      .get("/api/me")
      .set("Authorization", `Bearer ${ids.admin}`)
      .set("X-Workspace-Role", role)
      .expect(200);
    assert.equal(me.body.userId, ids.admin);
    assert.equal(me.body.role, role);
    assert.deepEqual(me.body.availableRoles.sort(), Object.values(Role).sort());
    for (const suffix of ["production/dashboard", "readings/trends"]) {
      await request(app.getHttpServer())
        .get(`/api/machines/WH-C/${suffix}`)
        .set("Authorization", `Bearer ${ids.admin}`)
        .set("X-Workspace-Role", role)
        .expect(200);
    }
    const importer = [
      Role.ADMINISTRATOR,
      Role.MAINTENANCE_HEAD,
      Role.SUPERVISOR,
    ].includes(role as "ADMINISTRATOR" | "MAINTENANCE_HEAD" | "SUPERVISOR");
    for (const suffix of ["production/inspect", "readings/previews"]) {
      await request(app.getHttpServer())
        .post(`/api/machines/WH-C/${suffix}`)
        .set("Authorization", `Bearer ${ids.admin}`)
        .set("X-Workspace-Role", role)
        .expect(importer ? 400 : 403);
    }
  }
  await get("", "tech").set("X-Workspace-Role", "ADMINISTRATOR").expect(403);
  await get("", "admin").set("X-Workspace-Role", "NOT_A_ROLE").expect(403);
  const run = (
    o: any,
    name: string,
    role: Role,
    input: Record<string, unknown> = {},
  ) =>
    post(`/${o.id}/actions/${name}`, "admin")
      .set("X-Workspace-Role", role)
      .send({ version: o.version, ...input });
  let o = (
    await post("", "admin")
      .set("X-Workspace-Role", Role.OPERATOR)
      .send(body())
      .expect(201)
  ).body;
  await run(o, "assign", Role.ADMINISTRATOR, {
    technicianId: ids.admin,
  }).expect(403);
  const directory = await get("/technicians", "admin")
    .set("X-Workspace-Role", Role.MAINTENANCE_HEAD)
    .expect(200);
  assert.ok(directory.body.items.some((p: any) => p.userId === ids.admin));
  o = (
    await run(o, "assign", Role.MAINTENANCE_HEAD, {
      technicianId: ids.admin,
    }).expect(200)
  ).body;
  await run(o, "start", Role.MANAGEMENT).expect(403);
  o = (await run(o, "start", Role.TECHNICIAN).expect(200)).body;
  o = (await run(o, "submit", Role.TECHNICIAN, repair(o)).expect(200)).body;
  for (const role of [
    Role.ADMINISTRATOR,
    Role.OPERATOR,
    Role.TECHNICIAN,
    Role.MANAGEMENT,
    Role.SUPERVISOR,
  ])
    await run(o, "approve", role).expect(403);
  o = (await run(o, "approve", Role.MAINTENANCE_HEAD).expect(200)).body;
  await run(o, "close", Role.ADMINISTRATOR).expect(403);
  o = (await run(o, "close", Role.SUPERVISOR).expect(200)).body;
  assert.equal(o.status, "CLOSED");
  assert.deepEqual(
    o.events.map((e: any) => e.actorRole),
    [
      Role.SUPERVISOR,
      Role.MAINTENANCE_HEAD,
      Role.TECHNICIAN,
      Role.TECHNICIAN,
      Role.MAINTENANCE_HEAD,
      Role.OPERATOR,
    ],
  );
  assert.ok(o.events.every((e: any) => e.actor.userId === ids.admin));
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: member.id, role: Role.OPERATOR },
    },
    data: { active: false },
  });
  await post("", "admin")
    .set("X-Workspace-Role", Role.OPERATOR)
    .send(body())
    .expect(403);
  await get("", "admin").expect(200);
  const defaultMe = await request(app.getHttpServer())
    .get("/api/me")
    .set("Authorization", `Bearer ${ids.admin}`)
    .expect(200);
  assert.equal(defaultMe.body.role, Role.ADMINISTRATOR);
  assert.ok(!defaultMe.body.availableRoles.includes(Role.OPERATOR));
  await assert.rejects(
    runtime.membershipRoleGrant.create({
      data: { orgId, membershipId: member.id, role: Role.ADMINISTRATOR },
    }),
  );
  await db.machineAccess.delete({
    where: { machineId_membershipId: { machineId, membershipId: member.id } },
  });
  await get("", "admin").set("X-Workspace-Role", Role.TECHNICIAN).expect(404);
});
