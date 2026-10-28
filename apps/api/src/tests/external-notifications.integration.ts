// Only parent runs this suite after isolated schema/grant preparation.
// All incidents, roles, fault injection and provider calls are synthetic *_test fixtures.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, Prisma } from "@prisma/client";
import { Test } from "@nestjs/testing";
import {
  ForbiddenException,
  UnauthorizedException,
  type INestApplication,
} from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { CONFIG } from "../config";
import { CalendarService } from "../calendar/service";
import { NOTIFICATION_CONTACT } from "../external-notifications/contact";
import {
  NOTIFICATION_EMAIL,
  type DeliveryResult,
} from "../external-notifications/provider";
import { ExternalNotificationsService } from "../external-notifications/service";
import type {
  EmailConfig,
  EmailPayload,
} from "../external-notifications/policy";
import { localTime } from "../readings/parser";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname ||
  new URL(owner).hostname !== new URL(runtimeUrl).hostname ||
  new URL(owner).port !== new URL(runtimeUrl).port
)
  throw new Error("Use matching isolated *_test database connections.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const roles = {
  operator: Role.OPERATOR,
  head: Role.MAINTENANCE_HEAD,
  head2: Role.MAINTENANCE_HEAD,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  admin: Role.ADMINISTRATOR,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  pilot: Role.ADMINISTRATOR,
  noGrant: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
type Fixture = {
  orgId: string;
  machineId: string;
  ids: Record<Who, string>;
  members: Record<Who, string>;
};
type Order = { id: string; version: number; reportedAt: string };
type Q = {
  id: string;
  status: string;
  code: string | null;
  attemptCount: number;
  payload: EmailPayload;
  destination: string;
  eventId: string;
  leaseToken: string | null;
};
const known = new Set<string>(),
  contacts = new Map<string, string>(),
  unconfirmed = new Set<string>();
const sent: { id: string; payload: EmailPayload }[] = [];
const responses = new Map<string, DeliveryResult[]>();
let providerHook: ((id: string) => Promise<void>) | undefined;
let app: INestApplication, service: ExternalNotificationsService;
const base = "/api/machines/WH-C/external-notifications",
  orders = "/api/machines/WH-C/work-orders";
const http = () => request(app.getHttpServer());
const headers = (f: Fixture, who: Who, role?: Role) => ({
  Authorization: `Bearer ${f.ids[who]}`,
  ...(role ? { "X-Workspace-Role": role } : {}),
});
const settings = (f: Fixture, who: Who = "tech", role?: Role) =>
  http()
    .get(base)
    .set(headers(f, who, role));
const save = (
  f: Fixture,
  enabled: boolean,
  version: number,
  who: Who = "tech",
  requestId = randomUUID(),
  role?: Role,
) =>
  http()
    .put(base + "/preference")
    .set(headers(f, who, role))
    .set("Content-Type", "application/json")
    .send({ enabled, version, requestId });
async function enroll(f: Fixture, who: Who = "tech", role?: Role) {
  const prior = (await settings(f, who, role).expect(200)).body;
  return (
    await save(
      f,
      true,
      prior.preference.version,
      who,
      randomUUID(),
      role,
    ).expect(200)
  ).body;
}
const action = (f: Fixture, o: Order, name: string, who: Who, input = {}) =>
  http()
    .post(`${orders}/${o.id}/actions/${name}`)
    .set(headers(f, who))
    .send({ version: o.version, ...input });
async function report(f: Fixture): Promise<Order> {
  return (
    await http()
      .post(orders)
      .set(headers(f, "operator"))
      .send({
        requestId: randomUUID(),
        title: "TEST external-email handoff",
        description:
          "Synthetic fixture only. Private symptom must not leave server.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
}
async function assigned(f: Fixture, who: Who = "tech") {
  return (
    await action(f, await report(f), "assign", "head", {
      technicianId: f.ids[who],
    }).expect(200)
  ).body as Order;
}
async function queue(f: Fixture): Promise<Q[]> {
  return db.$queryRaw<
    Q[]
  >`SELECT * FROM maintenance."ExternalNotificationOutbox" WHERE "orgId"=${f.orgId}::uuid ORDER BY "createdAt",id`;
}
async function drain() {
  for (let i = 0; i < 40; i++) await service.runJobs();
}
async function fixture(): Promise<Fixture> {
  const orgId = (
    await db.organization.create({
      data: {
        slug: `email-test-${randomUUID()}`,
        name: "TEST external-email fixtures",
      },
    })
  ).id;
  const machineId = (
    await db.machine.create({
      data: {
        orgId,
        code: "WH-C",
        name: "TEST pilot",
        manufacturer: "Fixture",
      },
    })
  ).id;
  await db.machine.create({
    data: {
      orgId,
      code: "WH-B",
      name: "TEST reference",
      manufacturer: "Fixture",
    },
  });
  const ids = {} as Record<Who, string>,
    members = {} as Record<Who, string>;
  for (const who of Object.keys(roles) as Who[]) {
    ids[who] = randomUUID();
    known.add(ids[who]);
    contacts.set(ids[who], `${ids[who]}@example.test`);
    await db.appUser.create({
      data: { id: ids[who], displayName: `TEST ${who}` },
    });
    const m = await db.membership.create({
      data: { orgId, userId: ids[who], role: roles[who] },
    });
    members[who] = m.id;
    if (["operator", "tech", "tech2", "pilot"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
      });
    if (who === "pilot")
      await db.membershipRoleGrant.createMany({
        data: [
          { orgId, membershipId: m.id, role: Role.TECHNICIAN },
          { orgId, membershipId: m.id, role: Role.MAINTENANCE_HEAD },
        ],
      });
  }
  return { orgId, machineId, ids, members };
}
async function failAudit(
  f: Fixture,
  actionName: string,
  run: () => Promise<void>,
  onlySent = false,
) {
  const name = `email_fail_${randomUUID().replaceAll("-", "")}`;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST email audit rollback'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${f.orgId}'::uuid AND NEW.action='${actionName}'${onlySent ? " AND NEW.detail->>'status'='SENT'" : ""}) EXECUTE FUNCTION maintenance.${name}()`,
  );
  try {
    await run();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${name} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${name}()`);
  }
}
async function due(id: string, expireLease = false, expireWindow = false) {
  // Owner-only clock fixture, never application/runtime code. Table DDL lock
  // confines trigger suspension to this isolated transaction and restores it
  // before any concurrent transaction can see the rows.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE maintenance."ExternalNotificationOutbox" DISABLE TRIGGER external_outbox_change`;
    await tx.$executeRaw(Prisma.sql`UPDATE maintenance."ExternalNotificationOutbox" SET "nextAttemptAt"=clock_timestamp()-interval '1 second'
      ${expireLease ? Prisma.sql`,"leaseUntil"=clock_timestamp()-interval '1 second'` : Prisma.empty}
      ${expireWindow ? Prisma.sql`,"firstAttemptAt"=clock_timestamp()-interval '21 hours'` : Prisma.empty}
      WHERE id=${id}::uuid`);
    await tx.$executeRaw`ALTER TABLE maintenance."ExternalNotificationOutbox" ENABLE TRIGGER external_outbox_change`;
  });
}
before(async () => {
  const config: EmailConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtimeUrl,
    EXTERNAL_NOTIFICATIONS_ENABLED: "true",
    NOTIFICATION_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "TEST-no-real-provider-key",
    NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
  };
  const mod = await Test.createTestingModule({ imports: [appModule(config)] })
    .overrideProvider(VERIFIER)
    .useValue({
      verify: async (token: string) => {
        if (!known.has(token)) throw new UnauthorizedException();
        return token;
      },
    })
    .overrideProvider(NOTIFICATION_CONTACT)
    .useValue({
      resolve: async (_token: string, id: string) => {
        if (unconfirmed.has(id))
          throw new ForbiddenException("Confirm your account email.");
        return contacts.get(id)!;
      },
    })
    .overrideProvider(NOTIFICATION_EMAIL)
    .useValue({
      send: async (id: string, payload: EmailPayload) => {
        sent.push({ id, payload: structuredClone(payload) });
        await providerHook?.(id);
        return (
          responses.get(id)?.shift() ?? {
            outcome: "SENT",
            providerId: randomUUID(),
          }
        );
      },
    })
    .compile();
  app = mod.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
  service = app.get(ExternalNotificationsService);
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});

test("email preferences use real trusted active roles, self-only JSON and WH-C machine scope", async () => {
  const f = await fixture();
  await http().get(base).expect(401);
  for (const who of [
    "operator",
    "admin",
    "supervisor",
    "management",
  ] as Who[]) {
    const res = await settings(f, who).expect(200);
    assert.equal(res.body.supported, false);
    assert.equal(res.body.preference.destination, null);
    assert.deepEqual(res.body.deliveries, []);
    await save(f, true, 0, who).expect(403);
  }
  await settings(f, "noGrant").expect(404);
  await http()
    .get(base.replace("WH-C", "WH-B"))
    .set(headers(f, "head"))
    .expect(404);
  for (const extra of [
    { userId: f.ids.head },
    { email: "forged@example.test" },
    { role: "MAINTENANCE_HEAD" },
    { enabledAt: new Date().toISOString() },
  ])
    await http()
      .put(base + "/preference")
      .set(headers(f, "tech"))
      .send({ enabled: true, version: 0, requestId: randomUUID(), ...extra })
      .expect(400);
  await http()
    .put(base + "/preference")
    .set(headers(f, "tech"))
    .set("Content-Type", "text/plain")
    .send(
      JSON.stringify({ enabled: true, version: 0, requestId: randomUUID() }),
    )
    .expect(400);
  const result = await enroll(f);
  assert.equal(result.preference.destination, contacts.get(f.ids.tech));
  assert.equal(
    (await settings(f, "head").expect(200)).body.preference.destination,
    null,
  );
});
test("unconfirmed contact rejects enrollment and independent pilot role selections never union authority", async () => {
  const f = await fixture();
  unconfirmed.add(f.ids.tech);
  await save(f, true, 0).expect(403);
  assert.equal((await settings(f).expect(200)).body.preference.version, 0);
  await save(f, true, 0, "pilot").expect(403);
  await enroll(f, "pilot", Role.TECHNICIAN);
  await enroll(f, "pilot", Role.MAINTENANCE_HEAD);
  assert.equal(
    (await settings(f, "pilot").expect(200)).body.preference.destination,
    null,
  );
  await settings(f, "tech", Role.MAINTENANCE_HEAD).expect(403);
});
test("enrollment excludes earlier events and concurrent repeated enqueue is duplicate-safe with atomic audit", async () => {
  const f = await fixture();
  await assigned(f);
  await enroll(f);
  assert.equal(await service.enqueue(), 0);
  const o = await assigned(f);
  await Promise.all([service.enqueue(), service.enqueue()]);
  const rows = await queue(f);
  assert.equal(rows.length, 1);
  assert.match(rows[0].payload.text, new RegExp(o.id));
  assert(!JSON.stringify(rows[0].payload).includes("Private symptom"));
  assert.equal(
    await db.auditEvent.count({
      where: {
        orgId: f.orgId,
        action: "EXTERNAL_NOTIFICATION_DELIVERY",
        entityId: rows[0].id,
      },
    }),
    1,
  );
});
test("exact preference retries serialize and altered body/version conflicts cannot re-enable old state", async () => {
  const f = await fixture(),
    requestId = randomUUID();
  const results = await Promise.all([
    save(f, true, 0, "tech", requestId),
    save(f, true, 0, "tech", requestId),
  ]);
  results.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));
  assert.equal((await settings(f).expect(200)).body.preference.version, 1);
  await save(f, false, 0, "tech", requestId).expect(409);
  await save(f, false, 1).expect(200);
  await save(f, true, 0, "tech", requestId).expect(200);
  assert.equal((await settings(f).expect(200)).body.preference.enabled, false);
  await save(f, true, 1).expect(409);
});
test("disable and verified-address change suppress queued payloads without silent redirection/backfill", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const first = (await queue(f))[0];
  contacts.set(f.ids.tech, "new-confirmed@example.test");
  await enroll(f);
  assert.equal((await queue(f))[0].status, "SUPPRESSED");
  assert.equal((await queue(f))[0].destination, first.destination);
  await service.enqueue();
  assert.equal((await queue(f)).length, 1);
  await assigned(f);
  await service.enqueue();
  const rows = await queue(f);
  assert.equal(rows[1].destination, "new-confirmed@example.test");
  const p = (await settings(f).expect(200)).body.preference;
  await save(f, false, p.version).expect(200);
  assert((await queue(f)).every((q) => q.status === "SUPPRESSED"));
  await drain();
  assert.equal(sent.filter((s) => rows.some((q) => q.id === s.id)).length, 0);
});
test("head intake, submission/resubmission and technician return select current handoffs for each recipient", async () => {
  const f = await fixture();
  await enroll(f, "head");
  await enroll(f, "head2");
  await enroll(f);
  let o = await report(f);
  await service.enqueue();
  assert.equal((await queue(f)).length, 2);
  o = (
    await action(f, o, "assign", "head", { technicianId: f.ids.tech }).expect(
      200,
    )
  ).body;
  await service.enqueue();
  o = (await action(f, o, "start", "tech").expect(200)).body;
  const submit = {
    findings: "TEST private findings",
    rootCause: "TEST human cause",
    correctiveAction: "TEST work",
    preventiveAction: "TEST next check",
    restoredAt: o.reportedAt,
  };
  o = (await action(f, o, "submit", "tech", submit).expect(200)).body;
  await service.enqueue();
  const pendingReview = (await queue(f)).slice(-2);
  assert.equal(pendingReview.length, 2);
  o = (
    await action(f, o, "return", "head", {
      reason: "TEST request evidence",
    }).expect(200)
  ).body;
  await service.enqueue();
  assert.equal((await queue(f)).length, 6);
  await drain();
  const sentFor = sent.filter((s) => s.payload.text.includes(o.id));
  assert.equal(sentFor.length, 1);
  assert.match(sentFor[0].payload.text, /returned to you/);
  o = (await action(f, o, "submit", "tech", submit).expect(200)).body;
  await service.enqueue();
  await drain();
  assert.equal(sent.filter((s) => s.payload.text.includes(o.id)).length, 3);
});
test("ATTACH preserves intake event while in-app marking read stays independent of email", async () => {
  const f = await fixture();
  await enroll(f, "head");
  const o = await report(f);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await http()
    .post(`${orders}/${o.id}/attachments`)
    .set(headers(f, "operator"))
    .field("requestId", randomUUID())
    .field("version", String(o.version))
    .field("description", "TEST private image")
    .attach("file", png, { filename: "test.png", contentType: "image/png" })
    .expect(201);
  await service.enqueue();
  const q = (await queue(f))[0];
  assert(q);
  await http()
    .post(`/api/machines/WH-C/work-order-notifications/${q.eventId}/read`)
    .set(headers(f, "head"))
    .send({})
    .expect(200);
  await drain();
  assert.equal((await queue(f))[0].status, "SENT");
  assert.equal(await db.workOrderEvent.count({ where: { orderId: o.id } }), 2);
});
test("new assignments and revoked memberships/grants/machine access suppress stale recipients before send", async () => {
  const f = await fixture();
  await enroll(f);
  await enroll(f, "tech2");
  const o = await assigned(f);
  await service.enqueue();
  await action(f, o, "assign", "head", {
    technicianId: f.ids.tech2,
    reason: "TEST reassignment",
  }).expect(200);
  await service.enqueue();
  await db.machineAccess.delete({
    where: {
      machineId_membershipId: {
        machineId: f.machineId,
        membershipId: f.members.tech2,
      },
    },
  });
  await drain();
  assert((await queue(f)).every((q) => q.status === "SUPPRESSED"));
  const f2 = await fixture();
  await enroll(f2, "pilot", Role.TECHNICIAN);
  await assigned(f2, "pilot");
  await service.enqueue();
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: {
        membershipId: f2.members.pilot,
        role: Role.TECHNICIAN,
      },
    },
    data: { active: false },
  });
  await drain();
  assert.equal((await queue(f2))[0].status, "SUPPRESSED");
  const f3 = await fixture();
  await enroll(f3);
  await assigned(f3);
  await service.enqueue();
  await db.membership.update({
    where: { id: f3.members.tech },
    data: { active: false },
  });
  await drain();
  assert.equal((await queue(f3))[0].status, "SUPPRESSED");
});
test("retry preserves exact durable payload/key, bounded attempts and acceptance history", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  responses.set(q.id, [
    { outcome: "RETRY", code: "NETWORK_UNCERTAIN" },
    { outcome: "SENT", providerId: randomUUID() },
  ]);
  await drain();
  assert.equal((await queue(f))[0].status, "PENDING");
  await due(q.id);
  await drain();
  const rows = await queue(f);
  assert.equal(rows[0].status, "SENT");
  assert.equal(rows[0].attemptCount, 2);
  const calls = sent.filter((s) => s.id === q.id);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  const view = (await settings(f).expect(200)).body;
  assert(
    view.deliveries[0].attempts.some(
      (a: any) => a.code === "NETWORK_UNCERTAIN",
    ),
  );
});
test("concurrent workers claim once and late acceptance after disable remains immutable evidence", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => {
    entered = r;
  });
  const wait = new Promise<void>((r) => {
    release = r;
  });
  providerHook = async (id) => {
    if (id === q.id) {
      entered();
      await wait;
    }
  };
  try {
    const running = service.runJobs();
    await barrier;
    await service.runJobs();
    await save(f, false, 1).expect(200);
    release();
    await running;
  } finally {
    release?.();
    providerHook = undefined;
  }
  assert.equal(sent.filter((s) => s.id === q.id).length, 1);
  assert.equal((await queue(f))[0].status, "SUPPRESSED");
  const attempts = await db.$queryRaw<
    { late: boolean; status: string }[]
  >`SELECT late,status FROM maintenance."ExternalNotificationAttempt" WHERE "outboxId"=${q.id}::uuid`;
  assert(attempts.some((a) => a.late && a.status === "SENT"));
  assert.equal(
    await db.auditEvent.count({
      where: { orgId: f.orgId, action: "EXTERNAL_NOTIFICATION_LATE_RESULT" },
    }),
    1,
  );
});
test("expired lease reclaims same id/payload and expired idempotency horizon never calls provider", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  const internals = service as unknown as { claim(): Promise<Q | null> };
  const claim = await internals.claim();
  assert.equal(claim?.id, q.id);
  await due(q.id, true);
  await drain();
  assert.equal((await queue(f))[0].status, "SENT");
  assert.equal((await queue(f))[0].attemptCount, 2);
  const f2 = await fixture();
  await enroll(f2);
  await assigned(f2);
  await service.enqueue();
  const q2 = (await queue(f2))[0];
  assert.equal((await internals.claim())?.id, q2.id);
  await due(q2.id, true, true);
  await drain();
  assert.equal((await queue(f2))[0].status, "FAILED");
  assert.equal((await queue(f2))[0].code, "IDEMPOTENCY_WINDOW_EXPIRED");
  assert.equal(sent.filter((s) => s.id === q2.id).length, 0);
});
test("terminal provider rejection and exhausted retries do not send on later polls", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  responses.set(q.id, [{ outcome: "FAILED", code: "PROVIDER_REJECTED" }]);
  await drain();
  await drain();
  assert.equal((await queue(f))[0].status, "FAILED");
  assert.equal(sent.filter((s) => s.id === q.id).length, 1);
  const f2 = await fixture();
  await enroll(f2);
  await assigned(f2);
  await service.enqueue();
  const q2 = (await queue(f2))[0];
  responses.set(
    q2.id,
    Array.from({ length: 6 }, () => ({
      outcome: "RETRY",
      code: "RATE_LIMITED",
    })),
  );
  for (let i = 0; i < 6; i++) {
    if (i) await due(q2.id);
    await drain();
  }
  assert.equal((await queue(f2))[0].attemptCount, 6);
  assert.equal((await queue(f2))[0].code, "ATTEMPTS_EXHAUSTED");
});
test("preference/enqueue/result audit failures roll back persisted changes and retries retain provider identity", async () => {
  const f = await fixture();
  await failAudit(f, "EXTERNAL_NOTIFICATION_PREFERENCE", async () => {
    await save(f, true, 0).expect(503);
  });
  assert.equal((await settings(f).expect(200)).body.preference.version, 0);
  await enroll(f);
  await assigned(f);
  await failAudit(f, "EXTERNAL_NOTIFICATION_DELIVERY", async () => {
    await assert.rejects(service.enqueue());
  });
  assert.equal((await queue(f)).length, 0);
  await service.enqueue();
  const q = (await queue(f))[0];
  await failAudit(
    f,
    "EXTERNAL_NOTIFICATION_DELIVERY",
    async () => {
      await assert.rejects(service.runJobs());
    },
    true,
  );
  assert.equal((await queue(f))[0].status, "SENDING");
  assert.equal(sent.filter((s) => s.id === q.id).length, 1);
  await due(q.id, true);
  await drain();
  assert.equal((await queue(f))[0].status, "SENT");
  const calls = sent.filter((s) => s.id === q.id);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].payload, calls[1].payload);
});
test("runtime SQL cannot edit evidence or payload, bypass enrollment/actionability, forge attempts, or cross scope", async () => {
  const f = await fixture();
  await enroll(f);
  const o = await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  await assert.rejects(
    runtime.$executeRaw`UPDATE maintenance."ExternalNotificationPreference" SET enabled=false WHERE "orgId"=${f.orgId}::uuid`,
  );
  await assert.rejects(
    runtime.$executeRaw`DELETE FROM maintenance."ExternalNotificationOutbox" WHERE id=${q.id}::uuid`,
  );
  await assert.rejects(
    runtime.$executeRaw`UPDATE maintenance."ExternalNotificationOutbox" SET payload='{}'::jsonb WHERE id=${q.id}::uuid`,
  );
  await assert.rejects(
    runtime.$executeRaw`INSERT INTO maintenance."ExternalNotificationAttempt"("outboxId",attempt,status) VALUES(${q.id}::uuid,0,'SENT')`,
  );
  await assert.rejects(
    runtime.$executeRaw`INSERT INTO maintenance."ExternalNotificationAttempt"("outboxId",attempt,status,late,"leaseToken",code,"providerId") VALUES(${q.id}::uuid,1,'SENT',true,${randomUUID()}::uuid,'ACCEPTED','fake')`,
  );
  const other = await fixture();
  assert.equal((await settings(other).expect(200)).body.deliveries.length, 0);
  await assert.rejects(
    runtime.$executeRaw`UPDATE maintenance."ExternalNotificationOutbox" SET status='SENT',"providerId"='fake' WHERE id=${q.id}::uuid`,
  );
  await action(f, o, "start", "tech").expect(200);
  await drain();
  assert.equal((await queue(f))[0].status, "SUPPRESSED");
});
test("explicit calendar release enqueues one SCHEDULE handoff after enrollment without reminder delivery", async () => {
  const f = await fixture();
  await enroll(f);
  const plan = (
    await http()
      .post("/api/machines/WH-C/calendar/plans")
      .set(headers(f, "head"))
      .send({
        requestId: randomUUID(),
        title: "TEST email planned task",
        instructions: "TEST inspect fixture",
        frequency: "DAILY",
        interval: 1,
        firstDueAt: new Date(Date.now() - 3600000).toISOString(),
        technicianId: f.ids.tech,
        priority: "NORMAL",
        remindDays: 3,
      })
      .expect(201)
  ).body;
  await app
    .get(CalendarService)
    .runJobs(new Date(), { orgId: f.orgId, machineId: f.machineId });
  assert.equal((await queue(f)).length, 0);
  const occurrence = await db.maintenanceOccurrence.findFirstOrThrow({
    where: { planId: plan.id },
    orderBy: { sequence: "asc" },
  });
  const release = () =>
    http()
      .post(`/api/machines/WH-C/calendar/occurrences/${occurrence.id}/release`)
      .set(headers(f, "head"))
      .send({ version: occurrence.version, technicianId: f.ids.tech });
  await release().expect(200);
  await release().expect(200);
  await service.enqueue();
  assert.equal((await queue(f)).length, 1);
  assert.match((await queue(f))[0].payload.text, /Planned maintenance/);
  await drain();
});
test("retained synthetic review alone sends nothing; explicit investigation release enqueues its own handoff", async () => {
  const f = await fixture();
  await enroll(f);
  const batch = await db.readingImport.create({
    data: {
      orgId: f.orgId,
      machineId: f.machineId,
      filename: "TEST synthetic.xlsx",
      workbookHash: "d".repeat(64),
      parserVersion: "TEST",
      policyVersion: "demo-hourly-bands-v1",
      staged: { TEST: true },
      status: "COMMITTED",
      createdBy: f.ids.admin,
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
        orgId: f.orgId,
        machineId: f.machineId,
        importId: batch.id,
        sourceId: `EMAIL-TEST-${i}`,
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
  const flags = (
    await http()
      .get(
        "/api/machines/WH-C/readings/anomalies?from=2026-09-01&to=2026-09-05&kind=SUDDEN_CHANGE&status=PENDING",
      )
      .set(headers(f, "head"))
      .expect(200)
  ).body;
  assert(flags.items[0]);
  const { key, measuredAt } = flags.items[0];
  const path = "/api/machines/WH-C/readings/anomalies/reviews";
  const review = (
    await http()
      .post(path)
      .set(headers(f, "head"))
      .send({
        key,
        measuredAt,
        decision: "INVESTIGATE",
        reason: "TEST inspect synthetic evidence",
      })
      .expect(201)
  ).body;
  await service.enqueue();
  assert.equal((await queue(f)).length, 0);
  await http()
    .post(`${path}/${review.id}/investigation`)
    .set(headers(f, "head"))
    .send({ technicianId: f.ids.tech })
    .expect(201);
  await service.enqueue();
  const rows = await queue(f);
  assert.equal(rows.length, 1);
  assert.match(
    rows[0].payload.text,
    /Synthetic evidence does not establish a fault cause/,
  );
  await drain();
});

test("missing/disabled email configuration prevents sends while allowing explicit disable", async () => {
  const f = await fixture();
  await enroll(f);
  await assigned(f);
  await service.enqueue();
  const q = (await queue(f))[0];
  const cfg = app.get<EmailConfig>(CONFIG);
  const prior = cfg.EXTERNAL_NOTIFICATIONS_ENABLED;
  cfg.EXTERNAL_NOTIFICATIONS_ENABLED = "false";
  try {
    await service.runJobs();
    assert.equal(sent.filter((s) => s.id === q.id).length, 0);
    assert.equal((await settings(f).expect(200)).body.configured, false);
    await save(f, true, 1).expect(503);
    await save(f, false, 1).expect(200);
    assert.equal((await queue(f))[0].status, "SUPPRESSED");
  } finally {
    cfg.EXTERNAL_NOTIFICATIONS_ENABLED = prior;
  }
});
