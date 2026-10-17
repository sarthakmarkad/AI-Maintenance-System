import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { productionFixture } from "./production-fixtures";
const ownerUrl = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !ownerUrl ||
  !runtimeUrl ||
  !new URL(ownerUrl).pathname.endsWith("_test") ||
  new URL(runtimeUrl).pathname !== new URL(ownerUrl).pathname
)
  throw new Error("Use isolated owner/runtime *_test database URLs.");
const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const ids: Record<string, string> = {
  admin: randomUUID(),
  head: randomUUID(),
  supervisor: randomUUID(),
  operator: randomUUID(),
  technician: randomUUID(),
  management: randomUUID(),
  outsider: randomUUID(),
  unassigned: randomUUID(),
};
let app: INestApplication;
let orgId: string, machineId: string;
let fixture: Buffer;
let previewId: string;
const base = "/api/machines/WH-C/production";
const get = (path: string, who = "admin") =>
  request(app.getHttpServer())
    .get(path)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (path: string, who = "admin") =>
  request(app.getHttpServer())
    .post(path)
    .set("Authorization", `Bearer ${ids[who]}`);
async function preview(
  buffer = fixture,
  month = "SEP-2026",
  filename = "synthetic-production.xlsx",
  source = "SYNTHETIC",
) {
  const response = await post(base + "/previews")
    .field("sheet", month)
    .field("source", source)
    .attach("file", buffer, filename)
    .expect(201);
  return response.body;
}
before(async () => {
  const org = await db.organization.create({
    data: {
      slug: "production-tests-" + randomUUID(),
      name: "Production integration fixture",
    },
  });
  orgId = org.id;
  const machine = await db.machine.create({
    data: {
      orgId,
      code: "WH-C",
      name: "Synthetic test machine",
      manufacturer: "Test fixture",
    },
  });
  machineId = machine.id;
  const other = await db.organization.create({
    data: {
      slug: "production-other-" + randomUUID(),
      name: "Other fixture organization",
    },
  });
  const roles: Record<string, Role> = {
    admin: Role.ADMINISTRATOR,
    head: Role.MAINTENANCE_HEAD,
    supervisor: Role.SUPERVISOR,
    operator: Role.OPERATOR,
    technician: Role.TECHNICIAN,
    management: Role.MANAGEMENT,
    outsider: Role.ADMINISTRATOR,
    unassigned: Role.OPERATOR,
  };
  for (const [key, id] of Object.entries(ids)) {
    await db.appUser.create({ data: { id, displayName: "Fixture " + key } });
    const member = await db.membership.create({
      data: {
        userId: id,
        orgId: key === "outsider" ? other.id : orgId,
        role: roles[key],
      },
    });
    if (key === "operator" || key === "technician")
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: member.id },
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
  fixture = await productionFixture();
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});
test("authentication, role and machine scope protect imports and stored previews", async () => {
  await request(app.getHttpServer())
    .post(base + "/inspect")
    .expect(401);
  for (const who of ["operator", "technician", "management"])
    await post(base + "/inspect", who)
      .set("x-role", "ADMINISTRATOR")
      .attach("file", fixture, "synthetic-production.xlsx")
      .expect(403);
  for (const who of ["admin", "head", "supervisor"])
    await post(base + "/inspect", who)
      .attach("file", fixture, "synthetic-production.xlsx")
      .expect(201);
  await post(base + "/inspect", "outsider")
    .attach("file", fixture, "synthetic-production.xlsx")
    .expect(404);
  await get(base + "/dashboard", "unassigned").expect(404);
  await post(base + "/inspect")
    .attach("file", Buffer.alloc(8 * 1024 * 1024 + 1), "oversize.xlsx")
    .expect(413);
});
test("preview persists provenance and errors without adding production totals", async () => {
  const response = await preview();
  previewId = response.id;
  assert.equal(
    response.days.filter((day: { eligible: boolean }) => day.eligible).length,
    2,
  );
  assert.equal(response.days[1].rawDate, "08-0-2026");
  assert.equal(await db.productionDay.count({ where: { orgId } }), 0);
  const original = await get(base + "/previews/" + previewId).expect(200);
  assert.equal(
    original.body.days[0].rows[0].description,
    "SYNTHETIC job one, original description",
  );
  assert.deepEqual(original.body.days[0].rows[0].rawCells.D8, {
    formula: "50+50",
    result: 100,
  });
  await get(base + "/previews/" + previewId, "outsider").expect(404);
  await get(base + "/previews/" + previewId, "operator").expect(403);
  await assert.rejects(
    runtime.productionImport.update({
      where: { id: previewId },
      data: { staged: { forged: true } },
    }),
  );
});
test("invalid selections, edited payloads and missing acknowledgements are rejected atomically", async () => {
  for (const body of [
    { dayKeys: ["row-12"], acknowledgeWarnings: true },
    { dayKeys: ["row-8"], acknowledgeWarnings: false },
    { dayKeys: ["row-8", "row-8"], acknowledgeWarnings: true },
    { dayKeys: ["row-8"], acknowledgeWarnings: true, productionKg: 999 },
  ])
    await post(base + "/previews/" + previewId + "/commit")
      .send(body)
      .expect(400);
  assert.equal(await db.productionDay.count({ where: { orgId } }), 0);
  await post(base + "/previews/" + previewId + "/commit")
    .set("Content-Type", "application/json")
    .send("{broken")
    .expect(400);
});
test("concurrent same-preview commits are idempotent and preserve job grain, audit and decimal totals", async () => {
  const body = { dayKeys: ["row-8", "row-14"], acknowledgeWarnings: true };
  const results = await Promise.all([
    post(base + "/previews/" + previewId + "/commit").send(body),
    post(base + "/previews/" + previewId + "/commit").send(body),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results.filter((r) => r.body.alreadyCommitted).length, 1);
  assert.equal(results[0].body.productionKg, 280);
  assert.equal(results[0].body.scrapKg, 12);
  assert.equal(results[0].body.jobRows, 4);
  assert.equal(await db.productionDay.count({ where: { orgId } }), 2);
  assert.equal(await db.productionRow.count({ where: { orgId } }), 5);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: previewId, action: "PRODUCTION_COMMITTED" },
    }),
    1,
  );
  const row = await db.productionRow.findFirstOrThrow({
    where: { orgId, sourceRow: 14 },
  });
  assert.equal(row.kind, "ACTIVITY");
  assert.equal(row.productionKg, null);
  assert.equal(row.downtimeUnit, "UNCONFIRMED");
  await post(base + "/previews/" + previewId + "/commit")
    .send({ dayKeys: ["row-8"], acknowledgeWarnings: true })
    .expect(409);
});
test("renamed-file retries do not duplicate dates, and persisted charts keep sources and missing dates separate", async () => {
  const repeated = await preview(fixture, "SEP-2026", "renamed-synthetic.xlsx");
  assert.equal(
    repeated.days.filter(
      (day: { alreadyImported: boolean }) => day.alreadyImported,
    ).length,
    2,
  );
  assert(repeated.days.every((day: { eligible: boolean }) => !day.eligible));
  await post(base + "/previews/" + repeated.id + "/commit")
    .send({ dayKeys: ["row-8"], acknowledgeWarnings: true })
    .expect(400);
  const synthetic = await get(
    base + "/dashboard?source=SYNTHETIC",
    "operator",
  ).expect(200);
  assert.equal(synthetic.body.productionKg, 280);
  assert.equal(synthetic.body.jobRows, 4);
  assert.equal(synthetic.body.importedDays, 2);
  assert.equal(synthetic.body.daily[1].productionKg, null);
  assert.equal(synthetic.body.daily.length, 30);
  assert.equal(synthetic.body.imports[0].sheet, "SEP-2026");
  const authentic = await get(base + "/dashboard?source=AUTHENTIC").expect(200);
  assert.equal(authentic.body.hasData, false);
  assert.equal(authentic.body.productionKg, 0);
  await get(base + "/dashboard?from=2026-09-01&to=2026-09-01&source=SYNTHETIC")
    .expect(200)
    .then((r) => assert.equal(r.body.productionKg, 200));
  for (const query of [
    "from=bad&to=bad",
    "source=UNKNOWN",
    "orgId=another",
    "from=2026-10-01&to=2026-09-01",
    "from=2024-01-01&to=2026-01-01",
  ])
    await get(base + "/dashboard?" + query).expect(400);
});
test("racing separate previews for the same date add one set of records and reject the other", async () => {
  const buffer = await productionFixture({ month: "2026-10" });
  const a = await preview(buffer, "OCT-2026"),
    b = await preview(buffer, "OCT-2026");
  const responses = await Promise.all([
    post(base + "/previews/" + a.id + "/commit").send({
      dayKeys: ["row-8"],
      acknowledgeWarnings: true,
    }),
    post(base + "/previews/" + b.id + "/commit").send({
      dayKeys: ["row-8"],
      acknowledgeWarnings: true,
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.productionDay.count({
      where: { orgId, date: new Date("2026-10-01T00:00:00Z") },
    }),
    1,
  );
});
test("audit failure rolls back all production records and leaves the preview uncommitted", async () => {
  const data = await preview(
    await productionFixture({ month: "2026-11" }),
    "NOV-2026",
  );
  const suffix = orgId.replace(/-/g, "");
  const fn = "reject_commit_" + suffix;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='PRODUCTION_COMMITTED') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await post(base + "/previews/" + data.id + "/commit")
      .send({ dayKeys: ["row-8"], acknowledgeWarnings: true })
      .expect(503);
    assert.equal(
      await db.productionDay.count({ where: { orgId, importId: data.id } }),
      0,
    );
    assert.equal(
      (await db.productionImport.findUniqueOrThrow({ where: { id: data.id } }))
        .status,
      "PREVIEW",
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
});
test("expired previews cannot commit and table constraints prevent invalid production values", async () => {
  const data = await preview(
    await productionFixture({ month: "2026-12" }),
    "DEC-2026",
  );
  await db.productionImport.update({
    where: { id: data.id },
    data: { expiresAt: new Date(0) },
  });
  await post(base + "/previews/" + data.id + "/commit")
    .send({ dayKeys: ["row-8"], acknowledgeWarnings: true })
    .expect(410);
  const day = await db.productionDay.findFirstOrThrow({ where: { orgId } });
  await assert.rejects(
    db.productionDay.update({
      where: { id: day.id },
      data: { productionKg: -1 },
    }),
  );
  await assert.rejects(
    runtime.productionDay.update({
      where: { id: day.id },
      data: { productionKg: 100 },
    }),
  );
});
