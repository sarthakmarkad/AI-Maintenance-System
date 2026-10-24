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
const pdf = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);
const base = "/api/machines/WH-C/documents";
let app: INestApplication, orgId: string, machineId: string;
const get = (path: string, who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const post = (path: string, who: Who = "admin") =>
  request(app.getHttpServer())
    .post(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const upload = (
  d: any = null,
  who: Who = "admin",
  key = randomUUID(),
  description = "TEST synthetic reference draft",
  bytes = pdf,
  filename = "TEST reference.pdf",
) =>
  post(d ? `/${d.id}/versions` : "", who)
    .field("requestId", key)
    .field("version", String(d?.version ?? 0))
    .field("title", d?.title ?? "TEST synthetic manual")
    .field("kind", d?.kind ?? "MANUAL")
    .field("description", description)
    .attach("file", bytes, { filename, contentType: "application/pdf" });
const detail = async (id: string, who: Who = "head") =>
  (await get("/" + id, who).expect(200)).body;
const create = async () => detail((await upload().expect(201)).body.documentId);
const act = (
  d: any,
  action = "approve",
  who: Who = "head",
  key = randomUUID(),
  fileId = d.files[0].id,
  reason = "TEST human reference review",
) =>
  post(`/${d.id}/actions/${action}`, who).send({
    requestId: key,
    version: d.version,
    fileId,
    reason,
  });
const download = (d: any, f: any = d.files[0], who: Who = "head") =>
  get(`/${d.id}/versions/${f.id}/download?version=${d.version}`, who);
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "documents-" + randomUUID(),
        name: "TEST document library",
      },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "documents-other-" + randomUUID(), name: "TEST other" },
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

test("only head/admin manage drafts; all six scoped roles see/download only current approval", async () => {
  const d = await create();
  assert.equal(d.files[0].status, "DRAFT");
  assert.equal(
    d.files[0].sha256,
    createHash("sha256").update(pdf).digest("hex"),
  );
  assert(!("content" in d.files[0]));
  for (const who of ["operator", "tech", "supervisor", "management"] as Who[]) {
    await upload(null, who).expect(403);
    await get("/" + d.id, who).expect(404);
    await download(d, d.files[0], who).expect(404);
    assert(
      !(await get("", who).expect(200)).body.items.some(
        (x: any) => x.id === d.id,
      ),
    );
  }
  await act(d, "approve", "admin").expect(403);
  await act(d, "approve", "supervisor").expect(403);
  await act(d).expect(200);
  const approved = await detail(d.id);
  for (const who of [
    "operator",
    "tech",
    "head",
    "supervisor",
    "management",
    "admin",
  ] as Who[]) {
    const view = await detail(d.id, who);
    assert.equal(view.files[0].status, "CURRENT");
    const r = await download(approved, approved.files[0], who).expect(200);
    assert.deepEqual(r.body, pdf);
    assert.equal(r.headers["content-type"], "application/octet-stream");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.match(r.headers["content-disposition"], /^attachment;/);
    assert.match(r.headers["content-security-policy"], /sandbox/);
  }
  await get("/" + d.id, "outsider").expect(404);
  await download(approved, approved.files[0], "outsider").expect(404);
  await download(approved, approved.files[0], "noGrant").expect(404);
  await request(app.getHttpServer()).get(base).expect(401);
  assert.equal(approved.events[0].actorRole, "ADMINISTRATOR");
  assert.equal(approved.events[1].actorRole, "MAINTENANCE_HEAD");
});

test("revisions never remove current approval; immutable history, hidden drafts, supersession and reasoned withdrawal", async () => {
  let d = await create();
  await act(d).expect(200);
  d = await detail(d.id);
  const original = d.files[0];
  await upload(d).expect(201);
  let next = await detail(d.id);
  assert.equal(next.currentFileId, original.id);
  assert.equal(next.files[0].status, "DRAFT");
  let reader = await detail(d.id, "operator");
  assert.equal(reader.files.length, 1);
  assert.equal(reader.files[0].id, original.id);
  assert(reader.events.every((e: any) => e.fileId === original.id));
  await download(next, next.files[0], "operator").expect(404);
  await download(d, original, "operator").expect(409);
  await act(next).expect(200);
  d = await detail(d.id);
  assert.equal(d.files[1].status, "SUPERSEDED");
  reader = await detail(d.id, "management");
  assert.equal(reader.files.length, 1);
  assert.equal(reader.files[0].id, d.files[0].id);
  await download(d, original, "management").expect(404);
  await download(d, original, "admin").expect(200);
  await act(d, "approve", "head", randomUUID(), original.id).expect(409);
  await act(d, "withdraw", "admin").expect(403);
  await act(d, "withdraw", "head", randomUUID(), d.files[0].id, "").expect(400);
  await act(
    d,
    "withdraw",
    "head",
    randomUUID(),
    d.files[0].id,
    "TEST replaced external instruction",
  ).expect(200);
  next = await detail(d.id);
  assert.equal(next.currentFileId, null);
  assert.equal(next.files[0].status, "WITHDRAWN");
  assert.equal(next.files[1].status, "SUPERSEDED");
  await get("/" + d.id, "operator").expect(404);
  await act(next).expect(409);
  assert.equal(next.events.length, 5);
  assert.deepEqual(
    (await download(next, original, "admin").expect(200)).body,
    pdf,
  );
  const audits = await db.auditEvent.findMany({
    where: { orgId, entityId: d.id },
    orderBy: { at: "asc" },
  });
  assert.equal(audits.length, 5);
  assert(audits.some((a) => a.action === "MACHINE_DOCUMENT_WITHDRAW"));
});

test("concurrent creation/action retries are idempotent; changed reuse/stale decisions conflict", async () => {
  const key = randomUUID();
  const saved = await Promise.all([
    upload(null, "admin", key),
    upload(null, "admin", key),
  ]);
  assert.deepEqual(
    saved.map((r) => r.status),
    [201, 201],
  );
  assert.equal(saved.filter((r) => r.body.alreadyApplied).length, 1);
  assert.equal(saved[0].body.documentId, saved[1].body.documentId);
  const d = await detail(saved[0].body.documentId);
  await upload(null, "admin", key, "TEST changed payload").expect(409);
  const actionKey = randomUUID(),
    race = await Promise.all([
      act(d, "approve", "head", actionKey),
      act(d, "approve", "head", actionKey),
    ]);
  assert.deepEqual(
    race.map((r) => r.status),
    [200, 200],
  );
  assert.equal(race.filter((r) => r.body.alreadyApplied).length, 1);
  await act(
    d,
    "approve",
    "head",
    actionKey,
    d.files[0].id,
    "TEST changed reason",
  ).expect(409);
  await act(d).expect(409);
  let next = await detail(d.id);
  await upload(next).expect(201);
  next = await detail(d.id);
  const secondRace = await Promise.all([act(next), act(next)]);
  assert.deepEqual(secondRace.map((r) => r.status).sort(), [200, 409]);
  const retry = await act(d, "approve", "head", actionKey).expect(200);
  assert.equal(retry.body.revision, 2);
  assert.equal((await detail(d.id)).version, 4);
});

test("upload-versus-approval and competing draft approvals use one expected version", async () => {
  let d = await create();
  const race = await Promise.all([upload(d), act(d)]);
  assert.equal(race.filter((r) => [200, 201].includes(r.status)).length, 1);
  assert(race.some((r) => r.status === 409));
  d = await create();
  await upload(d).expect(201);
  d = await detail(d.id);
  const results = await Promise.all([
    act(d, "approve", "head", randomUUID(), d.files[0].id),
    act(d, "approve", "head", randomUUID(), d.files[1].id),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const after = await detail(d.id);
  assert.equal(
    after.files.filter((f: any) => f.status === "CURRENT").length,
    1,
  );
  assert.equal(after.version, 3);
});

test("file and metadata policies fail without writing files/events; machine and document composite scope is enforced", async () => {
  const d = await create();
  await upload(
    d,
    "admin",
    randomUUID(),
    "TEST spoof",
    Buffer.from("<html>fake</html>"),
  ).expect(400);
  await upload(d, "admin", randomUUID(), "TEST empty", Buffer.alloc(0)).expect(
    400,
  );
  await upload(
    d,
    "admin",
    randomUUID(),
    "TEST large",
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ).expect(413);
  await upload(
    d,
    "admin",
    randomUUID(),
    "TEST wrong extension",
    pdf,
    "reference.html",
  ).expect(400);
  await post(`/${d.id}/versions`)
    .field("requestId", randomUUID())
    .field("version", d.version)
    .field("title", d.title)
    .field("kind", "MANUAL")
    .field("description", "TEST draft")
    .field("orgId", orgId)
    .attach("file", pdf, "ref.pdf")
    .expect(400);
  const other = await create();
  await get(
    `/${other.id}/versions/${d.files[0].id}/download?version=${other.version}`,
  ).expect(404);
  await act(other, "approve", "head", randomUUID(), d.files[0].id).expect(404);
  const before = await detail(d.id);
  assert.equal(before.version, 1);
  assert.equal(before.files.length, 1);
  assert.equal(before.events.length, 1);
  await request(app.getHttpServer())
    .get("/api/machines/WH-B/documents")
    .set("Authorization", `Bearer ${ids.head}`)
    .expect(404);
  await assert.rejects(
    db.machineDocumentFile.create({
      data: {
        orgId,
        machineId: randomUUID(),
        documentId: d.id,
        number: 2,
        filename: "TEST.pdf",
        description: "TEST invalid composite scope",
        content: pdf,
        byteSize: pdf.length,
        sha256: createHash("sha256").update(pdf).digest("hex"),
      },
    }),
  );
});

test("audit failure rolls approval/upload/withdrawal back without losing original current approval", async () => {
  let d = await create();
  await act(d).expect(200);
  d = await detail(d.id);
  const original = d.currentFileId;
  const fn = "document_fail_" + orgId.replaceAll("-", "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action LIKE 'MACHINE_DOCUMENT_%') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await upload(d).expect(503);
    await act(d, "withdraw").expect(503);
    const still = await detail(d.id);
    assert.equal(still.version, d.version);
    assert.equal(still.currentFileId, original);
    assert.equal(still.files.length, 1);
    assert.equal(still.events.length, 2);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await upload(d).expect(201);
  d = await detail(d.id);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${fn} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW WHEN (NEW."orgId"='${orgId}'::uuid AND NEW.action='MACHINE_DOCUMENT_APPROVE') EXECUTE FUNCTION maintenance.${fn}()`,
  );
  try {
    await act(d).expect(503);
    const still = await detail(d.id);
    assert.equal(still.version, d.version);
    assert.equal(still.currentFileId, original);
    assert.equal(still.files[0].status, "DRAFT");
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${fn} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${fn}()`);
  }
  await act(d).expect(200);
});

test("database runtime grants and immutable evidence guards reject edits, deletes and evidence-free version advances", async () => {
  const d = await create(),
    f = d.files[0],
    e = d.events[0];
  for (const client of [db, runtime]) {
    await assert.rejects(
      client.machineDocumentFile.update({
        where: { id: f.id },
        data: { description: "Changed" },
      }),
    );
    await assert.rejects(
      client.machineDocumentFile.delete({ where: { id: f.id } }),
    );
    await assert.rejects(
      client.machineDocumentEvent.update({
        where: { id: e.id },
        data: { reason: "Changed" },
      }),
    );
    await assert.rejects(
      client.machineDocumentEvent.delete({ where: { id: e.id } }),
    );
    await assert.rejects(
      client.machineDocument.update({
        where: { id: d.id },
        data: { title: "Changed" },
      }),
    );
    await assert.rejects(
      client.machineDocument.delete({ where: { id: d.id } }),
    );
    await assert.rejects(
      client.machineDocument.update({
        where: { id: d.id },
        data: { version: 2 },
      }),
    );
  }
  assert.equal((await detail(d.id)).version, 1);
});

test("trusted active role grants and access revocations apply to metadata, actions and bytes", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  await db.membershipRoleGrant.create({
    data: { orgId, membershipId: member.id, role: Role.MAINTENANCE_HEAD },
  });
  let d = await create();
  await act(d, "approve", "admin").expect(403);
  await act(d, "approve", "admin")
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .expect(200);
  d = await detail(d.id);
  assert.equal(d.events[1].actorRole, "MAINTENANCE_HEAD");
  assert.equal(d.events[1].actorId, ids.admin);
  await db.membershipRoleGrant.update({
    where: {
      membershipId_role: {
        membershipId: member.id,
        role: Role.MAINTENANCE_HEAD,
      },
    },
    data: { active: false },
  });
  await act(d, "withdraw", "admin")
    .set("X-Workspace-Role", "MAINTENANCE_HEAD")
    .expect(403);
  await get("/" + d.id, "admin")
    .set("X-Workspace-Role", "MANAGEMENT")
    .expect(403);
  const tech = await db.membership.findUniqueOrThrow({
    where: { userId: ids.tech },
  });
  await db.machineAccess.deleteMany({ where: { membershipId: tech.id } });
  try {
    await get("/" + d.id, "tech").expect(404);
    await download(d, d.files[0], "tech").expect(404);
  } finally {
    await db.machineAccess.create({
      data: { orgId, machineId, membershipId: tech.id },
    });
  }
  await db.membership.update({
    where: { id: member.id },
    data: { active: false },
  });
  try {
    await get("/" + d.id, "admin").expect(403);
    await download(d, d.files[0], "admin").expect(403);
  } finally {
    await db.membership.update({
      where: { id: member.id },
      data: { active: true },
    });
  }
});

test("browse filters paginate visible references without leaking draft metadata to readers", async () => {
  let d = await create();
  await act(d).expect(200);
  d = await detail(d.id);
  await upload(d).expect(201);
  const admin = (await get("?q=synthetic&kind=MANUAL&status=DRAFT").expect(200))
    .body;
  assert(admin.items.some((x: any) => x.id === d.id));
  assert.equal(admin.pageSize, 20);
  const reader = (
    await get("?q=synthetic&status=DRAFT", "operator").expect(200)
  ).body;
  assert.equal(reader.total, 0);
  await get("?page=11").expect(400);
  await get("?orgId=forged").expect(400);
});

test("100 immutable file versions cap is enforced without disturbing original approval", async () => {
  let d = await create();
  await act(d).expect(200);
  d = await detail(d.id);
  const original = d.currentFileId;
  for (let i = 1; i < 100; i++) {
    await upload(d, "admin", randomUUID(), "TEST bounded revision " + i).expect(
      201,
    );
    d = await detail(d.id);
  }
  assert.equal(d.files.length, 100);
  assert.equal(new Set(d.files.map((f: any) => f.number)).size, 100);
  await upload(d).expect(409);
  const still = await detail(d.id);
  assert.equal(still.version, d.version);
  assert.equal(still.currentFileId, original);
});

test("pagination counts only role-visible matching references and never truncates the second page", async () => {
  const title = "TEST page " + randomUUID();
  for (let i = 0; i < 21; i++)
    await post("")
      .field("requestId", randomUUID())
      .field("version", "0")
      .field("title", title + " " + String(i).padStart(2, "0"))
      .field("kind", "SOP")
      .field("description", "TEST pagination fixture only")
      .attach("file", pdf, {
        filename: "TEST page.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
  const q = "?q=" + encodeURIComponent(title) + "&kind=SOP";
  const first = (await get(q).expect(200)).body,
    second = (await get(q + "&page=2").expect(200)).body;
  assert.equal(first.total, 21);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 1);
  assert(!first.items.some((d: any) => d.id === second.items[0].id));
  const reader = (await get(q, "operator").expect(200)).body;
  assert.equal(reader.total, 0);
  assert.equal(reader.items.length, 0);
});
