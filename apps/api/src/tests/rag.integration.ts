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
import { DocumentAiService } from "../rag/service";
import { DocumentIndexer } from "../rag/indexer";
import { DIMENSIONS, settings, RagError, type Passage } from "../rag/policy";
import { textPdf } from "./rag-fixture";
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Use isolated *_test database");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const roles = {
  head: Role.MAINTENANCE_HEAD,
  admin: Role.ADMINISTRATOR,
  operator: Role.OPERATOR,
  tech: Role.TECHNICIAN,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  outsider: Role.MAINTENANCE_HEAD,
  noGrant: Role.TECHNICIAN,
};
type Who = keyof typeof roles;
const ids = Object.fromEntries(
  Object.keys(roles).map((k) => [k, randomUUID()]),
) as Record<Who, string>;
const config = {
  NODE_ENV: "test" as const,
  HOST: "127.0.0.1",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: runtime,
  OPENAI_API_KEY: "TEST-provider-never-networked",
};
let app: INestApplication,
  orgId: string,
  machineId: string,
  indexer: DocumentIndexer,
  lastHistory: any[] = [],
  lastPassages: Passage[] = [],
  lastQuestion = "",
  embeddingCalls = 0,
  conversationCalls = 0,
  conversationError = false,
  conversationHook: (() => Promise<void>) | null = null,
  conversationHistory: any[] = [],
  embeddingError = "",
  answerHook: (() => Promise<void>) | null = null,
  invalid = false,
  extraInvalidQuote = false,
  verify = true;
const ai: RagAi = {
  async converse(question, history = []) {
    conversationCalls++;
    if (conversationError) throw new RagError("AI_PROVIDER_UNAVAILABLE");
    if (conversationHook) await conversationHook();
    conversationHistory = history;
    if (
      /^(hi+|hello|thanks|hii what question|what is an sop|what is preventive|explain that concept|tell me a joke)/i.test(
        question,
      )
    )
      return {
        mode: "GENERAL",
        reply:
          "Hello! I can discuss general questions, explain concepts, and check approved SOPs or manuals when needed.",
      };
    return { mode: "DOCUMENTS", reply: "" };
  },
  async embed(texts, purpose) {
    if (texts[0]?.startsWith("How should")) assert.equal(purpose, "query");
    embeddingCalls++;
    if (embeddingError) throw new RagError(embeddingError);
    return texts.map(() =>
      Array.from({ length: DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
    );
  },
  async answer(q, sources, history = []) {
    lastHistory = history;
    lastPassages = sources;
    lastQuestion = q;
    if (answerHook) await answerHook();
    const s = sources[0];
    return {
      status: "ANSWERED",
      statements: [
        ...(extraInvalidQuote
          ? [
              {
                text: "The form has header fields.",
                citations: [
                  { sourceId: s.id, quote: "Header fields ... invented quote" },
                ],
              },
            ]
          : []),
        {
          text: invalid
            ? "Use 9999 degrees."
            : "This is a TEST training reference: inspect the visible indicator from a safe position.",
          citations: [{ sourceId: s.id, quote: s.text }],
        },
      ],
    };
  },
  async verify() {
    return verify;
  },
};
const base = "/api/machines/WH-C/assistant",
  docs = "/api/machines/WH-C/documents";
const get = (path = "/status", who: Who = "head") =>
  request(app.getHttpServer())
    .get(base + path)
    .set("Authorization", `Bearer ${ids[who]}`);
const ask = (
  who: Who = "head",
  question = "How should a TEST training indicator be checked?",
) =>
  request(app.getHttpServer())
    .post(base + "/ask")
    .set("Authorization", `Bearer ${ids[who]}`)
    .send({ question });
const text =
  "TEST training reference only, not a verified operating procedure. Inspect the visible indicator from a safe position. No verified temperature limit is supplied.";
async function upload(
  d: any = null,
  content: string | string[] = text,
  title = "TEST training indicator reference",
) {
  return (
    await request(app.getHttpServer())
      .post(d ? `${docs}/${d.id}/versions` : docs)
      .set("Authorization", `Bearer ${ids.admin}`)
      .field("requestId", randomUUID())
      .field("version", String(d?.version ?? 0))
      .field("title", d?.title ?? title)
      .field("kind", "SOP")
      .field("description", "TEST synthetic revision")
      .attach(
        "file",
        await textPdf(Array.isArray(content) ? content : [content]),
        {
          filename: "TEST.pdf",
          contentType: "application/pdf",
        },
      )
      .expect(201)
  ).body;
}
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
      reason: "TEST human reference decision",
    })
    .expect(200);
}
async function ready() {
  for (let i = 0; i < 25; i++) {
    await indexer.runOnce({ orgId, machineId });
    const s = (await get()).body;
    if (
      s.items.every(
        (i: any) => i.status !== "QUEUED" && i.status !== "PROCESSING",
      )
    )
      return;
  }
  throw Error("TEST indexing did not settle");
}
before(async () => {
  orgId = (
    await db.organization.create({
      data: { slug: "rag-" + randomUUID(), name: "TEST document AI" },
    })
  ).id;
  const other = (
    await db.organization.create({
      data: { slug: "rag-other-" + randomUUID(), name: "TEST other" },
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
      name: "TEST other",
      manufacturer: "Fixture",
    },
  });
  for (const who of Object.keys(roles) as Who[]) {
    await db.appUser.create({
      data: { id: ids[who], displayName: "TEST " + who },
    });
    const m = await db.membership.create({
      data: {
        orgId: who === "outsider" ? other : orgId,
        userId: ids[who],
        role: roles[who],
      },
    });
    if (["operator", "tech"].includes(who))
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
  // Isolate per-process model budgets between independent fixture scenarios.
  (app.get(DocumentAiService) as any).rates.clear();
});
after(async () => {
  await app?.close();
  await db.$disconnect();
});
test("all scoped roles can ask; empty corpus never calls provider; wrong machine/grants denied", async () => {
  const n = embeddingCalls;
  for (const who of Object.keys(roles).filter(
    (w) => !["outsider", "noGrant"].includes(w),
  ) as Who[]) {
    assert.equal(
      (await ask(who).expect(200)).body.status,
      "NO_APPROVED_DOCUMENTS",
    );
  }
  assert.equal(embeddingCalls, n);
  await get("/status", "noGrant").expect(404);
  await request(app.getHttpServer())
    .get(base.replace("WH-C", "WH-B") + "/status")
    .set("Authorization", `Bearer ${ids.head}`)
    .expect(404);
  await request(app.getHttpServer())
    .post(base + "/ask")
    .set("Authorization", `Bearer ${ids.head}`)
    .send({ question: "hello", role: "ADMINISTRATOR" })
    .expect(400);
});
test("the reported greeting and capability prompts use general chat with no corpus or embedding lookup", async () => {
  const before = embeddingCalls,
    calls = conversationCalls;
  const a = (await message("hiii", "operator").expect(200)).body;
  const b = (
    await message("hii what question can u anser", "operator", a.chatId).expect(
      200,
    )
  ).body;
  assert.equal(a.turn.answer.status, "GENERAL_ANSWER");
  assert.equal(b.turn.answer.status, "GENERAL_ANSWER");
  assert.deepEqual(b.turn.answer.sources, []);
  assert.deepEqual(b.turn.answer.statements, []);
  assert.equal(embeddingCalls, before);
  assert.equal(conversationCalls, calls + 2);
  assert.equal(conversationHistory[0].question, "hiii");
  assert.equal(conversationHistory[0].mode, "GENERAL");
  const c = (
    await message(
      "According to the SOP, what is the procedure?",
      "operator",
      a.chatId,
    ).expect(200)
  ).body;
  assert.equal(c.turn.answer.status, "NO_APPROVED_DOCUMENTS");
  assert.equal(embeddingCalls, before);
  assert.equal(conversationCalls, calls + 2);
});
test("drafts excluded; approval queues once; concurrent workers produce complete immutable vector index", async () => {
  const receipt = await upload();
  const d = await detail(receipt.documentId);
  assert.equal((await get()).body.approved, 0);
  await action(d);
  const index = await db.documentRagIndex.findFirstOrThrow({
    where: { fileId: receipt.fileId },
  });
  assert.equal(index.status, "QUEUED");
  await Promise.all([
    indexer.runOnce({ orgId, machineId }),
    indexer.runOnce({ orgId, machineId }),
  ]);
  await ready();
  const current = await db.documentRagIndex.findUniqueOrThrow({
    where: { id: index.id },
  });
  assert.equal(current.status, "READY");
  assert.equal(current.chunkCount, 1);
  assert.equal(
    await db.documentRagChunk.count({ where: { indexId: index.id } }),
    1,
  );
  await assert.rejects(
    db.documentRagChunk.updateMany({
      where: { indexId: index.id },
      data: { text: "Changed" },
    }),
    /append-only/,
  );
  for (const who of [
    "operator",
    "tech",
    "supervisor",
    "management",
    "admin",
    "head",
  ] as Who[]) {
    const a = (await ask(who).expect(200)).body;
    assert.equal(a.status, "ANSWERED");
    assert.equal(a.sources[0].page, 1);
    assert.equal(a.sources[0].fileId, receipt.fileId);
    assert(!("similarity" in a.sources[0]));
  }
  assert.equal(
    (await ask("outsider").expect(200)).body.status,
    "NO_APPROVED_DOCUMENTS",
  );
});
test("a newer draft preserves current approval; approved replacement and withdrawal exclude obsolete vectors", async () => {
  const old = (await get()).body.items[0];
  let d = await detail(old.documentId);
  const next = await upload(d);
  assert.equal(
    (await ask("operator").expect(200)).body.sources[0].fileId,
    old.fileId,
  );
  d = await detail(d.id);
  await action(d);
  await ready();
  assert.equal(
    (await ask("operator").expect(200)).body.sources[0].fileId,
    next.fileId,
  );
  await action(await detail(d.id), "withdraw");
  assert.equal(
    (await ask("operator").expect(200)).body.status,
    "NO_APPROVED_DOCUMENTS",
  );
});
test("unsupported answers abstain and source withdrawal during generation discards the answer", async () => {
  const r = await upload();
  await action(await detail(r.documentId));
  await ready();
  invalid = true;
  assert.equal(
    (await ask("tech").expect(200)).body.status,
    "INSUFFICIENT_EVIDENCE",
  );
  invalid = false;
  verify = false;
  assert.equal(
    (await ask("tech").expect(200)).body.status,
    "INSUFFICIENT_EVIDENCE",
  );
  verify = true;
  answerHook = async () => {
    answerHook = null;
    await action(await detail(r.documentId), "withdraw");
  };
  await ask("tech").expect(409);
});
test("failed scanned PDFs show actionable errors; retry is head/admin only and duplicate-safe", async () => {
  const r = await upload(null, " ");
  await action(await detail(r.documentId));
  await ready();
  const s = (await get()).body.items.find((i: any) => i.fileId === r.fileId);
  assert.equal(s.status, "FAILED");
  assert.equal(s.error, "OCR_REQUIRED");
  assert.equal(
    (await ask("management").expect(200)).body.status,
    "INDEXING_REQUIRED",
  );
  const path = `${base}/indexes/${s.indexId}/retry`;
  await request(app.getHttpServer())
    .post(path)
    .set("Authorization", `Bearer ${ids.tech}`)
    .send({})
    .expect(403);
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(app.getHttpServer())
        .post(path)
        .set("Authorization", `Bearer ${ids.admin}`)
        .send({})
        .expect(200),
    ),
  );
  assert.equal(responses.filter((r) => r.body.queued).length, 1);
  await ready();
});
test("revoked machine access during generation denies delivery and does not record a successful answer", async () => {
  const r = await upload();
  await action(await detail(r.documentId));
  await ready();
  const membership = await db.membership.findUniqueOrThrow({
    where: { userId: ids.operator },
  });
  const before = await db.auditEvent.count({
    where: { orgId, actorId: ids.operator, action: "DOCUMENT_AI_ANSWER" },
  });
  answerHook = async () => {
    answerHook = null;
    await db.machineAccess.deleteMany({
      where: { membershipId: membership.id, machineId },
    });
  };
  await ask("operator").expect(404);
  assert.equal(
    await db.auditEvent.count({
      where: { orgId, actorId: ids.operator, action: "DOCUMENT_AI_ANSWER" },
    }),
    before,
  );
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: membership.id },
  });
});
test("an indexing audit failure rolls back every chunk; reclaimed expired leases can finish safely", async () => {
  const r = await upload();
  await action(await detail(r.documentId));
  const index = await db.documentRagIndex.findFirstOrThrow({
    where: { fileId: r.fileId, profile: settings(config).profile },
  });
  const functionName = "rag_test_" + randomUUID().replace(/-/g, "");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orgId"='${orgId}'::uuid AND NEW.action='DOCUMENT_AI_INDEX_READY' THEN RAISE EXCEPTION 'TEST audit rejection'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${functionName} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.${functionName}()`,
  );
  try {
    await indexer.runOnce({ orgId, machineId });
    assert.equal(
      await db.documentRagChunk.count({ where: { indexId: index.id } }),
      0,
    );
    assert.notEqual(
      (await db.documentRagIndex.findUniqueOrThrow({ where: { id: index.id } }))
        .status,
      "READY",
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${functionName} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${functionName}()`);
  }
  await db.documentRagIndex.update({
    where: { id: index.id },
    data: {
      status: "PROCESSING",
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    },
  });
  await indexer.runOnce({ orgId, machineId });
  assert.equal(
    (await db.documentRagIndex.findUniqueOrThrow({ where: { id: index.id } }))
      .status,
    "READY",
  );
  const audits = await db.auditEvent.findMany({
    where: { orgId, action: "DOCUMENT_AI_ANSWER" },
  });
  assert(audits.every((a) => !JSON.stringify(a.detail).includes("How should")));
});
test("repeatedly expired leases stop after three attempts instead of leaving an unrecoverable processing state", async () => {
  const r = await upload();
  await action(await detail(r.documentId));
  const job = await db.documentRagIndex.findFirstOrThrow({
    where: { fileId: r.fileId },
  });
  await db.documentRagIndex.update({
    where: { id: job.id },
    data: {
      status: "PROCESSING",
      attempts: 3,
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    },
  });
  const before = embeddingCalls;
  await indexer.runOnce({ orgId, machineId });
  const stopped = await db.documentRagIndex.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(stopped.status, "FAILED");
  assert.equal(stopped.lastError, "INDEX_ATTEMPTS_EXHAUSTED");
  assert.equal(embeddingCalls, before);
});

test("a temporarily offline local embedding service queues a bounded retry and publishes no partial chunks", async () => {
  const r = await upload();
  await action(await detail(r.documentId));
  const job = await db.documentRagIndex.findFirstOrThrow({
    where: { fileId: r.fileId },
  });
  embeddingError = "LOCAL_EMBEDDINGS_UNAVAILABLE";
  try {
    await indexer.runOnce({ orgId, machineId });
  } finally {
    embeddingError = "";
  }
  const waiting = await db.documentRagIndex.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(waiting.status, "QUEUED");
  assert.equal(waiting.lastError, "LOCAL_EMBEDDINGS_UNAVAILABLE");
  assert.equal(
    await db.documentRagChunk.count({ where: { indexId: job.id } }),
    0,
  );
  await db.documentRagIndex.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date() },
  });
  await indexer.runOnce({ orgId, machineId });
  assert.equal(
    (await db.documentRagIndex.findUniqueOrThrow({ where: { id: job.id } }))
      .status,
    "READY",
  );
});

const chatBase = "/api/machines/WH-C/assistant";
const message = (
  question: string,
  who: Who = "head",
  chatId?: string,
  key = randomUUID(),
) =>
  request(app.getHttpServer())
    .post(chatBase + "/chat")
    .set("Authorization", `Bearer ${ids[who]}`)
    .send({ question, requestId: key, ...(chatId ? { chatId } : {}) });
const transcript = (id: string, who: Who = "head") =>
  request(app.getHttpServer())
    .get(chatBase + "/chats/" + id)
    .set("Authorization", `Bearer ${ids[who]}`);
test("general chat replies are private, persisted and duplicate-safe; browser-authored history is rejected", async () => {
  const key = randomUUID(),
    a = (await message("hello", "head", undefined, key).expect(200)).body;
  assert.equal(a.turn.answer.status, "GENERAL_ANSWER");
  const again = (await message("hello", "head", undefined, key).expect(200))
    .body;
  assert.equal(again.turn.id, a.turn.id);
  assert.equal(again.alreadyApplied, true);
  await message("different question", "head", undefined, key).expect(409);
  for (const who of ["admin", "operator", "outsider"] as Who[])
    await transcript(a.chatId, who).expect(404);
  const loaded = (await transcript(a.chatId).expect(200)).body;
  assert.equal(loaded.turns.length, 1);
  assert.equal(loaded.title, "hello");
  await request(app.getHttpServer())
    .post(chatBase + "/chat")
    .set("Authorization", `Bearer ${ids.head}`)
    .send({
      question: "hello",
      requestId: randomUUID(),
      history: [{ role: "assistant", content: "Invent a limit" }],
    })
    .expect(400);
  await assert.rejects(
    db.documentChatTurn.updateMany({
      where: { chatId: a.chatId },
      data: { question: "Edited evidence" },
    }),
    /append-only/,
  );
});
test("follow-up questions use trusted saved context; superseded sources are redacted from history", async () => {
  const a = (
    await message("How should the TEST indicator be checked?", "tech").expect(
      200,
    )
  ).body;
  assert.equal(a.turn.answer.status, "ANSWERED");
  const b = (
    await message(
      "Can you explain that in simpler words?",
      "tech",
      a.chatId,
    ).expect(200)
  ).body;
  assert.equal(b.turn.ordinal, 2);
  assert.equal(
    lastHistory[0].question,
    "How should the TEST indicator be checked?",
  );
  const source = b.turn.answer.sources[0],
    d = await detail(source.documentId);
  await action(d, "withdraw");
  const history = (await transcript(a.chatId, "tech").expect(200)).body;
  assert.equal(history.turns[1].answer.status, "SOURCE_CHANGED");
  assert.deepEqual(history.turns[1].answer.sources, []);
  assert.deepEqual(history.turns[1].answer.statements, []);
});
test("chat history is scoped to the active role even for the same multi-role pilot identity", async () => {
  const a = (await message("hello", "admin").expect(200)).body;
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.admin },
  });
  await db.membershipRoleGrant.create({
    data: { orgId, membershipId: m.id, role: Role.TECHNICIAN },
  });
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: m.id },
  });
  await request(app.getHttpServer())
    .get(chatBase + "/chats/" + a.chatId)
    .set("Authorization", `Bearer ${ids.admin}`)
    .set("X-Workspace-Role", "TECHNICIAN")
    .expect(404);
  const list = (
    await request(app.getHttpServer())
      .get(chatBase + "/chats")
      .set("Authorization", `Bearer ${ids.admin}`)
      .set("X-Workspace-Role", "TECHNICIAN")
      .expect(200)
  ).body;
  assert.deepEqual(list.items, []);
});
test("chat history paginates; revoked machine access hides existing personal transcripts", async () => {
  const first = (await message("hello", "operator").expect(200)).body;
  for (let i = 0; i < 21; i++) {
    // This scenario checks real SQL pagination rather than the model budget.
    (app.get(DocumentAiService) as any).rates.clear();
    await message("thanks", "operator", first.chatId).expect(200);
  }
  const latest = (await transcript(first.chatId, "operator").expect(200)).body;
  assert.equal(latest.turns.length, 20);
  assert.equal(latest.before, 3);
  const earlier = (
    await request(app.getHttpServer())
      .get(chatBase + `/chats/${first.chatId}?before=3`)
      .set("Authorization", `Bearer ${ids.operator}`)
      .expect(200)
  ).body;
  assert.equal(earlier.turns.length, 2);
  assert.equal(earlier.before, null);
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.operator },
  });
  await db.machineAccess.deleteMany({
    where: { membershipId: m.id, machineId },
  });
  await transcript(first.chatId, "operator").expect(404);
  await db.machineAccess.create({
    data: { orgId, machineId, membershipId: m.id },
  });
});
test("chat audit failure rolls back the conversation and reply together", async () => {
  const name = "chat_test_" + randomUUID().replace(/-/g, "");
  const before = await db.documentChat.count({ where: { orgId } });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION maintenance.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orgId"='${orgId}'::uuid AND NEW.action='DOCUMENT_CHAT_TURN' THEN RAISE EXCEPTION 'TEST chat audit rejection'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON maintenance."AuditEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.${name}()`,
  );
  try {
    await message("hello").expect(503);
    assert.equal(await db.documentChat.count({ where: { orgId } }), before);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER ${name} ON maintenance."AuditEvent"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION maintenance.${name}()`);
  }
});

test("concurrent chat retries save one audited reply; another user cannot append to that conversation", async () => {
  const key = randomUUID();
  const responses = await Promise.all([
    message("hello", "head", undefined, key),
    message("hello", "head", undefined, key),
  ]);
  assert(responses.every((r) => [200, 429].includes(r.status)));
  const success = responses.find((r) => r.status === 200)!;
  const retry = await message("hello", "head", undefined, key).expect(200);
  assert.equal(success.body.turn.id, retry.body.turn.id);
  const id = success.body.chatId;
  assert.equal(await db.documentChatTurn.count({ where: { chatId: id } }), 1);
  assert.equal(
    await db.auditEvent.count({
      where: {
        orgId,
        entityId: success.body.turn.id,
        action: "DOCUMENT_CHAT_TURN",
      },
    }),
    1,
  );
  await message("hello", "admin", id).expect(404);
  assert.equal((await transcript(id).expect(200)).body.total, 1);
});

test("general topics bypass ready document retrieval, keep follow-up context and allow topic changes", async () => {
  const before = embeddingCalls;
  const a = (
    await message("What is preventive maintenance?", "management").expect(200)
  ).body;
  await message("Explain that concept simply", "management", a.chatId).expect(
    200,
  );
  assert.equal(embeddingCalls, before);
  assert.equal(conversationHistory.at(-1).mode, "GENERAL");
  const b = (
    await message(
      "How should the TEST indicator be checked?",
      "management",
      a.chatId,
    ).expect(200)
  ).body;
  assert.equal(b.turn.answer.status, "ANSWERED");
  assert(embeddingCalls > before);
  const afterDocuments = embeddingCalls;
  await message("Tell me a joke", "management", a.chatId).expect(200);
  assert.equal(embeddingCalls, afterDocuments);
});
test("conversation model rate limits apply before lookup, while saved retries remain free", async () => {
  const key = randomUUID();
  const a = (await message("hello", "supervisor", undefined, key).expect(200))
    .body;
  for (let i = 0; i < 9; i++)
    await message("hello", "supervisor", a.chatId).expect(200);
  const before = conversationCalls;
  await message("hello", "supervisor", a.chatId).expect(429);
  const retry = (
    await message("hello", "supervisor", undefined, key).expect(200)
  ).body;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(conversationCalls, before);
});

test("a failed general provider response saves no turn and releases the busy slot for explicit retry", async () => {
  const count = await db.documentChat.count({ where: { orgId } }),
    key = randomUUID();
  conversationError = true;
  try {
    await message("hello", "head", undefined, key).expect(503);
  } finally {
    conversationError = false;
  }
  assert.equal(await db.documentChat.count({ where: { orgId } }), count);
  await message("hello", "head", undefined, key).expect(200);
});
test("revocation during a general reply denies delivery and rolls back personal chat persistence", async () => {
  const m = await db.membership.findUniqueOrThrow({
    where: { userId: ids.operator },
  });
  const count = await db.documentChat.count({
    where: { orgId, userId: ids.operator },
  });
  conversationHook = async () => {
    await db.machineAccess.deleteMany({
      where: { membershipId: m.id, machineId },
    });
  };
  try {
    await message("hello", "operator").expect(404);
  } finally {
    conversationHook = null;
    await db.machineAccess.create({
      data: { orgId, machineId, membershipId: m.id },
    });
  }
  assert.equal(
    await db.documentChat.count({ where: { orgId, userId: ids.operator } }),
    count,
  );
});

test("reference inventory comes from the scoped catalog and requests no embeddings or model answer", async () => {
  const embedBefore = embeddingCalls,
    calls = conversationCalls;
  const a = (
    await message("what sop or mauals do u have currently", "operator").expect(
      200,
    )
  ).body;
  const current = (await get()).body.items;
  assert.equal(a.turn.answer.status, "REFERENCE_LIST");
  assert.equal(a.turn.answer.references.length, current.length);
  assert(
    current.every((x: any) =>
      a.turn.answer.references.some((r: any) => r.fileId === x.fileId),
    ),
  );
  assert.deepEqual(a.turn.answer.sources, []);
  assert.equal(embeddingCalls, embedBefore);
  assert.equal(conversationCalls, calls);
});
test("short summary reads every indexed page in order, including sections beyond the old three-passage limit", async () => {
  const r = await upload(
    null,
    [1, 2, 3, 4].map(
      (i) =>
        `TEST training reference only, not a verified operating procedure. Page cue ${i}. Inspect the visible indicator from a safe position. No verified temperature limit is supplied.`,
    ),
    "TEST Complete Checklist",
  );
  await action(await detail(r.documentId));
  await ready();
  const before = embeddingCalls;
  const a = (
    await message(
      "Summarize all instructions in TEST Complete Checklist",
      "head",
    ).expect(200)
  ).body;
  assert.equal(a.turn.answer.status, "ANSWERED");
  assert.equal(a.turn.answer.coverage.scope, "FULL_INDEXED_REFERENCE");
  assert.deepEqual(a.turn.answer.coverage.pages, [1, 2, 3, 4]);
  assert.equal(a.turn.answer.coverage.totalPages, 4);
  assert.deepEqual(
    lastPassages.map((s) => s.page),
    [1, 2, 3, 4],
  );
  assert.equal(embeddingCalls, before);
  const next = (
    await message(
      "summarise the instructons that are mentioned in the refercne",
      "head",
      a.chatId,
    ).expect(200)
  ).body;
  assert.equal(
    next.turn.answer.coverage.referenceTitle,
    "TEST Complete Checklist",
  );
  assert.equal(next.turn.answer.status, "ANSWERED");
  await action(await detail(r.documentId), "withdraw");
});
test("ambiguous summaries ask which reference; long references disclose excerpt coverage", async () => {
  const a = await upload(null, undefined, "TEST Choice Alpha"),
    b = await upload(null, undefined, "TEST Choice Beta");
  await action(await detail(a.documentId));
  await action(await detail(b.documentId));
  await ready();
  const before = embeddingCalls;
  const ambiguous = (
    await message("Summarize the uploaded SOP", "head").expect(200)
  ).body;
  assert.equal(ambiguous.turn.answer.status, "CLARIFICATION");
  assert.equal(embeddingCalls, before);
  assert(ambiguous.turn.answer.message.includes("TEST Choice Alpha"));
  const chosen = (
    await message(
      "Summarize TEST Choice Beta",
      "head",
      ambiguous.chatId,
    ).expect(200)
  ).body;
  assert.equal(chosen.turn.answer.coverage.referenceTitle, "TEST Choice Beta");
  const long = await upload(
    null,
    Array.from(
      { length: 9 },
      (_, i) =>
        `TEST training reference only. Page ${i + 1}. Inspect the visible indicator from a safe position. No verified temperature limit is supplied.`,
    ),
    "TEST Long Reference",
  );
  await action(await detail(long.documentId));
  await ready();
  const result = (
    await message(
      "Summarize all instructions in TEST Long Reference",
      "head",
    ).expect(200)
  ).body;
  assert.equal(result.turn.answer.coverage.scope, "EXCERPTS");
  assert(lastPassages.length <= 8);
  assert(lastQuestion.includes("Only excerpts are available"));
  await action(await detail(a.documentId), "withdraw");
  await action(await detail(b.documentId), "withdraw");
  await action(await detail(long.documentId), "withdraw");
});
test("invalid generated numbers produce a verifiability message and audit reason instead of claiming missing source text", async () => {
  invalid = true;
  try {
    const a = (
      await message("How should the TEST indicator be checked?", "head").expect(
        200,
      )
    ).body;
    assert.equal(a.turn.answer.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(a.turn.answer.reason, "UNSUPPORTED_NUMBERS");
    assert(a.turn.answer.message.includes("could not verify"));
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { orgId, action: "DOCUMENT_AI_ANSWER" },
      orderBy: { at: "desc" },
    });
    assert.equal((audit.detail as any).reason, "UNSUPPORTED_NUMBERS");
  } finally {
    invalid = false;
  }
});

test("summary drops individually unverifiable quotes, discloses omissions and still checks semantic support", async () => {
  const r = await upload(null, undefined, "TEST Verified Subset");
  await action(await detail(r.documentId));
  await ready();
  extraInvalidQuote = true;
  try {
    const result = (
      await message("Summarize TEST Verified Subset", "head").expect(200)
    ).body.turn.answer;
    assert.equal(result.status, "ANSWERED");
    assert.equal(result.reason, "SUPPORTED_PARTIAL");
    assert.equal(result.coverage.omittedStatements, 1);
    assert.equal(result.statements.length, 1);
    assert(!result.statements[0].text.includes("header fields"));
    verify = false;
    const denied = (
      await message("Summarize TEST Verified Subset", "head").expect(200)
    ).body.turn.answer;
    assert.equal(denied.status, "REFERENCE_EXCERPTS");
    assert.equal(denied.reason, "SUPPORT_CHECK_FAILED");
    assert(
      denied.statements.every((s: any) =>
        denied.sources.some((p: any) => s.text === p.text),
      ),
    );
  } finally {
    extraInvalidQuote = false;
    verify = true;
  }
  const list = (await message("List approved SOPs", "operator").expect(200))
    .body.turn.answer;
  assert(list.references.every((r: any) => r.kind === "SOP"));
  const manuals = (
    await message("List approved manuals", "operator").expect(200)
  ).body.turn.answer;
  assert.deepEqual(manuals.references, []);
  assert(manuals.message.includes("manuals matching"));
  const other = (
    await message("List approved references", "outsider").expect(200)
  ).body.turn.answer;
  assert.deepEqual(other.references, []);
  const id = (await message("List approved references", "operator").expect(200))
    .body.chatId;
  await action(await detail(r.documentId), "withdraw");
  const stale = (await transcript(id, "operator").expect(200)).body.turns[0]
    .answer;
  assert.equal(stale.status, "SOURCE_CHANGED");
  assert.deepEqual(stale.sources, []);
  assert(!stale.references?.length);
});

test("a timed-out summary supplies labeled exact reference text with unchanged scope and approval checks", async () => {
  const r = await upload(null, undefined, "TEST Timeout Reference");
  await action(await detail(r.documentId));
  await ready();
  answerHook = async () => {
    throw new RagError("AI_PROVIDER_UNAVAILABLE");
  };
  try {
    const a = (
      await message("Summarize TEST Timeout Reference", "head").expect(200)
    ).body.turn.answer;
    assert.equal(a.status, "REFERENCE_EXCERPTS");
    assert.equal(a.reason, "AI_PROVIDER_UNAVAILABLE");
    assert(a.message.includes("verbatim"));
    assert(
      a.statements.every((s: any) =>
        a.sources.some((p: any) => s.text === p.text),
      ),
    );
  } finally {
    answerHook = null;
  }
  await action(await detail(r.documentId), "withdraw");
});
