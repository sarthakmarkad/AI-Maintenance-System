import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
const id = "06edc460-6be7-46a4-876c-b35980e581a9",
  path = `/machines/WH-C/work-orders/${id}`;
function order(kind = "BREAKDOWN", role = "TECHNICIAN") {
  return {
    id,
    kind,
    title: "TEST RCA vibration fixture",
    description: "Synthetic browser fixture only. No authentic incident.",
    priority: "NORMAL",
    impact: "OBSERVATION",
    status: "IN_PROGRESS",
    version: 3,
    reportedAt: "2026-09-01T02:00:00Z",
    observedAt: null,
    reporter: { userId, displayName: "TEST operator" },
    technician: { userId, displayName: "TEST technician" },
    startedAt: "2026-09-01T02:30:00Z",
    findings: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    restoredAt: null,
    submittedAt: null,
    returnReason: null,
    reviewedAt: null,
    reviewer: null,
    closedAt: null,
    closer: null,
    performedAt: null,
    investigationOutcome: null,
    investigationReview: null,
    maintenanceOccurrence: null,
    anomalyReviewId: null,
    updatedAt: "2026-09-01T02:30:00Z",
    events: [],
    historyNextVersion: null,
    attachments: [],
    canUploadAttachment: false,
    attachmentLimit: 20,
    attachmentMaxBytes: 5242880,
    allowedActions: role === "TECHNICIAN" ? ["submit"] : [],
  };
}
function receipt(requestId: string) {
  const source = {
    id: "S2",
    text: "TEST recorded vibration; no cause established",
    attribution: "Original operator report: symptoms",
    origin: "ORIGINAL_REPORT",
    eventId: null,
    eventVersion: null,
    recordedAt: "2026-09-01T02:00:00Z",
  };
  return {
    id: "e18b8952-9e55-494f-9d8c-95958463383f",
    requestId,
    orderId: id,
    version: 3,
    sourceHash: "a".repeat(64),
    model: "deepseek/deepseek-v4.1-flash",
    policy: "recorded-text-rca-v1",
    requestedBy: userId,
    createdAt: "2026-09-01T03:00:00Z",
    completedAt: "2026-09-01T03:00:30Z",
    status: "GENERATED",
    stale: false,
    reason: null,
    snapshot: {
      sources: [source],
      coverage:
        "Recorded work-order text only. No image, OCR or SOP retrieval.",
    },
    draft: {
      status: "INSUFFICIENT_EVIDENCE",
      facts: [source],
      factSourceIds: ["S2"],
      hypotheses: [],
      missingChecks: [
        { text: "Inspect and record actual measurements", sourceIds: ["S2"] },
      ],
      correctiveProposals: [
        { text: "Inspect before selecting repairs", sourceIds: ["S2"] },
      ],
      preventiveProposals: [],
      proposed: {
        findings: "TEST draft inspection note",
        rootCause: "Insufficient evidence; root cause remains unconfirmed",
        correctiveAction: "Proposed checks only; not performed",
        preventiveAction: "Proposed follow-up for human review",
      },
      limitations: "AI advisory only",
    },
  };
}
async function fixture(page: Page, role = "TECHNICIAN", kind = "BREAKDOWN") {
  await setup(page, role);
  let seededHistory: any[] | null = null;
  let model = order(kind, role),
    writes: any[] = [],
    generations: any[] = [],
    histories = 0;
  let generate: (body: any) => Promise<{ status?: number; json: any }> = async (
    body,
  ) => ({ json: receipt(body.requestId) });
  await page.route(
    "http://127.0.0.1:4400/api/machines/WH-C/work-orders/**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/rca-drafts")) {
        if (route.request().method() === "GET") {
          histories++;
          return route.fulfill({
            json: {
              items:
                seededHistory ??
                (generations.length ? [receipt(generations[0].requestId)] : []),
              nextCursor: null,
            },
          });
        }
        const body = route.request().postDataJSON();
        generations.push(body);
        return route.fulfill(await generate(body));
      }
      if (url.pathname.includes("/actions/")) {
        writes.push(route.request().postDataJSON());
        model = {
          ...model,
          status: "AWAITING_REVIEW",
          version: 4,
          allowedActions: [],
        };
        return route.fulfill({ json: model });
      }
      if (url.pathname.endsWith("/" + id))
        return route.fulfill({ json: model });
      return route.fulfill({ json: { items: [], nextCursor: null } });
    },
  );
  await signIn(page);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: model.title })).toBeVisible();
  return {
    writes,
    generations,
    seedHistory(items: any[]) {
      seededHistory = items;
    },
    histories: () => histories,
    setGenerate(fn: typeof generate) {
      generate = fn;
    },
    changeVersion() {
      model = { ...model, version: 4 };
    },
  };
}
async function completion(page: Page) {
  await page
    .getByRole("button", { name: "Submit repair", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toBeVisible();
}
const manual = async (page: Page) => {
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST human inspection");
  await page
    .getByRole("textbox", { name: "Human root-cause analysis", exact: true })
    .fill("TEST human cause analysis");
  await page
    .getByRole("textbox", { name: "Corrective action", exact: true })
    .fill("TEST actual repair performed");
  await page
    .getByRole("textbox", { name: "Preventive action", exact: true })
    .fill("TEST human preventive plan");
  await page
    .getByLabel("Service restored (IST)", { exact: true })
    .fill("2026-09-01T09:00");
};

test("explicit generation retains attribution, allows reviewed editing/apply and never autofills restoration", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  expect(f.generations).toHaveLength(0);
  expect(f.histories()).toBe(0);
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST current human input");
  await expect(page.getByText(/not private scratch notes/)).toBeVisible();
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(
    page.getByText("Insufficient evidence to establish a cause.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(f.generations).toHaveLength(1);
  expect(f.generations[0].human.findings).toBe("TEST current human input");
  expect(f.writes).toHaveLength(0);
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST current human input");
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Proposed inspection findings")
    .fill("TEST technician revised suggestion");
  await page
    .getByRole("button", { name: "Use inspection findings", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST technician revised suggestion");
  await page
    .getByRole("button", { name: "Apply reviewed draft", exact: true })
    .click();
  await page
    .getByRole("region", { name: "AI-assisted RCA drafting" })
    .screenshot({
      path: `.local/rca-browser-results/${test.info().project.name}-draft-panel.png`,
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("textbox", {
      name: "Human root-cause analysis",
      exact: true,
    }),
  ).toHaveValue(/unconfirmed/);
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Corrective action", exact: true })
    .fill("TEST actual performed checks after human review");
  await page
    .getByLabel("Service restored (IST)", { exact: true })
    .fill("2026-09-01T09:00");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].correctiveAction).toBe(
    "TEST actual performed checks after human review",
  );
  expect(f.writes[0].restoredAt).toBe("2026-09-01T03:30:00.000Z");
  expect(Object.keys(f.writes[0]).sort()).toEqual(
    [
      "version",
      "findings",
      "rootCause",
      "correctiveAction",
      "preventiveAction",
      "restoredAt",
    ].sort(),
  );
  await page.screenshot({
    path: `.local/rca-browser-results/${test.info().project.name}-review.png`,
    fullPage: true,
  });
});
test("pending success preserves newer form edits and prevents delayed overwrite on Apply", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setGenerate(async (body) => {
    await gate;
    return { json: receipt(body.requestId) };
  });
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST first note");
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(page.getByText(/form stays editable/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST newer note while waiting");
  release();
  await expect(
    page.getByRole("button", { name: "Apply reviewed draft", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use inspection findings", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Apply reviewed draft", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST newer note while waiting");
  expect(f.writes).toHaveLength(0);
});
test("provider errors preserve current manual form and original request key; manual submission remains usable", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  await manual(page);
  f.setGenerate(async () => ({
    status: 503,
    json: { message: "AI unavailable; continue manually" },
  }));
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(
    page
      .getByText("AI unavailable; continue manually", { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST preserved new manual edit");
  await page
    .getByRole("button", { name: "Retrieve original request", exact: true })
    .click();
  await expect.poll(() => f.generations.length).toBe(2);
  expect(f.generations[1]).toEqual(f.generations[0]);
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST preserved new manual edit");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].findings).toBe("TEST preserved new manual edit");
});
test("retained source history is lazy, scoped advisory evidence and not a claim of unedited submission", async ({
  page,
}) => {
  const f = await fixture(page, "MAINTENANCE_HEAD");
  f.seedHistory([receipt("retained-fixture-request")]);
  expect(f.histories()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Generate AI draft", exact: true }),
  ).toHaveCount(0);
  await page.getByText("AI drafting evidence", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Retained AI draft history" }),
  ).toBeVisible();
  await expect(
    page.getByText(/does not identify submitted text as an unedited AI draft/),
  ).toBeVisible();
  // Development StrictMode can start an aborted read before the committed one.
  // Check lazy, read-only behavior rather than the number of GET attempts.
  expect(f.histories()).toBeGreaterThan(0);
  expect(f.generations).toHaveLength(0);
  expect(f.writes).toHaveLength(0);
  await page.getByText(/Version 3 · generated/).click();
  await page
    .getByText(
      "Original generated suggestions (may differ from the submitted human report)",
      { exact: true },
    )
    .click();
  await expect(
    page.getByText("Insufficient evidence; root cause remains unconfirmed", {
      exact: true,
    }),
  ).toBeVisible();
});
for (const kind of ["PLANNED", "INVESTIGATION"]) {
  test(`${kind.toLowerCase()} completion does not offer breakdown RCA`, async ({
    page,
  }) => {
    await fixture(page, "TECHNICIAN", kind);
    await page
      .getByRole("button", {
        name:
          kind === "PLANNED" ? "Submit maintenance" : "Submit investigation",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "AI-assisted RCA drafting" }),
    ).toHaveCount(0);
  });
}

test("RCA busy conflict keeps manual fields/restoration and normal submission available", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  await manual(page);
  f.setGenerate(async () => ({
    status: 409,
    json: { message: "AI RCA drafting is busy. Try again explicitly later." },
  }));
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(
    page
      .getByText("AI RCA drafting is busy. Try again explicitly later.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST human inspection");
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveValue("2026-09-01T09:00");
  await expect(
    page.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].restoredAt).toBe("2026-09-01T03:30:00.000Z");
});
test("access denial removes retained suggestion text while preserving human form edits", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST human note remains");
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(page.getByLabel("Proposed inspection findings")).toBeVisible();
  f.setGenerate(async () => ({
    status: 403,
    json: { message: "Your role grant was revoked" },
  }));
  await page
    .getByRole("button", { name: "Generate a new draft", exact: true })
    .click();
  await expect(
    page.getByText("Your role grant was revoked", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Proposed inspection findings")).toHaveCount(0);
  await expect(
    page.getByText("TEST recorded vibration; no cause established", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST human note remains");
});

test("stale retained work-order version disables Apply and leaves manual inputs intact", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  await manual(page);
  f.setGenerate(async (body) => ({
    json: { ...receipt(body.requestId), version: 2, stale: true },
  }));
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(page.getByText(/Applying this draft is disabled/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply reviewed draft", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Use inspection findings", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST human inspection");
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveValue("2026-09-01T09:00");
  expect(f.writes).toHaveLength(0);
});
test("delayed provider failure preserves edits and restoration entered while waiting", async ({
  page,
}) => {
  const f = await fixture(page);
  await completion(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setGenerate(async () => {
    await gate;
    return { status: 503, json: { message: "TEST provider unavailable" } };
  });
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST old draft");
  await page
    .getByRole("button", { name: "Generate AI draft", exact: true })
    .click();
  await expect(page.getByText(/form stays editable/)).toBeVisible();
  await manual(page);
  release();
  await expect(
    page.getByText("TEST provider unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST human inspection");
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveValue("2026-09-01T09:00");
  await expect(
    page.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeEnabled();
});
