import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { CalendarService } from "../calendar/service";
import { dayStart, localDate } from "../calendar/recurrence";
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
  head: Role.MAINTENANCE_HEAD,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  admin: Role.ADMINISTRATOR,
  operator: Role.OPERATOR,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  noGrant: Role.TECHNICIAN,
  inactive: Role.MAINTENANCE_HEAD,
  outsider: Role.MAINTENANCE_HEAD,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let orgId: string,
  machineId: string,
  app: INestApplication,
  service: CalendarService;
const base = "/api/machines/WH-C/calendar",
  wb = "/api/machines/WH-C/work-orders";
const get = (path = "", who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (path = "", who: Who = "head") =>
  request(app.getHttpServer())
    .post(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const work = (
  id: string,
  action: string,
  who: Who,
  body: Record<string, unknown>,
) =>
  request(app.getHttpServer())
    .post(`${wb}/${id}/actions/${action}`)
    .set("Authorization", `Bearer ${ids[who]}`)
    .send(body);
const windowQuery = () =>
  `?from=${localDate(new Date(Date.now() - 31 * 86400000))}&to=${localDate(new Date(Date.now() + 30 * 86400000))}`;
const input = (extra: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  title: "TEST recurring maintenance",
  instructions: "TEST inspect and record the planned maintenance work.",
  frequency: "DAILY",
  interval: 1,
  firstDueAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  technicianId: ids.tech,
  priority: "NORMAL",
  remindDays: 3,
  ...extra,
});
const create = async (extra: Record<string, unknown> = {}) =>
  (await post("/plans").send(input(extra)).expect(201)).body;
const tasks = (planId: string) =>
  db.maintenanceOccurrence.findMany({
    where: { planId },
    orderBy: { sequence: "asc" },
  });
const jobs = (now = new Date()) => service.runJobs(now, { orgId, machineId });
before(async () => {
  const org = await db.organization.create({
    data: {
      slug: "calendar-test-" + randomUUID(),
      name: "TEST calendar fixture",
    },
  });
  orgId = org.id;
  const other = await db.organization.create({
    data: {
      slug: "calendar-other-" + randomUUID(),
      name: "TEST other fixture",
    },
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
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "outsider" ? other.id : orgId,
        role: roles[who],
        active: who !== "inactive",
      },
    });
    if (["operator", "tech", "tech2"].includes(who))
      await db.machineAccess.create({
        data: { orgId, membershipId: m.id, machineId },
      });
    if (who === "head")
      await db.membershipRoleGrant.create({
        data: { orgId, membershipId: m.id, role: Role.SUPERVISOR },
      });
  }
  const config = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtimeUrl,
  };
  const mod = await Test.createTestingModule({ imports: [appModule(config)] })
    .overrideProvider(VERIFIER)
    .useValue({
      async verify(t: string) {
        if (!Object.values(ids).includes(t)) throw new UnauthorizedException();
        return t;
      },
    })
    .compile();
  app = mod.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
  service = app.get(CalendarService);
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});
test("calendar enforces all six views, org/machine grants and strict head-only writes", async () => {
  await request(app.getHttpServer())
    .get(base + "/plans")
    .expect(401);
  for (const who of [
    "head",
    "tech",
    "admin",
    "operator",
    "supervisor",
    "management",
  ] as Who[]) {
    await get("/plans", who).expect(200);
    await get(windowQuery(), who).expect(200);
  }
  for (const who of [
    "tech",
    "admin",
    "operator",
    "supervisor",
    "management",
  ] as Who[])
    await post("/plans", who).send(input()).expect(403);
  for (const who of ["noGrant", "outsider"] as Who[])
    await get("/plans", who).expect(404);
  await get("/plans", "inactive").expect(403);
  for (const patch of [
    { orgId: randomUUID() },
    { firstDueAt: "2026-02-30T10:00:00Z" },
    { firstDueAt: "2099-01-01T10:00:00Z" },
    { interval: 0 },
    { remindDays: 15 },
    { technicianId: ids.noGrant },
    { technicianId: ids.admin },
  ])
    await post("/plans").send(input(patch)).expect(400);
  await get("?from=2026-01-01&to=2026-12-31").expect(400);
  await get(windowQuery() + "&orgId=forged").expect(400);
});
test("concurrent plan retries produce one immutable fixed schedule and changed keys conflict", async () => {
  const body = input();
  const responses = await Promise.all([
    post("/plans").send(body),
    post("/plans").send(body),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  const p = responses[0].body;
  assert.equal(p.id, responses[1].body.id);
  const rows = await tasks(p.id);
  assert.ok(rows.length >= 35);
  assert.equal(new Set(rows.map((o) => o.sequence)).size, rows.length);
  assert.equal(
    new Set(rows.map((o) => o.dueAt.toISOString())).size,
    rows.length,
  );
  await post("/plans")
    .send({ ...body, title: "TEST changed details" })
    .expect(409);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: p.id, action: "MAINTENANCE_PLAN_CREATED" },
    }),
    1,
  );
  await Promise.all([jobs(), jobs()]);
  assert.equal((await tasks(p.id)).length, rows.length);
});
test("pause/resume preserves existing tasks and resumes the fixed anchor with durable catch-up", async () => {
  const p = await create({
    firstDueAt: new Date(Date.now() + 31 * 86400000).toISOString(),
  });
  const before = await tasks(p.id);
  const paused = (
    await post(`/plans/${p.id}/state`)
      .send({
        version: p.version,
        active: false,
        reason: "TEST approved pause",
      })
      .expect(200)
  ).body;
  await jobs(new Date(Date.now() + 10 * 86400000));
  assert.equal((await tasks(p.id)).length, before.length);
  await post(`/plans/${p.id}/state`)
    .send({ version: p.version, active: true, reason: "TEST stale resume" })
    .expect(409);
  await post(`/plans/${p.id}/state`)
    .send({
      version: paused.version,
      active: true,
      reason: "TEST resume fixed schedule",
    })
    .expect(200);
  await jobs(new Date(Date.now() + 10 * 86400000));
  const after = await tasks(p.id);
  assert.ok(after.length > before.length);
  assert.equal(after[0].dueAt.toISOString(), p.firstDueAt);
  assert.equal(after[1].dueAt.getTime() - after[0].dueAt.getTime(), 86400000);
});
test("due/reminder jobs deduplicate, scope technician ownership and keep read state per role", async () => {
  const p = await create();
  await jobs();
  const all = await db.maintenanceReminder.findMany({
    where: { orgId, occurrence: { planId: p.id } },
    include: { occurrence: true },
  });
  assert.ok(all.some((r) => r.kind === "OVERDUE"));
  const count = all.length;
  await Promise.all([jobs(), jobs()]);
  assert.equal(
    await db.maintenanceReminder.count({
      where: { orgId, occurrence: { planId: p.id } },
    }),
    count,
  );
  const head = (await get("/reminders").expect(200)).body;
  const alert = head.items.find((r: any) => all.some((a) => a.id === r.id));
  assert.ok(alert);
  const tech = (await get("/reminders", "tech").expect(200)).body;
  assert.ok(tech.items.some((r: any) => r.id === alert.id));
  assert.equal(
    (await get("/reminders", "tech2").expect(200)).body.items.length,
    0,
  );
  assert.equal(
    (await get("/reminders", "admin").expect(200)).body.items.length,
    0,
  );
  await post(`/reminders/${alert.id}/read`).send({}).expect(200);
  await post(`/reminders/${alert.id}/read`).send({}).expect(200);
  assert.equal(
    await db.maintenanceReminderReceipt.count({
      where: {
        reminderId: alert.id,
        userId: ids.head,
        role: Role.MAINTENANCE_HEAD,
      },
    }),
    1,
  );
  const supervisor = (
    await get("/reminders").set("X-Workspace-Role", Role.SUPERVISOR).expect(200)
  ).body;
  assert.equal(
    supervisor.items.find((r: any) => r.id === alert.id).read,
    false,
  );
  await post(`/reminders/${alert.id}/read`, "tech2").send({}).expect(404);
});
test("concurrent release creates one assigned planned order; completion needs evidence and head review without fabricated breakdown RCA", async () => {
  const p = await create(),
    o = (await tasks(p.id))[0];
  const b = { version: o.version, technicianId: ids.tech };
  const releases = await Promise.all([
    post(`/occurrences/${o.id}/release`).send(b),
    post(`/occurrences/${o.id}/release`).send(b),
  ]);
  assert.deepEqual(
    releases.map((r) => r.status),
    [200, 200],
  );
  const id = releases[0].body.orderId;
  assert.equal(releases[1].body.orderId, id);
  assert.equal(await db.workOrder.count({ where: { occurrenceId: o.id } }), 1);
  const getOrder = async () =>
    (
      await request(app.getHttpServer())
        .get(wb + "/" + id)
        .set("Authorization", `Bearer ${ids.head}`)
        .expect(200)
    ).body;
  let order = await getOrder();
  assert.equal(order.kind, "PLANNED");
  assert.equal(order.status, "ASSIGNED");
  assert.equal(order.events[0].action, "SCHEDULE");
  assert.equal(order.events[0].actorRole, "MAINTENANCE_HEAD");
  await post(`/occurrences/${o.id}/skip`)
    .send({ version: 2, reason: "TEST cannot skip released work" })
    .expect(409);
  await work(id, "start", "tech2", { version: order.version }).expect(403);
  order = (
    await work(id, "start", "tech", { version: order.version }).expect(200)
  ).body;
  const completion = {
    findings: "TEST maintenance findings",
    correctiveAction: "TEST planned work performed",
    performedAt: order.reportedAt,
  };
  for (const patch of [
    { rootCause: "TEST fabricated cause" },
    { restoredAt: order.reportedAt },
    { performedAt: "2099-01-01T00:00:00Z" },
    { performedAt: "2026-02-30T00:00:00Z" },
  ])
    await work(id, "submit", "tech", {
      version: order.version,
      ...completion,
      ...patch,
    }).expect(400);
  await work(id, "submit", "tech", {
    version: order.version,
    findings: completion.findings,
    correctiveAction: completion.correctiveAction,
  }).expect(400);
  order = (
    await work(id, "submit", "tech", {
      version: order.version,
      ...completion,
    }).expect(200)
  ).body;
  assert.equal(order.rootCause, null);
  assert.equal(order.restoredAt, null);
  assert.ok(order.performedAt);
  await work(id, "approve", "admin", { version: order.version }).expect(403);
  order = (
    await work(id, "return", "head", {
      version: order.version,
      reason: "TEST add inspection detail",
    }).expect(200)
  ).body;
  order = (
    await work(id, "submit", "tech", {
      version: order.version,
      ...completion,
      findings: "TEST revised inspection findings",
    }).expect(200)
  ).body;
  order = (
    await work(id, "approve", "head", { version: order.version }).expect(200)
  ).body;
  order = (
    await work(id, "close", "supervisor", { version: order.version }).expect(
      200,
    )
  ).body;
  const calendar = (await get(windowQuery() + "&status=COMPLETED").expect(200))
    .body;
  assert.ok(
    calendar.items.some((r: any) => r.id === o.id && r.workOrderId === id),
  );
  assert.ok(
    !(await get("/reminders").expect(200)).body.items.some(
      (r: any) => r.occurrenceId === o.id,
    ),
  );
  assert.equal(
    order.events.filter((e: any) => e.action === "SUBMIT").length,
    2,
  );
  assert.ok(
    order.events.find((e: any) => e.action === "SUBMIT").detail.workPerformed,
  );
  assert.equal(
    (
      await db.maintenancePlan.findUniqueOrThrow({ where: { id: p.id } })
    ).firstDueAt.toISOString(),
    p.firstDueAt,
  );
});
test("skip/release races preserve one outcome, suppress reminders and never erase later fixed dates", async () => {
  const p = await create(),
    o = (await tasks(p.id))[0];
  const result = await Promise.all([
    post(`/occurrences/${o.id}/skip`).send({
      version: 1,
      reason: "TEST justified skip",
    }),
    post(`/occurrences/${o.id}/release`).send({
      version: 1,
      technicianId: ids.tech,
    }),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  const current = await db.maintenanceOccurrence.findUniqueOrThrow({
    where: { id: o.id },
    include: { workOrder: true },
  });
  assert.notEqual(!!current.skippedAt, !!current.workOrder);
  assert.ok((await tasks(p.id)).length > 1);
  if (current.skippedAt) {
    await jobs();
    assert.ok(
      !(await get("/reminders").expect(200)).body.items.some(
        (r: any) => r.occurrenceId === o.id,
      ),
    );
  }
});
test("audit failure rolls back plan generation and release; database protects snapshots and reminder history", async () => {
  const fn = "calendar_fail_" + orgId.replaceAll("-", ""),
    trigger = "calendar_fail_trigger_" + orgId.replaceAll("-", "");
  const install = async (action: string) => {
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orgId"='${orgId}'::uuid AND NEW.action='${action}' THEN RAISE EXCEPTION 'TEST audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.${fn}()`,
    );
  };
  const remove = () =>
    db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${trigger} ON maintenance."AuditEvent"`,
    );
  const before = await db.maintenancePlan.count({ where: { orgId } });
  await install("MAINTENANCE_PLAN_CREATED");
  try {
    await post("/plans").send(input()).expect(503);
    assert.equal(await db.maintenancePlan.count({ where: { orgId } }), before);
  } finally {
    await remove();
  }
  const p = await create(),
    o = (await tasks(p.id))[0];
  await install("WORK_ORDER_SCHEDULE");
  try {
    await post(`/occurrences/${o.id}/release`)
      .send({ version: 1, technicianId: ids.tech })
      .expect(503);
    assert.equal(
      await db.workOrder.count({ where: { occurrenceId: o.id } }),
      0,
    );
    assert.equal(
      (
        await db.maintenanceOccurrence.findUniqueOrThrow({
          where: { id: o.id },
        })
      ).version,
      1,
    );
  } finally {
    await remove();
  }
  const beforeCursors = await db.maintenancePlan.findMany({
    where: { orgId },
    orderBy: { id: "asc" },
    select: { id: true, nextSequence: true },
  });
  const beforeOccurrences = await db.maintenanceOccurrence.count({
    where: { orgId },
  });
  await install("MAINTENANCE_OCCURRENCES_CREATED");
  try {
    await assert.rejects(jobs(new Date(Date.now() + 20 * 86400000)));
    assert.equal(
      await db.maintenanceOccurrence.count({ where: { orgId } }),
      beforeOccurrences,
    );
    assert.deepEqual(
      await db.maintenancePlan.findMany({
        where: { orgId },
        orderBy: { id: "asc" },
        select: { id: true, nextSequence: true },
      }),
      beforeCursors,
    );
  } finally {
    await remove();
  }
  const beforeReminders = await db.maintenanceReminder.count({
    where: { orgId },
  });
  await install("MAINTENANCE_REMINDERS_CREATED");
  try {
    await assert.rejects(jobs());
    assert.equal(
      await db.maintenanceReminder.count({ where: { orgId } }),
      beforeReminders,
    );
  } finally {
    await remove();
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await jobs();
  assert.ok(
    (await db.maintenanceReminder.count({ where: { orgId } })) >
      beforeReminders,
  );
  await assert.rejects(
    runtime.maintenancePlan.update({
      where: { id: p.id },
      data: { title: "FORGED plan" },
    }),
  );
  await assert.rejects(
    runtime.maintenanceOccurrence.update({
      where: { id: o.id },
      data: { dueAt: new Date() },
    }),
  );
  const reminder = await db.maintenanceReminder.findFirstOrThrow({
    where: { orgId },
  });
  await assert.rejects(
    runtime.maintenanceReminder.delete({ where: { id: reminder.id } }),
  );
  await assert.rejects(
    db.maintenanceReminder.update({
      where: { id: reminder.id },
      data: { kind: "DUE" },
    }),
  );
});
test("calendar keyset paging is complete and active machine/role revocation denies later requests", async () => {
  const first = (await get(windowQuery()).expect(200)).body;
  assert.ok(first.nextCursor);
  const idsSeen = first.items.map((o: any) => o.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = (await get(windowQuery() + "&after=" + cursor).expect(200))
      .body;
    idsSeen.push(...page.items.map((o: any) => o.id));
    cursor = page.nextCursor;
  }
  assert.equal(new Set(idsSeen).size, idsSeen.length);
  assert.equal(
    idsSeen.length,
    Object.values(first.counts).reduce((a: any, b: any) => a + b, 0),
  );
  await get(windowQuery() + "&after=" + randomUUID()).expect(400);
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech2 },
  });
  await db.machineAccess.deleteMany({ where: { membershipId: member.id } });
  await get("/plans", "tech2").expect(404);
  const head = await db.membership.findUniqueOrThrow({
    where: { userId: ids.head },
  });
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: head.id, role: Role.SUPERVISOR },
    },
    data: { active: false },
  });
  await get("/reminders").set("X-Workspace-Role", Role.SUPERVISOR).expect(403);
});
