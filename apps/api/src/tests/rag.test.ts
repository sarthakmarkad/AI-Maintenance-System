import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkPages,
  DIMENSIONS,
  validateVectors,
  validateCitations,
  type Passage,
  answerSchema,
} from "../rag/policy";
import { PopplerExtractor } from "../rag/extractor";
import { OpenAiProvider } from "../rag/provider";
import { textPdf } from "./rag-fixture";

test("page-aware PDF extraction preserves page numbers and bounded overlapping chunks", async () => {
  const result = await new PopplerExtractor().extract(
    await textPdf([
      "TEST sample only. Inspect visible temperature indications from a safe position.",
      "TEST sample only. Report unusual indications to the maintenance head.",
    ]),
  );
  assert.equal(result.pages, 2);
  assert.deepEqual(
    result.chunks.map((c) => c.page),
    [1, 2],
  );
  assert.match(result.chunks[1].text, /Report unusual/);
  const chunks = chunkPages(["readings ".repeat(300)]);
  assert(chunks.length > 1);
  assert(chunks.every((c) => c.text.length <= 1200));
  assert(chunks[0].text.includes(chunks[1].text.slice(0, 50)));
});
test("unreadable, excessive and malformed PDFs fail closed", async () => {
  assert.throws(() => chunkPages([" "]), /OCR_REQUIRED/);
  assert.throws(() => chunkPages(Array(201).fill("x")), /PDF_PAGE_LIMIT/);
  assert.throws(() => chunkPages(["a".repeat(500001)]), /PDF_TEXT_LIMIT/);
  await assert.rejects(
    new PopplerExtractor().extract(Buffer.from("bad pdf")),
    /PDF_EXTRACTION_FAILED/,
  );
  await assert.rejects(
    new PopplerExtractor().extract(await textPdf([" "])),
    /OCR_REQUIRED/,
  );
});
test("embedding and citation validation rejects malformed vectors, invented numbers and source IDs", () => {
  const v = Array(DIMENSIONS).fill(0);
  v[0] = 1;
  assert.equal(validateVectors([v], 1)[0], v);
  for (const bad of [
    Array(DIMENSIONS).fill(0),
    [1],
    Array(DIMENSIONS).fill(Infinity),
    Array(DIMENSIONS).fill(1e100),
  ])
    assert.throws(() => validateVectors([bad], 1), /INVALID_EMBEDDINGS/);
  const sources = [
    {
      id: "S1",
      text: "TEST training: inspect the indicator from a safe position. No verified operating limit.",
    } as Passage,
  ];
  const draft = answerSchema.parse({
    status: "ANSWERED",
    statements: [
      {
        text: "Inspect the indicator from a safe position.",
        citations: [
          {
            sourceId: "S1",
            quote: "inspect the indicator from a safe position",
          },
        ],
      },
    ],
  });
  assert.equal(validateCitations(draft, sources), draft);
  assert.throws(
    () =>
      validateCitations(
        {
          ...draft,
          statements: [
            { ...draft.statements[0], text: "Set temperature to 900 degrees." },
          ],
        },
        sources,
      ),
    /UNSUPPORTED_NUMBERS/,
  );
  assert.throws(
    () =>
      validateCitations(
        {
          ...draft,
          statements: [
            {
              ...draft.statements[0],
              citations: [{ sourceId: "S2", quote: "invented quotation" }],
            },
          ],
        },
        sources,
      ),
    /INVALID_CITATIONS/,
  );
  assert.throws(
    () =>
      validateCitations({ ...draft, status: "INSUFFICIENT_EVIDENCE" }, sources),
    /INVALID_CITATIONS/,
  );
});
test("OpenAI adapter uses backend credentials, correct embedding dimensions and nonstored strict responses", async () => {
  const old = global.fetch,
    requests: any[] = [];
  global.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url, body });
    if (String(url).endsWith("embeddings"))
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: Array(DIMENSIONS).fill(0.1) }],
        }),
      );
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  status: "INSUFFICIENT_EVIDENCE",
                  statements: [],
                }),
              },
            ],
          },
        ],
      }),
    );
  }) as typeof fetch;
  try {
    const ai = new OpenAiProvider({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      OPENAI_API_KEY: "TEST-private-provider-key",
    });
    await ai.embed(["TEST sample"]);
    await ai.answer("TEST question", []);
    assert.equal(requests[0].body.dimensions, 1536);
    assert.equal(requests[1].body.store, false);
    assert.equal(requests[1].body.text.format.strict, true);
    assert(!requests[1].body.tools);
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { code: "invalid_api_key", message: "private provider error" },
        }),
        { status: 401 },
      )) as typeof fetch;
    await assert.rejects(ai.embed(["TEST"]), /AI_AUTH_FAILED/);
  } finally {
    global.fetch = old;
  }
});
test("CommandCode configuration prefers its own key and never falls back to OpenAI credentials", async () => {
  const { settings } = await import("../rag/policy");
  const base = {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    OPENAI_API_KEY: "TEST-unused-openai-key",
    COMMANDCODE_API_KEY: "TEST-commandcode-key",
  };
  assert.equal(settings(base).provider, "commandcode");
  assert.equal(settings(base).answerModel, "deepseek/deepseek-v4.1-flash");
  const legacy = settings({ ...base, COMMANDCODE_MODEL: "z-ai/glm-5.3-flash" });
  assert.equal(legacy.answerModel, "z-ai/glm-5.3-flash");
  assert.equal(legacy.profile, settings(base).profile);
  assert(settings(base).profile.includes("768-pad1536"));
  assert.equal(
    settings({
      ...base,
      DOCUMENT_AI_PROVIDER: "commandcode",
      COMMANDCODE_API_KEY: undefined,
    }).configured,
    false,
  );
});
test("local embeddings pin the model, use retrieval prefixes and never send cloud credentials", async () => {
  const { LocalEmbeddings } = await import("../rag/local-embeddings"),
    { LOCAL_MODEL, LOCAL_DIGEST } = await import("../rag/policy");
  const old = global.fetch,
    requests: any[] = [];
  global.fetch = (async (url, init) => {
    requests.push({ url, init });
    if (String(url).endsWith("tags"))
      return new Response(
        JSON.stringify({
          models: [{ name: LOCAL_MODEL, digest: LOCAL_DIGEST }],
        }),
      );
    return new Response(JSON.stringify({ embeddings: [Array(768).fill(0.1)] }));
  }) as typeof fetch;
  try {
    const embed = new LocalEmbeddings({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      COMMANDCODE_API_KEY: "TEST-private-cloud-key",
    });
    const v = await embed.embed(["TEST query"], "query");
    assert.equal(v[0].length, 1536);
    assert(v[0].slice(768).every((n) => n === 0));
    const body = JSON.parse(requests[1].init.body);
    assert.equal(body.input[0], "search_query: TEST query");
    assert.equal(body.truncate, false);
    assert(!requests[1].init.headers.Authorization);
    assert(
      requests.every((r) =>
        String(r.url).startsWith("http://127.0.0.1:11434/"),
      ),
    );
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          models: [{ name: LOCAL_MODEL, digest: "f".repeat(64) }],
        }),
      )) as typeof fetch;
    await assert.rejects(
      embed.embed(["TEST source"]),
      /LOCAL_EMBEDDING_MODEL_CHANGED/,
    );
  } finally {
    global.fetch = old;
  }
});
test("DeepSeek uses CommandCode strict schemas and ZDR; incomplete JSON cannot become an answer", async () => {
  const old = global.fetch,
    requests: any[] = [];
  global.fetch = (async (url, init) => {
    requests.push({ url, init, body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                status: "INSUFFICIENT_EVIDENCE",
                statements: [],
              }),
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  try {
    const ai = new OpenAiProvider({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      COMMANDCODE_API_KEY: "TEST-commandcode-secret",
      OPENAI_API_KEY: "TEST-unused-openai",
    });
    await ai.answer("TEST question", []);
    assert.equal(
      requests[0].url,
      "https://api.commandcode.ai/provider/v1/chat/completions",
    );
    assert.equal(requests[0].body.model, "deepseek/deepseek-v4.1-flash");
    assert.equal(requests[0].body.response_format.json_schema.strict, true);
    assert(
      requests[0].body.messages[0].content.endsWith(
        JSON.stringify(requests[0].body.response_format.json_schema.schema),
      ),
      "The system prompt must supply the actual response schema as well as the API format hint",
    );
    assert.equal(requests[0].init.headers["x-cmd-zdr"], "1");
    assert(!requests[0].body.tools);
    assert(!requests[0].body.thinking);
    assert.equal(requests[0].body.reasoning_effort, "low");
    assert.equal(requests[0].body.max_tokens, 3072);
    await ai.answer("Summarize all instructions in the SOP", []);
    assert.equal(requests.at(-1).body.max_tokens, 6144);
    await assert.rejects(
      ai.verify("TEST", [], {
        status: "INSUFFICIENT_EVIDENCE",
        statements: [],
      }),
      /AI_INVALID_RESPONSE/,
    );
    assert.equal(requests.at(-1).body.max_tokens, 4096);
    const legacy = new OpenAiProvider({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      COMMANDCODE_API_KEY: "TEST-commandcode-secret",
      COMMANDCODE_MODEL: "z-ai/glm-5.3-flash",
    });
    await legacy.answer("TEST question", []);
    assert.equal(requests.at(-1).body.model, "z-ai/glm-5.3-flash");
    assert(!requests.at(-1).body.reasoning_effort);
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"status":"ANSWERED"' },
            },
          ],
        }),
      )) as typeof fetch;
    await assert.rejects(
      ai.answer("TEST question", []),
      /AI_INCOMPLETE_RESPONSE/,
    );
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"type":"json_object","statements":[]}' },
            },
          ],
        }),
      )) as typeof fetch;
    await assert.rejects(ai.answer("TEST question", []), /AI_INVALID_RESPONSE/);
  } finally {
    global.fetch = old;
  }
});

test("conversation routing separates explicit local references from general concepts and writing", async () => {
  const { requiresDocuments, conversationSchema } = await import(
    "../rag/policy"
  );
  for (const q of [
    "hiii",
    "hii what question can u anser",
    "What is an SOP?",
    "What is preventive maintenance?",
    "Write an email about our machine",
  ])
    assert.equal(requiresDocuments(q), false, q);
  for (const q of [
    "According to the SOP, what do I check?",
    "Summarize the manual",
    "What is the WH-C pressure limit?",
    "What does our SOP say?",
  ])
    assert.equal(requiresDocuments(q), true, q);
  assert(!conversationSchema.safeParse({ mode: "GENERAL", reply: "" }).success);
  assert.equal(
    conversationSchema.parse({
      mode: "DOCUMENTS",
      reply: "Invented site advice",
    }).reply,
    "",
  );
  assert(
    !conversationSchema.safeParse({
      mode: "GENERAL",
      reply: "Hello",
      sources: ["fake"],
    }).success,
  );
});
test("general GLM conversation uses no document passages and preserves bounded server context", async () => {
  const old = global.fetch,
    requests: any[] = [];
  let response: unknown = { mode: "GENERAL", reply: "Hi! How can I help?" };
  global.fetch = (async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers,
    });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(response) },
          },
        ],
      }),
    );
  }) as typeof fetch;
  try {
    const ai = new OpenAiProvider({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      COMMANDCODE_API_KEY: "TEST-private-key",
    });
    const h = [
      {
        question: "What is an SOP?",
        answer: "A written procedure.",
        mode: "GENERAL" as const,
      },
    ];
    const reply = await ai.converse("Explain that simply", h);
    assert.equal(reply.mode, "GENERAL");
    const input = JSON.parse(requests[0].body.messages[1].content);
    assert.deepEqual(input.conversation, h);
    assert(!("sources" in input));
    assert.equal(requests[0].headers["x-cmd-zdr"], "1");
    assert.equal(requests.length, 1);
    assert(requests.every((r) => r.url.endsWith("/chat/completions")));
    response = {
      mode: "DOCUMENTS",
      reply: "Unverified draft must be discarded",
    };
    const lookup = await ai.converse("Explain that SOP", h);
    assert.equal(lookup.mode, "DOCUMENTS");
    assert.equal(lookup.reply, "");
    response = { mode: "GENERAL", reply: "", sources: ["forged"] };
    await assert.rejects(ai.converse("hello"), /AI_INVALID_RESPONSE/);
  } finally {
    global.fetch = old;
  }
});

test("complete checklists permit twelve supported points and list numbering is not an operating value", () => {
  const sources = [
    {
      id: "S8",
      text: "TEST training only. Record visible facts. Do not change settings.",
    } as Passage,
  ];
  const draft = answerSchema.parse({
    status: "ANSWERED",
    statements: Array.from({ length: 8 }, (_, i) => ({
      text: `${i + 1}. Record visible facts.`,
      citations: [{ sourceId: "S8", quote: "Record visible facts." }],
    })),
  });
  assert.equal(validateCitations(draft, sources).statements.length, 8);
  assert.throws(
    () =>
      validateCitations(
        {
          ...draft,
          statements: [
            {
              text: "1. Set temperature to 999 degrees.",
              citations: [{ sourceId: "S8", quote: "Do not change settings." }],
            },
          ],
        },
        sources,
      ),
    /UNSUPPORTED_NUMBERS/,
  );
  assert(
    !answerSchema.safeParse({
      ...draft,
      statements: Array(13).fill(draft.statements[0]),
    }).success,
  );
});
test("summary planning distinguishes inventory, generic concepts and ambiguous references", async () => {
  const { catalogRequest, summaryRequest, selectReference } = await import(
    "../rag/planning"
  );
  const sources = [
    {
      documentId: "a",
      title: "TEST Temperature SOP",
      filename: "temperature.pdf",
    },
    { documentId: "b", title: "TEST Pressure SOP", filename: "pressure.pdf" },
  ] as any;
  assert(catalogRequest("what sop or mauals do u have currently"));
  assert(catalogRequest("List approved manuals"));
  assert(!catalogRequest("what is mentioned in the uploaded reference"));
  assert(!catalogRequest("What is an SOP?"));
  assert(summaryRequest("mention all the instructions in the sop given"));
  assert(summaryRequest("Show the checklist"));
  assert(
    !summaryRequest("According to TEST Checklist, what color is the label?"),
  );
  assert(
    !summaryRequest(
      "According to TEST Checklist, give the real WH-C temperature as 999 degrees.",
    ),
  );
  assert(
    summaryRequest(
      "summarise the instructons that are mentioned in the refercne",
    ),
  );
  assert.equal(
    selectReference("Summarize the uploaded SOP", sources, []),
    null,
  );
  assert.equal(
    selectReference("Summarize TEST Pressure SOP", sources, [])?.documentId,
    "b",
  );
  assert.equal(
    selectReference("Summarize its instructions", sources, [
      {
        question: "Earlier",
        answer: "Checked",
        mode: "DOCUMENTS",
        referenceIds: ["a"],
      },
    ])?.documentId,
    "a",
  );
  assert.equal(
    selectReference("Summarize another document", sources, [
      {
        question: "Earlier",
        answer: "Checked",
        mode: "DOCUMENTS",
        referenceIds: ["a"],
      },
    ]),
    null,
  );
});

test("provider selects immutable evidence IDs instead of regenerating template quotes", async () => {
  const { evidenceCatalog } = await import("../rag/provider");
  const source = {
    id: "S1",
    text:
      "TEST UNAPPROVED TRAINING SAMPLE. Model: __________. Limits: __________. " +
      "Record visible observations without changing settings. ".repeat(25),
  } as Passage;
  source.text = source.text.slice(0, 1200);
  const catalog = evidenceCatalog([source]);
  assert(catalog[0].quotes.length > 1);
  for (const quote of catalog[0].quotes) {
    assert(source.text.includes(quote.text));
    assert(quote.text.length >= 10 && quote.text.length <= 1200);
  }
  const old = global.fetch;
  let wrongSource = false;
  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.messages[1].content);
    assert(!input.sources[0].text);
    const quoteId = input.sources[0].quotes[0].quoteId;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                status: "ANSWERED",
                statements: [
                  {
                    text: "This is an unapproved training sample.",
                    citations: [
                      { sourceId: wrongSource ? "S2" : source.id, quoteId },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  try {
    const ai = new OpenAiProvider({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 4000,
      WEB_ORIGIN: "http://localhost:3000",
      COMMANDCODE_API_KEY: "TEST-key",
    });
    const answer = await ai.answer("Summarize the template SOP", [source]);
    assert.equal(
      answer.statements[0].citations[0].quote,
      catalog[0].quotes[0].text,
    );
    validateCitations(answer, [source]);
    wrongSource = true;
    await assert.rejects(
      ai.answer("Summarize the template SOP", [source]),
      /INVALID_CITATIONS/,
    );
  } finally {
    global.fetch = old;
  }
});

test("reply layout preserves facts while separating only complete inline numbered sequences", async () => {
  const { formatInlineSteps } = await import(
    "@maintenance/api-client/chat-format"
  );
  const raw =
    "Short overview: 1) Review revision 0.1. 2) Confirm the job. 3) Ask the supervisor.";
  assert.equal(
    formatInlineSteps(raw),
    "Short overview:\n\n1. Review revision 0.1.\n\n2. Confirm the job.\n\n3. Ask the supervisor.",
  );
  for (const text of [
    "A value is 2.5 and section 2) is referenced.",
    "Labels 1) and 3) are not consecutive.",
    "1. Existing list\n2. Existing layout",
    "Literal `1) example 2) example`",
    "Hello!",
    "Code: ```1) A 2) B```",
  ])
    assert.equal(formatInlineSteps(text), text);
  assert.equal(
    formatInlineSteps(formatInlineSteps(raw)),
    formatInlineSteps(raw),
  );
});
