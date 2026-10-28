// All identities, machine data and fault injection are confined to *_test.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { productionTemplate, readingsTemplate } from "../imports/templates";
import { whbProductionFixture } from "./whb-production-fixture";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  admin: Role.ADMINISTRATOR,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  management: Role.MANAGEMENT,
  foreign: Role.ADMINISTRATOR,
  noGrant: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
let app: INestApplication,
  orgId: string,
  firstId: string,
  secondId: string,
  productionId: string,
  readingId: string;
const first = "PACK-01",
  second = "PRESS-02";
const http = (
  method: "get" | "post",
  code: string,
  suffix: string,
  who: Who = "admin",
) =>
  request(app.getHttpServer())
    [method](`/api/machines/${code}${suffix}`)
    .set("Authorization", `Bearer ${ids[who]}`);
const binary = (
  res: any,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (b: Buffer) => chunks.push(b));
  res.on("end", () => done(null, Buffer.concat(chunks)));
  res.on("error", (e: Error) => done(e, Buffer.alloc(0)));
};
async function workbook(bytes: Buffer) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(bytes as never);
  return w;
}
async function production(code: string) {
  const w = await workbook(await productionTemplate(code, "2026-09"));
  const s = w.getWorksheet("SEP-2026")!;
  s.getRow(8).values = [
    "2026-09-01",
    "A",
    "TEST standard job one",
    100,
    1,
    2,
    150,
    3,
    "TEST source remarks",
  ];
  s.getRow(9).values = [null, "A", "TEST standard job two", 50, 0, 1];
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function readings(code: string) {
  const w = await workbook(await readingsTemplate(code));
  w.getWorksheet("Hourly_Readings")!.addRow([
    "TEST-SAME-ID",
    code,
    "2026-09-01T00:00:00",
    "A",
    200,
    45,
    100,
    "SYNTHETIC",
    999,
    999,
    999,
  ]);
  return Buffer.from(await w.xlsx.writeBuffer());
}
const previewProduction = (
  code: string,
  bytes: Buffer,
  source = "AUTHENTIC",
  who: Who = "admin",
) =>
  http("post", code, "/production/previews", who)
    .field("sheet", "SEP-2026")
    .field("source", source)
    .attach("file", bytes, { filename: "TEST-standard.xlsx" });
const commitProduction = (code: string, id: string) =>
  http("post", code, `/production/previews/${id}/commit`).send({
    dayKeys: ["row-8"],
    acknowledgeWarnings: true,
  });
const previewReadings = (code: string, bytes: Buffer, who: Who = "admin") =>
  http("post", code, "/readings/previews", who).attach("file", bytes, {
    filename: "TEST-synthetic-readings.xlsx",
  });
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "machine-imports-" + randomUUID(),
        name: "TEST standard imports",
      },
    })
  ).id;
  const foreign = (
    await db.organization.create({
      data: {
        slug: "machine-imports-foreign-" + randomUUID(),
        name: "TEST foreign",
      },
    })
  ).id;
  for (const [code, org] of [
    [first, orgId],
    [second, orgId],
    ["WHB", orgId],
    [first, foreign],
  ]) {
    const m = await db.machine.create({
      data: { code, orgId: org, name: "TEST machine" },
    });
    if (org === orgId) {
      if (code === first) firstId = m.id;
      else if (code === second) secondId = m.id;
    }
  }
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "foreign" ? foreign : orgId,
        role: roles[who],
      },
    });
    if (who === "operator" || who === "tech")
      await db.machineAccess.create({
        data: { orgId, machineId: firstId, membershipId: m.id },
      });
  }
  const config = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: runtime,
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
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  await db.$disconnect();
});
test("both data workspaces return scoped empty data for any registered machine under all six roles", async () => {
  for (const who of [
    "admin",
    "head",
    "supervisor",
    "operator",
    "tech",
    "management",
  ] as Who[]) {
    const p = (
      await http(
        "get",
        first,
        "/production/dashboard?source=AUTHENTIC&from=2026-09-01&to=2026-09-30",
        who,
      ).expect(200)
    ).body;
    assert.equal(p.hasData, false);
    const r = (
      await http(
        "get",
        first,
        "/readings/trends?from=2026-09-01&to=2026-09-02",
        who,
      ).expect(200)
    ).body;
    assert.equal(r.hasData, false);
  }
  for (const suffix of ["/production/dashboard", "/readings/trends"]) {
    await http("get", first, suffix, "noGrant").expect(404);
    await http("get", second, suffix, "tech").expect(404);
  }
});
test("empty machine-specific templates enforce import roles and create no imports/observations", async () => {
  for (const who of ["admin", "head", "supervisor"] as Who[]) {
    for (const type of ["production", "readings"]) {
      const res = await http(
        "get",
        first,
        `/${type}/template${type === "production" ? "?month=2026-09" : ""}`,
        who,
      )
        .buffer(true)
        .parse(binary)
        .expect(200);
      assert.match(res.headers["content-type"], /spreadsheetml/);
      assert.match(res.headers["content-disposition"], /PACK-01/);
      const w = await workbook(res.body);
      if (type === "production")
        assert.equal(
          w.getWorksheet("SEP-2026")!.getCell("A1").text,
          "PACK-01 production records",
        );
      else assert.equal(w.getWorksheet("Guide")!.getCell("B5").value, first);
    }
  }
  for (const who of ["operator", "tech", "management"] as Who[])
    for (const type of ["production", "readings"])
      await http("get", first, `/${type}/template`, who).expect(403);
  await http("get", first, "/production/template?month=2026-13").expect(400);
  await http("get", first, "/production/template?orgId=forged").expect(400);
  await http("get", first, "/readings/template", "noGrant").expect(403);
  for (const type of ["production", "readings"]) {
    const denied = await http(
      "get",
      "MISSING-MACHINE",
      `/${type}/template`,
      "head",
    ).expect(404);
    assert.match(denied.headers["content-type"], /application\/json/);
    assert.equal(denied.headers["content-disposition"], undefined);
  }
  assert.equal(await db.productionImport.count({ where: { orgId } }), 0);
  assert.equal(await db.readingImport.count({ where: { orgId } }), 0);
});
test("standard production previews/commits retain job grain, controls, cells and retry idempotency per machine", async () => {
  const p = (
    await previewProduction(first, await production(first)).expect(201)
  ).body;
  productionId = p.id;
  assert.equal(p.days[0].rows.length, 2);
  assert.equal(p.days[0].controlProductionKg, 150);
  assert.equal(p.days[0].rows[0].rawCells.G8, 150);
  const saved = (await commitProduction(first, p.id).expect(201)).body;
  assert.equal(saved.alreadyCommitted, false);
  assert.equal(
    (await commitProduction(first, p.id).expect(201)).body.alreadyCommitted,
    true,
  );
  const rows = await db.productionDay.findMany({
    where: { orgId, machineId: firstId },
    include: { rows: true },
  });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].productionKg), 150);
  assert.equal(Number(rows[0].scrapKg), 3);
  assert.equal(rows[0].rows.length, 2);
  await http("get", second, `/production/previews/${p.id}`).expect(404);
  await commitProduction(second, p.id).expect(404);
  await http("get", first, `/production/previews/${p.id}`, "foreign").expect(
    404,
  );
});
test("reviewed WHB workbook persists its parser, original AT/AS cells and safe retry without crossing machines", async () => {
  const bytes = await whbProductionFixture();
  const inspected = (
    await http("post", "WHB", "/production/inspect")
      .attach("file", bytes, "TEST-WHB.xlsx")
      .expect(201)
  ).body;
  assert(inspected.sheets[0].supported);
  const p = (
    await previewProduction("WHB", bytes, "SYNTHETIC", "head").expect(201)
  ).body;
  assert.equal(p.parserVersion, "whb-monthly-production-v1");
  assert(p.days[0].eligible);
  const blocked = (
    await previewProduction(
      "WHB",
      await whbProductionFixture((s) => {
        s.getCell("AD8").value = null;
        s.getCell("AD10").value = 3;
      }),
      "SYNTHETIC",
      "head",
    ).expect(201)
  ).body;
  assert.equal(blocked.days[0].eligible, false);
  assert(
    blocked.days[0].problems.some(
      (p: { code: string }) => p.code === "INVALID_SHIFT",
    ),
  );
  assert.equal(blocked.days[0].rows[2].rawCells.AD10, 3);
  await commitProduction("WHB", blocked.id).expect(400);
  assert.equal(
    await db.productionDay.count({ where: { importId: blocked.id } }),
    0,
  );
  await commitProduction("WHB", p.id).expect(201);
  assert.equal(
    (await commitProduction("WHB", p.id).expect(201)).body.alreadyCommitted,
    true,
  );
  const saved = await db.productionImport.findUniqueOrThrow({
    where: { id: p.id },
  });
  assert.equal(saved.parserVersion, "whb-monthly-production-v1");
  const day = await db.productionDay.findFirstOrThrow({
    where: { importId: p.id },
    include: { rows: true },
  });
  assert.equal(day.rows.length, 2);
  assert.equal(Number(day.controlScrapKg), 3);
  const row = day.rows.find((r) => r.sourceRow === 8)!;
  assert.equal(row.remarks, "TEST original remarks");
  assert.equal(
    (row.downtime as Record<string, number>)["AS: no planning"],
    0.5,
  );
  assert.equal(
    (row.rawCells as Record<string, unknown>).AT8,
    "TEST original remarks",
  );
  await commitProduction(first, p.id).expect(404);
  await previewProduction(first, bytes, "SYNTHETIC").expect(400);
  await previewProduction("WHB", bytes, "SYNTHETIC", "operator").expect(403);
  await http("get", "WHB", `/production/previews/${p.id}`, "foreign").expect(
    404,
  );
  const duplicate = (
    await previewProduction("WHB", bytes, "SYNTHETIC").expect(201)
  ).body;
  assert(duplicate.days[0].alreadyImported);
  assert.equal(duplicate.days[0].eligible, false);
});
test("wrong-machine files cannot be reassigned and identical dates stay separate across machines/provenance", async () => {
  const bytes = await production(first);
  const inspect = (
    await http("post", second, "/production/inspect")
      .attach("file", bytes, "TEST-standard.xlsx")
      .expect(201)
  ).body;
  assert.equal(inspect.sheets[0].supported, false);
  await previewProduction(second, bytes).expect(400);
  const secondPreview = (
    await previewProduction(second, await production(second)).expect(201)
  ).body;
  await commitProduction(second, secondPreview.id).expect(201);
  const synthetic = (
    await previewProduction(first, bytes, "SYNTHETIC").expect(201)
  ).body;
  await commitProduction(first, synthetic.id).expect(201);
  assert.equal(
    await db.productionDay.count({ where: { orgId, machineId: firstId } }),
    2,
  );
  assert.equal(
    await db.productionDay.count({ where: { orgId, machineId: secondId } }),
    1,
  );
  const p = (
    await http(
      "get",
      first,
      "/production/dashboard?source=AUTHENTIC&from=2026-09-01&to=2026-09-30",
      "foreign",
    ).expect(200)
  ).body;
  assert.equal(p.hasData, false);
});
test("standard synthetic readings save under the selected machine and preserve separate measurement/receipt times", async () => {
  const preview = (
    await previewReadings(first, await readings(first)).expect(201)
  ).body;
  readingId = preview.id;
  assert(preview.rows[0].eligible);
  assert.equal(preview.rows[0].rawCells.I2.value, 999);
  const save = (
    await http("post", first, `/readings/previews/${preview.id}/commit`)
      .send({ acknowledgeWarnings: true })
      .expect(201)
  ).body;
  assert.equal(save.importedReadings, 1);
  assert.equal(
    (
      await http("post", first, `/readings/previews/${preview.id}/commit`)
        .send({ acknowledgeWarnings: true })
        .expect(201)
    ).body.alreadyCommitted,
    true,
  );
  const row = await db.processReading.findFirstOrThrow({
    where: { orgId, machineId: firstId },
  });
  assert.equal(row.measuredAt.toISOString(), "2026-08-31T18:30:00.000Z");
  assert(row.receivedAt > row.measuredAt);
  assert.equal(Number(row.hotTempC), 200);
  const trends = (
    await http(
      "get",
      first,
      "/readings/trends?from=2026-09-01&to=2026-09-02",
      "tech",
    ).expect(200)
  ).body;
  assert.equal(trends.observations, 1);
  assert.equal(trends.reviewObservations, 0);
  await http("get", second, `/readings/previews/${preview.id}`).expect(404);
  await http("post", second, `/readings/previews/${preview.id}/commit`)
    .send({ acknowledgeWarnings: true })
    .expect(404);
});
test("process templates reject another machine's Guide/rows and same source IDs stay machine-specific", async () => {
  await previewReadings(second, await readings(first)).expect(400);
  const p = (await previewReadings(second, await readings(second)).expect(201))
    .body;
  await http("post", second, `/readings/previews/${p.id}/commit`)
    .send({ acknowledgeWarnings: true })
    .expect(201);
  assert.equal(
    await db.processReading.count({
      where: { orgId, sourceId: "TEST-SAME-ID" },
    }),
    2,
  );
  const wrong = await workbook(await readings(second));
  wrong.getWorksheet("Hourly_Readings")!.getCell("B2").value = first;
  const excluded = (
    await previewReadings(
      second,
      Buffer.from(await wrong.xlsx.writeBuffer()),
    ).expect(201)
  ).body;
  assert.equal(excluded.rows[0].eligible, false);
});
test("revoked machine grants deny both workspaces and existing preview bytes without weakening import authority", async () => {
  const tech = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.deleteMany({
    where: { orgId, machineId: firstId, membershipId: tech.id },
  });
  await http("get", first, "/production/dashboard", "tech").expect(404);
  await http("get", first, "/readings/trends", "tech").expect(404);
  await previewProduction(
    first,
    await production(first),
    "AUTHENTIC",
    "operator",
  ).expect(403);
  await previewReadings(first, await readings(first), "operator").expect(403);
  await http(
    "get",
    first,
    `/production/previews/${productionId}`,
    "foreign",
  ).expect(404);
  await http("get", first, `/readings/previews/${readingId}`, "foreign").expect(
    404,
  );
});
