// Actual restricted PostgreSQL and HTTP; identities/contact/email doubles exist in this test only.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import {
  ForbiddenException,
  UnauthorizedException,
  type INestApplication,
} from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { NOTIFICATION_CONTACT } from "../external-notifications/contact";
import { NOTIFICATION_EMAIL } from "../external-notifications/provider";
import { TeamService } from "../team/service";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).host !== new URL(runtime).host ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Matching isolated *_test database connections required");
const db = new PrismaClient({ datasources: { db: { url: owner } } }),
  restricted = new PrismaClient({ datasources: { db: { url: runtime } } });
const roles = {
  admin: Role.ADMINISTRATOR,
  otherAdmin: Role.ADMINISTRATOR,
  head: Role.MAINTENANCE_HEAD,
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  foreign: Role.ADMINISTRATOR,
};
const ids: Record<string, string> = Object.fromEntries(
  [
    ...Object.keys(roles),
    "newTech",
    "newOperator",
    "unconfirmed",
    "wrongEmail",
    "newManager",
    "newSupervisor",
  ].map((k) => [k, randomUUID()]),
);
const emails: Record<string, string> = Object.fromEntries(
  Object.keys(ids).map((k) => [
    k,
    ("test-" + k + "@example.test").toLowerCase(),
  ]),
);
let app: INestApplication,
  orgId: string,
  foreignOrg: string,
  machineId: string,
  secondMachine: string,
  foreignMachine: string,
  archivedMachine: string;
let calls = 0,
  lastPayload: any,
  emailOutcome: "SENT" | "FAILED" | "RETRY" = "SENT",
  mainInvitation: any,
  joined: any;
const get = (path: string, who = "admin") =>
  request(app.getHttpServer())
    .get("/api" + path)
    .set("Authorization", "Bearer " + ids[who]);
const post = (path: string, who = "admin") =>
  request(app.getHttpServer())
    .post("/api" + path)
    .set("Authorization", "Bearer " + ids[who]);
const inviteBody = (
  key: string,
  role: Role = Role.TECHNICIAN,
  machines: string[] = [machineId],
) => ({
  requestId: randomUUID(),
  email: emails[key],
  displayName: "TEST " + key,
  role,
  machineIds: machines,
});
const invite = async (key: string, role?: Role, machines?: string[]) =>
  (
    await post("/team/invitations")
      .send(inviteBody(key, role, machines))
      .expect(201)
  ).body;
const list = async () => (await get("/team/members").expect(200)).body.items;
async function editBody(userId: string, changes: Record<string, unknown> = {}) {
  const m = (await list()).find((m: any) => m.userId === userId);
  assert(m);
  return {
    requestId: randomUUID(),
    version: m.version,
    displayName: m.displayName,
    role: m.role,
    active: m.active,
    machineIds: m.machines.map((x: any) => x.id).sort(),
    expectedMachineIds: m.machines.map((x: any) => x.id).sort(),
    reason: "TEST access review",
    replaceAdditionalRoles: false,
    ...changes,
  };
}
async function update(
  userId: string,
  changes: Record<string, unknown> = {},
  who = "admin",
) {
  const m = await db.membership.findUniqueOrThrow({ where: { userId } });
  return request(app.getHttpServer())
    .put("/api/team/members/" + m.id)
    .set("Authorization", "Bearer " + ids[who])
    .send(await editBody(userId, changes));
}
before(async () => {
  const org = await db.organization.create({
    data: { slug: "team-" + randomUUID(), name: "TEST staff organization" },
  });
  orgId = org.id;
  foreignOrg = (
    await db.organization.create({
      data: {
        slug: "team-foreign-" + randomUUID(),
        name: "TEST foreign organization",
      },
    })
  ).id;
  for (const [code, org, archived] of [
    ["QA-01", orgId, false],
    ["QA-02", orgId, false],
    ["ARCHIVED", orgId, true],
    ["FOREIGN", foreignOrg, false],
  ] as const) {
    const m = await db.machine.create({
      data: {
        orgId: org,
        code,
        name: "TEST " + code,
      },
    });
    if (code === "QA-01") machineId = m.id;
    else if (code === "QA-02") secondMachine = m.id;
    else if (code === "ARCHIVED") archivedMachine = m.id;
    else foreignMachine = m.id;
  }
  for (const [key, role] of Object.entries(roles)) {
    await db.appUser.create({
      data: { id: ids[key], displayName: "TEST " + key },
    });
    const member = await db.membership.create({
      data: {
        userId: ids[key],
        orgId: key === "foreign" ? foreignOrg : orgId,
        role,
      },
    });
    if (["operator", "tech"].includes(key))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: member.id },
      });
  }
  const config = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtime,
    TEAM_INVITATION_SECRET: "a".repeat(64),
    EXTERNAL_NOTIFICATIONS_ENABLED: "true" as const,
    NOTIFICATION_EMAIL_PROVIDER: "resend" as const,
    RESEND_API_KEY: "test-only-resend-provider-key",
    NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
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
    .overrideProvider(NOTIFICATION_CONTACT)
    .useValue({
      async resolve(_token: string, userId: string) {
        const key = Object.keys(ids).find((k) => ids[k] === userId);
        if (key === "unconfirmed")
          throw new ForbiddenException("Confirm your email first.");
        if (!key) throw new UnauthorizedException();
        return emails[key];
      },
    })
    .overrideProvider(NOTIFICATION_EMAIL)
    .useValue({
      async send(_id: string, payload: any) {
        calls++;
        lastPayload = payload;
        return emailOutcome === "SENT"
          ? { outcome: "SENT", providerId: "test-provider-id" }
          : { outcome: emailOutcome, code: "TEST_PROVIDER_FAILURE" };
      },
    })
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.listen(0, "127.0.0.1");
  await post("/machines/ARCHIVED/lifecycle")
    .send({
      requestId: randomUUID(),
      version: 1,
      archived: true,
      reason: "TEST retired",
    })
    .expect(201);
});
after(async () => {
  await app?.close();
  await Promise.all([db.$disconnect(), restricted.$disconnect()]);
});

test("all role views enforce Administrator-only staff management and no identity/body/header grants", async () => {
  await request(app.getHttpServer()).get("/api/team/members").expect(401);
  for (const who of ["head", "operator", "tech", "supervisor", "management"]) {
    await get("/team/members", who).expect(403);
    await post("/team/invitations", who)
      .send(inviteBody("newTech"))
      .expect(403);
  }
  await get("/team/members", "operator")
    .set("X-Workspace-Role", "ADMINISTRATOR")
    .expect(403);
  await get("/team/members", "foreign")
    .expect(200)
    .then((r) => assert.equal(r.body.total, 1));
  await get("/me", "newTech").expect(403);
  await post("/team/invitations")
    .send({ ...inviteBody("newTech"), orgId: foreignOrg })
    .expect(400);
  await post("/team/invitations")
    .send({ ...inviteBody("newTech"), email: emails.admin })
    .expect(400);
});
test("invitation validation rejects empty, foreign, archived, duplicate machine grants and invalid names", async () => {
  await post("/team/invitations")
    .send(inviteBody("newTech", Role.TECHNICIAN, []))
    .expect(409);
  for (const machine of [foreignMachine, archivedMachine, randomUUID()])
    await post("/team/invitations")
      .send(inviteBody("newTech", Role.TECHNICIAN, [machine]))
      .expect(409);
  await post("/team/invitations")
    .send(inviteBody("newTech", Role.TECHNICIAN, [machineId, machineId]))
    .expect(400);
  await post("/team/invitations")
    .send({ ...inviteBody("newTech"), displayName: "x" })
    .expect(400);
  assert.equal(await db.teamInvitation.count({ where: { orgId } }), 0);
});
test("concurrent exact invitation retries return one stable private link and immutable action/audit", async () => {
  const body = inviteBody("newTech");
  body.email = body.email.toUpperCase();
  const receipts = await Promise.all([
    post("/team/invitations").send(body).expect(201),
    post("/team/invitations").send(body).expect(201),
  ]);
  assert.equal(receipts.filter((r) => r.body.alreadyApplied).length, 1);
  assert.equal(receipts[0].body.invitationUrl, receipts[1].body.invitationUrl);
  mainInvitation = receipts[0].body;
  assert(
    mainInvitation.invitationUrl.startsWith(
      "http://localhost:3000/join#invitation=",
    ),
  );
  const stored = await db.teamInvitation.findUniqueOrThrow({
    where: { id: mainInvitation.id },
  });
  assert.equal(stored.email, emails.newTech);
  assert.equal(stored.role, "TECHNICIAN");
  assert(!JSON.stringify(stored).includes(mainInvitation.invitationUrl));
  assert.equal(
    await db.teamAction.count({ where: { orgId, targetId: stored.id } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: stored.id, action: "TEAM_INVITE" },
    }),
    1,
  );
  await post("/team/invitations")
    .send({ ...body, role: "ADMINISTRATOR" })
    .expect(409);
  await post("/team/invitations").send(inviteBody("newTech")).expect(409);
  const preview = await request(app.getHttpServer())
    .post("/api/team/onboarding/preview")
    .send({ token: mainInvitation.invitationUrl.split("#invitation=")[1] })
    .expect(201);
  assert.equal(preview.body.email, emails.newTech);
  assert.equal(preview.body.tokenHash, undefined);
  await request(app.getHttpServer())
    .post("/api/team/onboarding/preview")
    .send({ token: mainInvitation.id + "." + "x".repeat(43) })
    .expect(404);
});
test("only confirmed matching Supabase identity can accept, with no request-provided email or authority", async () => {
  await request(app.getHttpServer())
    .post("/api/team/onboarding/accept")
    .send({ invitationId: mainInvitation.id })
    .expect(401);
  await post("/team/onboarding/accept", "unconfirmed")
    .send({ invitationId: mainInvitation.id })
    .expect(403);
  await post("/team/onboarding/accept", "wrongEmail")
    .send({ invitationId: mainInvitation.id })
    .expect(404);
  await post("/team/onboarding/accept", "newTech")
    .send({
      invitationId: mainInvitation.id,
      email: emails.newTech,
      role: "ADMINISTRATOR",
    })
    .expect(400);
  const available = await post("/team/onboarding/available", "newTech")
    .send({})
    .expect(201);
  assert.equal(available.body.items.length, 1);
  assert.equal(
    await db.membership.findUnique({ where: { userId: ids.newTech } }),
    null,
  );
  const result = await Promise.all([
    post("/team/onboarding/accept", "newTech")
      .send({ invitationId: mainInvitation.id })
      .expect(201),
    post("/team/onboarding/accept", "newTech")
      .send({ invitationId: mainInvitation.id })
      .expect(201),
  ]);
  assert.equal(result.filter((r) => r.body.alreadyApplied).length, 1);
  joined = await db.membership.findUniqueOrThrow({
    where: { userId: ids.newTech },
  });
  const me = await get("/me", "newTech").expect(200);
  assert.equal(me.body.role, "TECHNICIAN");
  assert.deepEqual(me.body.availableRoles, ["TECHNICIAN"]);
  const machineList = await get("/machines", "newTech").expect(200);
  assert.deepEqual(
    machineList.body.items.map((m: any) => m.id),
    [machineId],
  );
  assert.equal(
    await db.auditEvent.count({
      where: {
        orgId,
        action: "TEAM_INVITATION_ACCEPTED",
        entityId: mainInvitation.id,
      },
    }),
    1,
  );
  assert.equal(
    await db.externalNotificationPreference.count({
      where: { orgId, userId: ids.newTech },
    }),
    0,
  );
  await get("/team/members", "newTech").expect(403);
});
test("role/name/machine changes are atomic, versioned, replay-safe and retain the real identity", async () => {
  const body = await editBody(ids.newTech, {
    displayName: "TEST renamed technician",
    machineIds: [secondMachine],
  });
  const path = "/api/team/members/" + joined.id;
  const changes = await Promise.all([
    request(app.getHttpServer())
      .put(path)
      .set("Authorization", "Bearer " + ids.admin)
      .send(body)
      .expect(200),
    request(app.getHttpServer())
      .put(path)
      .set("Authorization", "Bearer " + ids.admin)
      .send(body)
      .expect(200),
  ]);
  assert.equal(changes.filter((r) => r.body.alreadyApplied).length, 1);
  await get("/machines/QA-01", "newTech").expect(404);
  await get("/machines/QA-02", "newTech").expect(200);
  await request(app.getHttpServer())
    .put(path)
    .set("Authorization", "Bearer " + ids.admin)
    .send({ ...body, requestId: randomUUID() })
    .expect(409);
  await request(app.getHttpServer())
    .put(path)
    .set("Authorization", "Bearer " + ids.admin)
    .send({ ...body, reason: "TEST changed retry" })
    .expect(409);
  const saved = await db.membership.findUniqueOrThrow({
    where: { id: joined.id },
  });
  assert.equal(saved.userId, ids.newTech);
  assert.equal(saved.teamVersion, 2);
});
test("machine-access edits outside Team invalidate a stale Team draft without granting a foreign scope", async () => {
  const body = await editBody(ids.newTech, { machineIds: [secondMachine] });
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: joined.id },
  });
  await request(app.getHttpServer())
    .put("/api/team/members/" + joined.id)
    .set("Authorization", "Bearer " + ids.admin)
    .send(body)
    .expect(409);
  await update(ids.newTech, { machineIds: [foreignMachine] }).then((r) =>
    assert.equal(r.status, 409),
  );
  await request(app.getHttpServer())
    .put("/api/team/members/" + joined.id)
    .set("Authorization", "Bearer " + ids.foreign)
    .send(await editBody(ids.newTech))
    .expect(404);
});
test("deactivation denies retained sessions and old invitation retries cannot reactivate; explicit reactivation preserves identity", async () => {
  await update(ids.newTech, { active: false }).then((r) =>
    assert.equal(r.status, 200),
  );
  await get("/me", "newTech").expect(403);
  await get("/machines/QA-02", "newTech").expect(403);
  await post("/team/onboarding/accept", "newTech")
    .send({ invitationId: mainInvitation.id })
    .expect(403);
  const before = await db.membership.findUniqueOrThrow({
    where: { id: joined.id },
  });
  assert.equal(before.active, false);
  await update(ids.newTech, { active: true }).then((r) =>
    assert.equal(r.status, 200),
  );
  await get("/me", "newTech").expect(200);
  assert.equal(
    (await db.membership.findUniqueOrThrow({ where: { userId: ids.newTech } }))
      .id,
    joined.id,
  );
  await update(ids.admin, { active: false }).then((r) =>
    assert.equal(r.status, 403),
  );
});
test("additional pilot grants require explicit replacement and a primary role never combines authority", async () => {
  await db.membershipRoleGrant.create({
    data: { orgId, membershipId: joined.id, role: "MAINTENANCE_HEAD" },
  });
  await update(ids.newTech, { role: "OPERATOR" }).then((r) =>
    assert.equal(r.status, 409),
  );
  await update(ids.newTech, {
    role: "OPERATOR",
    replaceAdditionalRoles: true,
  }).then((r) => assert.equal(r.status, 200));
  await get("/me", "newTech")
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .expect(403);
  const me = await get("/me", "newTech").expect(200);
  assert.deepEqual(me.body.availableRoles, ["OPERATOR"]);
});
test("revoked and expired invitations cannot create memberships; receipt retries retain revocation history", async () => {
  const invitation = await invite("newOperator", Role.OPERATOR);
  const body = { requestId: randomUUID(), version: 1 };
  await post("/team/invitations/" + invitation.id + "/revoke")
    .send(body)
    .expect(201);
  await post("/team/invitations/" + invitation.id + "/revoke")
    .send(body)
    .expect(201)
    .then((r) => assert.equal(r.body.alreadyApplied, true));
  await post("/team/onboarding/accept", "newOperator")
    .send({ invitationId: invitation.id })
    .expect(409);
  const second = await invite("newManager", Role.MANAGEMENT, []);
  await db.teamInvitation.update({
    where: { id: second.id },
    data: {
      createdAt: new Date(Date.now() - 8 * 86400000),
      expiresAt: new Date(Date.now() - 86400000),
    },
  });
  await post("/team/onboarding/accept", "newManager")
    .send({ invitationId: second.id })
    .expect(409);
  assert.equal(
    await db.membership.findUnique({ where: { userId: ids.newManager } }),
    null,
  );
});
test("a former Administrator cannot leave usable pending invitations behind", async () => {
  const body = inviteBody("newSupervisor", Role.SUPERVISOR, []);
  const invitation = (
    await post("/team/invitations", "otherAdmin").send(body).expect(201)
  ).body;
  await update(ids.otherAdmin, { active: false }).then((r) =>
    assert.equal(r.status, 200),
  );
  await post("/team/onboarding/accept", "newSupervisor")
    .send({ invitationId: invitation.id })
    .expect(409);
  assert.equal(
    (
      await db.teamInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).status,
    "REVOKED",
  );
  await get("/team/members", "otherAdmin").expect(403);
  await update(ids.otherAdmin, { active: true }).then((r) =>
    assert.equal(r.status, 200),
  );
});
test("invitation emails require explicit action, durable receipt and bounded duplicate-safe sends", async () => {
  const invitation = await invite("newSupervisor", Role.SUPERVISOR, []);
  assert.equal(calls, 0);
  const body = { requestId: randomUUID(), version: 1 };
  const r = await post("/team/invitations/" + invitation.id + "/email")
    .send(body)
    .expect(201);
  assert.equal(r.body.deliveryStatus, "SENT");
  assert.equal(calls, 1);
  assert.deepEqual(lastPayload.to, [emails.newSupervisor]);
  assert(lastPayload.text.includes("#invitation="));
  await post("/team/invitations/" + invitation.id + "/email")
    .send(body)
    .expect(201);
  assert.equal(calls, 1);
  await post("/team/invitations/" + invitation.id + "/email")
    .send({ ...body, requestId: randomUUID() })
    .expect(429);
  assert.equal(
    await db.teamInvitationEmail.count({
      where: { invitationId: invitation.id },
    }),
    1,
  );
});
test("runtime cannot write identity/team tables directly or alter immutable receipts, and browser roles cannot invoke privileged team functions", async () => {
  await assert.rejects(
    restricted.membership.update({
      where: { id: joined.id },
      data: { role: "ADMINISTRATOR" },
    }),
  );
  await assert.rejects(
    restricted.teamInvitation.updateMany({
      where: { orgId },
      data: { role: "ADMINISTRATOR" },
    }),
  );
  await assert.rejects(restricted.teamAction.deleteMany({ where: { orgId } }));
  await assert.rejects(
    restricted.appUser.update({
      where: { id: ids.newTech },
      data: { displayName: "TEST forged" },
    }),
  );
  const grants = await db.$queryRaw<
    { role: string; can: boolean }[]
  >`SELECT rolname::text AS role,has_function_privilege(oid,'maintenance.team_admin_action(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE') AS can FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
  assert(grants.every((r) => !r.can));
  const receipt = await db.teamAction.findFirstOrThrow({ where: { orgId } });
  await assert.rejects(
    db.teamAction.update({
      where: { id: receipt.id },
      data: { result: { forged: true } },
    }),
  );
});
test("audit failure rolls back membership edits and invitation acceptance, including identity and grant inserts", async () => {
  const auditId = randomUUID().replaceAll("-", "");
  const functionName = "team_fail_" + auditId;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orgId"='${orgId}'::uuid AND NEW.action IN ('TEAM_UPDATE_MEMBER','TEAM_INVITATION_ACCEPTED') THEN RAISE EXCEPTION 'TEST audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${functionName} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.${functionName}()`,
  );
  try {
    const before = await db.membership.findUniqueOrThrow({
      where: { id: joined.id },
    });
    await update(ids.newTech, { active: false }).then((r) =>
      assert.equal(r.status, 503),
    );
    assert.deepEqual(
      await db.membership.findUniqueOrThrow({ where: { id: joined.id } }),
      before,
    );
    const pending = await db.teamInvitation.findFirstOrThrow({
      where: { orgId, email: emails.newSupervisor, status: "PENDING" },
    });
    await post("/team/onboarding/accept", "newSupervisor")
      .send({ invitationId: pending.id })
      .expect(503);
    assert.equal(
      await db.membership.findUnique({ where: { userId: ids.newSupervisor } }),
      null,
    );
    assert.equal(
      await db.appUser.findUnique({ where: { id: ids.newSupervisor } }),
      null,
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${functionName} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${functionName}()`);
  }
});

test("team edits retain existing archived machine access without modifying archived metadata", async () => {
  const historyMachine = await db.machine.create({
    data: { orgId, code: "HISTORY", name: "TEST archived staff access" },
  });
  const current = await editBody(ids.newTech);
  await update(ids.newTech, {
    machineIds: [...current.machineIds, historyMachine.id],
  }).then((r) => assert.equal(r.status, 200));
  const registered = await db.machine.findUniqueOrThrow({
    where: { id: historyMachine.id },
  });
  await post("/machines/HISTORY/lifecycle")
    .send({
      requestId: randomUUID(),
      version: registered.version,
      archived: true,
      reason: "TEST retired with existing staff access",
    })
    .expect(201);
  const historyId = historyMachine.id;
  const before = await db.machine.findUniqueOrThrow({
    where: { id: historyId },
  });
  await update(ids.newTech, {
    displayName: "TEST archived access retained",
  }).then((r) => assert.equal(r.status, 200));
  assert.deepEqual(
    await db.machine.findUniqueOrThrow({ where: { id: historyId } }),
    before,
  );
  assert(
    await db.machineAccess.findUnique({
      where: {
        machineId_membershipId: {
          machineId: historyId,
          membershipId: joined.id,
        },
      },
    }),
  );
});
test("privileged function boundaries reject null email proof and null version even if HTTP validation is bypassed", async () => {
  const body = await editBody(ids.newTech);
  const before = await db.membership.findUniqueOrThrow({
    where: { id: joined.id },
  });
  await assert.rejects(
    restricted.$queryRaw`SELECT maintenance.team_admin_action(${orgId}::uuid,${ids.admin}::uuid,${randomUUID()}::uuid,'UPDATE_MEMBER',${joined.id}::uuid,${JSON.stringify({ ...body, version: null })}::jsonb)`,
  );
  const pending = await db.teamInvitation.findFirstOrThrow({
    where: { orgId, email: emails.newSupervisor, status: "PENDING" },
  });
  await assert.rejects(
    restricted.$queryRaw`SELECT maintenance.team_accept_invitation(${pending.id}::uuid,${ids.newSupervisor}::uuid,NULL::text)`,
  );
  assert.deepEqual(
    await db.membership.findUniqueOrThrow({ where: { id: joined.id } }),
    before,
  );
});

test("deactivating an assigned technician preserves the work order and lets the head reassign it", async () => {
  const order = (
    await post("/machines/QA-01/work-orders", "operator")
      .send({
        requestId: randomUUID(),
        title: "TEST staff lifecycle repair",
        description:
          "Synthetic lifecycle acceptance only; not an operational incident.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  const assigned = (
    await post(
      "/machines/QA-01/work-orders/" + order.id + "/actions/assign",
      "head",
    )
      .send({ version: order.version, technicianId: ids.tech })
      .expect(200)
  ).body;
  await update(ids.tech, { active: false }).then((r) =>
    assert.equal(r.status, 200),
  );
  await get("/machines/QA-01/work-orders/" + order.id, "tech").expect(403);
  const retained = (
    await get("/machines/QA-01/work-orders/" + order.id, "head").expect(200)
  ).body;
  assert.equal(retained.technician.userId, ids.tech);
  assert.equal(retained.title, order.title);
  const member = (await list()).find((m: any) => m.userId === ids.tech);
  assert.equal(member.openWorkOrders, 1);
  assert.equal(member.active, false);
  await update(ids.newTech, { role: "TECHNICIAN" }).then((r) =>
    assert.equal(r.status, 200),
  );
  const reassigned = await post(
    "/machines/QA-01/work-orders/" + order.id + "/actions/assign",
    "head",
  )
    .send({
      version: assigned.version,
      technicianId: ids.newTech,
      reason: "TEST continuity after staff deactivation",
    })
    .expect(200);
  assert.equal(reassigned.body.technician.userId, ids.newTech);
  assert(
    reassigned.body.events.some((e: any) => e.detail.technicianId === ids.tech),
  );
});

test("invitation signing is canonical for uppercase request UUIDs and rotated keys cannot reshare broken links", async () => {
  const body = {
    ...inviteBody("wrongEmail", Role.MANAGEMENT, []),
    requestId: randomUUID().toUpperCase(),
  };
  const created = (await post("/team/invitations").send(body).expect(201)).body;
  const token = new URL(created.invitationUrl).hash.slice(
    "#invitation=".length,
  );
  await request(app.getHttpServer())
    .post("/api/team/onboarding/preview")
    .send({ token })
    .expect(201);
  const service = app.get(TeamService),
    config = (service as any).config;
  const key = config.TEAM_INVITATION_SECRET;
  try {
    config.TEAM_INVITATION_SECRET = "b".repeat(64);
    await post("/team/invitations/" + created.id + "/link")
      .send({})
      .expect(409);
  } finally {
    config.TEAM_INVITATION_SECRET = key;
  }
});

test("concurrent invitation email retries call the provider once and terminal failures retain their outcome", async () => {
  const make = async () =>
    (
      await post("/team/invitations")
        .send({
          ...inviteBody("wrongEmail", Role.MANAGEMENT, []),
          email: "test-" + randomUUID() + "@example.test",
        })
        .expect(201)
    ).body;
  const concurrent = await make(),
    start = calls;
  const body = { requestId: randomUUID(), version: 1 };
  const receipts = await Promise.all([
    post("/team/invitations/" + concurrent.id + "/email")
      .send(body)
      .expect(201),
    post("/team/invitations/" + concurrent.id + "/email")
      .send(body)
      .expect(201),
  ]);
  assert.equal(calls, start + 1);
  assert(receipts.some((r) => r.body.deliveryStatus === "SENT"));
  for (const outcome of ["FAILED", "RETRY"] as const) {
    emailOutcome = outcome;
    try {
      const inv = await make(),
        requestBody = { requestId: randomUUID(), version: 1 },
        count = calls;
      const sent = await post("/team/invitations/" + inv.id + "/email")
        .send(requestBody)
        .expect(201);
      assert.equal(
        sent.body.deliveryStatus,
        outcome === "FAILED" ? "FAILED" : "UNCERTAIN",
      );
      const retried = await post("/team/invitations/" + inv.id + "/email")
        .send(requestBody)
        .expect(201);
      assert.equal(retried.body.deliveryStatus, sent.body.deliveryStatus);
      assert.equal(calls, count + 1);
      const stored = await db.teamInvitationEmail.findUniqueOrThrow({
        where: { id: requestBody.requestId },
      });
      assert.equal(stored.code, "TEST_PROVIDER_FAILURE");
      assert.equal(stored.providerId, null);
    } finally {
      emailOutcome = "SENT";
    }
  }
});
