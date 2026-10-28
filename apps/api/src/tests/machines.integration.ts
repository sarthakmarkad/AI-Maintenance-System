import sharp from "sharp";
// Test-only identities and records; never use the operational database.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { ExternalNotificationsService } from "../external-notifications/service";
import { NOTIFICATION_CONTACT } from "../external-notifications/contact";
import { RCA_AI } from "../rca/provider";
import { rcaConfig, rcaOutput } from "./rca-fixtures";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Isolated *_test DB required.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  admin: Role.ADMINISTRATOR,
  head: Role.MAINTENANCE_HEAD,
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  multi: Role.ADMINISTRATOR,
  management: Role.MANAGEMENT,
  supervisor: Role.SUPERVISOR,
  foreign: Role.ADMINISTRATOR,
  inactive: Role.ADMINISTRATOR,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
    Object.keys(roles).map((k) => [k, randomUUID()]),
  ) as Record<Who, string>,
  members = {} as Record<Who, string>;
let rcaMachineCode = "";
let app: INestApplication,
  orgId: string,
  foreignOrg: string,
  machine: any,
  second: any,
  order: any,
  service: ExternalNotificationsService;
const http = (
  method: "get" | "post" | "put",
  path: string,
  who: Who = "admin",
  role?: Role,
) =>
  request(app.getHttpServer())
    [method]("/api" + path)
    .set("Authorization", `Bearer ${ids[who]}`)
    .set(role ? { "X-Workspace-Role": role } : {});
const registration = (code = "COMP-01") => ({
  requestId: randomUUID(),
  code,
  name: "TEST air compressor",
  manufacturer: null,
  department: "TEST Utilities",
  location: "TEST bay",
});
test("archive/restore retains records, enforces blockers and leaves archived workspaces read only", async () => {
  const m = (
    await http("post", "/machines").send(registration("REMOVE-01")).expect(201)
  ).body;
  const path = `/machines/${m.code}`;
  let version = m.version;
  await http("put", path + "/access")
    .send({
      requestId: randomUUID(),
      version,
      changes: [
        { membershipId: members.operator, granted: true },
        { membershipId: members.tech, granted: true },
      ],
    })
    .expect(200);
  version++;
  const report = (
    await http("post", path + "/work-orders", "operator")
      .send({
        requestId: randomUUID(),
        title: "TEST removal fixture",
        description: "TEST observed issue",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  const input = {
    requestId: randomUUID(),
    version,
    archived: true,
    reason: "TEST equipment retired",
  };
  await http("post", path + "/lifecycle", "head")
    .send(input)
    .expect(403);
  await http("post", path + "/lifecycle")
    .send(input)
    .expect(409);
  const cancelled = (
    await http(
      "post",
      path + `/work-orders/${report.id}/actions/cancel`,
      "head",
    )
      .send({ version: report.version, reason: "TEST duplicate issue" })
      .expect(200)
  ).body;
  assert.equal(cancelled.status, "CANCELLED");
  await http("post", path + "/lifecycle")
    .send(input)
    .expect(201);
  await http("post", path + "/lifecycle")
    .send(input)
    .expect(201);
  const archived = (await http("get", path).expect(200)).body;
  assert.ok(archived.archivedAt);
  assert.equal(archived.version, version + 1);
  assert.ok(
    !(await http("get", "/machines").expect(200)).body.items.some(
      (x: any) => x.id === m.id,
    ),
  );
  assert.ok(
    (await http("get", "/machines?archived=true").expect(200)).body.items.some(
      (x: any) => x.id === m.id,
    ),
  );
  await http("get", path + `/work-orders/${report.id}`, "operator").expect(200);
  await http("post", path + "/work-orders", "operator")
    .send({
      requestId: randomUUID(),
      title: "TEST blocked",
      description: "TEST blocked report",
      priority: "NORMAL",
      impact: "OBSERVATION",
    })
    .expect(409);
  await http("put", path + "/details")
    .send({})
    .expect(409);
  await http("put", path + "/external-notifications/preference", "head")
    .send({ requestId: randomUUID(), version: 0, enabled: false })
    .expect(200);
  await http("put", path + "/external-notifications/preference", "head")
    .send({ requestId: randomUUID(), version: 1, enabled: true })
    .expect(409);
  await assert.rejects(
    db.machine.update({
      where: { id: m.id },
      data: { name: "TEST forbidden edit" },
    }),
  );
  await assert.rejects(
    db.machine.update({
      where: { id: m.id },
      data: { archivedAt: null, archiveReason: null },
    }),
  );
  const restore = {
    requestId: randomUUID(),
    version: archived.version,
    archived: false,
    reason: "TEST return to service",
  };
  await http("post", path + "/lifecycle")
    .send(restore)
    .expect(201);
  assert.equal((await http("get", path).expect(200)).body.archivedAt, null);
  assert.equal(await db.workOrder.count({ where: { machineId: m.id } }), 1);
  assert.equal(
    await db.auditEvent.count({
      where: { entityId: m.id, action: "MACHINE_ARCHIVE" },
    }),
    1,
  );
  await http("post", path + "/lifecycle")
    .send({
      requestId: randomUUID(),
      version: archived.version + 1,
      archived: true,
      reason: "TEST final retirement",
    })
    .expect(201);
});
test("machine archival requires paused plans and explicit resolution of outstanding occurrences", async () => {
  const m = (
    await http("post", "/machines")
      .send(registration("REMOVE-PLAN"))
      .expect(201)
  ).body;
  const path = `/machines/${m.code}`;
  await http("put", path + "/access")
    .send({
      requestId: randomUUID(),
      version: m.version,
      changes: [{ membershipId: members.tech, granted: true }],
    })
    .expect(200);
  const plan = (
    await http("post", path + "/calendar/plans", "head")
      .send({
        requestId: randomUUID(),
        title: "TEST retirement schedule",
        instructions: "TEST routine inspection",
        frequency: "WEEKLY",
        interval: 1,
        firstDueAt: new Date(Date.now() + 86400000).toISOString(),
        technicianId: ids.tech,
        priority: "NORMAL",
        remindDays: 1,
      })
      .expect(201)
  ).body;
  const archive = {
    requestId: randomUUID(),
    version: m.version + 1,
    archived: true,
    reason: "TEST retire scheduled machine",
  };
  await http("post", path + "/lifecycle")
    .send(archive)
    .expect(409);
  await http("post", path + `/calendar/plans/${plan.id}/state`, "head")
    .send({
      version: plan.version,
      active: false,
      reason: "TEST stop recurrence",
    })
    .expect(200);
  await http("post", path + "/lifecycle")
    .send(archive)
    .expect(409);
  const tasks = await db.maintenanceOccurrence.findMany({
    where: { planId: plan.id },
  });
  assert.ok(tasks.length > 0);
  for (const task of tasks)
    await http("post", path + `/calendar/occurrences/${task.id}/skip`, "head")
      .send({
        version: task.version,
        reason: "TEST retirement cancels future occurrence",
      })
      .expect(200);
  await http("post", path + "/lifecycle")
    .send(archive)
    .expect(201);
  assert.equal(
    await db.maintenanceOccurrence.count({ where: { planId: plan.id } }),
    tasks.length,
  );
});
const access = (
  changes: { membershipId: string; granted: boolean }[],
  version = machine.version,
  requestId = randomUUID(),
) =>
  http("put", `/machines/${machine.code}/access`).send({
    requestId,
    version,
    changes,
  });
const action = (name: string, who: Who, input = {}) =>
  http(
    "post",
    `/machines/${machine.code}/work-orders/${order.id}/actions/${name}`,
    who,
  ).send({ version: order.version, ...input });
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "machines-" + randomUUID(), name: "TEST registry" },
    })
  ).id;
  foreignOrg = (
    await db.organization.create({
      data: {
        slug: "machines-foreign-" + randomUUID(),
        name: "TEST other registry",
      },
    })
  ).id;
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    members[who] = (
      await db.membership.create({
        data: {
          orgId: who === "foreign" ? foreignOrg : orgId,
          userId: ids[who],
          role: roles[who],
          active: who !== "inactive",
        },
      })
    ).id;
  }
  await db.membershipRoleGrant.createMany({
    data: [Role.OPERATOR, Role.TECHNICIAN, Role.MAINTENANCE_HEAD].map(
      (role) => ({ orgId, membershipId: members.multi, role }),
    ),
  });
  const config = {
    ...rcaConfig,
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtime,
    EXTERNAL_NOTIFICATIONS_ENABLED: "true" as const,
    NOTIFICATION_EMAIL_PROVIDER: "resend" as const,
    NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
    RESEND_API_KEY: "TEST-no-live-send",
  };
  const mod = await Test.createTestingModule({ imports: [appModule(config)] })
    .overrideProvider(VERIFIER)
    .useValue({
      async verify(token: string) {
        if (!Object.values(ids).includes(token))
          throw new UnauthorizedException();
        return token;
      },
    })
    .overrideProvider(NOTIFICATION_CONTACT)
    .useValue({
      async resolve(_token: string, userId: string) {
        return `${userId}@example.test`;
      },
    })
    .overrideProvider(RCA_AI)
    .useValue({
      async generate(evidence: any) {
        rcaMachineCode = evidence.machineCode;
        return rcaOutput();
      },
    })
    .compile();
  app = mod.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.listen(0, "127.0.0.1");
  service = app.get(ExternalNotificationsService);
});
after(async () => {
  await app?.close();
  await db.$disconnect();
});
test("registration allows only active trusted Administrator, without engineering-role unions", async () => {
  await request(app.getHttpServer())
    .post("/api/machines")
    .send(registration())
    .expect(401);
  for (const who of [
    "head",
    "tech",
    "operator",
    "management",
    "supervisor",
    "inactive",
  ] as Who[])
    await http("post", "/machines", who).send(registration()).expect(403);
  await http("post", "/machines", "multi", Role.MAINTENANCE_HEAD)
    .send(registration())
    .expect(403);
  await http("post", "/machines", "head", Role.ADMINISTRATOR)
    .send(registration())
    .expect(403);
  for (const patch of [
    { orgId: foreignOrg },
    { code: "WH-B" },
    { code: "bad/code" },
    { operationalStatus: "RUNNING" },
  ])
    await http("post", "/machines")
      .send({ ...registration(), ...patch })
      .expect(400);
});
test("racing identical registrations persist one machine, reference metadata and audit", async () => {
  const input = registration(),
    responses = await Promise.all([
      http("post", "/machines").send(input),
      http("post", "/machines").send(input),
    ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  machine = responses[0].body;
  assert.equal(machine.id, responses[1].body.id);
  assert.equal(machine.manufacturer, null);
  assert.equal(machine.model, null);
  assert.equal(machine.version, 1);
  assert.equal(machine.department.name, input.department);
  assert.equal(machine.operationalStatus, "NOT_MONITORED");
  assert.equal(
    await db.machine.count({ where: { orgId, code: input.code } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: machine.id, action: "MACHINE_REGISTER" },
    }),
    1,
  );
  await http("post", "/machines")
    .send({ ...input, name: "changed intent" })
    .expect(409);
  await http("post", "/machines").send(registration()).expect(409);
  const other = (
    await http("post", "/machines", "foreign").send(registration()).expect(201)
  ).body;
  assert.notEqual(other.id, machine.id);
  second = (
    await http("post", "/machines").send(registration("PUMP-02")).expect(201)
  ).body;
  assert.equal(
    await db.department.count({ where: { orgId, name: input.department } }),
    1,
  );
});
test("database receipt pairs reject missing or malformed hashes", async () => {
  for (const receipt of [
    { registrationKey: randomUUID(), registrationHash: null },
    { registrationKey: null, registrationHash: "a".repeat(64) },
    { registrationKey: randomUUID(), registrationHash: "bad" },
  ]) {
    await assert.rejects(
      db.machine.create({
        data: {
          orgId,
          code: "INVALID-" + randomUUID().slice(0, 8),
          name: "TEST invalid receipt",
          ...receipt,
        },
      }),
    );
  }
});
test("search and keyset pagination respect organization and individual machine grants", async () => {
  const first = (await http("get", "/machines?limit=1").expect(200)).body;
  assert.equal(first.items[0].id, machine.id);
  assert.equal(first.nextCursor, machine.code);
  const next = (
    await http("get", `/machines?limit=1&after=${machine.code}`).expect(200)
  ).body;
  assert.equal(next.items[0].id, second.id);
  const search = (await http("get", "/machines?q=pump").expect(200)).body;
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, second.id);
  assert.deepEqual(
    (await http("get", "/machines", "tech").expect(200)).body.items,
    [],
  );
  for (const who of ["operator", "tech"] as Who[])
    await http("get", `/machines/${machine.code}`, who).expect(404);
  await http("get", `/machines/${machine.code}/access`, "head").expect(403);
});
test("eligible access roster supports primary/extra operational grants and excludes foreign or inactive users", async () => {
  const roster = (
    await http("get", `/machines/${machine.code}/access`).expect(200)
  ).body;
  assert.deepEqual(
    roster.items.map((p: any) => p.membershipId).sort(),
    [members.operator, members.tech, members.multi].sort(),
  );
  const multi = roster.items.find((p: any) => p.membershipId === members.multi);
  assert.deepEqual(multi.roles.sort(), ["OPERATOR", "TECHNICIAN"]);
  const page = (
    await http("get", `/machines/${machine.code}/access?limit=1&q=TEST`).expect(
      200,
    )
  ).body;
  assert(page.nextCursor);
  assert.equal(page.items.length, 1);
  for (const id of [members.foreign, members.head, members.inactive])
    await access([{ membershipId: id, granted: true }]).expect(400);
});
test("audited access saves once on retry, detects changed requests and optimistic conflicts", async () => {
  const body = {
    requestId: randomUUID(),
    version: machine.version,
    changes: [members.operator, members.tech, members.multi].map(
      (membershipId) => ({ membershipId, granted: true }),
    ),
  };
  const responses = await Promise.all([
    http("put", `/machines/${machine.code}/access`).send(body),
    http("put", `/machines/${machine.code}/access`).send(body),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(responses.filter((r) => r.body.alreadySaved).length, 1);
  machine.version = responses[0].body.version;
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: machine.id, action: "MACHINE_ACCESS_UPDATE" },
    }),
    1,
  );
  await http("put", `/machines/${machine.code}/access`)
    .send({
      ...body,
      changes: [{ membershipId: members.tech, granted: false }],
    })
    .expect(409);
  await access([{ membershipId: members.tech, granted: false }], 1).expect(409);
  await http("get", `/machines/${machine.code}`, "tech").expect(200);
  await http("get", `/machines/${second.code}`, "tech").expect(404);
  const techs = (
    await http(
      "get",
      `/machines/${machine.code}/work-orders/technicians`,
      "head",
    ).expect(200)
  ).body.items;
  assert.deepEqual(
    techs.map((p: any) => p.userId).sort(),
    [ids.tech, ids.multi].sort(),
  );
});
test("competing access intents permit one version and retain one audit", async () => {
  const version = machine.version;
  const results = await Promise.all([
    access([{ membershipId: members.multi, granted: false }], version),
    access([{ membershipId: members.multi, granted: true }], version),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  machine.version = results.find((r) => r.status === 200)!.body.version;
  machine.version = (
    await access([{ membershipId: members.multi, granted: true }]).expect(200)
  ).body.version;
});
test("complete breakdown workflow and scoped handoff receipts work on a newly registered machine", async () => {
  order = (
    await http("post", `/machines/${machine.code}/work-orders`, "operator")
      .send({
        requestId: randomUUID(),
        title: "TEST new machine report",
        description: "Synthetic fixture only; no authentic incident.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  const heads = (
    await http(
      "get",
      `/machines/${machine.code}/work-order-notifications`,
      "head",
    ).expect(200)
  ).body;
  assert.equal(heads.items[0].orderId, order.id);
  await http(
    "post",
    `/machines/${machine.code}/work-order-notifications/${heads.items[0].id}/read`,
    "head",
  )
    .send({})
    .expect(200);
  await http(
    "get",
    `/machines/${second.code}/work-orders/${order.id}`,
    "head",
  ).expect(404);
  order = (
    await action("assign", "head", { technicianId: ids.tech }).expect(200)
  ).body;
  const techs = (
    await http(
      "get",
      `/machines/${machine.code}/work-order-notifications`,
      "tech",
    ).expect(200)
  ).body;
  assert.equal(techs.items[0].orderId, order.id);
  await http(
    "post",
    `/machines/${machine.code}/work-order-notifications/${techs.items[0].id}/read`,
    "tech",
  )
    .send({})
    .expect(200);
  await action("start", "admin").expect(403);
  order = (await action("start", "tech").expect(200)).body;
  await http(
    "post",
    `/machines/${machine.code}/work-orders/${order.id}/rca-drafts`,
    "tech",
  )
    .send({
      requestId: randomUUID(),
      version: order.version,
      human: {
        findings: "TEST observed compressor condition",
        rootCause: "",
        correctiveAction: "",
        preventiveAction: "",
      },
    })
    .expect(200);
  assert.equal(rcaMachineCode, machine.code);
  order = (
    await action("submit", "tech", {
      findings: "TEST checked recorded condition",
      rootCause: "TEST human finding",
      correctiveAction: "TEST inspected equipment",
      preventiveAction: "TEST next inspection",
      restoredAt: order.reportedAt,
    }).expect(200)
  ).body;
  await action("approve", "admin").expect(403);
  order = (await action("approve", "head").expect(200)).body;
  order = (await action("close", "supervisor").expect(200)).body;
  assert.equal(order.status, "CLOSED");
});
test("machine-specific calendar, library, reports, performance and assistant preserve separate scope", async () => {
  const plan = (
    await http("post", `/machines/${machine.code}/calendar/plans`, "head")
      .send({
        requestId: randomUUID(),
        title: "TEST weekly inspection",
        instructions: "TEST instructions only",
        frequency: "WEEKLY",
        interval: 1,
        firstDueAt: new Date().toISOString(),
        technicianId: ids.tech,
        priority: "NORMAL",
        remindDays: 1,
      })
      .expect(201)
  ).body;
  const plans = (
    await http(
      "get",
      `/machines/${machine.code}/calendar/plans`,
      "head",
    ).expect(200)
  ).body;
  assert(plans.items.some((p: any) => p.id === plan.id));
  assert.equal(
    (
      await http(
        "get",
        `/machines/${second.code}/calendar/plans`,
        "head",
      ).expect(200)
    ).body.items.length,
    0,
  );
  const pdf = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
  const uploaded = (
    await http("post", `/machines/${machine.code}/documents`)
      .field("requestId", randomUUID())
      .field("version", "0")
      .field("title", "TEST compressor manual")
      .field("kind", "MANUAL")
      .field("description", "TEST scoped document")
      .attach("file", pdf, {
        filename: "TEST.pdf",
        contentType: "application/pdf",
      })
      .expect(201)
  ).body;
  await http(
    "get",
    `/machines/${second.code}/documents/${uploaded.documentId}`,
    "head",
  ).expect(404);
  await http(
    "get",
    `/machines/${machine.code}/assistant/status`,
    "tech",
  ).expect(200);
  await http("get", `/machines/${machine.code}/assistant/chats`, "tech").expect(
    200,
  );
  await http("get", `/machines/${machine.code}/performance`, "tech").expect(
    200,
  );
  await http("get", `/machines/${machine.code}/reports/preview`, "head").expect(
    200,
  );
  await http(
    "get",
    `/machines/${machine.code}/production/dashboard`,
    "head",
  ).expect(200);
  await http("get", `/machines/${machine.code}/readings/trends`, "head").expect(
    200,
  );
});
test("external opt-in and queued payloads use the actual machine, without sending email", async () => {
  const base = `/machines/${second.code}/external-notifications/preference`;
  const enabled = await http("put", base, "head").send({
    requestId: randomUUID(),
    version: 0,
    enabled: true,
  });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  await db.machineAccess.create({
    data: { orgId, machineId: second.id, membershipId: members.operator },
  });
  await http("post", `/machines/${second.code}/work-orders`, "operator")
    .send({
      requestId: randomUUID(),
      title: "TEST email handoff",
      description: "Synthetic test only",
      priority: "NORMAL",
      impact: "OBSERVATION",
    })
    .expect(201);
  await service.enqueue();
  const queued = await db.$queryRaw<
    any[]
  >`SELECT payload FROM maintenance."ExternalNotificationOutbox" WHERE "orgId"=${orgId}::uuid AND "machineId"=${second.id}::uuid`;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.subject, "PUMP-02 work-order action");
  assert(queued[0].payload.text.includes("/machines/PUMP-02/work-orders/"));
});
test("access updates batch people and preserve grants outside the selected page", async () => {
  const people = Array.from({ length: 31 }, () => ({
    id: randomUUID(),
    userId: randomUUID(),
  }));
  await db.appUser.createMany({
    data: people.map((p) => ({
      id: p.userId,
      displayName: "TEST batch technician",
    })),
  });
  await db.membership.createMany({
    data: people.map((p) => ({ ...p, orgId, role: Role.TECHNICIAN })),
  });
  machine.version = (
    await access(
      people.map((p) => ({ membershipId: p.id, granted: true })),
    ).expect(200)
  ).body.version;
  const first = (
    await http("get", `/machines/${machine.code}/access?limit=25`).expect(200)
  ).body;
  assert.equal(first.items.length, 25);
  assert(first.nextCursor);
  const next = (
    await http(
      "get",
      `/machines/${machine.code}/access?limit=25&after=${first.nextCursor}`,
    ).expect(200)
  ).body;
  assert(next.items.length > 0);
  assert(
    !next.items.some((p: any) =>
      first.items.some((x: any) => p.membershipId === x.membershipId),
    ),
  );
  machine.version = (
    await access([{ membershipId: people[0].id, granted: false }]).expect(200)
  ).body.version;
  assert.equal(
    await db.machineAccess.count({
      where: {
        orgId,
        machineId: machine.id,
        membershipId: { in: people.map((p) => p.id) },
      },
    }),
    30,
  );
});
async function auditFailure(actionName: string, run: () => Promise<void>) {
  const fn = "machine_fail_" + randomUUID().replaceAll("-", "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST audit rollback'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='${actionName}') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await run();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
}
test("audit failures roll back registration metadata, access changes and versions", async () => {
  await auditFailure("MACHINE_REGISTER", async () => {
    await http("post", "/machines")
      .send({
        ...registration("ROLLBACK-01"),
        department: "TEST rollback department",
      })
      .expect(503);
    assert.equal(
      await db.machine.count({ where: { orgId, code: "ROLLBACK-01" } }),
      0,
    );
    assert.equal(
      await db.department.count({
        where: { orgId, name: "TEST rollback department" },
      }),
      0,
    );
  });
  await auditFailure("MACHINE_ACCESS_UPDATE", async () => {
    await access([{ membershipId: members.tech, granted: false }]).expect(503);
    assert.equal(
      (await db.machine.findUniqueOrThrow({ where: { id: machine.id } }))
        .version,
      machine.version,
    );
    await http("get", `/machines/${machine.code}`, "tech").expect(200);
  });
});

const profileInput = () => ({
  requestId: randomUUID(),
  version: machine.version,
  name: "TEST edited compressor",
  manufacturer: null,
  model: null,
  department: "TEST edited utilities",
  location: null,
});
let photoId: string;
const photoUpload = async (
  input = { requestId: randomUUID(), version: machine.version },
  who: Who = "admin",
  bytes?: Buffer,
) => {
  const image =
    bytes ??
    (await sharp({
      create: { width: 20, height: 10, channels: 3, background: "yellow" },
    })
      .png()
      .toBuffer());
  return http("post", `/machines/${machine.code}/photo`, who)
    .field("requestId", input.requestId)
    .field("version", String(input.version))
    .attach("file", image, {
      filename: "TEST machine.png",
      contentType: "image/png",
    });
};
test("metadata editing is Administrator-only, scoped and leaves code and engineering evidence unchanged", async () => {
  const beforeOrder = await db.workOrder.findUniqueOrThrow({
    where: { id: order.id },
  });
  for (const who of [
    "head",
    "supervisor",
    "management",
    "operator",
    "tech",
  ] as Who[])
    await http("put", `/machines/${machine.code}/details`, who)
      .send(profileInput())
      .expect(403);
  await http(
    "put",
    `/machines/${machine.code}/details`,
    "multi",
    Role.MAINTENANCE_HEAD,
  )
    .send(profileInput())
    .expect(403);
  for (const patch of [
    { code: "NEW-CODE" },
    { orgId: foreignOrg },
    { operationalStatus: "RUNNING" },
  ])
    await http("put", `/machines/${machine.code}/details`)
      .send({ ...profileInput(), ...patch })
      .expect(400);
  await http("put", "/machines/NOT-MINE/details", "foreign")
    .send(profileInput())
    .expect(404);
  const input = profileInput();
  const responses = await Promise.all([
    http("put", `/machines/${machine.code}/details`).send(input),
    http("put", `/machines/${machine.code}/details`).send(input),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(responses.filter((r) => r.body.alreadySaved).length, 1);
  machine.version = responses[0].body.version;
  await http("put", `/machines/${machine.code}/details`)
    .send({ ...input, name: "changed retry" })
    .expect(409);
  await http("put", `/machines/${machine.code}/details`)
    .send({ ...profileInput(), version: input.version })
    .expect(409);
  const detail = (
    await http("get", `/machines/${machine.code}/details`, "tech").expect(200)
  ).body;
  assert.equal(detail.machine.code, machine.code);
  assert.equal(detail.machine.model, null);
  assert.equal(detail.machine.manufacturer, null);
  assert.equal(detail.machine.department.name, input.department);
  assert.equal(detail.machine.location, null);
  assert.equal(detail.canManage, false);
  assert.deepEqual(
    await db.workOrder.findUniqueOrThrow({ where: { id: order.id } }),
    beforeOrder,
  );
  const audit = await db.auditEvent.findFirstOrThrow({
    where: { orgId, entityId: machine.id, action: "MACHINE_DETAILS_UPDATE" },
  });
  assert.equal((audit.detail as any).evidence.before.name, machine.name);
});
test("racing metadata and access updates share one CAS version", async () => {
  const result = await Promise.all([
    http("put", `/machines/${machine.code}/details`).send(profileInput()),
    access([{ membershipId: members.tech, granted: true }]),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  machine.version = result.find((r) => r.status === 200)!.body.version;
});
test("photo upload is bounded, role-restricted, duplicate-safe and all scoped readers retrieve normalized private bytes", async () => {
  const input = { requestId: randomUUID(), version: machine.version };
  for (const who of [
    "head",
    "tech",
    "operator",
    "supervisor",
    "management",
  ] as Who[])
    assert.equal((await photoUpload(input, who)).status, 403);
  const responses = await Promise.all([photoUpload(input), photoUpload(input)]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  assert.equal(responses.filter((r) => r.body.alreadySaved).length, 1);
  machine.version = responses[0].body.version;
  const detail = (
    await http("get", `/machines/${machine.code}/details`).expect(200)
  ).body;
  photoId = detail.photo.id;
  assert.equal(detail.photo.source.filename, "TEST machine.png");
  assert.equal(detail.photo.width, 20);
  assert.equal(detail.photo.content, undefined);
  for (const who of [
    "admin",
    "head",
    "tech",
    "operator",
    "management",
    "supervisor",
  ] as Who[]) {
    const listing = (await http("get", "/machines", who).expect(200)).body;
    const listed = listing.items.find(
      (item: { id: string }) => item.id === machine.id,
    );
    assert.deepEqual(listed.photo, {
      id: photoId,
      width: detail.photo.width,
      height: detail.photo.height,
    });
    const response = await http(
      "get",
      `/machines/${machine.code}/photo/${photoId}`,
      who,
    ).expect(200);
    assert.match(response.headers["content-type"], /image\/webp/);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"], /sandbox/);
    assert.equal((await sharp(response.body).metadata()).format, "webp");
  }
  await request(app.getHttpServer())
    .get(`/api/machines/${machine.code}/photo/${photoId}`)
    .expect(401);
  await http("get", `/machines/${second.code}/photo/${photoId}`).expect(404);
  await http(
    "get",
    `/machines/${machine.code}/photo/${photoId}`,
    "foreign",
  ).expect(404);
  const different = await sharp({
    create: { width: 25, height: 10, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  assert.equal((await photoUpload(input, "admin", different)).status, 409);
  assert.equal(
    (await photoUpload({ requestId: randomUUID(), version: input.version }))
      .status,
    409,
  );
  assert.equal(
    (await photoUpload(undefined, "admin", Buffer.from("<svg/>"))).status,
    400,
  );
  assert.equal(
    (await photoUpload(undefined, "admin", Buffer.alloc(5 * 1024 * 1024 + 1)))
      .status,
    413,
  );
});
test("audit failures roll back metadata references, photo replacement/removal and shared machine version", async () => {
  await auditFailure("MACHINE_DETAILS_UPDATE", async () => {
    await http("put", `/machines/${machine.code}/details`)
      .send({ ...profileInput(), department: "TEST failed metadata" })
      .expect(503);
    assert.equal(
      await db.department.count({
        where: { orgId, name: "TEST failed metadata" },
      }),
      0,
    );
  });
  await auditFailure("MACHINE_PHOTO_REPLACE", async () => {
    assert.equal((await photoUpload()).status, 503);
  });
  await auditFailure("MACHINE_PHOTO_REMOVE", async () => {
    await http("post", `/machines/${machine.code}/photo/remove`)
      .send({ requestId: randomUUID(), version: machine.version })
      .expect(503);
  });
  assert.equal(
    (await db.machine.findUniqueOrThrow({ where: { id: machine.id } })).version,
    machine.version,
  );
  assert.equal(
    (
      await db.machinePhoto.findUniqueOrThrow({
        where: { machineId: machine.id },
      })
    ).id,
    photoId,
  );
});
test("photo replacement invalidates prior photo URLs and removal retains audited source metadata with duplicate-safe receipt", async () => {
  const result = await photoUpload();
  assert.equal(result.status, 201);
  machine.version = result.body.version;
  await http("get", `/machines/${machine.code}/photo/${photoId}`).expect(404);
  const detail = (
    await http("get", `/machines/${machine.code}/details`).expect(200)
  ).body;
  photoId = detail.photo.id;
  const input = { requestId: randomUUID(), version: machine.version };
  const responses = await Promise.all([
    http("post", `/machines/${machine.code}/photo/remove`).send(input),
    http("post", `/machines/${machine.code}/photo/remove`).send(input),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  assert.equal(responses.filter((r) => r.body.alreadySaved).length, 1);
  machine.version = responses[0].body.version;
  await http("get", `/machines/${machine.code}/photo/${photoId}`).expect(404);
  assert.equal(
    (await http("get", `/machines/${machine.code}/details`).expect(200)).body
      .photo,
    null,
  );
  const audit = await db.auditEvent.findFirstOrThrow({
    where: { orgId, entityId: machine.id, action: "MACHINE_PHOTO_REMOVE" },
  });
  assert.equal(
    (audit.detail as any).evidence.before.source.filename,
    "TEST machine.png",
  );
  const uploaded = await photoUpload();
  assert.equal(uploaded.status, 201);
  machine.version = uploaded.body.version;
  photoId = (await http("get", `/machines/${machine.code}/details`).expect(200))
    .body.photo.id;
});
test("runtime cannot rename identity, mutate audits or inject a foreign photo association", async () => {
  const runtimeDb = new PrismaClient({ datasources: { db: { url: runtime } } });
  try {
    await assert.rejects(
      runtimeDb.machine.update({
        where: { id: machine.id },
        data: { code: "FORGED" },
      }),
    );
    await assert.rejects(
      runtimeDb.auditEvent.updateMany({
        where: { entityId: machine.id },
        data: { action: "FORGED" },
      }),
    );
    const stored = await db.machinePhoto.findUniqueOrThrow({
      where: { machineId: machine.id },
    });
    await assert.rejects(
      runtimeDb.machinePhoto.update({
        where: { machineId: machine.id },
        data: { content: stored.content },
      }),
    );
    await assert.rejects(
      db.machinePhoto.create({
        data: {
          ...stored,
          source: stored.source as Record<string, string>,
          id: randomUUID(),
          orgId: foreignOrg,
          machineId: second.id,
        },
      }),
    );
  } finally {
    await runtimeDb.$disconnect();
  }
});
test("revocation removes access immediately and administrator changes never edit engineering history", async () => {
  const saved = (
    await access([{ membershipId: members.tech, granted: false }]).expect(200)
  ).body;
  machine.version = saved.version;
  for (const suffix of [
    "",
    "/work-orders",
    "/calendar/plans",
    "/documents",
    "/assistant/chats",
    "/work-order-notifications",
    "/details",
    `/photo/${photoId}`,
  ])
    await http("get", `/machines/${machine.code}${suffix}`, "tech").expect(404);
  assert.equal(
    (
      await http(
        "get",
        `/machines/${machine.code}/work-orders/${order.id}`,
        "head",
      ).expect(200)
    ).body.status,
    "CLOSED",
  );
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: members.multi, role: Role.TECHNICIAN },
    },
    data: { active: false },
  });
  const roster = (
    await http("get", `/machines/${machine.code}/access?q=TEST%20multi`).expect(
      200,
    )
  ).body;
  assert(
    !roster.items
      .find((p: any) => p.membershipId === members.multi)
      .roles.includes("TECHNICIAN"),
  );
  await db.membership.update({
    where: { id: members.admin },
    data: { active: false },
  });
  await http("post", "/machines").send(registration("REVOKED-01")).expect(403);
  await http("put", `/machines/${machine.code}/details`)
    .send(profileInput())
    .expect(403);
  await http("get", `/machines/${machine.code}/photo/${photoId}`).expect(403);
});
