// Opt-in paid-provider acceptance. All application fixtures are confined to *_test.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient, Role } = require("@prisma/client");
const { Test } = require("@nestjs/testing");
const { UnauthorizedException } = require("@nestjs/common");
const request = require("supertest");
const { appModule, configure } = require("../../apps/api/dist/app");
const { parseConfig } = require("../../apps/api/dist/config");
const { VERIFIER } = require("../../apps/api/dist/auth");
const { DocumentIndexer } = require("../../apps/api/dist/rag/indexer");
const { settings } = require("../../apps/api/dist/rag/policy");
const { textPdf } = require("../../apps/api/dist/tests/rag-fixture");
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (
  !owner ||
  !runtime ||
  !new URL(owner).pathname.endsWith("_test") ||
  new URL(owner).pathname !== new URL(runtime).pathname
)
  throw Error("Live AI acceptance requires the isolated *_test database.");
if (!process.env.COMMANDCODE_API_KEY)
  throw Error("Configure the backend CommandCode key first.");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
let app,
  localEmbeddingRequests = 0;
const actualFetch = global.fetch,
  usage = [];
global.fetch = async (url, init) => {
  const target = String(url);
  if (
    !target.startsWith("https://api.commandcode.ai/provider/v1/") &&
    !target.startsWith("http://127.0.0.1:11434/")
  )
    throw Error("Unexpected provider in live acceptance");
  if (target.startsWith("http://127.0.0.1:11434/") && target.endsWith("/embed"))
    localEmbeddingRequests++;
  const response = await actualFetch(url, init);
  if (target.includes("commandcode")) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    usage.push({
      status: response.status,
      model: body?.model,
      finishReason: body?.choices?.[0]?.finish_reason,
      usage: body?.usage,
    });
  }
  return response;
};
try {
  const org = await db.organization.create({
    data: {
      slug: "live-rag-" + randomUUID(),
      name: "TEST live RAG acceptance",
    },
  });
  const machine = await db.machine.create({
    data: {
      orgId: org.id,
      code: "WH-C",
      name: "TEST machine only",
      manufacturer: "Fixture",
    },
  });
  const ids = {};
  for (const [name, role] of Object.entries({
    admin: Role.ADMINISTRATOR,
    head: Role.MAINTENANCE_HEAD,
    operator: Role.OPERATOR,
  })) {
    ids[name] = randomUUID();
    await db.appUser.create({
      data: { id: ids[name], displayName: "TEST " + name },
    });
    const membership = await db.membership.create({
      data: { orgId: org.id, userId: ids[name], role },
    });
    if (role === Role.OPERATOR)
      await db.machineAccess.create({
        data: {
          orgId: org.id,
          machineId: machine.id,
          membershipId: membership.id,
        },
      });
  }
  const config = parseConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: runtime,
    DOCUMENT_AI_PROVIDER: "commandcode",
    OPENAI_API_KEY: "",
  });
  const module = await Test.createTestingModule({
    imports: [appModule(config)],
  })
    .overrideProvider(VERIFIER)
    .useValue({
      async verify(token) {
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
  const docs = "/api/machines/WH-C/documents",
    assistant = "/api/machines/WH-C/assistant";
  const get = (path, who = "head") =>
    request(app.getHttpServer())
      .get(path)
      .set("Authorization", "Bearer " + ids[who]);
  const post = (path, who = "head") =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", "Bearer " + ids[who])
      .expect((res) => {
        if (res.status >= 400)
          console.error(
            "Live acceptance HTTP error",
            res.status,
            res.body?.message,
          );
      });
  const pdf = await textPdf([
    "TEST TRAINING DOCUMENT. This is a synthetic software acceptance fixture, not an operating procedure. In this demonstration the inspection label color is amber. Inspect the visible indicator from a safe position. No numeric operating temperature threshold is supplied.",
    "TEST TRAINING ONLY. Report this demonstration observation to the maintenance head. The real WH-C model and operating limits are not established by this example.",
  ]);
  const upload = (
    await post(docs, "admin")
      .field("requestId", randomUUID())
      .field("version", "0")
      .field("title", "TEST live AI training SOP")
      .field("kind", "SOP")
      .field("description", "TEST public synthetic acceptance fixture")
      .attach("file", pdf, {
        filename: "TEST-live-training.pdf",
        contentType: "application/pdf",
      })
      .expect(201)
  ).body;
  assert.equal(
    (
      await post(assistant + "/ask", "operator")
        .send({ question: "What color is the TEST label?" })
        .expect(200)
    ).body.status,
    "NO_APPROVED_DOCUMENTS",
  );
  assert.equal(usage.length, 0);
  const generalStart = localEmbeddingRequests;
  const greeting = (
    await post(assistant + "/chat", "operator")
      .send({ requestId: randomUUID(), question: "hiii" })
      .expect(200)
  ).body;
  assert.equal(greeting.turn.answer.status, "GENERAL_ANSWER");
  assert.equal(greeting.turn.answer.sources.length, 0);
  assert(/hi|hello|hey/i.test(greeting.turn.answer.message));
  const capability = (
    await post(assistant + "/chat", "operator")
      .send({
        requestId: randomUUID(),
        chatId: greeting.chatId,
        question: "hii what question can u anser",
      })
      .expect(200)
  ).body;
  assert.equal(capability.turn.answer.status, "GENERAL_ANSWER");
  assert.equal(capability.turn.answer.sources.length, 0);
  assert.equal(localEmbeddingRequests, generalStart);
  let document = (await get(docs + "/" + upload.documentId).expect(200)).body;
  await post(`${docs}/${document.id}/actions/approve`)
    .send({
      requestId: randomUUID(),
      version: document.version,
      fileId: upload.fileId,
      reason: "TEST approval for isolated live acceptance only",
    })
    .expect(200);
  await app
    .get(DocumentIndexer)
    .runOnce({ orgId: org.id, machineId: machine.id });
  const status = (await get(assistant + "/status", "operator").expect(200))
    .body;
  assert.equal(status.provider, "commandcode");
  assert.equal(status.ready, 1);
  assert.equal(status.items[0].pages, 2);
  const answer = (
    await post(assistant + "/ask", "operator")
      .send({
        question:
          "In this TEST training example, what color is the inspection label?",
      })
      .expect(200)
  ).body;
  assert.equal(answer.status, "ANSWERED");
  assert(answer.statements.some((s) => /amber/i.test(s.text)));
  assert(answer.sources.some((s) => s.page === 1));
  const firstChatRequest = {
    chatId: greeting.chatId,
    requestId: randomUUID(),
    question:
      "In this TEST training example, what color is the inspection label?",
  };
  const firstChat = (
    await post(assistant + "/chat", "operator")
      .send(firstChatRequest)
      .expect(200)
  ).body;
  assert.equal(firstChat.turn.answer.status, "ANSWERED");
  assert(firstChat.turn.answer.statements.some((s) => /amber/i.test(s.text)));
  const beforeRetry = usage.length;
  const retry = (
    await post(assistant + "/chat", "operator")
      .send(firstChatRequest)
      .expect(200)
  ).body;
  assert.equal(retry.turn.id, firstChat.turn.id);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(usage.length, beforeRetry);
  const followup = (
    await post(assistant + "/chat", "operator")
      .send({
        requestId: randomUUID(),
        chatId: firstChat.chatId,
        question:
          "After inspecting it, who should I report this demonstration observation to?",
      })
      .expect(200)
  ).body;
  assert.equal(followup.turn.answer.status, "ANSWERED");
  assert(
    followup.turn.answer.statements.some((s) =>
      /maintenance head/i.test(s.text),
    ),
  );
  assert(followup.turn.answer.sources.some((s) => s.page === 2));
  const savedChat = (
    await get(assistant + "/chats/" + firstChat.chatId, "operator").expect(200)
  ).body;
  assert.equal(savedChat.total, 4);
  assert.equal(savedChat.turns.length, 4);
  await get(assistant + "/chats/" + firstChat.chatId, "head").expect(404);
  const beforeGeneral = localEmbeddingRequests;
  const concept = (
    await post(assistant + "/chat", "operator")
      .send({
        requestId: randomUUID(),
        chatId: firstChat.chatId,
        question: "What is preventive maintenance?",
      })
      .expect(200)
  ).body;
  assert.equal(concept.turn.answer.status, "GENERAL_ANSWER");
  assert.equal(concept.turn.answer.sources.length, 0);
  const simple = (
    await post(assistant + "/chat", "operator")
      .send({
        requestId: randomUUID(),
        chatId: firstChat.chatId,
        question: "Explain that concept simply",
      })
      .expect(200)
  ).body;
  assert.equal(simple.turn.answer.status, "GENERAL_ANSWER");
  assert.equal(simple.turn.answer.sources.length, 0);
  assert.equal(localEmbeddingRequests, beforeGeneral);
  const missing = (
    await post(assistant + "/ask", "operator")
      .send({
        question:
          "What is the maximum safe numeric operating temperature of the real WH-C line?",
      })
      .expect(200)
  ).body;
  assert(
    missing.status === "INSUFFICIENT_EVIDENCE" ||
      (missing.status === "ANSWERED" &&
        missing.statements.every(
          (s) =>
            !/[0-9]/.test(s.text) && /no|not|unspecified|cannot/i.test(s.text),
        )),
    "Unsupported operating limit was not safely rejected",
  );
  document = (await get(docs + "/" + upload.documentId).expect(200)).body;
  await post(`${docs}/${document.id}/actions/withdraw`)
    .send({
      requestId: randomUUID(),
      version: document.version,
      fileId: upload.fileId,
      reason: "TEST withdrawal after live acceptance",
    })
    .expect(200);
  const withdrawnChat = (
    await get(assistant + "/chats/" + firstChat.chatId, "operator").expect(200)
  ).body;
  assert(
    withdrawnChat.turns
      .slice(2, 4)
      .every(
        (t) =>
          t.answer.status === "SOURCE_CHANGED" &&
          t.answer.statements.length === 0 &&
          t.answer.sources.length === 0,
      ),
  );
  assert(
    withdrawnChat.turns.filter((t) => t.answer.status === "GENERAL_ANSWER")
      .length === 4,
  );
  const before = usage.length;
  assert.equal(
    (
      await post(assistant + "/ask", "operator")
        .send({ question: "What color is the TEST label?" })
        .expect(200)
    ).body.status,
    "NO_APPROVED_DOCUMENTS",
  );
  assert.equal(usage.length, before);
  assert(
    usage.every((attempt) => attempt.model === settings(config).answerModel),
  );
  const result = {
    passed: true,
    provider: "commandcode",
    model: settings(config).answerModel,
    localEmbeddings: true,
    pages: 2,
    answerStatus: answer.status,
    sourcePages: answer.sources.map((s) => s.page),
    unsupportedQuestionStatus: missing.status,
    withdrawalExcluded: true,
    savedConversation: true,
    reportedGreetingStatus: greeting.turn.answer.status,
    reportedCapabilityStatus: capability.turn.answer.status,
    generalTopicStatus: concept.turn.answer.status,
    generalFollowupStatus: simple.turn.answer.status,
    generalChatUsedEmbeddings: false,
    generalWithoutApprovedDocuments: true,
    followupStatus: followup.turn.answer.status,
    followupPages: followup.turn.answer.sources.map((s) => s.page),
    retryAvoidedProvider: true,
    privateHistory: true,
    withdrawalRedactedHistory: true,
    providerRequests: usage,
  };
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/commandcode-live-e2e.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/hybrid-live-attempt-usage.json",
    JSON.stringify(usage, null, 2),
  );
  global.fetch = actualFetch;
  await app?.close();
  await db.$disconnect();
}
