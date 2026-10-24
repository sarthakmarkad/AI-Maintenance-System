// All fixtures and fault injection are confined to an explicitly isolated *_test DB.
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
import { localTime } from "../readings/parser";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname
)
  throw new Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const roles = {
  operator: Role.OPERATOR,
  head: Role.MAINTENANCE_HEAD,
  head2: Role.MAINTENANCE_HEAD,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  pilot: Role.ADMINISTRATOR,
  admin: Role.ADMINISTRATOR,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  noGrant: Role.TECHNICIAN,
  foreign: Role.MAINTENANCE_HEAD,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let app: INestApplication, orgId: string, machineId: string;
const base = "/api/machines/WH-C/work-order-notifications";
const orders = "/api/machines/WH-C/work-orders";
const calendar = "/api/machines/WH-C/calendar";
const reviews = "/api/machines/WH-C/readings/anomalies/reviews";
const http = () => request(app.getHttpServer());
const headers = (who: Who, role?: Role) => ({
  Authorization: `Bearer ${ids[who]}`,
  ...(role ? { "X-Workspace-Role": role } : {}),
});
const list = (who: Who = "tech", role?: Role, query = "") =>
  http()
    .get(base + query)
    .set(headers(who, role));
const read = (id: string, who: Who = "tech", role?: Role) =>
  http().post(`${base}/${id}/read`).set(headers(who, role)).send({});
const action = (
  o: any,
  name: string,
  who: Who,
  input: Record<string, unknown> = {},
  role?: Role,
) =>
  http()
    .post(`${orders}/${o.id}/actions/${name}`)
    .set(headers(who, role))
    .send({ version: o.version, ...input });
async function report() {
  return (
    await http()
      .post(orders)
      .set(headers("operator"))
      .send({
        requestId: randomUUID(),
        title: "TEST notification handoff",
        description:
          "Synthetic integration fixture only; not a company incident.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
}
async function assigned(tech: Who = "tech") {
  return (
    await action(await report(), "assign", "head", {
      technicianId: ids[tech],
    }).expect(200)
  ).body;
}
const submission = (o: any) => ({
  findings: "TEST inspection findings",
  correctiveAction: "TEST work performed",
  preventiveAction: "TEST next checks",
  ...(o.kind === "BREAKDOWN"
    ? { rootCause: "TEST human analysis", restoredAt: o.reportedAt }
    : {
        performedAt: o.reportedAt,
        ...(o.kind === "INVESTIGATION"
          ? { investigationOutcome: "INCONCLUSIVE" }
          : {}),
      }),
});
async function itemFor(o: any, who: Who = "tech", role?: Role) {
  let page = (await list(who, role).expect(200)).body;
  while (!page.items.some((n: any) => n.orderId === o.id) && page.nextCursor)
    page = (await list(who, role, "?after=" + page.nextCursor).expect(200))
      .body;
  return page.items.find((n: any) => n.orderId === o.id);
}
async function failAudit(actionName: string, run: () => Promise<void>) {
  const fn = "notifications_fail_" + randomUUID().replaceAll("-", "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST audit failure'; END $$`,
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
async function flagFor() {
  const res = await http()
    .get(
      "/api/machines/WH-C/readings/anomalies?from=2026-09-01&to=2026-09-05&kind=SUDDEN_CHANGE&status=PENDING",
    )
    .set(headers("head"))
    .expect(200);
  assert(res.body.items[0], "TEST flag fixture available");
  const { key, measuredAt } = res.body.items[0];
  return {
    key,
    measuredAt,
    decision: "INVESTIGATE",
    reason: "TEST explicitly inspect synthetic evidence",
  };
}
async function planned() {
  const plan = (
    await http()
      .post(calendar + "/plans")
      .set(headers("head"))
      .send({
        requestId: randomUUID(),
        title: "TEST notification planned task",
        instructions: "TEST inspect the fixture",
        frequency: "DAILY",
        interval: 1,
        firstDueAt: new Date(Date.now() - 3600000).toISOString(),
        technicianId: ids.tech,
        priority: "NORMAL",
        remindDays: 3,
      })
      .expect(201)
  ).body;
  await app.get(CalendarService).runJobs(new Date(), { orgId, machineId });
  return db.maintenanceOccurrence.findFirstOrThrow({
    where: { planId: plan.id },
    orderBy: { sequence: "asc" },
  });
}
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "notifications-" + randomUUID(),
        name: "TEST notification fixture",
      },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: {
        slug: "notifications-other-" + randomUUID(),
        name: "TEST foreign fixture",
      },
    })
  ).id;
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
  await db.machine.createMany({
    data: [
      {
        orgId: other,
        code: "WH-C",
        name: "TEST foreign machine",
        manufacturer: "Fixture",
      },
      {
        orgId,
        code: "WH-B",
        name: "TEST reference only",
        manufacturer: "Fixture",
      },
    ],
  });
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "foreign" ? other : orgId,
        role: roles[who],
      },
    });
    if (who === "pilot")
      await db.membershipRoleGrant.createMany({
        data: Object.values(Role)
          .filter((r) => r !== Role.ADMINISTRATOR)
          .map((role) => ({ orgId, membershipId: m.id, role })),
      });
    if (["operator", "tech", "tech2", "pilot"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
      });
  }
  const batch = await db.readingImport.create({
    data: {
      orgId,
      machineId,
      filename: "TEST synthetic.xlsx",
      workbookHash: "b".repeat(64),
      parserVersion: "TEST",
      policyVersion: "demo-hourly-bands-v1",
      staged: { TEST: true },
      status: "COMMITTED",
      createdBy: ids.admin,
      expiresAt: new Date(),
      committedAt: new Date(),
    },
  });
  await db.processReading.createMany({
    data: Array.from({ length: 120 }, (_, i) => {
      const measuredAt = new Date(
          Date.parse("2026-08-31T18:30:00Z") + i * 3600000,
        ),
        hour = Number(localTime(measuredAt).slice(11, 13));
      return {
        id: randomUUID(),
        orgId,
        machineId,
        importId: batch.id,
        sourceId: "NOTIFY-" + i,
        sourceRow: i + 2,
        measuredAt,
        receivedAt: new Date(),
        localMeasuredAt: localTime(measuredAt),
        demoShift: hour < 8 ? "A" : hour < 16 ? "B" : "C",
        hotTempC: i < 24 ? 200 : i % 4 === 0 ? 220 : 200,
        coldTempC: 45,
        pressureBar: 100,
        rawCells: {},
      };
    }),
  });
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
      async verify(token: string) {
        if (!Object.values(ids).includes(token))
          throw new UnauthorizedException();
        return token;
      },
    })
    .compile();
  app = mod.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});

test("notifications require trusted role/org/machine scope and reject forged receipts", async () => {
  const o = await assigned(),
    n = await itemFor(o);
  assert(n);
  assert.equal(n.action, "ASSIGN");
  assert.equal(n.eventVersion, 2);
  await http().get(base).expect(401);
  for (const who of [
    "operator",
    "supervisor",
    "management",
    "admin",
    "foreign",
    "tech2",
  ] as Who[]) {
    const page = (await list(who).expect(200)).body;
    assert(!page.items.some((x: any) => x.id === n.id));
    await read(n.id, who).expect(404);
  }
  await list("noGrant").expect(404);
  await http()
    .get(base.replace("WH-C", "WH-B"))
    .set(headers("head"))
    .expect(404);
  await list("tech", Role.MAINTENANCE_HEAD).expect(403);
  await list("head", undefined, "?userId=" + ids.tech).expect(400);
  await http()
    .post(`${base}/${n.id}/read`)
    .set(headers("tech"))
    .send({ userId: ids.head, role: "MAINTENANCE_HEAD" })
    .expect(400);
  await read(randomUUID()).expect(404);
  await read("invalid").expect(400);
});

test("concurrent receipts are idempotent per actual user, preserve read time and do not bump workflow version", async () => {
  const o = await assigned(),
    n = await itemFor(o);
  assert.equal(n.readAt, null);
  await list().expect(200);
  assert.equal(
    await db.workOrderNotificationReceipt.count({ where: { eventId: n.id } }),
    0,
    "opening inbox never reads",
  );
  const results = await Promise.all([read(n.id), read(n.id), read(n.id)]);
  for (const result of results)
    assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(new Set(results.map((r) => r.body.readAt)).size, 1);
  assert.equal(
    (await read(n.id).expect(200)).body.readAt,
    results[0].body.readAt,
  );
  assert.equal(
    await db.workOrderNotificationReceipt.count({ where: { eventId: n.id } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: n.id, action: "WORK_ORDER_NOTIFICATION_READ" },
    }),
    1,
  );
  const current = await db.workOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(current.version, o.version);
  assert.equal(current.updatedAt.toISOString(), o.updatedAt);
  assert.equal((await itemFor(o)).readAt, results[0].body.readAt);
});

test("same six-role pilot isolates technician and head receipts; each head has its own unread submission", async () => {
  let o = await assigned("pilot");
  const assignment = await itemFor(o, "pilot", Role.TECHNICIAN);
  assert(assignment);
  for (const role of [
    Role.ADMINISTRATOR,
    Role.OPERATOR,
    Role.SUPERVISOR,
    Role.MANAGEMENT,
    Role.MAINTENANCE_HEAD,
  ])
    await read(assignment.id, "pilot", role).expect(404);
  await read(assignment.id, "pilot", Role.TECHNICIAN).expect(200);
  o = (await action(o, "start", "pilot", {}, Role.TECHNICIAN).expect(200)).body;
  o = (
    await action(o, "submit", "pilot", submission(o), Role.TECHNICIAN).expect(
      200,
    )
  ).body;
  const notification = await itemFor(o, "pilot", Role.MAINTENANCE_HEAD);
  assert(notification);
  assert.equal(notification.readAt, null);
  await read(notification.id, "pilot", Role.TECHNICIAN).expect(404);
  await read(notification.id, "pilot", Role.MAINTENANCE_HEAD).expect(200);
  assert.equal((await itemFor(o, "head")).readAt, null);
  await read(notification.id, "head").expect(200);
  assert.equal((await itemFor(o, "head2")).readAt, null);
  assert.equal(
    await db.workOrderNotificationReceipt.count({
      where: { eventId: notification.id },
    }),
    2,
  );
});

test("assignment retries/races create one event and superseded assignees lose notification access", async () => {
  const reported = await report();
  const results = await Promise.all([
    action(reported, "assign", "head", { technicianId: ids.tech }),
    action(reported, "assign", "head", { technicianId: ids.tech }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  let o = results.find((r) => r.status === 200)!.body;
  const old = await itemFor(o);
  await action(reported, "assign", "head", { technicianId: ids.tech }).expect(
    409,
  );
  assert.equal(
    await db.workOrderEvent.count({
      where: { orderId: o.id, action: "ASSIGN" },
    }),
    1,
  );
  o = (
    await action(o, "assign", "head", {
      technicianId: ids.tech2,
      reason: "TEST coverage handoff",
    }).expect(200)
  ).body;
  assert.equal(await itemFor(o), undefined);
  await read(old.id).expect(404);
  const next = await itemFor(o, "tech2");
  assert(next);
  assert.match(next.message, /Reassigned/);
  await action(reported, "assign", "head", { technicianId: ids.tech }).expect(
    409,
  );
  assert.equal((await itemFor(o, "tech2")).id, next.id);
});

test("current stage tracks start, submission, return, evidence additions, resubmission, approval and closure", async () => {
  let o = await assigned();
  const assignment = await itemFor(o);
  o = (await action(o, "start", "tech").expect(200)).body;
  await read(assignment.id).expect(404);
  assert.equal(await itemFor(o), undefined);
  o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
  const submitted = await itemFor(o, "head");
  assert.equal(submitted.action, "SUBMIT");
  o = (
    await action(o, "return", "head", {
      reason: "TEST retain an additional inspection detail",
    }).expect(200)
  ).body;
  await read(submitted.id, "head").expect(404);
  const returned = await itemFor(o);
  assert.equal(returned.action, "RETURN");
  // Attachment-only version changes preserve the handoff instead of hiding it.
  const upload = await http()
    .post(`${orders}/${o.id}/attachments`)
    .set(headers("tech"))
    .field("version", String(o.version))
    .field("requestId", randomUUID())
    .field("description", "TEST returned-work evidence")
    .attach("file", Buffer.from("%PDF-1.4\nTEST fixture\n%%EOF"), {
      filename: "TEST.pdf",
      contentType: "application/pdf",
    })
    .expect(201);
  o = { ...o, version: upload.body.attachment.orderVersion };
  assert.equal((await itemFor(o)).id, returned.id);
  await read(returned.id).expect(200);
  o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
  await read(returned.id).expect(404);
  const resubmitted = await itemFor(o, "head");
  assert.notEqual(resubmitted.id, submitted.id);
  assert.equal(resubmitted.readAt, null);
  assert.equal(
    (await list("head").expect(200)).body.items.filter(
      (n: any) => n.orderId === o.id,
    ).length,
    1,
  );
  o = (await action(o, "approve", "head").expect(200)).body;
  await read(resubmitted.id, "head").expect(404);
  assert.equal(await itemFor(o, "head"), undefined);
  o = (await action(o, "close", "supervisor").expect(200)).body;
  assert.equal(await itemFor(o), undefined);
  assert.equal(await itemFor(o, "head"), undefined);
  assert.equal(
    await db.workOrderNotificationReceipt.count({
      where: { eventId: returned.id },
    }),
    1,
    "retained read evidence survives stage changes",
  );
});

test("revoked membership, role grant and machine access immediately block list/read and restoration retains receipts", async () => {
  const o = await assigned("pilot"),
    n = await itemFor(o, "pilot", Role.TECHNICIAN);
  await read(n.id, "pilot", Role.TECHNICIAN).expect(200);
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.pilot },
  });
  await db.membership.update({ where: { id: m.id }, data: { active: false } });
  await list("pilot", Role.TECHNICIAN).expect(403);
  await read(n.id, "pilot", Role.TECHNICIAN).expect(403);
  await db.membership.update({ where: { id: m.id }, data: { active: true } });
  await db.membershipRoleGrant.update({
    where: { membershipId_role: { membershipId: m.id, role: Role.TECHNICIAN } },
    data: { active: false },
  });
  await list("pilot", Role.TECHNICIAN).expect(403);
  await read(n.id, "pilot", Role.TECHNICIAN).expect(403);
  await db.membershipRoleGrant.update({
    where: { membershipId_role: { membershipId: m.id, role: Role.TECHNICIAN } },
    data: { active: true },
  });
  await db.machineAccess.delete({
    where: { machineId_membershipId: { machineId, membershipId: m.id } },
  });
  await list("pilot", Role.TECHNICIAN).expect(404);
  await read(n.id, "pilot", Role.TECHNICIAN).expect(404);
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: m.id },
  });
  assert((await itemFor(o, "pilot", Role.TECHNICIAN)).readAt);
});

test("planned release exact retries/concurrency create one assignment notification; reminders remain separate", async () => {
  const occurrence = await planned(),
    body = { version: occurrence.version, technicianId: ids.tech };
  const release = () =>
    http()
      .post(`${calendar}/occurrences/${occurrence.id}/release`)
      .set(headers("head"))
      .send(body);
  const results = await Promise.all([release(), release()]);
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(results[0].body.orderId, results[1].body.orderId);
  assert.equal(
    (await release().expect(201)).body.orderId,
    results[0].body.orderId,
  );
  const o = { id: results[0].body.orderId };
  const n = await itemFor(o);
  assert.equal(n.action, "SCHEDULE");
  assert.equal(n.kind, "PLANNED");
  assert.equal(
    await db.workOrderEvent.count({
      where: { orderId: o.id, action: "SCHEDULE" },
    }),
    1,
  );
  await http()
    .get(calendar + "/reminders")
    .set(headers("tech"))
    .expect(200);
  assert.equal(
    await db.maintenanceReminderReceipt.count({ where: { orgId } }),
    0,
  );
  await read(n.id).expect(200);
  assert.equal(
    await db.maintenanceReminderReceipt.count({ where: { orgId } }),
    0,
  );
});

test("explicit and compatible investigation releases notify only after release and dedupe concurrent/exact retries", async () => {
  const input = await flagFor();
  const saved = (
    await http().post(reviews).set(headers("head")).send(input).expect(201)
  ).body;
  assert.equal(saved.workOrderId, null);
  assert.equal(
    await db.workOrderEvent.count({ where: { orgId, action: "INVESTIGATE" } }),
    0,
  );
  const release = () =>
    http()
      .post(`${reviews}/${saved.id}/investigation`)
      .set(headers("head"))
      .send({ technicianId: ids.tech });
  const results = await Promise.all([release(), release()]);
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(results[0].body.workOrderId, results[1].body.workOrderId);
  // Explicit endpoint uses workOrderId (same returned receipt as compatible path).
  const id = results[0].body.workOrderId;
  assert(id);
  assert.equal((await release().expect(201)).body.workOrderId, id);
  assert.equal((await itemFor({ id })).action, "INVESTIGATE");
  const combined = { ...(await flagFor()), technicianId: ids.tech };
  const requestCombined = () =>
    http().post(reviews).set(headers("head")).send(combined);
  const both = await Promise.all([requestCombined(), requestCombined()]);
  for (const r of both) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(both[0].body.workOrderId, both[1].body.workOrderId);
  let o = (
    await http()
      .get(`${orders}/${both[0].body.workOrderId}`)
      .set(headers("head"))
      .expect(200)
  ).body;
  const old = await itemFor(o);
  assert.equal(old.action, "INVESTIGATE");
  o = (
    await action(o, "assign", "head", {
      technicianId: ids.tech2,
      reason: "TEST investigation handoff",
    }).expect(200)
  ).body;
  assert.equal((await requestCombined().expect(201)).body.workOrderId, o.id);
  await read(old.id).expect(404);
  assert.equal((await itemFor(o, "tech2")).action, "ASSIGN");
  assert.equal(
    await db.workOrderEvent.count({
      where: { orderId: o.id, action: "INVESTIGATE" },
    }),
    1,
  );
});

test("all kinds notify heads on submission/resubmission and technicians on return", async () => {
  const occurrence = await planned();
  const p = (
    await http()
      .post(`${calendar}/occurrences/${occurrence.id}/release`)
      .set(headers("head"))
      .send({ version: 1, technicianId: ids.tech })
      .expect(201)
  ).body.orderId;
  const input = { ...(await flagFor()), technicianId: ids.tech };
  const i = (
    await http().post(reviews).set(headers("head")).send(input).expect(201)
  ).body.workOrderId;
  for (const id of [p, i]) {
    let o = (
      await http().get(`${orders}/${id}`).set(headers("head")).expect(200)
    ).body;
    o = (await action(o, "start", "tech").expect(200)).body;
    o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
    const first = await itemFor(o, "head");
    assert.equal(first.action, "SUBMIT");
    o = (
      await action(o, "return", "head", {
        reason: "TEST another observation required",
      }).expect(200)
    ).body;
    assert.equal((await itemFor(o)).action, "RETURN");
    o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
    const next = await itemFor(o, "head");
    assert.equal(next.action, "SUBMIT");
    assert.notEqual(next.id, first.id);
  }
});

test("failed workflow/audit emits no phantom assignment, submission, return or read receipt", async () => {
  let o = await report();
  await failAudit("WORK_ORDER_ASSIGN", async () => {
    await action(o, "assign", "head", { technicianId: ids.tech }).expect(503);
    assert.equal(await itemFor(o), undefined);
    assert.equal(
      await db.workOrderEvent.count({
        where: { orderId: o.id, action: "ASSIGN" },
      }),
      0,
    );
  });
  o = (
    await action(o, "assign", "head", { technicianId: ids.tech }).expect(200)
  ).body;
  const n = await itemFor(o);
  await failAudit("WORK_ORDER_NOTIFICATION_READ", async () => {
    await read(n.id).expect(503);
    assert.equal(
      await db.workOrderNotificationReceipt.count({ where: { eventId: n.id } }),
      0,
    );
    assert.equal((await itemFor(o)).readAt, null);
  });
  o = (await action(o, "start", "tech").expect(200)).body;
  await failAudit("WORK_ORDER_SUBMIT", async () => {
    await action(o, "submit", "tech", submission(o)).expect(503);
    assert.equal(await itemFor(o, "head"), undefined);
  });
  o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
  const pending = await itemFor(o, "head");
  await failAudit("WORK_ORDER_RETURN", async () => {
    await action(o, "return", "head", {
      reason: "TEST additional evidence",
    }).expect(503);
    assert.equal(await itemFor(o), undefined);
    assert.equal((await itemFor(o, "head")).id, pending.id);
  });
});

test("failed planned/explicit/compatible releases leave no phantom source notifications", async () => {
  const occurrence = await planned();
  await failAudit("WORK_ORDER_SCHEDULE", async () => {
    await http()
      .post(`${calendar}/occurrences/${occurrence.id}/release`)
      .set(headers("head"))
      .send({ version: 1, technicianId: ids.tech })
      .expect(503);
    assert.equal(
      await db.workOrder.count({ where: { occurrenceId: occurrence.id } }),
      0,
    );
  });
  const combined = { ...(await flagFor()), technicianId: ids.tech };
  const retained = (
    await http()
      .post(reviews)
      .set(headers("head"))
      .send(await flagFor())
      .expect(201)
  ).body;
  // Use a different pending flag for the compatible request.
  Object.assign(combined, await flagFor());
  const beforeCount = await db.workOrderEvent.count({
    where: { orgId, action: "INVESTIGATE" },
  });
  await failAudit("WORK_ORDER_INVESTIGATE", async () => {
    await http()
      .post(`${reviews}/${retained.id}/investigation`)
      .set(headers("head"))
      .send({ technicianId: ids.tech })
      .expect(503);
    await http().post(reviews).set(headers("head")).send(combined).expect(503);
    assert.equal(
      await db.workOrder.count({ where: { anomalyReviewId: retained.id } }),
      0,
    );
    assert.equal(
      await db.anomalyReview.count({ where: { orgId, key: combined.key } }),
      0,
    );
    assert.equal(
      await db.workOrderEvent.count({
        where: { orgId, action: "INVESTIGATE" },
      }),
      beforeCount,
    );
  });
});

test("runtime SQL cannot rewrite receipts, forge roles/scope/stages or delete source evidence", async () => {
  const o = await assigned(),
    n = await itemFor(o);
  const data = {
    orgId,
    machineId,
    eventId: n.id,
    userId: ids.tech,
    role: Role.TECHNICIAN,
  };
  await runtime.workOrderNotificationReceipt.create({ data });
  await assert.rejects(
    runtime.workOrderNotificationReceipt.updateMany({
      where: { eventId: n.id },
      data: { readAt: new Date(0) },
    }),
  );
  await assert.rejects(
    runtime.workOrderNotificationReceipt.deleteMany({
      where: { eventId: n.id },
    }),
  );
  await assert.rejects(
    db.workOrderNotificationReceipt.updateMany({
      where: { eventId: n.id },
      data: { readAt: new Date(0) },
    }),
    /immutable|cannot|protected|append.only/i,
  );
  for (const patch of [
    { userId: ids.tech2 },
    { userId: ids.admin, role: Role.ADMINISTRATOR },
    { orgId: randomUUID() },
    { machineId: randomUUID() },
  ])
    await assert.rejects(
      runtime.workOrderNotificationReceipt.create({
        data: { ...data, ...patch },
      }),
    );
  await action(o, "start", "tech").expect(200);
  await assert.rejects(
    runtime.workOrderNotificationReceipt.create({
      data: { ...data, userId: ids.head, role: Role.MAINTENANCE_HEAD },
    }),
  );
  await assert.rejects(runtime.workOrderEvent.delete({ where: { id: n.id } }));
});

test("new inbox uses existing immutable history and keyset pages/count span all current handoffs", async () => {
  // No feature cutover timestamp: older existing events behave identically.
  const ordersCreated = [];
  for (let i = 0; i < 27; i++) ordersCreated.push(await assigned("tech2"));
  const beforeVersion = ordersCreated[0].version;
  const first = (await list("tech2").expect(200)).body;
  assert.equal(first.items.length, 25);
  assert(first.nextCursor);
  const second = (
    await list("tech2", undefined, "?after=" + first.nextCursor).expect(200)
  ).body;
  assert(second.items.length > 0);
  assert.equal(second.unread, first.unread);
  const all = [...first.items, ...second.items];
  assert.equal(new Set(all.map((n: any) => n.id)).size, all.length);
  for (const o of ordersCreated)
    assert(all.some((n: any) => n.orderId === o.id));
  await read(first.items[0].id, "tech2").expect(200);
  assert.equal((await list("tech2").expect(200)).body.unread, first.unread - 1);
  assert.equal(
    (
      await db.workOrder.findUniqueOrThrow({
        where: { id: ordersCreated[0].id },
      })
    ).version,
    beforeVersion,
  );
  await action(
    ordersCreated.find((o) => o.id === first.items[24].orderId)!,
    "start",
    "tech2",
  ).expect(200);
  await list("tech2", undefined, "?after=" + first.nextCursor).expect(400);
});

test("service rechecks a stale trusted head principal after a selected grant is revoked", async () => {
  const { REPOSITORY } = await import("../repository");
  const { NotificationsService } = await import("../notifications/service");
  const repository = app.get(REPOSITORY);
  const principal = await repository.principal(
    ids.pilot,
    Role.MAINTENANCE_HEAD,
  );
  assert(principal);
  let o = await assigned();
  o = (await action(o, "start", "tech").expect(200)).body;
  o = (await action(o, "submit", "tech", submission(o)).expect(200)).body;
  const n = await itemFor(o, "pilot", Role.MAINTENANCE_HEAD);
  assert(n);
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.pilot },
  });
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: m.id, role: Role.MAINTENANCE_HEAD },
    },
    data: { active: false },
  });
  try {
    await list("pilot", Role.MAINTENANCE_HEAD).expect(403);
    const service = app.get(NotificationsService);
    await assert.rejects(
      service.list(principal, "WH-C", {}),
      /selected role is no longer available/,
    );
    await assert.rejects(
      service.read(principal, "WH-C", n.id),
      /selected role is no longer available/,
    );
  } finally {
    await db.membershipRoleGrant.update({
      where: {
        membershipId_role: { membershipId: m.id, role: Role.MAINTENANCE_HEAD },
      },
      data: { active: true },
    });
  }
});

test("concurrent read and start serialize around current-stage actionability without extra workflow events", async () => {
  const o = await assigned(),
    n = await itemFor(o);
  const [receipt, started] = await Promise.all([
    read(n.id),
    action(o, "start", "tech"),
  ]);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert([200, 404].includes(receipt.status), JSON.stringify(receipt.body));
  await read(n.id).expect(404);
  assert.equal(await itemFor(o), undefined);
  assert.equal(await db.workOrderEvent.count({ where: { orderId: o.id } }), 3);
  assert.equal(
    await db.workOrderNotificationReceipt.count({ where: { eventId: n.id } }),
    receipt.status === 200 ? 1 : 0,
  );
});
