import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient, Role } from "@prisma/client";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw new Error("Use isolated *_test database URLs.");
test("trusted role provisioning is atomic and idempotent, audits restored machine access, and refuses revoked grants/runtime writes", async () => {
  const db = new PrismaClient({ datasources: { db: { url: owner } } });
  const id = randomUUID();
  let membershipId: string | undefined;
  const run = (roles: Role[], url = owner) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/grant-roles.ts", id, ...roles],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DIRECT_URL: url, DATABASE_URL: runtime },
      },
    );
  try {
    const org = await db.organization.findUniqueOrThrow({
      where: { slug: "supreme-industries" },
    });
    const machine = await db.machine.findUniqueOrThrow({
      where: { orgId_code: { orgId: org.id, code: "WH-C" } },
    });
    await db.appUser.create({
      data: { id, displayName: "TEST role provisioning" },
    });
    const member = await db.membership.create({
      data: { userId: id, orgId: org.id, role: Role.ADMINISTRATOR },
    });
    membershipId = member.id;
    const roles = [Role.OPERATOR, Role.TECHNICIAN, Role.MAINTENANCE_HEAD];
    assert.equal(run(roles).status, 0);
    assert.equal(
      await db.membershipRoleGrant.count({ where: { membershipId } }),
      3,
    );
    assert.equal(
      await db.auditEvent.count({
        where: { entityId: membershipId, action: "MEMBERSHIP_ROLES_GRANTED" },
      }),
      1,
    );
    assert.equal(run(roles).status, 0);
    assert.equal(
      await db.membershipRoleGrant.count({ where: { membershipId } }),
      3,
    );
    assert.equal(
      await db.auditEvent.count({
        where: { entityId: membershipId, action: "MEMBERSHIP_ROLES_GRANTED" },
      }),
      1,
    );
    await db.machineAccess.delete({
      where: {
        machineId_membershipId: { machineId: machine.id, membershipId },
      },
    });
    assert.equal(run(roles).status, 0);
    const events = await db.auditEvent.findMany({
      where: { entityId: membershipId, action: "MEMBERSHIP_ROLES_GRANTED" },
      orderBy: { at: "asc" },
    });
    assert.equal(events.length, 2);
    assert.deepEqual((events[1].detail as any).roles, []);
    assert.deepEqual((events[1].detail as any).machineCodes, ["WH-C"]);
    await db.membershipRoleGrant.update({
      where: { membershipId_role: { membershipId, role: Role.TECHNICIAN } },
      data: { active: false },
    });
    assert.equal(run(roles).status, 1);
    assert.equal(
      await db.auditEvent.count({
        where: { entityId: membershipId, action: "MEMBERSHIP_ROLES_GRANTED" },
      }),
      2,
    );
    assert.equal(run([Role.MANAGEMENT], runtime).status, 1);
    assert.equal(
      await db.membershipRoleGrant.count({
        where: { membershipId, role: Role.MANAGEMENT },
      }),
      0,
    );
    assert.equal(
      (await db.membership.findUniqueOrThrow({ where: { id: membershipId } }))
        .role,
      Role.ADMINISTRATOR,
    );
  } finally {
    if (membershipId) {
      await db.machineAccess.deleteMany({ where: { membershipId } });
      await db.membershipRoleGrant.deleteMany({ where: { membershipId } });
      await db.membership.delete({ where: { id: membershipId } });
    }
    await db.appUser.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
