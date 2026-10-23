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
import ExcelJS from "exceljs";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { CalendarService } from "../calendar/service";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname
)
  throw Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  noGrant: Role.TECHNICIAN,
  inactive: Role.MAINTENANCE_HEAD,
  outsider: Role.MAINTENANCE_HEAD,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
const base = "/api/machines/WH-C/reports",
  range = "from=2026-09-01&to=2026-09-01&kind=BREAKDOWN",
  epoch = Date.parse("2026-08-31T18:30:00Z"),
  at = (h: number) => new Date(epoch + h * 3600000);
let app: INestApplication,
  orgId: string,
  machineId: string,
  reported: any,
  started: any,
  oldClosed: any,
  investigation: any,
  planId: string,
  calendar: CalendarService;
const get = (path: string, who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const postWork = (path: string, who: Who = "operator") =>
  request(app.getHttpServer())
    .post("/api/machines/WH-C/work-orders" + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const binary = (res: any, done: (err: Error | null, data: any) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on("end", () => done(null, Buffer.concat(chunks)));
  res.on("error", done);
};
const download = (path: string, who: Who = "head") =>
  get(path, who).buffer(true).parse(binary);
async function workbook(bytes: Buffer) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(bytes as any);
  return b;
}
async function seed(
  kind: WorkOrderKind,
  status: WorkOrderStatus,
  when: Date,
  extra: Partial<Prisma.WorkOrderUncheckedCreateInput> = {},
) {
  const h = (n: number) => new Date(when.getTime() + n * 3600000),
    isStarted = [
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
          policyVersion: "TEST-SYNTHETIC",
          measuredAt: h(-24),
          decision: "INVESTIGATE",
          reason: "TEST inspect pressure-device readings",
          reviewedBy: ids.head,
          actorRole: "MAINTENANCE_HEAD",
          createdAt: new Date(when.getTime() - 1000),
          evidence: {
            key,
            policyVersion: "TEST-SYNTHETIC",
            parameter: "pressureBar",
            value: 123,
            source: "SYNTHETIC",
          },
        },
      })
    ).id;
  }
  return db.workOrder.create({
    data: {
      orgId,
      machineId,
      requestId: randomUUID(),
      reportFingerprint: "f".repeat(64),
      title: "TEST " + kind,
      description: "Synthetic report fixture only; not a company incident.",
      kind,
      status,
      impact: "OBSERVATION",
      reportedAt: when,
      reportedBy: ids.operator,
      updatedAt: h(10),
      technicianId: status === "REPORTED" ? null : ids.tech,
      startedAt: isStarted ? h(1) : null,
      submittedAt: submitted ? h(4) : null,
      reviewedAt: reviewed ? h(6) : null,
      reviewedBy: reviewed ? ids.head : null,
      closedAt: status === "CLOSED" ? h(8) : null,
      closedBy: status === "CLOSED" ? ids.supervisor : null,
      findings: submitted ? "TEST findings" : null,
      correctiveAction: submitted ? "TEST checks performed" : null,
      preventiveAction: submitted ? "TEST next steps" : null,
      rootCause: submitted && kind === "BREAKDOWN" ? "TEST human RCA" : null,
      restoredAt: submitted && kind === "BREAKDOWN" ? h(3) : null,
      performedAt: submitted && kind !== "BREAKDOWN" ? h(3) : null,
      investigationOutcome:
        submitted && kind === "INVESTIGATION" ? "INCONCLUSIVE" : null,
      anomalyReviewId,
      ...extra,
    },
  });
}
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "reports-" + randomUUID(),
        name: "TEST reports organization",
      },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: {
        slug: "reports-other-" + randomUUID(),
        name: "TEST other organization",
      },
    })
  ).id;
  machineId = (
    await db.machine.create({
      data: {
        orgId,
        code: "WH-C",
        name: "TEST report machine",
        manufacturer: "Fixture",
      },
    })
  ).id;
  await db.machine.create({
    data: {
      orgId: other,
      code: "WH-C",
      name: "TEST foreign machine",
      manufacturer: "Fixture",
    },
  });
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "outsider" ? other : orgId,
        role: roles[who],
        active: who !== "inactive",
      },
    });
    if (["operator", "tech", "tech2", "admin"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
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
  calendar = app.get(CalendarService);
  reported = await seed("BREAKDOWN", "REPORTED", at(0), {
    title: '=HYPERLINK("https://example.invalid","TEST")',
  });
  started = await seed("BREAKDOWN", "IN_PROGRESS", at(1));
  oldClosed = await seed("BREAKDOWN", "CLOSED", at(-24), {
    closedAt: at(5),
    updatedAt: at(6),
  });
  await seed("BREAKDOWN", "REPORTED", at(24));
  investigation = await seed("INVESTIGATION", "AWAITING_REVIEW", at(2));
  await seed("INVESTIGATION", "CLOSED", at(3), {
    investigationOutcome: "NO_FAULT_FOUND",
  });
  planId = (
    await db.maintenancePlan.create({
      data: {
        orgId,
        machineId,
        requestId: randomUUID(),
        fingerprint: "e".repeat(64),
        title: "TEST fixed daily plan",
        instructions: "TEST inspect pressure device",
        frequency: "DAILY",
        interval: 1,
        firstDueAt: at(5),
        technicianId: ids.tech,
        createdBy: ids.head,
        active: false,
        pauseReason: "TEST paused after generation",
        nextSequence: 5,
        createdAt: at(-24),
        updatedAt: at(-24),
      },
    })
  ).id;
  for (let i = 0; i < 5; i++) {
    const occurrence = await db.maintenanceOccurrence.create({
      data: {
        orgId,
        machineId,
        planId,
        sequence: i,
        dueAt: at(5 + i * 24),
        remindAt: at(-67 + i * 24),
        title: "TEST daily pressure check " + i,
        instructions: "TEST fixed instructions",
        technicianId: ids.tech,
        priority: "NORMAL",
        createdAt: at(-24),
        ...(i === 2
          ? {
              skippedAt: at(54),
              skippedBy: ids.head,
              skipReason: "TEST authorized skip",
              version: 2,
            }
          : {}),
      },
    });
    if (i === 1)
      await seed("PLANNED", "CLOSED", at(2), {
        occurrenceId: occurrence.id,
        closedAt: at(31),
        updatedAt: at(32),
      });
    if (i === 3)
      await seed("PLANNED", "ASSIGNED", at(2), {
        occurrenceId: occurrence.id,
        technicianId: ids.tech2,
      });
  }
});
after(async () => {
  if (app) await app.close();
  await db.$disconnect();
});

test("all six roles export within trusted scope; no forged role, organization or machine access expands it", async () => {
  await request(app.getHttpServer())
    .get(base + "/preview?" + range)
    .expect(401);
  for (const who of [
    "operator",
    "tech",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const p = (await get("/preview?" + range, who).expect(200)).body;
    assert.equal(p.total, 2);
    assert.equal(p.organization, "TEST reports organization");
    const r = await download(
      "/export?" + range + "&format=pdf&fingerprint=" + p.fingerprint,
      who,
    ).expect(200);
    assert.equal(r.body.subarray(0, 4).toString(), "%PDF");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.match(r.headers["content-disposition"], /^attachment;/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  }
  await get("/preview?" + range, "noGrant").expect(404);
  await get("/preview?" + range, "inactive").expect(403);
  assert.equal(
    (await get("/preview?" + range, "outsider").expect(200)).body.total,
    0,
  );
  await get(
    `/work-orders/${reported.id}/export?format=pdf&version=1`,
    "outsider",
  ).expect(404);
  await get("/preview?" + range, "tech")
    .set("X-Workspace-Role", "ADMINISTRATOR")
    .expect(403);
  for (const extra of [
    "orgId=forged",
    "format=csv",
    "from=2026-02-30",
    "basis=closed&status=OPEN",
  ])
    await get("/preview?" + range + "&" + extra).expect(400);
});

test("created and closed date cohorts use exact IST boundaries, retain old closures and never imply complete history from a register", async () => {
  const p = (await get("/preview?" + range).expect(200)).body;
  assert.deepEqual(
    new Set(p.rows.map((r: any) => r.id)),
    new Set([reported.id, started.id]),
  );
  assert.equal(p.counts.open, 2);
  assert.equal(p.counts.closed, 0);
  const closed = (await get("/preview?" + range + "&basis=closed").expect(200))
    .body;
  assert.deepEqual(
    closed.rows.map((r: any) => r.id),
    [oldClosed.id],
  );
  assert.equal(closed.basis, "Closed date");
  assert.equal(closed.counts.closed, 1);
  const empty = (await get("/preview?" + range + "&status=CLOSED").expect(200))
    .body;
  assert.equal(empty.total, 0);
  const x = await workbook(
      (await download("/export?" + range + "&format=xlsx").expect(200)).body,
    ),
    sheet = x.getWorksheet("Work orders")!;
  const titleColumn = sheet.getRow(1).values as string[];
  assert(titleColumn.includes("Created (UTC)"));
  assert.equal(sheet.getCell("C2").type, ExcelJS.ValueType.String); // newest order, no formula objects
  const values = sheet.getColumn(3).values;
  assert(values.includes(reported.title));
  const info = x.getWorksheet("Report information")!;
  const records = info
    .getRows(1, info.rowCount)!
    .find((row) => row.getCell(1).value === "Records")!;
  assert.equal(records.getCell(2).value, 2);
});

test("preview fingerprint prevents changed records from silently altering downloads", async () => {
  const p = (await get("/preview?" + range).expect(200)).body;
  const refreshed = (await get("/preview?" + range).expect(200)).body;
  assert.equal(p.fingerprint, refreshed.fingerprint);
  await postWork(`/${reported.id}/actions/assign`, "head")
    .send({ version: reported.version, technicianId: ids.tech })
    .expect(200);
  const before = await db.auditEvent.count({
    where: { orgId, action: "REPORT_EXPORTED" },
  });
  await get(
    "/export?" + range + "&format=xlsx&fingerprint=" + p.fingerprint,
  ).expect(409);
  assert.equal(
    await db.auditEvent.count({ where: { orgId, action: "REPORT_EXPORTED" } }),
    before,
  );
  const current = (await get("/preview?" + range).expect(200)).body;
  assert.notEqual(current.fingerprint, p.fingerprint);
  await download(
    "/export?" + range + "&format=xlsx&fingerprint=" + current.fingerprint,
  ).expect(200);
  await get(`/work-orders/${reported.id}/export?format=pdf&version=1`).expect(
    409,
  );
});

test("planned reports retain unreleased, skipped and paused obligations, current reassignment and closure-based completion", async () => {
  const q = "report=planned-maintenance&from=2026-09-01&to=2026-09-04";
  const p = (await get("/preview?" + q).expect(200)).body;
  assert.equal(p.total, 4);
  assert.deepEqual(p.counts, { open: 2, closed: 1, skipped: 1 });
  assert.equal(p.basis, "Due date");
  assert(p.rows.some((r: any) => r.cells[2] === "TEST tech2"));
  assert(p.rows.some((r: any) => r.cells[3] === "Not released"));
  assert(p.rows.some((r: any) => r.cells[3] === "Skipped"));
  assert.equal(
    (await get("/preview?" + q + "&status=OPEN").expect(200)).body.total,
    2,
  );
  assert.equal(
    (await get("/preview?" + q + "&status=CLOSED").expect(200)).body.total,
    1,
  );
  const b = await workbook(
      (await download("/export?" + q + "&format=xlsx").expect(200)).body,
    ),
    ws = b.getWorksheet("Planned tasks")!;
  const headers = ws.getRow(1).values as string[],
    col = (name: string) => headers.indexOf(name);
  const closed = ws.getRow(3);
  assert.equal(closed.getCell(col("Closure timing")).value, "Late");
  assert.equal(closed.getCell(col("Plan currently active")).value, "No");
  calendar.jobFailed = true;
  try {
    const failed = (await get("/preview?" + q).expect(200)).body;
    assert.match(failed.warning, /incomplete or unavailable/);
  } finally {
    calendar.jobFailed = false;
  }
});

test("investigation reports preserve synthetic provenance, raw retained evidence and provisional human outcomes", async () => {
  const q = "report=investigations&from=2026-09-01&to=2026-09-01";
  const p = (await get("/preview?" + q).expect(200)).body;
  assert.equal(p.total, 2);
  assert.match(p.warning, /synthetic/i);
  assert(p.notes.some((n: string) => n.includes("provisional")));
  const b = await workbook(
    (await download("/export?" + q + "&format=xlsx").expect(200)).body,
  );
  assert(b.getWorksheet("Source reviews"));
  const evidence = JSON.parse(
    String(b.getWorksheet("Source reviews")!.getCell("I2").value),
  );
  assert.equal(evidence.value, 123);
  assert.equal(evidence.source, "SYNTHETIC");
  const detail = await download(
    `/work-orders/${investigation.id}/export?format=pdf&version=${investigation.version}`,
  ).expect(200);
  assert.equal(detail.body.subarray(0, 4).toString(), "%PDF");
});

test("individual reports include more than fifty immutable events and the file manifest without attachment bytes", async () => {
  let o = (
    await postWork("")
      .send({
        requestId: randomUUID(),
        title: "TEST complete-history export",
        description: "Synthetic integration fixture only.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await postWork(`/${o.id}/attachments`)
    .field("requestId", randomUUID())
    .field("version", "1")
    .field("description", "TEST report attachment")
    .attach("file", png, "fixture.png")
    .expect(201);
  o = (
    await request(app.getHttpServer())
      .get("/api/machines/WH-C/work-orders/" + o.id)
      .set("Authorization", `Bearer ${ids.head}`)
      .expect(200)
  ).body;
  const act = async (
    action: string,
    who: Who,
    input: Record<string, unknown> = {},
  ) => {
    o = (
      await postWork(`/${o.id}/actions/${action}`, who)
        .send({ version: o.version, ...input })
        .expect(200)
    ).body;
  };
  await act("assign", "head", { technicianId: ids.tech });
  await act("start", "tech");
  for (let i = 0; i < 26; i++) {
    await act("submit", "tech", {
      findings: "TEST retained findings " + i,
      rootCause: "TEST human RCA " + i,
      correctiveAction: "TEST checks performed",
      preventiveAction: "TEST follow-up",
      restoredAt: o.reportedAt,
    });
    await act("return", "head", { reason: "TEST return " + i });
  }
  const r = await download(
      `/work-orders/${o.id}/export?format=xlsx&version=${o.version}`,
    ).expect(200),
    b = await workbook(r.body);
  const history = b.getWorksheet("Action history")!;
  assert.equal(history.rowCount - 1, o.version);
  assert.equal(history.getCell("B2").value, 1);
  assert.equal(history.getRow(history.rowCount).getCell("B").value, o.version);
  assert(
    String(history.getCell("J6").value).includes("TEST retained findings 0"),
  );
  const manifest = b.getWorksheet("Attachments")!;
  assert.equal(manifest.rowCount, 2);
  assert.equal(manifest.getCell("B2").value, "fixture.png");
  assert.equal(manifest.getCell("E2").value, png.length);
  assert.equal(manifest.columnCount, 11);
  assert(!r.body.includes(png));
  await download(
    `/work-orders/${o.id}/export?format=pdf&version=${o.version}`,
  ).expect(200);
});

test("audit failures fail before report bytes are delivered and leave source records intact", async () => {
  const fn = "report_fail_" + orgId.replaceAll("-", ""),
    count = await db.auditEvent.count({
      where: { orgId, action: "REPORT_EXPORTED" },
    }),
    before = await db.workOrder.findUnique({ where: { id: started.id } });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only export audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='REPORT_EXPORTED') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    const response = await get("/export?" + range + "&format=pdf").expect(503);
    assert.match(response.headers["content-type"], /json/);
    assert.equal(
      await db.auditEvent.count({
        where: { orgId, action: "REPORT_EXPORTED" },
      }),
      count,
    );
    assert.deepEqual(
      await db.workOrder.findUnique({ where: { id: started.id } }),
      before,
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
});

test("access is rechecked after rendering and revoked grants or memberships cannot receive report bytes", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  await db.membershipRoleGrant.create({
    data: { orgId, membershipId: member.id, role: Role.TECHNICIAN },
  });
  await get("/preview?" + range, "admin")
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(200);
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: member.id, role: Role.TECHNICIAN },
    },
    data: { active: false },
  });
  await get("/export?" + range + "&format=xlsx", "admin")
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(403);
  const renderers =
      require("../reports/render") as typeof import("../reports/render"),
    original = renderers.renderWorkbook;
  renderers.renderWorkbook = async (s) => {
    const bytes = await original(s);
    await db.membership.update({
      where: { userId: ids.admin },
      data: { active: false },
    });
    return bytes;
  };
  try {
    await get("/export?" + range + "&format=xlsx", "admin").expect(403);
  } finally {
    renderers.renderWorkbook = original;
    await db.membership.update({
      where: { userId: ids.admin },
      data: { active: true },
    });
  }
  const tech = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.deleteMany({ where: { membershipId: tech.id } });
  try {
    await get("/export?" + range + "&format=xlsx", "tech").expect(404);
  } finally {
    await db.machineAccess.create({
      data: { orgId, machineId, membershipId: tech.id },
    });
  }
});

test("preview limit is explicit while exports retain all matching rows; excess reports fail without truncation", async () => {
  const data = Array.from({ length: 501 }, (_, i) => ({
    orgId,
    machineId,
    requestId: randomUUID(),
    reportFingerprint: "a".repeat(64),
    title: "TEST bounded export " + i,
    description: "Synthetic limit fixture only.",
    reportedBy: ids.operator,
    reportedAt: at(48),
    updatedAt: at(48),
    impact: "OBSERVATION" as const,
  }));
  await db.workOrder.createMany({ data: data.slice(0, 55) });
  const q = "from=2026-09-03&to=2026-09-03&kind=BREAKDOWN";
  const p = (await get("/preview?" + q).expect(200)).body;
  assert.equal(p.total, 55);
  assert.equal(p.rows.length, 50);
  assert.equal(p.previewLimit, 50);
  const b = await workbook(
    (
      await download(
        "/export?" + q + "&format=xlsx&fingerprint=" + p.fingerprint,
      ).expect(200)
    ).body,
  );
  assert.equal(b.getWorksheet("Work orders")!.rowCount, 56);
  await db.workOrder.createMany({ data: data.slice(55) });
  await get("/preview?" + q).expect(422);
  await get("/export?" + q + "&format=pdf").expect(422);
});
