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
  operator: Role.OPERATOR,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  noGrant: Role.OPERATOR,
  outsider: Role.MAINTENANCE_HEAD,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let app: INestApplication, orgId: string, machineId: string;
const base = "/api/machines/WH-C/readings/anomalies",
  window = "?from=2026-09-01&to=2026-09-05";
const get = (suffix = window, who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + suffix)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (body: unknown, who: Who = "head") =>
  request(app.getHttpServer())
    .post(base + "/reviews")
    .set("Authorization", `Bearer ${ids[who]}`)
    .send(body as object);
const input = (f: { key: string; measuredAt: string }) => ({
  key: f.key,
  measuredAt: f.measuredAt,
  decision: "INVESTIGATE",
  reason: "TEST inspect sensor and confirm operating context.",
  technicianId: ids.tech,
});
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "anomaly-test-" + randomUUID(),
        name: "TEST statistical fixture",
      },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "anomaly-other-" + randomUUID(), name: "TEST other" },
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
        orgId: who === "outsider" ? other : orgId,
        role: roles[who],
      },
    });
    if (["tech", "operator"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
      });
    if (who === "admin")
      await db.membershipRoleGrant.create({
        data: { orgId, membershipId: m.id, role: Role.MAINTENANCE_HEAD },
      });
  }
  const batch = await db.readingImport.create({
    data: {
      orgId,
      machineId,
      filename: "TEST synthetic.xlsx",
      workbookHash: "a".repeat(64),
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
        local = localTime(measuredAt),
        hour = Number(local.slice(11, 13));
      return {
        id: randomUUID(),
        orgId,
        machineId,
        importId: batch.id,
        sourceId: "TEST-" + i,
        sourceRow: i + 2,
        measuredAt,
        receivedAt: new Date(),
        localMeasuredAt: local,
        demoShift: hour < 8 ? "A" : hour < 16 ? "B" : "C",
        hotTempC: i < 24 ? 200 : i % 4 === 0 ? 220 : 200,
        coldTempC: 45,
        pressureBar: 100,
        rawCells: { ignoredFlag: "not a detector input" },
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
let flags: {
  key: string;
  measuredAt: string;
  baseline: unknown[];
  samples: unknown[];
  review: unknown;
  parameter: string;
  kind: string;
}[] = [];
test("patterns enforce authentication, all six reads, selected-role authority and scope", async () => {
  await request(app.getHttpServer()).get(base).expect(401);
  for (const who of [
    "head",
    "tech",
    "operator",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const r = await get(window, who).expect(200);
    assert.equal(r.body.canReview, who === "head");
    assert(r.body.total > 0);
    assert.equal(r.body.source, "SYNTHETIC");
  }
  await get(window, "outsider").expect(404);
  await get(window, "noGrant").expect(404);
  for (const q of [
    "?from=2026-09-01",
    "?from=2026-09-31&to=2026-09-31",
    "?from=2026-01-01&to=2026-12-31",
    "?orgId=forged",
    "?source=AUTHENTIC",
    "?parameter=label",
    "?kind=FAULT",
  ])
    await get(q).expect(400);
  const r = await get().expect(200);
  flags = r.body.items;
  assert.equal(r.body.observations, 120);
  assert.equal(r.body.eligible.SUDDEN_CHANGE, 96);
  assert.equal(flags[0].baseline.length, 24);
  assert(!JSON.stringify(flags).includes("ignoredFlag"));
  for (const who of [
    "tech",
    "operator",
    "supervisor",
    "management",
    "admin",
  ] as Who[])
    await post(input(flags[0]), who).expect(403);
  await post(input(flags[0]), "outsider").expect(404);
  assert.equal(await db.anomalyReview.count({ where: { orgId } }), 0);
});
test("flag fingerprints are stable across date windows; filtering, markers and paging are complete", async () => {
  const first = (await get().expect(200)).body;
  const seen = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const r = (await get(window + "&after=" + cursor).expect(200)).body;
    seen.push(...r.items);
    cursor = r.nextCursor;
  }
  assert.equal(seen.length, first.total);
  assert.equal(new Set(seen.map((f) => f.key)).size, first.total);
  flags = seen;
  const narrow = (await get("?from=2026-09-05&to=2026-09-05").expect(200)).body;
  for (const f of narrow.items) assert(seen.some((s) => s.key === f.key));
  const filtered = (
    await get(
      window + "&kind=SUDDEN_CHANGE&parameter=hotTempC&status=PENDING",
    ).expect(200)
  ).body;
  assert(
    filtered.items.every(
      (f: { kind: string; parameter: string; review: null }) =>
        f.kind === "SUDDEN_CHANGE" &&
        f.parameter === "hotTempC" &&
        f.review === null,
    ),
  );
  assert.equal(filtered.markers.length, filtered.matching);
  await get(window + "&after=" + "f".repeat(64)).expect(409);
});
test("review retries and concurrent decisions retain one immutable evidence snapshot and audit", async () => {
  const body = input(flags[0]);
  const same = await Promise.all([post(body), post(body)]);
  assert.deepEqual(
    same.map((r) => r.status),
    [201, 201],
  );
  assert.equal(same[0].body.id, same[1].body.id);
  const id = same[0].body.id;
  const saved = await db.anomalyReview.findUniqueOrThrow({ where: { id } });
  assert.equal(saved.actorRole, "MAINTENANCE_HEAD");
  assert.equal((saved.evidence as { key: string }).key, body.key);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: id, action: "ANOMALY_REVIEWED" },
    }),
    1,
  );
  await post({
    key: body.key,
    measuredAt: body.measuredAt,
    decision: "DISMISSED",
    reason: "TEST different decision",
  }).expect(409);
  const race = await Promise.all([
    post(input(flags[1])),
    post({
      key: flags[1].key,
      measuredAt: flags[1].measuredAt,
      decision: "DISMISSED",
      reason: "TEST inspect sensor and confirm operating context.",
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  const history = (await get("/reviews").expect(200)).body;
  assert.equal(history.items.length, 2);
  assert.equal(
    history.items.find((r: { id: string }) => r.id === id).evidence.key,
    body.key,
  );
  assert.equal(
    await db.workOrder.count({
      where: {
        orgId,
        kind: "INVESTIGATION",
        anomalyReview: { decision: "INVESTIGATE" },
      },
    }),
    await db.anomalyReview.count({ where: { orgId, decision: "INVESTIGATE" } }),
  );
  await assert.rejects(
    runtime.anomalyReview.update({
      where: { id },
      data: { reason: "TEST forged" },
    }),
  );
  await assert.rejects(runtime.anomalyReview.delete({ where: { id } }));
  await assert.rejects(
    db.anomalyReview.update({
      where: { id },
      data: { reason: "TEST owner update blocked by trigger" },
    }),
  );
});
test("forged, shifted, unavailable and extra review inputs fail without inserting decisions", async () => {
  await post({ ...input(flags[2]), reason: " " }).expect(400);
  await post({ ...input(flags[2]), orgId }).expect(400);
  await post({ ...input(flags[2]), evidence: { forged: true } }).expect(400);
  await post({ ...input(flags[2]), key: "0".repeat(64) }).expect(409);
  await post({
    ...input(flags[2]),
    measuredAt: new Date(Date.parse(flags[2].measuredAt) - 1000).toISOString(),
  }).expect(409);
  await post({ ...input(flags[2]), measuredAt: "2099-01-01T00:00:00Z" }).expect(
    400,
  );
});
test("audit failure rolls back review and retry succeeds; active grant revocation is enforced", async () => {
  const fn = "anomaly_audit_" + orgId.replace(/-/g, "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='ANOMALY_REVIEWED') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await post(input(flags[3])).expect(503);
    assert.equal(
      await db.anomalyReview.count({ where: { orgId, key: flags[3].key } }),
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await post(input(flags[3])).expect(201);
  const selected = await post(input(flags[4]), "admin")
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .expect(201);
  assert.equal(selected.body.actorRole, "MAINTENANCE_HEAD");
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  await db.membershipRoleGrant.updateMany({
    where: { membershipId: m.id, role: "MAINTENANCE_HEAD" },
    data: { active: false },
  });
  await post(input(flags[5]), "admin")
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .expect(403);
  await db.machineAccess.deleteMany({
    where: { orgId, membership: { userId: ids.tech } },
  });
  await get(window, "tech").expect(404);
  const techMembership = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: techMembership.id },
  });
});
test("reviewed status and history pages preserve all decisions and reject foreign cursors", async () => {
  for (const f of flags.slice(6, 30)) await post(input(f)).expect(201);
  const reviewed = (await get(window + "&status=REVIEWED").expect(200)).body;
  assert.equal(reviewed.reviewed, 28);
  assert.equal(reviewed.matching, 28);
  assert(reviewed.items.every((f: { review: unknown }) => f.review));
  const first = (await get("/reviews").expect(200)).body;
  assert.equal(first.items.length, 25);
  assert(first.nextCursor);
  const next = (await get("/reviews?after=" + first.nextCursor).expect(200))
    .body;
  assert.equal(next.items.length, 3);
  assert.equal(next.nextCursor, null);
  await get("/reviews?after=" + randomUUID()).expect(404);
  await get("/reviews", "outsider").expect(404);
});
