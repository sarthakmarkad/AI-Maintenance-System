import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  Role,
  type Prisma,
  type WorkOrderKind,
  type WorkOrderStatus,
} from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { CalendarService } from "../calendar/service";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw new Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  pilot: Role.ADMINISTRATOR,
  noGrant: Role.TECHNICIAN,
  inactive: Role.MAINTENANCE_HEAD,
  outsider: Role.MAINTENANCE_HEAD,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((w) => [w, randomUUID()]),
) as Record<Who, string>;
let orgId: string,
  machineId: string,
  planId: string,
  app: INestApplication,
  calendar: CalendarService,
  oldOpenId: string;
const epoch = Date.parse("2026-08-31T18:30:00Z"),
  at = (h: number) => new Date(epoch + h * 3600000);
const base = "/api/machines/WH-C/performance",
  range = "?from=2026-09-01&to=2026-09-02";
const get = (q = range, who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + q)
    .set("Authorization", `Bearer ${ids[who]}`);
async function order(
  kind: WorkOrderKind,
  status: WorkOrderStatus,
  reportedAt: Date,
  extra: Partial<Prisma.WorkOrderUncheckedCreateInput> = {},
) {
  const h = (n: number) => new Date(reportedAt.getTime() + n * 3600000);
  const started = [
      "IN_PROGRESS",
      "AWAITING_REVIEW",
      "APPROVED",
      "CLOSED",
    ].includes(status),
    submitted = ["AWAITING_REVIEW", "APPROVED", "CLOSED"].includes(status),
    reviewed = ["APPROVED", "CLOSED"].includes(status);
  let anomalyReviewId: string | undefined;
  if (kind === "INVESTIGATION") {
    const key =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    anomalyReviewId = (
      await db.anomalyReview.create({
        data: {
          orgId,
          machineId,
          key,
          policyVersion: "TEST",
          measuredAt: reportedAt,
          decision: "INVESTIGATE",
          reason: "TEST inspect",
          reviewedBy: ids.head,
          actorRole: "MAINTENANCE_HEAD",
          evidence: { key, policyVersion: "TEST" },
        },
      })
    ).id;
  }
  const o = await db.workOrder.create({
    data: {
      orgId,
      machineId,
      requestId: randomUUID(),
      reportFingerprint: "f".repeat(64),
      title: "TEST " + kind,
      description: "TEST performance fixture",
      kind,
      status,
      impact: "OBSERVATION",
      reportedAt,
      reportedBy: ids.head,
      updatedAt: h(10),
      technicianId: status === "REPORTED" ? null : ids.tech,
      startedAt: started ? h(1) : null,
      submittedAt: submitted ? h(4) : null,
      reviewedAt: reviewed ? h(6) : null,
      reviewedBy: reviewed ? ids.head : null,
      closedAt: status === "CLOSED" ? h(8) : null,
      closedBy: status === "CLOSED" ? ids.supervisor : null,
      findings: submitted ? "TEST findings" : null,
      correctiveAction: submitted ? "TEST work" : null,
      preventiveAction: submitted ? "TEST follow-up" : null,
      rootCause: submitted && kind === "BREAKDOWN" ? "TEST human cause" : null,
      restoredAt: submitted && kind === "BREAKDOWN" ? h(3) : null,
      performedAt: submitted && kind !== "BREAKDOWN" ? h(3) : null,
      investigationOutcome:
        submitted && kind === "INVESTIGATION" ? "INCONCLUSIVE" : null,
      anomalyReviewId,
      ...extra,
    },
  });
  if (started)
    await db.workOrderEvent.create({
      data: {
        orgId,
        machineId,
        orderId: o.id,
        version: 1,
        action: "START",
        fromStatus: "ASSIGNED",
        toStatus: "IN_PROGRESS",
        actorId: ids.tech,
        actorName: "TEST technician",
        actorRole: "TECHNICIAN",
        at: h(1),
        detail: { TEST: true },
      },
    });
  return o;
}
async function occurrence(hour: number, skip = false) {
  return db.maintenanceOccurrence.create({
    data: {
      orgId,
      machineId,
      planId,
      sequence: hour,
      dueAt: at(hour),
      remindAt: at(hour - 24),
      title: "TEST planned task",
      instructions: "TEST checks",
      technicianId: ids.tech,
      priority: "NORMAL",
      ...(skip
        ? {
            skippedAt: at(hour - 1),
            skippedBy: ids.head,
            skipReason: "TEST reason",
          }
        : {}),
    },
  });
}
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "performance-" + randomUUID(), name: "TEST performance" },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "performance-other-" + randomUUID(), name: "TEST other" },
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
  await db.machine.create({
    data: {
      orgId: other,
      code: "WH-C",
      name: "TEST other machine",
      manufacturer: "Fixture",
    },
  });
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const member = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "outsider" ? other : orgId,
        role: roles[who],
        active: who !== "inactive",
      },
    });
    if (["operator", "tech", "pilot"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: member.id },
      });
    if (who === "pilot")
      await db.membershipRoleGrant.createMany({
        data: [Role.TECHNICIAN, Role.MAINTENANCE_HEAD].map((role) => ({
          orgId,
          membershipId: member.id,
          role,
        })),
      });
  }
  planId = (
    await db.maintenancePlan.create({
      data: {
        orgId,
        machineId,
        requestId: randomUUID(),
        fingerprint: "a".repeat(64),
        title: "TEST plan",
        instructions: "TEST inspections",
        frequency: "DAILY",
        firstDueAt: at(5),
        technicianId: ids.tech,
        createdBy: ids.head,
        active: false,
        pauseReason: "TEST paused",
        nextSequence: 10,
      },
    })
  ).id;
  await order("BREAKDOWN", "CLOSED", at(0));
  await order("BREAKDOWN", "ASSIGNED", at(48 - 1 / 3600));
  await order("BREAKDOWN", "REPORTED", at(48));
  await order("BREAKDOWN", "CLOSED", at(-24), {
    submittedAt: at(-20),
    reviewedAt: at(-18),
    closedAt: at(2),
    updatedAt: at(3),
  });
  oldOpenId = (await order("BREAKDOWN", "REPORTED", at(-48))).id;
  await order("INVESTIGATION", "AWAITING_REVIEW", at(1));
  const task = await occurrence(5);
  await order("PLANNED", "CLOSED", at(0), { occurrenceId: task.id }); // performed before due; closure late
  await occurrence(6, true);
  await occurrence(7);
  const early = await occurrence(20);
  await order("PLANNED", "CLOSED", at(2), { occurrenceId: early.id }); // closed on time
  const config = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtime,
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
  calendar = module.get(CalendarService);
});
after(async () => {
  if (app) await app.close();
  await db.$disconnect();
});
test("performance is authenticated, read-only and scoped for all six roles and trusted pilot views", async () => {
  await request(app.getHttpServer()).get(base).expect(401);
  for (const who of [
    "operator",
    "tech",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const r = await get(range, who).expect(200);
    assert.equal(r.body.cohort.total, 5);
    assert.equal(r.body.current.myOpen, who === "tech" ? 2 : null);
  }
  await get(range, "noGrant").expect(404);
  await get(range, "inactive").expect(403);
  const foreign = await get(range, "outsider").expect(200);
  assert.equal(foreign.body.cohort.total, 0);
  assert.equal(foreign.body.current.total, 0);
  assert.equal(foreign.body.current.items.length, 0);
  for (const role of ["ADMINISTRATOR", "MAINTENANCE_HEAD", "TECHNICIAN"]) {
    const r = await get(range, "pilot")
      .set("X-Workspace-Role", role)
      .expect(200);
    assert.equal(r.body.current.myOpen, role === "TECHNICIAN" ? 0 : null);
  }
  await get(range, "admin").set("X-Workspace-Role", "TECHNICIAN").expect(403);
  await request(app.getHttpServer())
    .post(base)
    .set("Authorization", `Bearer ${ids.head}`)
    .send({})
    .expect(404);
});
test("IST cohort and closure activity differ correctly; current backlog retains older open work", async () => {
  const r = (await get().expect(200)).body;
  assert.equal(r.cohort.total, 5);
  assert.equal(r.closedInRange, 4);
  assert.equal(r.current.total, 4);
  assert(r.current.items.some((o: { id: string }) => o.id === oldOpenId));
  assert.equal(r.activity.length, 2);
  assert.deepEqual(
    r.activity.map((d: { created: number }) => d.created),
    [4, 1],
  );
  assert.deepEqual(
    r.activity.map((d: { closed: number }) => d.closed),
    [4, 0],
  );
  assert.equal(
    r.current.statuses.find((s: { key: string }) => s.key === "AWAITING_REVIEW")
      .count,
    1,
  );
  assert.equal(r.current.overduePlanned, 1);
  assert.equal("unavailable" in r, false);
});
test("investigation outcomes distinguish submitted findings from engineering acceptance", async () => {
  const r = (await get().expect(200)).body;
  assert.equal("timings" in r, false);
  const investigations = r.investigations;
  assert.equal(investigations.total, 1);
  assert.equal(
    investigations.outcomes.find(
      (o: { key: string }) => o.key === "INCONCLUSIVE",
    ).count,
    1,
  );
  assert.equal(
    investigations.outcomes.find(
      (o: { key: string }) => o.key === "INCONCLUSIVE",
    ).approvedOrClosed,
    0,
  );
});
test("planned denominators exclude skipped tasks and measure on-time closure instead of performed time", async () => {
  const r = (await get().expect(200)).body.planned;
  assert.equal(r.due, 4);
  assert.equal(r.skipped, 1);
  assert.equal(r.eligible, 3);
  assert.equal(r.completed, 2);
  assert.equal(r.open, 1);
  assert.equal(r.onTime, 1);
  assert.equal(r.late, 1);
  assert.equal(r.completionPercent, 66.7);
  assert.equal(r.onTimePercent, 33.3);
});
test("kind filters apply to cohorts, current backlog and activity without inventing missing metrics", async () => {
  const r = (await get(range + "&kind=INVESTIGATION").expect(200)).body;
  assert.equal(r.cohort.total, 1);
  assert.equal(r.current.total, 1);
  assert.equal(r.closedInRange, 0);
  assert.equal(r.planned.applicable, false);
  assert.equal(r.current.overduePlanned, null);
  const empty = (await get("?from=2026-08-01&to=2026-08-02").expect(200)).body;
  assert.equal(empty.cohort.total, 0);
  assert.equal(empty.current.total, 4);
  assert.equal(empty.planned.completionPercent, null);
});
test("strict filters, defaults, live machine revocation and unavailable scheduling fail explicitly", async () => {
  for (const q of [
    "?from=2026-09-01",
    "?from=2026-09-31&to=2026-10-01",
    "?from=2099-01-01&to=2099-01-02",
    "?from=2025-01-01&to=2026-01-02",
    "?orgId=forged",
    "?kind=FAULT",
  ])
    await get(q).expect(400);
  const defaults = (await get("").expect(200)).body;
  assert.equal(defaults.activity.length, 30);
  const before = await db.workOrder.count({ where: { orgId } }),
    audits = await db.auditEvent.count({ where: { orgId } });
  await get().expect(200);
  assert.equal(await db.workOrder.count({ where: { orgId } }), before);
  assert.equal(await db.auditEvent.count({ where: { orgId } }), audits);
  await db.machineAccess.deleteMany({
    where: { orgId, machineId, membership: { userId: ids.tech } },
  });
  await get(range, "tech").expect(404);
  calendar.jobFailed = true;
  const failed = (await get().expect(200)).body;
  assert.equal(failed.planned.scheduling.failed, true);
  assert.equal(failed.planned.completionPercent, null);
  calendar.jobFailed = false;
  await db.maintenancePlan.create({
    data: {
      orgId,
      machineId,
      requestId: randomUUID(),
      fingerprint: "c".repeat(64),
      title: "TEST pending generation",
      instructions: "TEST catch up",
      frequency: "DAILY",
      firstDueAt: at(0),
      technicianId: ids.tech,
      createdBy: ids.head,
    },
  });
  const catching = (await get().expect(200)).body;
  assert.equal(catching.planned.scheduling.catchingUp, true);
  assert.equal(catching.planned.onTimePercent, null);
});
