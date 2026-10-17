import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { readingFixture } from "./readings-fixtures";
const ownerUrl = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !ownerUrl ||
  !runtimeUrl ||
  !new URL(ownerUrl).pathname.endsWith("_test") ||
  new URL(ownerUrl).pathname !== new URL(runtimeUrl).pathname
)
  throw new Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } }),
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
let app: INestApplication, orgId: string, machineId: string;
const ids = {
  admin: randomUUID(),
  operator: randomUUID(),
  management: randomUUID(),
  outsider: randomUUID(),
  unassigned: randomUUID(),
};
const base = "/api/machines/WH-C/readings";
const post = (path: string, who: keyof typeof ids = "admin") =>
  request(app.getHttpServer())
    .post(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const get = (path: string, who: keyof typeof ids = "admin") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
async function preview(
  options: Parameters<typeof readingFixture>[0] = {},
  filename = "synthetic.xlsx",
) {
  return (
    await post("/previews")
      .attach("file", await readingFixture(options), filename)
      .expect(201)
  ).body;
}
before(async () => {
  const org = await db.organization.create({
    data: { slug: "readings-tests-" + randomUUID(), name: "Readings fixture" },
  });
  orgId = org.id;
  const machine = await db.machine.create({
    data: {
      orgId,
      code: "WH-C",
      name: "Synthetic fixture",
      manufacturer: "Test",
    },
  });
  machineId = machine.id;
  const other = await db.organization.create({
    data: { slug: "readings-other-" + randomUUID(), name: "Other fixture" },
  });
  for (const [key, id] of Object.entries(ids)) {
    await db.appUser.create({ data: { id, displayName: key } });
    const member = await db.membership.create({
      data: {
        userId: id,
        orgId: key === "outsider" ? other.id : orgId,
        role:
          key === "operator" || key === "unassigned"
            ? Role.OPERATOR
            : key === "management"
              ? Role.MANAGEMENT
              : Role.ADMINISTRATOR,
      },
    });
    if (key === "operator")
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
        if (!Object.values(ids).some((id) => id === token))
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
test("reading endpoints enforce identity, import roles, org and machine grants", async () => {
  await request(app.getHttpServer())
    .get(base + "/trends")
    .expect(401);
  for (const who of ["operator", "management"] as const)
    await post("/previews", who)
      .attach("file", await readingFixture(), "synthetic.xlsx")
      .expect(403);
  await post("/previews", "outsider")
    .attach("file", await readingFixture(), "synthetic.xlsx")
    .expect(404);
  await get("/trends", "unassigned").expect(404);
  await post("/previews")
    .attach("file", Buffer.alloc(8 * 1024 * 1024 + 1), "oversize.xlsx")
    .expect(413);
});
let first: string;
test("preview retains raw values/errors but does not affect readings or production", async () => {
  const p = await preview({ prefix: true, invalid: true });
  first = p.id;
  assert.equal(
    p.rows.filter((r: { eligible: boolean }) => r.eligible).length,
    3,
  );
  assert.equal(await db.processReading.count({ where: { orgId } }), 0);
  assert.equal(await db.productionDay.count({ where: { orgId } }), 0);
  await get("/previews/" + first, "outsider").expect(404);
  await get("/previews/" + first, "operator").expect(403);
  await assert.rejects(
    runtime.readingImport.update({
      where: { id: first },
      data: { staged: { forged: true } },
    }),
  );
  for (const body of [
    { acknowledgeWarnings: false },
    { acknowledgeWarnings: true, hotTempC: 999 },
  ])
    await post(`/previews/${first}/commit`).send(body).expect(400);
});
test("same-preview concurrent retries append once and retain distinct UTC measurement/receipt times", async () => {
  const results = await Promise.all([
    post(`/previews/${first}/commit`).send({ acknowledgeWarnings: true }),
    post(`/previews/${first}/commit`).send({ acknowledgeWarnings: true }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results.filter((r) => r.body.alreadyCommitted).length, 1);
  assert.equal(await db.processReading.count({ where: { orgId } }), 3);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: first, action: "READINGS_COMMITTED" },
    }),
    1,
  );
  const row = await db.processReading.findFirstOrThrow({
    where: { orgId, sourceId: "TEST-0" },
  });
  assert.equal(row.measuredAt.toISOString(), "2026-08-31T18:30:00.000Z");
  assert(row.receivedAt > row.measuredAt);
  assert.equal(
    row.rawCells && JSON.stringify(row.rawCells).includes("230"),
    true,
  );
  await assert.rejects(
    runtime.processReading.update({
      where: { id: row.id },
      data: { hotTempC: 200 },
    }),
  );
  await assert.rejects(
    runtime.processReading.delete({ where: { id: row.id } }),
  );
});
test("renamed uploads exclude stored IDs/times, trends expose gaps and reject foreign scope/window edits", async () => {
  const p = await preview({}, "renamed.xlsx");
  assert.equal(
    p.rows.filter((r: { alreadyImported: boolean }) => r.alreadyImported)
      .length,
    3,
  );
  assert.equal(
    p.rows.filter((r: { eligible: boolean }) => r.eligible).length,
    1,
  );
  const t = (
    await get("/trends?from=2026-09-01&to=2026-09-01", "operator").expect(200)
  ).body;
  assert.equal(t.observations, 3);
  assert.equal(t.missingHours, 21);
  assert.equal(t.points[2].hotTempC, null);
  assert.equal(t.statistics[0].reviewCount, 2);
  assert.equal(t.reviews[0].kind, "CONSECUTIVE");
  assert.equal(t.reviews[1].kind, "ISOLATED");
  assert.equal(t.source, "SYNTHETIC");
  assert.equal(t.rows[0].filename, "synthetic.xlsx");
  for (const query of [
    "from=bad&to=bad",
    "from=2026-09-01",
    "from=2026-10-01&to=2026-09-01",
    "from=2026-01-01&to=2026-12-31",
    "orgId=forged",
    "source=AUTHENTIC",
  ])
    await get("/trends?" + query).expect(400);
});
test("racing separate previews reject one commit atomically, even when file names differ", async () => {
  const a = await preview({ month: "2026-10" }),
    b = await preview({ month: "2026-10" }, "changed-name.xlsx");
  // The fixture IDs intentionally match September: IDs cannot be reused for new measurements.
  assert.equal(
    a.rows.filter((r: { eligible: boolean }) => r.eligible).length,
    1,
  );
  const results = await Promise.all([
    post(`/previews/${a.id}/commit`).send({ acknowledgeWarnings: true }),
    post(`/previews/${b.id}/commit`).send({ acknowledgeWarnings: true }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.processReading.count({
      where: { orgId, measuredAt: { gte: new Date("2026-09-30T18:30Z") } },
    }),
    1,
  );
});
test("audit failure rolls back readings and import state, and expired previews fail", async () => {
  // Use another organization-scoped fixture with unused IDs for an eligible preview.
  const bytes = await readingFixture({ month: "2026-11" });
  const ExcelJS = (await import("exceljs")).default;
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(bytes as unknown as Parameters<typeof w.xlsx.load>[0]);
  for (let i = 2; i <= 5; i++)
    w.getWorksheet("Hourly_Readings")!.getCell("A" + i).value = "NOV-" + i;
  const p = (
    await post("/previews")
      .attach(
        "file",
        Buffer.from(await w.xlsx.writeBuffer()),
        "nov-synthetic.xlsx",
      )
      .expect(201)
  ).body;
  const fn = "reading_audit_" + orgId.replace(/-/g, "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='READINGS_COMMITTED') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await post(`/previews/${p.id}/commit`)
      .send({ acknowledgeWarnings: true })
      .expect(503);
    assert.equal(
      await db.processReading.count({ where: { importId: p.id } }),
      0,
    );
    assert.equal(
      (await db.readingImport.findUniqueOrThrow({ where: { id: p.id } }))
        .status,
      "PREVIEW",
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await db.readingImport.update({
    where: { id: p.id },
    data: { expiresAt: new Date(0) },
  });
  await post(`/previews/${p.id}/commit`)
    .send({ acknowledgeWarnings: true })
    .expect(410);
});
