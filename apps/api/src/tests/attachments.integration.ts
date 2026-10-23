import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
const owner = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtimeUrl ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtimeUrl).pathname
)
  throw Error("Use isolated *_test databases.");
const db = new PrismaClient({ datasources: { db: { url: owner } } }),
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const roles = {
  operator: Role.OPERATOR,
  operator2: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  tech2: Role.TECHNICIAN,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
  outsider: Role.MAINTENANCE_HEAD,
  noGrant: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const base = "/api/machines/WH-C/work-orders";
let app: INestApplication, orgId: string, machineId: string;
const get = (path: string, who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (path: string, who: Who = "operator") =>
  request(app.getHttpServer())
    .post(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const upload = (
  o: any,
  who: Who = "operator",
  key = randomUUID(),
  description = "TEST inspection photo",
  bytes = png,
  filename = "inspection.png",
) =>
  post(`/${o.id}/attachments`, who)
    .field("requestId", key)
    .field("version", String(o.version))
    .field("description", description)
    .attach("file", bytes, {
      filename,
      contentType: filename.endsWith(".pdf") ? "application/pdf" : "image/png",
    });
const report = async () =>
  (
    await post("")
      .send({
        requestId: randomUUID(),
        title: "TEST attachment fixture",
        description: "Synthetic test only; not a company incident.",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
const act = async (
  o: any,
  action: string,
  who: Who,
  data: Record<string, unknown> = {},
) =>
  (
    await post(`/${o.id}/actions/${action}`, who)
      .send({ version: o.version, ...data })
      .expect(200)
  ).body;
const refresh = async (o: any) => (await get("/" + o.id).expect(200)).body;
const repair = (o: any) => ({
  findings: "TEST inspection completed",
  rootCause: "TEST human finding",
  correctiveAction: "TEST checks performed",
  preventiveAction: "TEST future checks",
  restoredAt: o.reportedAt,
});
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "attachments-" + randomUUID(), name: "TEST attachments" },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "attachments-other-" + randomUUID(), name: "TEST other" },
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
    const m = await db.membership.create({
      data: {
        userId: ids[who],
        orgId: who === "outsider" ? other : orgId,
        role: roles[who],
      },
    });
    if (["operator", "operator2", "tech", "tech2", "admin"].includes(who))
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
});
after(async () => {
  if (app) await app.close();
  await Promise.all([db.$disconnect(), runtime.$disconnect()]);
});

test("private uploads are scoped, immutable and duplicate-safe; all six roles download exact bytes", async () => {
  const o = await report(),
    key = randomUUID();
  const results = await Promise.all([
    upload(o, "operator", key),
    upload(o, "operator", key),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results.filter((r) => r.body.alreadyUploaded).length, 1);
  const a = results[0].body.attachment,
    next = await refresh(o);
  assert.equal(next.version, 2);
  assert.equal(next.attachments.length, 1);
  assert.equal(next.events[0].action, "ATTACH");
  assert.equal(next.canUploadAttachment, false); // head view
  assert.equal(a.sha256, createHash("sha256").update(png).digest("hex"));
  assert.equal(a.orderVersion, 2);
  assert(!("content" in a));
  assert(!("content" in next.attachments[0]));
  await upload(o, "operator", key, "Changed evidence").expect(409);
  for (const who of [
    "operator",
    "tech",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const result = await get(
      `/${o.id}/attachments/${a.id}/download`,
      who,
    ).expect(200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["content-type"], "application/octet-stream");
    assert.match(result.headers["content-disposition"], /^attachment;/);
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(result.body, png);
  }
  await request(app.getHttpServer())
    .get(base + `/${o.id}/attachments/${a.id}/download`)
    .expect(401);
  await get(`/${o.id}/attachments/${a.id}/download`, "outsider").expect(404);
  await get(`/${o.id}/attachments/${a.id}/download`, "noGrant").expect(404);
  const another = await report();
  await get(`/${another.id}/attachments/${a.id}/download`).expect(404);
  for (const who of [
    "operator2",
    "tech",
    "tech2",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[])
    await upload(next, who).expect(403);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, entityId: o.id, action: "WORK_ORDER_ATTACH" },
    }),
    1,
  );
});

test("operator evidence and assigned technician evidence survive return, reassignment, approval and closure; review freezes uploads", async () => {
  let o = await report();
  const first = (await upload(o).expect(201)).body.attachment;
  o = await act(await refresh(o), "assign", "head", { technicianId: ids.tech });
  await upload(o).expect(403);
  await upload({ ...o, version: 1 }).expect(409);
  await upload(o, "tech").expect(403);
  o = await act(o, "start", "tech");
  await upload(o, "tech2").expect(403);
  const key = randomUUID(),
    receipt = (await upload(o, "tech", key).expect(201)).body;
  o = await refresh(o);
  o = await act(o, "submit", "tech", repair(o));
  await upload(o, "tech").expect(403);
  assert.equal(
    (await upload({ ...o, version: 1 }, "tech", key).expect(201)).body
      .alreadyUploaded,
    true,
  );
  o = await act(o, "return", "head", {
    reason: "TEST additional evidence needed",
  });
  await upload(o, "tech").expect(201);
  o = await refresh(o);
  o = await act(o, "assign", "head", {
    technicianId: ids.tech2,
    reason: "TEST handover",
  });
  assert.equal(o.attachments.length, 3);
  assert.equal(o.attachments[0].id, first.id);
  o = await act(o, "start", "tech2");
  await upload(o, "tech").expect(403);
  // Original successful retry remains valid after reassignment, without mutating anything.
  assert.equal(
    (await upload(o, "tech", key).expect(201)).body.attachment.id,
    receipt.attachment.id,
  );
  o = await act(o, "submit", "tech2", repair(o));
  o = await act(o, "approve", "head");
  await upload(o, "tech2").expect(403);
  o = await act(o, "close", "supervisor");
  await upload(o, "operator").expect(403);
  await upload(o, "tech2").expect(403);
  assert.equal(o.attachments.length, 3);
  assert.equal(o.events.filter((e: any) => e.action === "ATTACH").length, 3);
  await get(`/${o.id}/attachments/${first.id}/download`, "management").expect(
    200,
  );
});

test("stale uploads/actions and upload-versus-assignment races never silently omit evidence", async () => {
  let o = await report();
  await upload(o).expect(201);
  await upload(o).expect(409);
  await post(`/${o.id}/actions/assign`, "head")
    .send({ version: o.version, technicianId: ids.tech })
    .expect(409);
  o = await report();
  const race = await Promise.all([
    upload(o),
    post(`/${o.id}/actions/assign`, "head").send({
      version: o.version,
      technicianId: ids.tech,
    }),
  ]);
  assert.equal(race.filter((r) => [200, 201].includes(r.status)).length, 1);
  assert(race.some((r) => [403, 409].includes(r.status)));
  const saved = await refresh(o);
  assert.equal(saved.version, 2);
  assert.equal(saved.events.length, 2);
  let t = await act(await report(), "assign", "head", {
    technicianId: ids.tech,
  });
  t = await act(t, "start", "tech");
  const submitted = await Promise.all([
    upload(t, "tech"),
    post(`/${t.id}/actions/submit`, "tech").send({
      version: t.version,
      ...repair(t),
    }),
  ]);
  assert.equal(
    submitted.filter((r) => [200, 201].includes(r.status)).length,
    1,
  );
  assert(submitted.some((r) => [403, 409].includes(r.status)));
});

test("upload validation rejects spoofed/oversized files and unknown metadata without changing evidence", async () => {
  const o = await report();
  await upload(
    o,
    "operator",
    randomUUID(),
    "TEST spoof",
    Buffer.from("<html>fake</html>"),
  ).expect(400);
  await upload(
    o,
    "operator",
    randomUUID(),
    "TEST empty",
    Buffer.alloc(0),
  ).expect(400);
  await upload(
    o,
    "operator",
    randomUUID(),
    "TEST oversized",
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ).expect(413);
  await post(`/${o.id}/attachments`)
    .field("requestId", randomUUID())
    .field("version", "1")
    .field("description", "TEST file")
    .field("orgId", orgId)
    .attach("file", png, "photo.png")
    .expect(400);
  await post(`/${o.id}/attachments`)
    .field("requestId", randomUUID())
    .field("version", "1")
    .field("description", "TEST missing")
    .expect(400);
  assert.equal((await refresh(o)).version, 1);
  assert.equal(
    await db.workOrderAttachment.count({ where: { orderId: o.id } }),
    0,
  );
});

test("attachment audit failure atomically rolls back bytes, version and event; exact retry can recover", async () => {
  const o = await report(),
    key = randomUUID(),
    fn = "attachment_fail_" + orgId.replaceAll("-", "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='WORK_ORDER_ATTACH') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await upload(o, "operator", key).expect(503);
    const still = await refresh(o);
    assert.equal(still.version, 1);
    assert.equal(still.events.length, 1);
    assert.equal(still.attachments.length, 0);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await upload(o, "operator", key).expect(201);
});

test("database evidence protections reject edits, deletes and evidence-free same-stage version changes", async () => {
  const o = await report(),
    a = (await upload(o).expect(201)).body.attachment;
  await assert.rejects(
    runtime.workOrderAttachment.update({
      where: { id: a.id },
      data: { description: "Changed" },
    }),
  );
  await assert.rejects(
    db.workOrderAttachment.update({
      where: { id: a.id },
      data: { description: "Changed" },
    }),
  );
  await assert.rejects(
    runtime.workOrderAttachment.delete({ where: { id: a.id } }),
  );
  await assert.rejects(db.workOrderAttachment.delete({ where: { id: a.id } }));
  await assert.rejects(
    runtime.workOrder.update({
      where: { id: o.id },
      data: { version: { increment: 1 } },
    }),
  );
  assert.equal((await refresh(o)).version, 2);
});

test("twenty-file limit is serialized and persists across reloads", async () => {
  let o = await report();
  for (let i = 0; i < 19; i++) {
    await upload(o, "operator", randomUUID(), "TEST evidence " + i).expect(201);
    o = await refresh(o);
  }
  const final = await Promise.all([
    upload(o, "operator", randomUUID(), "TEST final photo A"),
    upload(o, "operator", randomUUID(), "TEST final photo B"),
  ]);
  assert.deepEqual(final.map((r) => r.status).sort(), [201, 409]);
  o = await refresh(o);
  assert.equal(o.attachments.length, 20);
  await upload(o).expect(409);
  assert.equal((await refresh(o)).version, 21);
  const view = (await get("/" + o.id, "operator").expect(200)).body;
  assert.equal(view.canUploadAttachment, false);
});

test("trusted pilot role selection and revocation apply to uploads and private downloads", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  await db.membershipRoleGrant.createMany({
    data: [Role.OPERATOR, Role.TECHNICIAN, Role.MAINTENANCE_HEAD].map(
      (role) => ({ orgId, membershipId: member.id, role }),
    ),
  });
  let o = (
    await post("", "admin")
      .set("X-Workspace-Role", "OPERATOR")
      .send({
        requestId: randomUUID(),
        title: "TEST pilot evidence",
        description: "Synthetic fixture only",
        priority: "NORMAL",
        impact: "OBSERVATION",
      })
      .expect(201)
  ).body;
  await upload(o, "admin").expect(403);
  const a = (
    await upload(o, "admin").set("X-Workspace-Role", "OPERATOR").expect(201)
  ).body.attachment;
  assert.equal(a.actorRole, "OPERATOR");
  assert.equal(a.uploader.userId, ids.admin);
  o = await refresh(o);
  o = (
    await post(`/${o.id}/actions/assign`, "admin")
      .set("X-Workspace-Role", "MAINTENANCE_HEAD")
      .send({ version: o.version, technicianId: ids.admin })
      .expect(200)
  ).body;
  o = (
    await post(`/${o.id}/actions/start`, "admin")
      .set("X-Workspace-Role", "TECHNICIAN")
      .send({ version: o.version })
      .expect(200)
  ).body;
  const techEvidence = (
    await upload(o, "admin").set("X-Workspace-Role", "TECHNICIAN").expect(201)
  ).body.attachment;
  assert.equal(techEvidence.actorRole, "TECHNICIAN");
  assert.equal(techEvidence.uploader.userId, ids.admin);
  await upload(await refresh(o), "admin").expect(403);
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: member.id, role: Role.TECHNICIAN },
    },
    data: { active: false },
  });
  await upload(await refresh(o), "admin")
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(403);
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: { membershipId: member.id, role: Role.OPERATOR },
    },
    data: { active: false },
  });
  await upload(await refresh(o), "admin")
    .set("X-Workspace-Role", "OPERATOR")
    .expect(403);
  await get(`/${o.id}/attachments/${a.id}/download`, "admin").expect(200);
  const tech = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.deleteMany({ where: { membershipId: tech.id } });
  try {
    await get(`/${o.id}/attachments/${a.id}/download`, "tech").expect(404);
  } finally {
    await db.machineAccess.create({
      data: { orgId, machineId, membershipId: tech.id },
    });
  }
  await db.membership.update({
    where: { userId: ids.admin },
    data: { active: false },
  });
  await get(`/${o.id}/attachments/${a.id}/download`, "admin").expect(403);
});

test("PDF bytes download intact and safely encode filenames", async () => {
  const o = await report();
  const pdf = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
  const a = (
    await upload(
      o,
      "operator",
      randomUUID(),
      "TEST PDF inspection report",
      pdf,
      "inspection's report.pdf",
    ).expect(201)
  ).body.attachment;
  const result = await get(
    `/${o.id}/attachments/${a.id}/download`,
    "management",
  ).expect(200);
  assert.deepEqual(result.body, pdf);
  assert.match(
    result.headers["content-disposition"],
    /filename\*=UTF-8''inspection%27s%20report.pdf/,
  );
  await upload(
    o,
    "operator",
    randomUUID(),
    "TEST stale PDF",
    pdf,
    "inspection.pdf",
  ).expect(409);
});
