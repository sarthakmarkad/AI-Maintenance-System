import { test, expect, type Page } from "@playwright/test";
import { setup, signIn } from "./helpers";
import { emptyPatterns } from "./anomalies-fixtures";
import { readingFixture } from "../../apps/api/src/tests/readings-fixtures";
import {
  parseReadings,
  localDayStart,
  REVIEW_POLICY,
  type ReadingStage,
} from "../../apps/api/src/readings/parser";
import {
  analyse,
  type Observation,
} from "../../apps/api/src/readings/analysis";
let buffer: Buffer, stage: ReadingStage;
const id = "36e821c7-e4c3-4029-8f14-e01893b97893",
  receipt = "2026-10-17T10:00:00.000Z";
test.beforeAll(async () => {
  buffer = await readingFixture({ invalid: true });
  stage = await parseReadings(buffer, "synthetic-readings.xlsx");
});
function trends(saved: boolean) {
  const rows = (saved ? stage.rows.filter((r) => r.eligible) : []).map((r) => ({
    ...r,
    hotTempC: r.hotTempC!,
    coldTempC: r.coldTempC!,
    pressureBar: r.pressureBar!,
    measuredAt: new Date(r.measuredAt!),
    receivedAt: new Date(receipt),
    importId: id,
  }));
  return {
    source: "SYNTHETIC",
    timezone: "Asia/Kolkata",
    policyVersion: REVIEW_POLICY,
    from: "2026-09-01",
    to: "2026-09-01",
    hasData: saved,
    observations: rows.length,
    latestMeasuredAt: saved ? rows.at(-1)!.measuredAt.toISOString() : null,
    lastReceivedAt: saved ? receipt : null,
    ...analyse(
      rows as Observation[],
      localDayStart("2026-09-01"),
      localDayStart("2026-09-02"),
    ),
    rows: rows.map((r) => ({
      ...r,
      measuredAt: r.measuredAt.toISOString(),
      receivedAt: receipt,
      filename: stage.filename,
      sheet: stage.sheet,
      workbookHash: stage.workbookHash,
    })),
    imports: saved
      ? [
          {
            id,
            filename: stage.filename,
            sheet: stage.sheet,
            workbookHash: stage.workbookHash,
            receivedAt: receipt,
            observations: 3,
          },
        ]
      : [],
  };
}
async function mocks(
  page: Page,
  options: {
    role?: string;
    saved?: boolean;
    conflict?: boolean;
    expired?: boolean;
  } = {},
) {
  await setup(page, options.role ?? "ADMINISTRATOR");
  let saved = options.saved ?? false,
    conflicted = false;
  await page.route("**/api/machines/WH-C/readings/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (options.expired) {
      await route.fulfill({
        status: 401,
        json: { message: "Session expired." },
      });
      return;
    }
    if (path.includes("/anomalies")) {
      await route.fulfill({ json: emptyPatterns() });
      return;
    }
    if (path.endsWith("/trends")) {
      await route.fulfill({ json: trends(saved) });
      return;
    }
    if (path.endsWith("/commit")) {
      expect(route.request().postDataJSON()).toEqual({
        acknowledgeWarnings: true,
      });
      if (options.conflict) {
        conflicted = true;
        await route.fulfill({
          status: 409,
          json: {
            message:
              "Another import saved these readings. Refresh the preview; no duplicates were added.",
          },
        });
        return;
      }
      saved = true;
      await route.fulfill({
        status: 201,
        json: { importId: id, importedReadings: 3, alreadyCommitted: false },
      });
      return;
    }
    const next = structuredClone(stage);
    if ((saved && route.request().method() === "POST") || conflicted)
      for (const r of next.rows)
        if (r.eligible) {
          r.eligible = false;
          r.alreadyImported = true;
          r.problems.push("Already saved.");
        }
    await route.fulfill({
      status: 201,
      json: {
        ...next,
        id,
        status:
          saved && route.request().method() === "GET" ? "COMMITTED" : "PREVIEW",
        createdAt: receipt,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        committedAt: null,
      },
    });
  });
}
async function open(page: Page) {
  await signIn(page);
  await page.goto("/machines/WH-C/readings");
  await expect(
    page.getByRole("heading", { name: "Process trends", exact: true }),
  ).toBeVisible();
}
async function preview(page: Page) {
  await page
    .getByRole("button", { name: "Import synthetic readings", exact: true })
    .click();
  await page.locator("#reading-file").setInputFiles({
    name: "synthetic-readings.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page
    .getByRole("button", { name: "Preview reading workbook", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Reading validation preview",
      exact: true,
    }),
  ).toBeVisible();
}
const ack =
  "I reviewed the exclusions and understand these are synthetic hourly readings with invented review bands.";
test("reading review excludes invalid rows, requires acknowledgement, commits and retains trends on reload", async ({
  page,
}) => {
  await mocks(page);
  await open(page);
  await expect(
    page.getByRole("heading", {
      name: "No saved process readings for this period",
    }),
  ).toBeVisible();
  await preview(page);
  const sourceDetails = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Source details$/ }) });
  await expect(sourceDetails.locator("small")).toBeHidden();
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails).toContainText(stage.workbookHash.slice(0, 16));
  await expect(sourceDetails).toContainText(stage.parserVersion);
  await expect(
    page.getByText("1 excluded rows", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Import 3 valid observations",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel(ack, { exact: true }).check();
  await page
    .getByRole("button", { name: "Import 3 valid observations", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "3 synthetic observations saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Hot temperature",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pressure", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("3 / 24 hours", { exact: false })).toBeVisible();
  await page.getByLabel("Review samples only", { exact: true }).check();
  await expect(page.getByText("1–3 of 3", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/readings-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review reading source", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved reading source", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Synthetic reading import", exact: true }),
  ).toBeInViewport();
});
test("operators see separate timestamps and trends without workbook import controls", async ({
  page,
}) => {
  await mocks(page, { role: "OPERATOR", saved: true });
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Retrospective review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Import synthetic readings",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Latest measurement in dataset", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Last received / imported", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review reading source", exact: true }),
  ).toHaveCount(0);
});
test("reading conflicts require a new preview and prevent duplicate confirmation", async ({
  page,
}) => {
  await mocks(page, { conflict: true });
  await open(page);
  await preview(page);
  await page.getByLabel(ack, { exact: true }).check();
  await page
    .getByRole("button", { name: "Import 3 valid observations", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "no duplicates were added" }),
  ).toContainText("no duplicates were added");
  await page
    .getByRole("button", { name: "Preview reading workbook", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Import 0 valid observations",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByLabel(ack, { exact: true })).not.toBeChecked();
});
test("expired process requests use the shared sign-in expiry flow", async ({
  page,
}) => {
  await mocks(page, { expired: true });
  await signIn(page);
  await page.goto("/machines/WH-C/readings");
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
