import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { appModule, configure } from "../app";
import { VERIFIER } from "../auth";
import { RAG_AI, type RagAi } from "../rag/provider";
import { DocumentIndexer } from "../rag/indexer";
import { DocumentAiService } from "../rag/service";
import { KEYWORD_PROFILE, type Passage } from "../rag/policy";
import { textPdf } from "./rag-fixture";
import type { Config } from "../config";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).host !== new URL(runtime).host ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Keyword tests require matching isolated test connections");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  admin: Role.ADMINISTRATOR,
  head: Role.MAINTENANCE_HEAD,
  operator: Role.OPERATOR,
  technician: Role.TECHNICIAN,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  outsider: Role.MAINTENANCE_HEAD,
  ungranted: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: runtime,
  DOCUMENT_AI_PROVIDER: "commandcode",
  DOCUMENT_RETRIEVAL_MODE: "keyword",
  DOCUMENT_AI_ENABLED: "true",
  COMMANDCODE_API_KEY: "TEST-answer-provider-no-network",
};
let app: INestApplication,
  orgId: string,
  machineId: string,
  indexer: DocumentIndexer,
  answerCalls = 0,
  embedCalls = 0,
  last: Passage[] = [],
  duringAnswer: (() => Promise<void>) | null = null;
const ai: RagAi = {
  async embed() {
    embedCalls++;
    throw Error("Keyword mode must not embed");
  },
  async converse(q) {
    return /^hi|hello/i.test(q)
      ? {
          mode: "GENERAL",
          reply: "Hello. I can help with approved references.",
        }
      : { mode: "DOCUMENTS", reply: "" };
  },
  async answer(_q, passages) {
    answerCalls++;
    last = passages;
    if (duringAnswer) await duringAnswer();
    return {
      status: "ANSWERED",
      statements: [
        {
          text: passages[0].text.slice(0, 350),
          citations: [
            { sourceId: passages[0].id, quote: passages[0].text.slice(0, 350) },
          ],
        },
      ],
    };
  },
  async verify() {
    return true;
  },
};
const docs = "/api/machines/KEY-01/documents",
  base = "/api/machines/KEY-01/assistant";
const get = (path = "/status", who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const ask = (question: string, who: Who = "head") =>
  request(app.getHttpServer())
    .post(base + "/ask")
    .set("Authorization", `Bearer ${ids[who]}`)
    .send({ question });
async function detail(id: string) {
  return (
    await request(app.getHttpServer())
      .get(`${docs}/${id}`)
      .set("Authorization", `Bearer ${ids.head}`)
      .expect(200)
  ).body;
}
async function action(d: any, action = "approve") {
  await request(app.getHttpServer())
    .post(`${docs}/${d.id}/actions/${action}`)
    .set("Authorization", `Bearer ${ids.head}`)
    .send({
      version: d.version,
      requestId: randomUUID(),
      fileId: action === "withdraw" ? d.currentFileId : d.files[0].id,
      reason: "TEST reference review",
    })
    .expect(200);
}
async function upload(pages: string[], d: any = null) {
  return (
    await request(app.getHttpServer())
      .post(d ? `${docs}/${d.id}/versions` : docs)
      .set("Authorization", `Bearer ${ids.admin}`)
      .field("requestId", randomUUID())
      .field("version", String(d?.version ?? 0))
      .field("title", d?.title ?? "TEST keyword maintenance reference")
      .field("kind", "SOP")
      .field("description", "TEST synthetic reference only")
      .attach("file", await textPdf(pages), {
        filename: "TEST-keyword.pdf",
        contentType: "application/pdf",
      })
      .expect(201)
  ).body;
}
async function ready() {
  for (let i = 0; i < 20; i++) {
    await indexer.runOnce({ orgId, machineId });
    const s = (await get().expect(200)).body;
    if (
      s.items.every(
        (v: any) => v.status !== "QUEUED" && v.status !== "PROCESSING",
      )
    )
      return;
  }
  throw Error("Indexing did not settle");
}
const pressure =
  "TEST training example only. Pressure gauge ZX-73 inspection: inspect the visible indicator from a safe position and record unusual readings. No validated operating limit is supplied.";
const temperature =
  "TEST training example only. Hot temperature sensor inspection: record unusual indications and notify the maintenance head. No validated operating limit is supplied.";
let reference: any;
before(async () => {
  orgId = (
    await db.organization.create({
      data: {
        slug: "keyword-" + randomUUID(),
        name: "TEST keyword organization",
      },
    })
  ).id;
  const foreign = (
    await db.organization.create({
      data: {
        slug: "keyword-foreign-" + randomUUID(),
        name: "TEST foreign organization",
      },
    })
  ).id;
  machineId = (
    await db.machine.create({
      data: {
        orgId,
        code: "KEY-01",
        name: "TEST keyword machine",
        manufacturer: "Fixture",
      },
    })
  ).id;
  await db.machine.create({
    data: {
      orgId: foreign,
      code: "KEY-01",
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
        orgId: who === "outsider" ? foreign : orgId,
        userId: ids[who],
        role: roles[who],
      },
    });
    if (["operator", "technician"].includes(who))
      await db.machineAccess.create({
        data: { orgId, machineId, membershipId: m.id },
      });
  }
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
    .overrideProvider(RAG_AI)
    .useValue(ai)
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  configure(app, config);
  await app.init();
  indexer = app.get(DocumentIndexer);
});
beforeEach(() => {
  (app.get(DocumentAiService) as any).rates.clear();
});
after(async () => {
  await app?.close();
  await db.$disconnect();
});

test("keyword mode persists general chat and indexes page-aware text without any embedding call", async () => {
  const hello = await request(app.getHttpServer())
    .post(base + "/chat")
    .set("Authorization", `Bearer ${ids.operator}`)
    .send({ requestId: randomUUID(), question: "Hello" })
    .expect(200);
  assert.equal(hello.body.turn.answer.status, "GENERAL_ANSWER");
  reference = await upload([pressure, temperature]);
  await action(await detail(reference.documentId));
  await ready();
  const status = (await get().expect(200)).body;
  assert.equal(status.configured, true);
  assert.equal(status.embeddingModel, "not-required");
  assert.equal(status.ready, 1);
  const rows = await db.$queryRaw<
    any[]
  >`SELECT c.page,c.embedding IS NULL AS "textOnly",c."searchEnglish" IS NOT NULL AS searchable FROM maintenance."DocumentRagChunk" c JOIN maintenance."DocumentRagIndex" i ON i.id=c."indexId" WHERE i."fileId"=${reference.fileId}::uuid AND i.profile=${KEYWORD_PROFILE} ORDER BY ordinal`;
  assert.deepEqual(
    rows.map((r) => r.page),
    [1, 2],
  );
  assert(rows.every((r) => r.textOnly && r.searchable));
  assert.equal(embedCalls, 0);
});

test("ranked keyword lookup handles stemming and exact codes; irrelevant queries do not call the answer model", async () => {
  for (const q of ["pressure gauges", "ZX-73", "PRESSURE inspection"]) {
    const result = await ask(q).expect(200);
    assert.equal(result.body.status, "ANSWERED");
    assert.equal(result.body.sources[0].page, 1);
    assert(last.every((p) => p.indexId));
  }
  const before = answerCalls;
  for (const q of ["zygophoton quasars", "orbital zygomorph specifications"]) {
    const r = await ask(q).expect(200);
    assert.equal(r.body.status, "INSUFFICIENT_EVIDENCE");
    assert.deepEqual(r.body.sources, []);
  }
  assert.equal(answerCalls, before);
  assert.equal(embedCalls, 0);
});

test("all six scoped roles retrieve citations while foreign organizations and revoked machine access fail closed", async () => {
  for (const who of [
    "admin",
    "head",
    "operator",
    "technician",
    "supervisor",
    "management",
  ] as Who[]) {
    const r = await ask("pressure gauge", who).expect(200);
    assert.equal(r.body.status, "ANSWERED");
    assert(r.body.sources.every((s: any) => s.fileId === reference.fileId));
  }
  const foreign = await ask("pressure", "outsider").expect(200);
  assert.equal(foreign.body.status, "NO_APPROVED_DOCUMENTS");
  assert.deepEqual(foreign.body.sources, []);
  await ask("pressure", "ungranted").expect(404);
  await request(app.getHttpServer())
    .get(base + "/status")
    .expect(401);
  const membership = await db.membership.findUniqueOrThrow({
    where: { userId: ids.operator },
  });
  await db.machineAccess.deleteMany({
    where: { membershipId: membership.id, machineId },
  });
  try {
    await ask("pressure", "operator").expect(404);
  } finally {
    await db.machineAccess.create({
      data: { orgId, machineId, membershipId: membership.id },
    });
  }
});

test("replacement and withdrawal exclude retained text, including changes during model generation", async () => {
  const oldFile = reference.fileId;
  const next = await upload([temperature], await detail(reference.documentId));
  await action(await detail(reference.documentId));
  const pending = await ask("pressure gauge").expect(200);
  assert.equal(pending.body.status, "INDEXING_REQUIRED");
  await ready();
  const missing = await ask("pressure gauge").expect(200);
  assert.equal(missing.body.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(
    await db.documentRagChunk.count({ where: { fileId: oldFile } }),
    2,
  );
  duringAnswer = async () => {
    duringAnswer = null;
    await action(await detail(reference.documentId), "withdraw");
  };
  try {
    await ask("hot temperature").expect(409);
  } finally {
    duringAnswer = null;
  }
  const gone = await ask("hot temperature").expect(200);
  assert.equal(gone.body.status, "NO_APPROVED_DOCUMENTS");
  assert.equal(embedCalls, 0);
  assert(next.fileId !== oldFile);
});

test("database guards require real vectors for legacy profiles, NULL for keyword chunks, and immutable retained text", async () => {
  const r = await upload([pressure]);
  const file = await db.machineDocumentFile.findUniqueOrThrow({
    where: { id: r.fileId },
  });
  async function claimed(profile: string) {
    return db.documentRagIndex.create({
      data: {
        orgId,
        machineId,
        documentId: r.documentId,
        fileId: r.fileId,
        profile,
        sourceHash: file.sha256,
        status: "PROCESSING",
        leaseId: randomUUID(),
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
  }
  const legacy = await claimed("TEST-vector-guard"),
    keyword = await claimed(KEYWORD_PROFILE);
  const insert = (indexId: string, vector: string | null) =>
    db.$executeRaw`INSERT INTO maintenance."DocumentRagChunk"(id,"orgId","machineId","documentId","fileId","indexId",ordinal,page,text,hash,embedding) VALUES(${randomUUID()}::uuid,${orgId}::uuid,${machineId}::uuid,${r.documentId}::uuid,${r.fileId}::uuid,${indexId}::uuid,0,1,'TEST',encode(sha256(convert_to('TEST','UTF8')),'hex'),${vector}::extensions.vector)`;
  await assert.rejects(
    insert(legacy.id, null),
    /Vector chunks require embeddings/,
  );
  await assert.rejects(
    insert(keyword.id, JSON.stringify([1, ...Array(1535).fill(0)])),
    /Keyword chunks must not contain embeddings/,
  );
  await insert(keyword.id, null);
  await assert.rejects(
    db.$executeRaw`UPDATE maintenance."DocumentRagChunk" SET text='changed' WHERE "indexId"=${keyword.id}::uuid`,
  );
  const originals = await db.$queryRaw<
    any[]
  >`SELECT c.embedding IS NULL AS "textOnly" FROM maintenance."DocumentRagChunk" c WHERE c."indexId"=${keyword.id}::uuid`;
  assert(originals.every((x) => x.textOnly));
});
