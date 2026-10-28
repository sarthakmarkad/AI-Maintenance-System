import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { type INestApplication, UnauthorizedException } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
const url = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a separate TEST_DATABASE_URL database ending in _test.");
if (!runtimeUrl || new URL(runtimeUrl).pathname !== new URL(url).pathname)
  throw new Error(
    "TEST_RUNTIME_DATABASE_URL must reference the same isolated test database with restricted credentials.",
  );
const db = new PrismaClient({ datasources: { db: { url } } });
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const users = {
  operator: randomUUID(),
  unassigned: randomUUID(),
  technician: randomUUID(),
  head: randomUUID(),
  supervisor: randomUUID(),
  management: randomUUID(),
  administrator: randomUUID(),
  outsider: randomUUID(),
  inactive: randomUUID(),
};
let app: INestApplication;
let orgId: string;
let machineId: string;
let outsiderOrgId: string;
let operatorMembershipId: string;
const get = (path: string, user: keyof typeof users = "operator") =>
  request(app.getHttpServer())
    .get(path)
    .set("Authorization", `Bearer ${users[user]}`);
before(async () => {
  const org = await db.organization.findUniqueOrThrow({
    where: { slug: "supreme-industries" },
  });
  orgId = org.id;
  const machine = await db.machine.findUniqueOrThrow({
    where: { orgId_code: { orgId, code: "WH-C" } },
  });
  machineId = machine.id;
  const other = await db.organization.upsert({
    where: { slug: "integration-other" },
    create: {
      slug: "integration-other",
      name: "Other organization (test fixture)",
    },
    update: {},
  });
  outsiderOrgId = other.id;
  const roles: Record<keyof typeof users, Role> = {
    operator: Role.OPERATOR,
    unassigned: Role.OPERATOR,
    technician: Role.TECHNICIAN,
    head: Role.MAINTENANCE_HEAD,
    supervisor: Role.SUPERVISOR,
    management: Role.MANAGEMENT,
    administrator: Role.ADMINISTRATOR,
    outsider: Role.MAINTENANCE_HEAD,
    inactive: Role.OPERATOR,
  };
  for (const [key, id] of Object.entries(users)) {
    await db.appUser.create({
      data: { id, displayName: `Integration ${key}` },
    });
    const membership = await db.membership.create({
      data: {
        userId: id,
        orgId: key === "outsider" ? outsiderOrgId : orgId,
        role: roles[key as keyof typeof users],
        active: key !== "inactive",
      },
    });
    if (key === "operator") operatorMembershipId = membership.id;
    if (["operator", "technician"].includes(key))
      await db.machineAccess.create({
        data: { machineId, membershipId: membership.id, orgId },
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
        if (!(Object.values(users) as string[]).includes(token))
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
  await db.machineAccess.deleteMany({
    where: { membership: { userId: { in: Object.values(users) } } },
  });
  await db.membership.deleteMany({
    where: { userId: { in: Object.values(users) } },
  });
  await db.appUser.deleteMany({ where: { id: { in: Object.values(users) } } });
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});
test("migrations and repeated seed retain exactly one WH-C and one seed audit event", async () => {
  assert.equal(await db.machine.count({ where: { orgId, code: "WH-C" } }), 1);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, action: "MACHINE_SEEDED", entityId: machineId },
    }),
    1,
  );
});
test("real scoped Prisma queries return WH-C for each authorized role", async () => {
  for (const user of [
    "operator",
    "technician",
    "head",
    "supervisor",
    "management",
    "administrator",
  ] as const) {
    const res = await get("/api/machines/WH-C", user).expect(200);
    assert.equal(res.body.id, machineId);
    assert.equal(res.body.model, null);
  }
  const me = await get("/api/me").expect(200);
  assert.equal(me.body.role, "OPERATOR");
  assert.equal(me.body.orgId, orgId);
});
test("real database scope denies another organization and an operator without a grant", async () => {
  for (const user of ["outsider", "unassigned"] as const) {
    await get("/api/machines/WH-C", user).expect(404);
    const res = await get("/api/machines", user).expect(200);
    assert.deepEqual(res.body.items, []);
  }
  await get("/api/me", "inactive").expect(403);
  await request(app.getHttpServer()).get("/api/machines/WH-C").expect(401);
});
test("membership revocation is applied immediately, without trusting an existing bearer token", async () => {
  await db.membership.update({
    where: { id: operatorMembershipId },
    data: { active: false },
  });
  try {
    await get("/api/machines/WH-C").expect(403);
  } finally {
    await db.membership.update({
      where: { id: operatorMembershipId },
      data: { active: true },
    });
  }
});
test("database prevents cross-organization grants and duplicate machine codes", async () => {
  const outsider = await db.membership.findUniqueOrThrow({
    where: { userId: users.outsider },
  });
  await assert.rejects(
    db.machineAccess.create({
      data: { orgId, machineId, membershipId: outsider.id },
    }),
    (e) => (e as { code: string }).code === "P2003",
  );
  await assert.rejects(
    db.machine.create({
      data: { orgId, code: "WH-C", name: "duplicate", manufacturer: "test" },
    }),
    (e) => (e as { code: string }).code === "P2002",
  );
});
test("keyset pagination and invalid query validation work against persisted records", async () => {
  const first = await get("/api/machines?limit=1").expect(200);
  assert.equal(first.body.items[0].code, "WH-C");
  assert.equal(first.body.nextCursor, null);
  const after = await get("/api/machines?after=WH-C").expect(200);
  assert.deepEqual(after.body.items, []);
  await get("/api/machines?limit=bad").expect(400);
});
test("runtime database login cannot change roles, machine identity, or protected audit events", async () => {
  assert.equal(
    (
      await runtime.membership.findUniqueOrThrow({
        where: { id: operatorMembershipId },
      })
    ).role,
    "OPERATOR",
  );
  await assert.rejects(
    runtime.membership.update({
      where: { id: operatorMembershipId },
      data: { role: Role.ADMINISTRATOR },
    }),
  );
  await assert.rejects(
    runtime.machine.update({
      where: { id: machineId },
      data: { code: "FORBIDDEN" },
    }),
  );
  await assert.rejects(runtime.auditEvent.deleteMany({ where: { orgId } }));
  // Even the migration owner cannot accidentally edit/delete an existing audit row.
  const event = await db.auditEvent.findFirstOrThrow({
    where: { orgId, action: "MACHINE_SEEDED" },
  });
  await assert.rejects(
    db.auditEvent.update({
      where: { id: event.id },
      data: { action: "FORGED" },
    }),
    /append-only/,
  );
});
test("unprivileged browser-like database role has no direct table access", async () => {
  await db.$executeRawUnsafe(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='maintenance_browser_test') THEN CREATE ROLE maintenance_browser_test NOLOGIN; END IF; END $$",
  );
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE maintenance_browser_test");
      await tx.$queryRawUnsafe('SELECT id FROM maintenance."Machine" LIMIT 1');
    }),
    /permission denied/,
  );
});
