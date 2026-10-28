import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
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
const db = new PrismaClient({ datasources: { db: { url: owner } } }),
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const roles = {
  head: Role.MAINTENANCE_HEAD,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  noAccessTech: Role.TECHNICIAN,
  foreignHead: Role.MAINTENANCE_HEAD,
  operator: Role.OPERATOR,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  pilot: Role.ADMINISTRATOR,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let app: INestApplication, orgId: string, machineId: string;
const reviews = "/api/machines/WH-C/readings/anomalies/reviews",
  orders = "/api/machines/WH-C/work-orders";
const as = (who: Who) => ({ Authorization: `Bearer ${ids[who]}` });
const http = () => request(app.getHttpServer());
const review = (body: unknown, who: Who = "head") =>
  http()
    .post(reviews)
    .set(as(who))
    .send(body as object);
const act = (id: string, action: string, body: unknown, who: Who) =>
  http()
    .post(`${orders}/${id}/actions/${action}`)
    .set(as(who))
    .send(body as object);
const getOrder = (id: string, who: Who = "head") =>
  http().get(`${orders}/${id}`).set(as(who));
const flagFor = async () => {
  const res = await http()
    .get(
      "/api/machines/WH-C/readings/anomalies?from=2026-09-01&to=2026-09-05&kind=SUDDEN_CHANGE&status=PENDING",
    )
    .set(as("head"))
    .expect(200);
  const { key, measuredAt } = res.body.items[0];
  return { key, measuredAt } as { key: string; measuredAt: string };
};
const completedAfter = async (id: string) => {
  const o = await db.workOrder.findUniqueOrThrow({
    where: { id },
    select: { reportedAt: true },
  });
  return o.reportedAt.toISOString();
};
const reason = "TEST inspect the sensor wiring and operating context.";
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "invest-" + randomUUID(), name: "TEST investigation" },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "invest-other-" + randomUUID(), name: "TEST other" },
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
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: ["noAccessTech", "foreignHead"].includes(who) ? other : orgId,
        role: roles[who],
      },
    });
    if (who === "pilot")
      await db.membershipRoleGrant.createMany({
        data: [Role.TECHNICIAN, Role.MAINTENANCE_HEAD].map((role) => ({
          orgId,
          membershipId: m.id,
          role,
        })),
      });
    if (["tech", "tech2", "operator", "pilot"].includes(who))
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
      );
      const hour = Number(localTime(measuredAt).slice(11, 13));
      return {
        id: randomUUID(),
        orgId,
        machineId,
        importId: batch.id,
        sourceId: "INV-" + i,
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
test("head opens an investigation from a flag; the order links the review and starts assigned", async () => {
  const flag = await flagFor();
  const res = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const orderId = res.body.workOrderId as string;
  assert(orderId, "investigate review must return a work order id");
  const order = await db.workOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { events: true, anomalyReview: true },
  });
  assert.equal(order.kind, "INVESTIGATION");
  assert.equal(order.status, "ASSIGNED");
  assert.equal(order.technicianId, ids.tech);
  assert.equal(order.anomalyReviewId, res.body.id);
  assert.equal(order.anomalyReview?.decision, "INVESTIGATE");
  assert.equal(order.impact, "OBSERVATION");
  assert.equal(order.events.length, 1);
  assert.equal(order.events[0].action, "INVESTIGATE");
  const detail = (await getOrder(orderId).expect(200)).body;
  assert.equal(detail.kind, "INVESTIGATION");
  assert.deepEqual(detail.allowedActions, ["cancel", "assign"]);
  const cancelled = (
    await act(
      orderId,
      "cancel",
      { version: detail.version, reason: "TEST duplicate investigation" },
      "head",
    ).expect(200)
  ).body;
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.anomalyReviewId, res.body.id);
  assert.equal(cancelled.performedAt, null);
  await act(orderId, "start", { version: cancelled.version }, "tech").expect(
    409,
  );
});
test("only the Maintenance head can open an investigation", async () => {
  const flag = await flagFor();
  for (const who of [
    "tech",
    "tech2",
    "operator",
    "supervisor",
    "admin",
  ] as Who[])
    await review(
      {
        key: flag.key,
        measuredAt: flag.measuredAt,
        decision: "INVESTIGATE",
        reason,
        technicianId: ids.tech,
      },
      who,
    ).expect(403);
  assert.equal(
    await db.workOrder.count({
      where: { orgId, kind: "INVESTIGATION", anomalyReview: { key: flag.key } },
    }),
    0,
  );
});
test("an investigation needs an eligible technician with machine access; ineligible ones are refused atomically", async () => {
  const flag = await flagFor();

  await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.noAccessTech,
  }).expect(400);
  await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.head,
  }).expect(400);
  assert.equal(
    await db.anomalyReview.count({ where: { orgId, key: flag.key } }),
    0,
    "no review may persist when the technician is ineligible",
  );
});
test("a dismissed flag cannot carry a technician and never opens an order", async () => {
  const flag = await flagFor();
  await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "DISMISSED",
    reason,
    technicianId: ids.tech,
  }).expect(400);
  const dismissed = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "DISMISSED",
    reason,
  }).expect(201);
  assert.equal(dismissed.body.workOrderId, null);
  assert.equal(
    await db.workOrder.count({
      where: { orgId, kind: "INVESTIGATION", anomalyReview: { key: flag.key } },
    }),
    0,
  );
});
test("an exact retry returns the original order; a changed technician conflicts", async () => {
  const flag = await flagFor();
  const body = {
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech2,
  };
  const first = await review(body).expect(201);
  const retry = await review(body).expect(201);
  assert.equal(retry.body.id, first.body.id);
  assert.equal(retry.body.workOrderId, first.body.workOrderId);
  assert.equal(
    await db.workOrder.count({
      where: { orgId, kind: "INVESTIGATION", anomalyReviewId: first.body.id },
    }),
    1,
  );
  await review({ ...body, technicianId: ids.tech }).expect(409);
  assert.equal(
    await db.workOrder.count({
      where: { orgId, kind: "INVESTIGATION", anomalyReviewId: first.body.id },
    }),
    1,
  );
});
test("full lifecycle: assign, start, submit findings, return, resubmit, approve, close", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const id = created.body.workOrderId as string;
  let version = 1;
  await act(id, "start", { version }, "tech").expect(200);
  version++;
  const submitBody = {
    version,
    findings: "Sensor connector was loose; reading consistent after reseat.",
    correctiveAction: "Reseated connector and verified the reading.",
    performedAt: await completedAfter(id),
    investigationOutcome: "NO_FAULT_FOUND",
  };
  const submitted = await act(id, "submit", submitBody, "tech").expect(200);
  assert.equal(submitted.body.status, "AWAITING_REVIEW");
  assert.equal(submitted.body.restoredAt, null);
  version = submitted.body.version;
  const returned = await act(
    id,
    "return",
    { version, reason: "Show the reading after reseat." },
    "head",
  ).expect(200);
  assert.equal(returned.body.status, "IN_PROGRESS");
  version = returned.body.version;
  const resubmitted = await act(
    id,
    "submit",
    {
      ...submitBody,
      version,
      findings: "Reading verified over 30 minutes after reseat.",
    },
    "tech",
  ).expect(200);
  version = resubmitted.body.version;
  const approved = await act(id, "approve", { version }, "head").expect(200);
  assert.equal(approved.body.status, "APPROVED");
  version = approved.body.version;
  const closed = await act(id, "close", { version }, "supervisor").expect(200);
  assert.equal(closed.body.status, "CLOSED");
  const history = await db.workOrderEvent.findMany({
    where: { orderId: id },
    orderBy: { version: "asc" },
  });
  assert.deepEqual(
    history.map((e) => e.action),
    ["INVESTIGATE", "START", "SUBMIT", "RETURN", "SUBMIT", "APPROVE", "CLOSE"],
  );
  assert.equal(new Set(history.map((e) => e.version)).size, history.length);
  assert.equal(
    history.find((e) => e.action === "RETURN")?.detail &&
      (history.find((e) => e.action === "RETURN")!.detail as { reason: string })
        .reason,
    "Show the reading after reseat.",
  );
});
test("submission rejects breakdown RCA and restoration fields for an investigation", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech2,
  }).expect(201);
  const id = created.body.workOrderId as string;
  await act(id, "start", { version: 1 }, "tech2").expect(200);
  const base = {
    version: 2,
    findings: "Inspection found no fault.",
    correctiveAction: "No corrective work required.",
    performedAt: await completedAfter(id),
    investigationOutcome: "NO_FAULT_FOUND",
  };
  await act(
    id,
    "submit",
    { ...base, rootCause: "Invented cause" },
    "tech2",
  ).expect(400);
  await act(
    id,
    "submit",
    { ...base, restoredAt: new Date(Date.now() - 60000).toISOString() },
    "tech2",
  ).expect(400);
  await act(
    id,
    "submit",
    {
      version: 2,
      findings: "Inspection found no fault.",
      correctiveAction: "No work required.",
    },
    "tech2",
  ).expect(400);
  const unchanged = await db.workOrder.findUniqueOrThrow({ where: { id } });
  assert.equal(unchanged.status, "IN_PROGRESS");
  assert.equal(unchanged.findings, null);
  assert.equal(unchanged.rootCause, null);
  assert.equal(unchanged.version, 2);
});
test("only the assigned technician acts; reassignment resets repair fields and keeps history", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const id = created.body.workOrderId as string;
  await act(id, "start", { version: 1 }, "tech2").expect(403);
  await act(id, "start", { version: 1 }, "head").expect(403);
  const reassigned = await act(
    id,
    "assign",
    {
      version: 1,
      technicianId: ids.tech2,
      reason: "Original technician is on another job.",
    },
    "head",
  ).expect(200);
  assert.equal(reassigned.body.technician.userId, ids.tech2);
  assert.equal(reassigned.body.status, "ASSIGNED");
  await act(id, "start", { version: 2 }, "tech").expect(403);
  await act(id, "start", { version: 2 }, "tech2").expect(200);
});
test("supervisors and administrators cannot approve; approval and closure are separate actors", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const id = created.body.workOrderId as string;
  await act(id, "start", { version: 1 }, "tech").expect(200);
  await act(
    id,
    "submit",
    {
      version: 2,
      findings: "Checked calibration; within tolerance.",
      correctiveAction: "No change needed.",
      performedAt: await completedAfter(id),
      investigationOutcome: "NO_FAULT_FOUND",
    },
    "tech",
  ).expect(200);
  for (const who of ["supervisor", "admin"] as Who[])
    await act(id, "approve", { version: 3 }, who).expect(403);
  await act(id, "approve", { version: 3 }, "head").expect(200);
  await act(id, "close", { version: 4 }, "tech").expect(403);
  await act(id, "close", { version: 4 }, "supervisor").expect(200);
});
test("a stale version is rejected and a revoked technician loses access", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const id = created.body.workOrderId as string;
  await act(id, "start", { version: 99 }, "tech").expect(409);
  await db.machineAccess.deleteMany({
    where: { orgId, membership: { userId: ids.tech } },
  });
  await act(id, "start", { version: 1 }, "tech").expect(404);
  const membership = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: membership.id },
  });
});
test("the order is listed with its kind and is hidden from unauthorized roles", async () => {
  const flag = await flagFor();
  const created = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const list = (
    await http()
      .get(orders + "?limit=50")
      .set(as("head"))
      .expect(200)
  ).body;
  const row = list.items.find(
    (o: { id: string }) => o.id === created.body.workOrderId,
  );
  assert(row, "investigation must appear in the head's list");
  assert.equal(row.kind, "INVESTIGATION");
  await http().get(orders).set(as("noAccessTech")).expect(404);
  await http()
    .get(orders + "/" + created.body.workOrderId)
    .set(as("noAccessTech"))
    .expect(404);
});
test("database rejects an investigation without a review and a review linked to a dismissal", async () => {
  await assert.rejects(
    runtime.workOrder.create({
      data: {
        orgId,
        machineId,
        requestId: randomUUID(),
        reportFingerprint: "d".repeat(64),
        title: "TEST orphan investigation",
        description: "TEST no review link",
        kind: "INVESTIGATION",
        impact: "OBSERVATION",
        status: "ASSIGNED",
        technicianId: ids.tech,
        reportedBy: ids.head,
      },
    }),
  );
  const dismissed = await db.anomalyReview.findFirstOrThrow({
    where: { orgId, decision: "DISMISSED" },
  });
  await assert.rejects(
    runtime.workOrder.create({
      data: {
        orgId,
        machineId,
        requestId: randomUUID(),
        reportFingerprint: "e".repeat(64),
        title: "TEST dismissed investigation",
        description: "TEST dismissed link",
        kind: "INVESTIGATION",
        impact: "OBSERVATION",
        anomalyReviewId: dismissed.id,
        status: "ASSIGNED",
        technicianId: ids.tech,
        reportedBy: ids.head,
      },
    }),
  );
});
test("review insert, order creation and audit roll back together", async () => {
  const flag = await flagFor();
  const fn = "investigation_audit_" + orgId.replace(/-/g, "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='ANOMALY_REVIEWED') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await review({
      key: flag.key,
      measuredAt: flag.measuredAt,
      decision: "INVESTIGATE",
      reason,
      technicianId: ids.tech,
    }).expect(503);
    assert.equal(
      await db.anomalyReview.count({ where: { orgId, key: flag.key } }),
      0,
    );
    assert.equal(
      await db.workOrder.count({
        where: {
          orgId,
          kind: "INVESTIGATION",
          anomalyReview: { key: flag.key },
        },
      }),
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  const retried = await review({
    key: flag.key,
    measuredAt: flag.measuredAt,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  assert(retried.body.workOrderId);
});

test("saved reviews open explicitly, including older evidence, with concurrent duplicate-safe assignment", async () => {
  const flag = await flagFor();
  const saved = await review({
    ...flag,
    decision: "INVESTIGATE",
    reason,
  }).expect(201);
  assert.equal(saved.body.workOrderId, null);
  await http()
    .post(`${reviews}/${saved.body.id}/investigation`)
    .set(as("foreignHead"))
    .send({ technicianId: ids.tech })
    .expect(404);
  const before = await db.anomalyReview.findUniqueOrThrow({
    where: { id: saved.body.id },
  });
  const endpoint = `${reviews}/${saved.body.id}/investigation`;
  for (const who of [
    "operator",
    "tech",
    "supervisor",
    "management",
    "admin",
  ] as Who[])
    await http()
      .post(endpoint)
      .set(as(who))
      .send({ technicianId: ids.tech })
      .expect(403);
  await http()
    .post(endpoint)
    .set(as("noAccessTech"))
    .send({ technicianId: ids.tech })
    .expect(403);
  await http()
    .post(endpoint)
    .set(as("head"))
    .send({ technicianId: ids.noAccessTech })
    .expect(400);
  await http()
    .post(endpoint)
    .set(as("head"))
    .send({ technicianId: ids.tech, orgId })
    .expect(400);
  const results = await Promise.all(
    [1, 2].map(() =>
      http().post(endpoint).set(as("head")).send({ technicianId: ids.tech }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  const id = results[0].body.workOrderId;
  assert.equal(results[1].body.workOrderId, id);
  assert.equal(
    await db.workOrder.count({ where: { anomalyReviewId: saved.body.id } }),
    1,
  );
  assert.equal(await db.workOrderEvent.count({ where: { orderId: id } }), 1);
  assert.equal(
    await db.auditEvent.count({
      where: { entityId: id, action: "WORK_ORDER_INVESTIGATE" },
    }),
    1,
  );
  assert.deepEqual(
    await db.anomalyReview.findUniqueOrThrow({ where: { id: saved.body.id } }),
    before,
  );
  const history = (
    await http().get(reviews).set(as("tech")).expect(200)
  ).body.items.find((r: { id: string }) => r.id === saved.body.id);
  assert.equal(history.workOrderId, id);
  assert.equal(history.workOrderStatus, "ASSIGNED");
  const detail = (await getOrder(id, "tech").expect(200)).body;
  assert.equal(detail.investigationReview.id, saved.body.id);
  assert.equal(detail.investigationReview.evidence.key, flag.key);
  await act(
    id,
    "assign",
    { version: 1, technicianId: ids.tech2, reason: "TEST coverage handover" },
    "head",
  ).expect(200);
  // Retry compares immutable opening assignment, never the mutable current assignee.
  const retry = await http()
    .post(endpoint)
    .set(as("head"))
    .send({ technicianId: ids.tech })
    .expect(201);
  assert.equal(retry.body.workOrderId, id);
  assert.equal(retry.body.technicianId, ids.tech2);
  await http()
    .post(endpoint)
    .set(as("head"))
    .send({ technicianId: ids.tech2 })
    .expect(409);
});

test("same pilot identity uses head to assign, Administrator to read, and Technician to act", async () => {
  const flag = await flagFor();
  const body = {
    ...flag,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.pilot,
  };
  const saved = await http()
    .post(reviews)
    .set(as("pilot"))
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .send(body)
    .expect(201);
  const id = saved.body.workOrderId;
  const listed = (
    await http()
      .get(orders)
      .set(as("pilot"))
      .set("X-Workspace-Role", "TECHNICIAN")
      .expect(200)
  ).body;
  assert(listed.items.some((o: { id: string }) => o.id === id));
  assert.deepEqual(
    (await getOrder(id, "pilot").expect(200)).body.allowedActions,
    [],
  );
  await act(id, "start", { version: 1 }, "pilot").expect(403);
  const detail = await http()
    .get(`${orders}/${id}`)
    .set(as("pilot"))
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(200);
  assert.deepEqual(detail.body.allowedActions, ["start"]);
  await http()
    .post(`${orders}/${id}/actions/start`)
    .set(as("pilot"))
    .set("X-Workspace-Role", "TECHNICIAN")
    .send({ version: 1 })
    .expect(200);
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.pilot },
  });
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: member.id, role: "TECHNICIAN" },
    },
    data: { active: false },
  });
  await http()
    .get(`${orders}/${id}`)
    .set(as("pilot"))
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(403);
});

test("combined-review retries survive reassignment and list/history retain current progress", async () => {
  const flag = await flagFor();
  const body = {
    ...flag,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  };
  const saved = await review(body).expect(201),
    id = saved.body.workOrderId;
  await act(
    id,
    "assign",
    { version: 1, technicianId: ids.tech2, reason: "TEST coverage" },
    "head",
  ).expect(200);
  const retry = await review(body).expect(201);
  assert.equal(retry.body.workOrderId, id);
  assert.equal(retry.body.technicianId, ids.tech2);
  const listed = await http()
    .get(
      "/api/machines/WH-C/readings/anomalies?from=2026-09-01&to=2026-09-05&status=REVIEWED",
    )
    .set(as("head"))
    .expect(200);
  let page = listed.body;
  while (
    !page.items.some((f: { key: string }) => f.key === flag.key) &&
    page.nextCursor
  ) {
    page = (
      await http()
        .get(
          "/api/machines/WH-C/readings/anomalies?from=2026-09-01&to=2026-09-05&status=REVIEWED&after=" +
            page.nextCursor,
        )
        .set(as("head"))
        .expect(200)
    ).body;
  }
  assert.equal(
    page.items.find((f: { key: string }) => f.key === flag.key).review
      .workOrderId,
    id,
  );
});

test("investigation outcomes require honest findings and action-requiring outcomes retain explicit follow-up", async () => {
  const flag = await flagFor();
  const created = await review({
    ...flag,
    decision: "INVESTIGATE",
    reason,
    technicianId: ids.tech,
  }).expect(201);
  const id = created.body.workOrderId;
  await act(id, "start", { version: 1 }, "tech").expect(200);
  const body = {
    version: 2,
    findings: "TEST inspection remains inconclusive",
    correctiveAction: "TEST inspected without changing machine",
    performedAt: await completedAfter(id),
  };
  await act(id, "submit", body, "tech").expect(400);
  await act(
    id,
    "submit",
    { ...body, investigationOutcome: "FAULT_CONFIRMED" },
    "tech",
  ).expect(400);
  await act(
    id,
    "submit",
    { ...body, investigationOutcome: "MAINTENANCE_REQUIRED" },
    "tech",
  ).expect(400);
  await assert.rejects(
    runtime.workOrder.update({
      where: { id },
      data: {
        status: "AWAITING_REVIEW",
        version: { increment: 1 },
        findings: body.findings,
        correctiveAction: body.correctiveAction,
        performedAt: new Date(body.performedAt),
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  );
  const submitted = await act(
    id,
    "submit",
    {
      ...body,
      investigationOutcome: "SENSOR_CHECK_REQUIRED",
      preventiveAction:
        "TEST head to authorize an independent sensor calibration check",
    },
    "tech",
  ).expect(200);
  assert.equal(submitted.body.investigationOutcome, "SENSOR_CHECK_REQUIRED");
  assert.equal(submitted.body.rootCause, null);
  assert.equal(submitted.body.restoredAt, null);
  const event = submitted.body.events.find(
    (e: { action: string }) => e.action === "SUBMIT",
  );
  assert.equal(event.detail.investigationOutcome, "SENSOR_CHECK_REQUIRED");
  await act(
    id,
    "return",
    { version: 3, reason: "TEST more evidence" },
    "head",
  ).expect(200);
  await act(
    id,
    "assign",
    { version: 4, technicianId: ids.tech2, reason: "TEST handover" },
    "head",
  ).expect(200);
  const cleared = await getOrder(id).expect(200);
  assert.equal(cleared.body.investigationOutcome, null);
  assert.equal(cleared.body.performedAt, null);
  assert(
    cleared.body.events.some(
      (e: { detail: { investigationOutcome?: string } }) =>
        e.detail.investigationOutcome === "SENSOR_CHECK_REQUIRED",
    ),
  );
});

test("opening from dismissal/foreign review is refused and opening audit failure preserves the review only", async () => {
  const dismissed = await db.anomalyReview.findFirstOrThrow({
    where: { orgId, decision: "DISMISSED" },
  });
  await http()
    .post(`${reviews}/${dismissed.id}/investigation`)
    .set(as("head"))
    .send({ technicianId: ids.tech })
    .expect(409);
  await http()
    .post(`${reviews}/${randomUUID()}/investigation`)
    .set(as("head"))
    .send({ technicianId: ids.tech })
    .expect(404);
  const flag = await flagFor();
  const saved = await review({
    ...flag,
    decision: "INVESTIGATE",
    reason,
  }).expect(201);
  const combinedFlag = await flagFor();
  const fn = "opening_audit_" + orgId.replaceAll("-", "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only opening audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='WORK_ORDER_INVESTIGATE') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await review({
      ...combinedFlag,
      decision: "INVESTIGATE",
      reason,
      technicianId: ids.tech,
    }).expect(503);
    assert.equal(
      await db.anomalyReview.count({ where: { orgId, key: combinedFlag.key } }),
      0,
    );
    await http()
      .post(`${reviews}/${saved.body.id}/investigation`)
      .set(as("head"))
      .send({ technicianId: ids.tech })
      .expect(503);
    assert.equal(
      await db.workOrder.count({ where: { anomalyReviewId: saved.body.id } }),
      0,
    );
    assert.equal(
      await db.anomalyReview.count({ where: { id: saved.body.id } }),
      1,
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
});
