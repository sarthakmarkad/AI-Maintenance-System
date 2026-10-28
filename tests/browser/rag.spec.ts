// Chat presentation uses intercepted Auth/API. SQL ownership/evidence are tested in rag.integration.ts.
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { setup, signIn } from "./helpers";
const base = "/machines/WH-C/assistant",
  doc = "e368802a-0bde-4199-893b-8951005abe86",
  file = "ba93b838-e74f-4920-9a87-f32504bc080a",
  index = "9383d491-297b-48fa-8ccc-5c717ee768c8";
const question = "How should the TEST indicator be checked?";
async function fixture(
  page: Page,
  role = "OPERATOR",
  mode = "ready",
  failure = 0,
  coverage?: "FULL_INDEXED_REFERENCE" | "EXCERPTS",
  omittedStatements = 0,
  fallback = false,
  customAnswer?: any,
) {
  await setup(page, role);
  const requests: any[] = [],
    threads: any[] = [];
  let retries = 0,
    failed = false,
    changed = false;
  const status = {
    provider: "commandcode",
    embeddingModel: "nomic-embed-text:v1.5",
    configured: mode !== "unconfigured",
    canManage: ["ADMINISTRATOR", "MAINTENANCE_HEAD"].includes(role),
    approved: mode === "empty" ? 0 : 1,
    ready: mode === "ready" ? 1 : 0,
    items:
      mode === "empty"
        ? []
        : [
            {
              documentId: doc,
              fileId: file,
              title: "TEST temperature SOP",
              fileNumber: 1,
              indexId: index,
              status:
                mode === "failed"
                  ? "FAILED"
                  : mode === "ready"
                    ? "READY"
                    : "QUEUED",
              pages: 1,
              chunks: 1,
              error: mode === "failed" ? "OCR_REQUIRED" : null,
            },
          ],
  };
  const answer = () =>
    changed
      ? {
          status: "SOURCE_CHANGED",
          message:
            "The references used for this reply have changed. Ask again to check the current approved documents.",
          policy: "approved-documents-v1",
          coverage: { approved: 0, ready: 0 },
          statements: [],
          sources: [],
        }
      : {
          status: fallback ? "REFERENCE_EXCERPTS" : "ANSWERED",
          message: fallback
            ? "I could not finish a verified AI summary. Here is the reference text verbatim instead; this is not a generated summary."
            : "Answer from approved references.",
          policy: "approved-documents-v1",
          coverage: {
            approved: 1,
            ready: 1,
            ...(coverage
              ? {
                  scope: coverage,
                  omittedStatements,
                  pages: [1, 2, 3, 4],
                  totalPages: 4,
                }
              : {}),
          },
          statements: [
            {
              text: "TEST training only: inspect the visible indicator from a safe position.",
              citations: [
                {
                  sourceId: "S1",
                  quote: "Inspect the visible indicator from a safe position.",
                },
              ],
            },
          ],
          sources: [
            {
              id: "S1",
              documentId: doc,
              fileId: file,
              title: "TEST temperature SOP",
              filename: "TEST.pdf",
              fileNumber: 1,
              documentVersion: 2,
              approvalId: "test-approval",
              page: 1,
              text: "TEST training only. Inspect the visible indicator from a safe position.",
            },
          ],
        };
  await page.route("**/api/machines/WH-C/assistant/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    expect(req.headers().authorization).toMatch(/^Bearer /);
    if (path.endsWith("/status")) {
      await route.fulfill({ json: status });
      return;
    }
    if (path.endsWith("/retry")) {
      retries++;
      await route.fulfill({ json: { queued: true } });
      return;
    }
    if (path.endsWith("/chat")) {
      const body = req.postDataJSON();
      requests.push(body);
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.history).toBeUndefined();
      if (failure && !failed) {
        failed = true;
        await route.fulfill({
          status: failure,
          json: {
            message:
              failure === 409
                ? "References changed before the reply was saved. Please ask again."
                : "TEST service unavailable",
          },
        });
        return;
      }
      let chat = threads.find((c) => c.id === body.chatId);
      if (!chat) {
        chat = {
          id: randomUUID(),
          title: body.question,
          turns: [],
          updatedAt: new Date().toISOString(),
        };
        threads.unshift(chat);
      }
      const turn = {
        id: randomUUID(),
        ordinal: chat.turns.length + 1,
        question: body.question,
        at: new Date().toISOString(),
        answer:
          /^(hiii|hii what question|what is an sop|what is preventive|explain that concept)/i.test(
            body.question,
          )
            ? {
                status: "GENERAL_ANSWER",
                message:
                  "Hi! I can answer general questions and check your manuals or SOPs when needed.",
                policy: "hybrid-chat-v1",
                statements: [],
                sources: [],
                coverage: { approved: 0, ready: 0 },
              }
            : answer(),
      };
      if (customAnswer) turn.answer = customAnswer;
      chat.turns.push(turn);
      await route.fulfill({
        json: { chatId: chat.id, turn, alreadyApplied: false },
      });
      return;
    }
    if (path.endsWith("/archive")) {
      const chatId = path.split("/").at(-2);
      const position = threads.findIndex((c) => c.id === chatId);
      if (position >= 0) threads.splice(position, 1);
      return route.fulfill({ json: { removed: true } });
    }
    if (path.endsWith("/chats")) {
      await route.fulfill({
        json: {
          items: threads.map((c) => ({
            id: c.id,
            title: c.title,
            turns: c.turns.length,
            updatedAt: c.updatedAt,
          })),
          nextCursor: null,
        },
      });
      return;
    }
    const id = path.split("/").at(-1),
      chat = threads.find((c) => c.id === id);
    await route.fulfill(
      chat
        ? {
            json: {
              id,
              title: chat.title,
              total: chat.turns.length,
              turns: chat.turns.map((t: any) => ({
                ...t,
                answer: changed ? answer() : t.answer,
              })),
              before: null,
            },
          }
        : { status: 404, json: { message: "Conversation not found." } },
    );
  });
  await page.route("**/api/machines/WH-C/documents/**/download?**", (route) =>
    route.fulfill({
      body: Buffer.from("%PDF-1.7\nTEST\n%%EOF"),
      contentType: "application/octet-stream",
    }),
  );
  await signIn(page);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Maintenance assistant", exact: true }),
  ).toBeVisible();

  return {
    requests,
    retries: () => retries,
    threads,
    withdraw: () => {
      changed = true;
    },
  };
}
async function send(page: Page, text = question) {
  await page.getByLabel("Message the maintenance assistant").fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("article", { name: /Assistant reply/ }).last(),
  ).toBeVisible();
  await expect(page).toHaveURL(/\?chat=/);
}
test("a user removes a saved conversation through a confirmation popup", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page, "hiii");
  if (test.info().project.name === "mobile")
    await page
      .getByRole("button", { name: "Show conversation history", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Remove conversation: hiii", exact: true })
    .click();
  await page.screenshot({
    path: `.local/removal-chat-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("dialog", { name: "Remove conversation" })
    .getByRole("button", { name: "Confirm removal" })
    .click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect.poll(() => f.threads.length).toBe(0);
  await expect(
    page.getByRole("article", { name: /Assistant reply/ }),
  ).toHaveCount(0);
});
test("successful removal stays removed when the conversation-list refresh fails", async ({
  page,
}) => {
  await fixture(page);
  await send(page, "hiii");
  await page.route("**/assistant/chats", (route) =>
    route.fulfill({ status: 503, json: { message: "TEST list unavailable" } }),
  );
  if (test.info().project.name === "mobile")
    await page
      .getByRole("button", { name: "Show conversation history", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Remove conversation: hiii", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Remove conversation" })
    .getByRole("button", { name: "Confirm removal" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Remove conversation: hiii",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Conversation removed. The list could not refresh; reopen this page to reload it.",
    ),
  ).toBeVisible();
});
for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "MAINTENANCE_HEAD",
  "SUPERVISOR",
  "MANAGEMENT",
  "ADMINISTRATOR",
]) {
  test(`${role} has a conversational chat with private history and expandable source citations`, async ({
    page,
  }, info) => {
    const f = await fixture(page, role);
    await page.getByRole("button", { name: /Explain a procedure/ }).click();
    await expect(
      page.getByLabel("Message the maintenance assistant"),
    ).toHaveValue(/Walk me through/);
    expect(f.requests.length).toBe(0);
    await send(page);
    await expect(
      page.getByRole("article", { name: "Assistant reply 1", exact: true }),
    ).toContainText("TEST training only");
    await expect(page).toHaveURL(/\?chat=/);
    await page
      .getByRole("button", { name: "Source 1 for reply 1", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sources for this reply" }),
    ).toBeVisible();
    await expect(
      page.getByText("Approved version 1 · Page 1", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("blockquote")).toContainText(
      "Inspect the visible indicator",
    );
    if (role === "MAINTENANCE_HEAD")
      await page.screenshot({
        path: info.outputPath("maintenance-chat-sources.png"),
        fullPage: true,
      });
    const d = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download source PDF" }).click();
    expect((await d).suggestedFilename()).toBe("TEST.pdf");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Source 1 for reply 1", exact: true }),
    ).toBeFocused();
    await send(page, "Can you explain that more simply?");
    expect(f.requests[1].chatId).toBe(f.threads[0].id);
    await expect(
      page.getByRole("article", { name: "Assistant reply 2", exact: true }),
    ).toBeVisible();
    expect(f.requests.length).toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (role === "MAINTENANCE_HEAD")
      await page.screenshot({
        path: info.outputPath("maintenance-chat.png"),
        fullPage: true,
      });
  });
}
test("new chat clears the composer and saved history can be reopened after reload", async ({
  page,
}, info) => {
  await fixture(page);
  await page.screenshot({
    path: info.outputPath("maintenance-chat-welcome.png"),
    fullPage: true,
  });
  await send(page);
  const saved = page.url();
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: /How can I help/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Message the maintenance assistant"),
  ).toHaveValue("");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "Show conversation history", exact: true })
      .click();
  await page.getByRole("button", { name: question, exact: true }).click();
  await expect(page).toHaveURL(saved);
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Assistant reply 1", exact: true }),
  ).toContainText("TEST training only");
});
for (const mode of ["empty", "unconfigured", "queued", "failed"]) {
  test(`${mode} state keeps knowledge status separate from general conversation`, async ({
    page,
  }) => {
    const f = await fixture(page, "MAINTENANCE_HEAD", mode);
    await page.getByLabel("Message the maintenance assistant").fill("hiii");
    const sendButton = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    if (mode === "unconfigured") await expect(sendButton).toBeDisabled();
    else await expect(sendButton).toBeEnabled();
    await page.getByRole("button", { name: /Knowledge/ }).click();
    await expect(
      page.getByRole("heading", { name: "Knowledge sources" }),
    ).toBeVisible();
    if (mode === "failed") {
      await expect(page.getByText(/No readable text found/)).toBeVisible();
      await page.getByRole("button", { name: "Retry preparation" }).click();
      await expect(
        page.getByText("The reference is queued. Refresh sources shortly."),
      ).toBeVisible();
      expect(f.retries()).toBe(1);
    }
    expect(f.requests.length).toBe(0);
    await page.keyboard.press("Escape");
    if (mode !== "unconfigured") {
      await send(page, "hiii");
      const reply = page.getByRole("article", {
        name: "Assistant reply 1",
        exact: true,
      });
      await expect(reply).toContainText("Hi! I can answer general questions");
      await expect(reply).toContainText("General knowledge");
      await expect(reply.getByRole("button", { name: /source/ })).toHaveCount(
        0,
      );
    }
  });
}
test("reader sees reference readiness without preparation controls", async ({
  page,
}) => {
  await fixture(page, "TECHNICIAN", "failed");
  await page.getByRole("button", { name: /Knowledge/ }).click();
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Knowledge sources" }),
  ).toHaveCount(0);
});
for (const code of [503, 409, 403, 401]) {
  test(`${code} chat failure retains the unsent question and never auto-retries`, async ({
    page,
  }) => {
    const f = await fixture(page, "OPERATOR", "ready", code);
    await page.getByLabel("Message the maintenance assistant").fill(question);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    if (code === 401) await expect(page).toHaveURL(/\/login\?reason=expired/);
    else {
      await expect(
        page.getByRole("alert").filter({
          hasText:
            code === 409 ? "References changed" : "TEST service unavailable",
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Message the maintenance assistant"),
      ).toHaveValue(question);
      await expect(
        page.getByRole("article", { name: /Assistant reply/ }),
      ).toHaveCount(0);
    }
    expect(f.requests.length).toBe(1);
    if (code === 503) {
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await expect(
        page.getByRole("article", { name: "Assistant reply 1", exact: true }),
      ).toBeVisible();
      expect(f.requests[0].requestId).toBe(f.requests[1].requestId);
    }
  });
}
test("withdrawn evidence is removed when an existing saved chat is reopened", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  f.withdraw();
  await page.reload();
  await expect(
    page.getByText("Reference updated", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "TEST training only: inspect the visible indicator from a safe position.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View 1 source/ })).toHaveCount(
    0,
  );
});
test("Enter sends a message; Shift Enter preserves a newline without sending", async ({
  page,
}) => {
  const f = await fixture(page);
  const input = page.getByLabel("Message the maintenance assistant");
  await input.fill(question);
  await input.press("Shift+Enter");
  expect(f.requests.length).toBe(0);
  await input.press("Enter");
  await expect(
    page.getByRole("article", { name: "Assistant reply 1", exact: true }),
  ).toBeVisible();
  expect(f.requests.length).toBe(1);
});

test("new chat remains usable when an earlier conversation is still loading", async ({
  page,
}, info) => {
  await fixture(page);
  await send(page);
  const saved = new URL(page.url()).searchParams.get("chat");
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .last()
    .click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/assistant/chats/${saved}`, async (route) => {
    await held;
    await route.fallback();
  });
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "Show conversation history", exact: true })
      .click();
  await page.getByRole("button", { name: question, exact: true }).click();
  await expect(
    page.getByText("Opening conversation…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: /How can I help/ }),
  ).toBeVisible();
  release();
  await send(page, "What does the TEST SOP say?");
  await expect(
    page.getByRole("article", { name: "Assistant reply 1", exact: true }),
  ).toBeVisible();
});

test("the reported greeting and capability exchange is conversational with sources only on document questions", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page, "hiii");
  await send(page, "hii what question can u anser");
  const general = page.getByRole("article", {
    name: "Assistant reply 2",
    exact: true,
  });
  await expect(general).toContainText("Hi! I can answer general questions");
  await expect(general.getByRole("button", { name: /source/ })).toHaveCount(0);
  await send(page, question);
  await expect(
    page
      .getByRole("article", { name: "Assistant reply 3", exact: true })
      .getByRole("button", { name: "View 1 source" }),
  ).toBeVisible();
  await send(page, "What is an SOP?");
  const next = page.getByRole("article", {
    name: "Assistant reply 4",
    exact: true,
  });
  await expect(next).toContainText("General knowledge");
  await expect(next.getByRole("button", { name: /source/ })).toHaveCount(0);
  expect(f.requests[3].chatId).toBe(f.requests[2].chatId);
});

for (const coverage of ["FULL_INDEXED_REFERENCE", "EXCERPTS"] as const) {
  test(`${coverage} summary explains its coverage without claiming unavailable instructions`, async ({
    page,
  }) => {
    await fixture(page, "MAINTENANCE_HEAD", "ready", 0, coverage);
    await send(page, "Summarize all instructions in the SOP");
    const reply = page.getByRole("article", {
      name: "Assistant reply 1",
      exact: true,
    });
    await expect(reply).toContainText(
      coverage === "FULL_INDEXED_REFERENCE"
        ? "all indexed text"
        : "not every instruction",
    );
    await expect(reply).toContainText("Pages: 1, 2, 3, 4");
  });
}

test("an omitted summary statement is disclosed rather than presented as a complete verified answer", async ({
  page,
}) => {
  await fixture(
    page,
    "MAINTENANCE_HEAD",
    "ready",
    0,
    "FULL_INDEXED_REFERENCE",
    1,
  );
  await send(page, "Summarize the SOP");
  await expect(
    page.getByRole("article", { name: "Assistant reply 1", exact: true }),
  ).toContainText("Some draft statements failed source checks");
});

test("provider fallback is labeled as verbatim reference text and retains citations and coverage", async ({
  page,
}) => {
  await fixture(
    page,
    "MAINTENANCE_HEAD",
    "ready",
    0,
    "FULL_INDEXED_REFERENCE",
    0,
    true,
  );
  await send(page, "Summarize the SOP");
  const reply = page.getByRole("article", {
    name: "Assistant reply 1",
    exact: true,
  });
  await expect(reply).toContainText("not a generated summary");
  await expect(reply).toContainText("all indexed text");
  await expect(
    reply.getByRole("button", { name: "View 1 source" }),
  ).toBeVisible();
  await expect(
    reply.getByText("General knowledge", { exact: true }),
  ).toHaveCount(0);
});

for (const outcome of ["success", "failure"] as const) {
  test(`composer clears immediately and preserves next draft on ${outcome}`, async ({
    page,
  }) => {
    const f = await fixture(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received!: () => void;
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(
      "**/api/machines/WH-C/assistant/chat",
      async (route) => {
        received();
        await gate;
        if (outcome === "failure")
          await route.fulfill({
            status: 503,
            json: { message: "TEST delayed failure" },
          });
        else await route.fallback();
      },
      { times: 1 },
    );
    const input = page.getByLabel("Message the maintenance assistant");
    try {
      await input.fill(question);
      await input.press("Enter");
      await started;
      await expect(input).toHaveValue("");
      await expect(page.getByText(question, { exact: true })).toBeVisible();
      await input.fill("My next question");
      await input.press("Enter");
      expect(f.requests).toHaveLength(0);
      release();
      if (outcome === "failure")
        await expect(
          page.getByRole("alert").filter({ hasText: "TEST delayed failure" }),
        ).toContainText("TEST delayed failure");
      else
        await expect(
          page.getByRole("article", { name: "Assistant reply 1", exact: true }),
        ).toBeVisible();
      await expect(input).toHaveValue("My next question");
      if (outcome === "failure") {
        await page
          .getByRole("button", { name: "Try again", exact: true })
          .click();
        await expect(
          page.getByRole("article", { name: "Assistant reply 1", exact: true }),
        ).toBeVisible();
        expect(f.requests[0].question).toBe(question);
        await expect(input).toHaveValue("My next question");
      }
    } finally {
      release();
    }
  });
}

const generalReply = (message: string) => ({
  status: "GENERAL_ANSWER",
  message,
  policy: "hybrid-chat-v1",
  statements: [],
  sources: [],
  coverage: { approved: 0, ready: 0 },
});
test("chat replies render readable headings lists tables and code without executing model HTML", async ({
  page,
}) => {
  await fixture(
    page,
    "OPERATOR",
    "ready",
    0,
    undefined,
    0,
    false,
    generalReply(
      "## Setup overview\n\nThis is a **general overview**.\n\n1. Confirm the job.\n2. Review the documents.\n   - Confirm the revision.\n   - Ask the supervisor.\n\n| Check | Result |\n| --- | --- |\n| Training | Required |\n\nUse `jobId` for a record.\n\n```text\nNo machine settings supplied\n```\n\n<script>window.chatInjected=true</script>\n\n[Unsafe](javascript:alert(1)) ![remote](https://example.com/tracking.png)\n\n[Background](https://example.com/reference)",
    ),
  );
  await send(page, "Give a formatted general explanation");
  const reply = page.getByRole("article", {
    name: "Assistant reply 1",
    exact: true,
  });
  await expect(
    reply.getByRole("heading", { name: "Setup overview" }),
  ).toBeVisible();
  await expect(reply.locator("strong")).toHaveText("general overview");
  await expect(reply.locator("ol > li")).toHaveCount(2);
  await expect(reply.locator("ul > li")).toHaveCount(2);
  await expect(reply.getByRole("table")).toContainText("Training");
  await expect(reply.locator("pre code")).toHaveText(
    "No machine settings supplied\n",
  );
  await expect(reply.locator("img,script,a[href^='javascript:']")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => (window as any).chatInjected),
  ).toBeUndefined();
  await expect(reply.getByRole("link", { name: "Background" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  const bounds = await reply.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Setup overview" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Assistant reply 1", exact: true })
      .locator("ol > li"),
  ).toHaveCount(2);
  await page.screenshot({
    path: `test-results/chat-reply-format-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("older inline numbered replies display as distinct steps and preserve decimal values", async ({
  page,
}) => {
  await fixture(
    page,
    "OPERATOR",
    "ready",
    0,
    undefined,
    0,
    false,
    generalReply(
      "Here is a short overview: 1) Confirm the document revision 0.1. 2) Review the material record. 3) Ask the supervisor.",
    ),
  );
  await send(page);
  const reply = page.getByRole("article", {
    name: "Assistant reply 1",
    exact: true,
  });
  await expect(reply.locator("ol > li")).toHaveCount(3);
  await expect(reply.locator("ol > li").first()).toContainText("revision 0.1.");
  await expect(reply).toContainText("Here is a short overview:");
});
test("ordinary numeric prose stays prose rather than becoming a false step list", async ({
  page,
}) => {
  await fixture(
    page,
    "OPERATOR",
    "ready",
    0,
    undefined,
    0,
    false,
    generalReply(
      "Revision 0.1 is a draft. The comparison uses values 2.5 and 3.5; section 2) is a reference label.",
    ),
  );
  await send(page);
  const reply = page.getByRole("article", {
    name: "Assistant reply 1",
    exact: true,
  });
  await expect(reply.locator("ol")).toHaveCount(0);
  await expect(reply).toContainText("values 2.5 and 3.5");
});

test("formatted document points retain their own source controls", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  const answer = f.threads[0].turns[0].answer;
  answer.statements = [
    {
      ...answer.statements[0],
      text: "**Training only.** Inspect the visible indicator from a safe position.",
    },
    {
      ...answer.statements[0],
      text: "**Record observations.** Use the displayed indicator information.",
    },
  ];
  await page.reload();
  const reply = page.getByRole("article", {
    name: "Assistant reply 1",
    exact: true,
  });
  await expect(reply.locator("ul > li")).toHaveCount(2);
  await expect(reply.locator("strong")).toHaveCount(2);
  await expect(
    reply.getByRole("button", { name: "Source 1 for reply 1", exact: true }),
  ).toHaveCount(2);
  await reply
    .getByRole("button", { name: "Source 1 for reply 1", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Sources for this reply" }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toContainText(
    "Inspect the visible indicator",
  );
});
