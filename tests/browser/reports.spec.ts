// Fixtures exercise browser controls/downloads only. Actual files, scope,
// source consistency and audit use the isolated PostgreSQL HTTP suite.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
import { reportFixture } from "../../apps/api/src/tests/reports-fixtures";
import { finish, preview } from "../../apps/api/src/reports/model";
import { renderPdf, renderWorkbook } from "../../apps/api/src/reports/render";
const path = "/machines/WH-C/reports",
  id = "c25dfdba-fb43-47d5-8055-34d10a22834a";
async function mocks(
  page: Page,
  {
    role = "MANAGEMENT",
    count = 3,
    failPreview = 0,
    failDownload = 0,
  }: {
    role?: string;
    count?: number;
    failPreview?: number;
    failDownload?: number;
  } = {},
) {
  await setup(page, role);
  let previewStatus = failPreview,
    downloadFailed = false,
    generation = 0;
  const exports: URL[] = [],
    queries: URL[] = [],
    headers: Record<string, string>[] = [];
  await page.route("**/api/machines/WH-C/reports/**", async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    expect(url.searchParams.has("token")).toBe(false);
    const type = url.searchParams.get("report") ?? "work-orders";
    const s = reportFixture(
      type,
      url.searchParams.get("status") === "CLOSED" ? 1 : count,
    );
    s.from = url.searchParams.get("from") ?? s.from;
    s.to = url.searchParams.get("to") ?? s.to;
    s.basis =
      type === "planned-maintenance"
        ? "Due date"
        : url.searchParams.get("basis") === "closed"
          ? "Closed date"
          : "Created date";
    s.status = url.searchParams.get("status") ?? "ALL";
    if (s.status === "CLOSED") {
      s.counts = { open: 0, closed: s.total, skipped: 0 };
      if (s.rows[0]) s.rows[0].cells[2] = "Closed";
    }
    if (type === "planned-maintenance") {
      s.warning =
        "Some future recurrences have not been generated yet. Generated tasks only.";
      if (s.rows[0]) s.rows[0].orderId = null;
    }
    if (s.sheets[0].rows[0]) s.sheets[0].rows[0][3] = generation;
    const { fingerprint: _, ...data } = s,
      snapshot = finish(data);
    if (url.pathname.endsWith("/preview")) {
      queries.push(url);
      if (previewStatus) {
        await route.fulfill({
          status: previewStatus,
          json: { message: "TEST report preview unavailable" },
        });
        return;
      }
      await route.fulfill({ json: preview(snapshot) });
      return;
    }
    exports.push(url);
    headers.push(route.request().headers());
    if (failDownload && !downloadFailed) {
      downloadFailed = true;
      generation++;
      await route.fulfill({
        status: failDownload,
        json: {
          message:
            failDownload === 409
              ? "Report records changed after preview. Refresh the report before downloading."
              : "TEST export unavailable",
        },
      });
      return;
    }
    if (!url.pathname.includes("/work-orders/"))
      expect(url.searchParams.get("fingerprint")).toBe(snapshot.fingerprint);
    const format = url.searchParams.get("format");
    await route.fulfill({
      body:
        format === "pdf"
          ? await renderPdf(snapshot)
          : await renderWorkbook(snapshot),
      contentType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: {
        "Content-Disposition": `attachment; filename="fixture.${format}"`,
      },
    });
  });
  await signIn(page);
  return {
    exports,
    queries,
    headers,
    recoverPreview: () => {
      previewStatus = 0;
    },
  };
}
async function open(page: Page) {
  await page.goto(path);
  await expect(
    page.getByRole("region", { name: "Report preview" }),
  ).toBeVisible();
}
async function download(page: Page, name: string) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return promise;
}

test("report preview downloads authenticated PDF and Excel with the matching filters and snapshot", async ({
  page,
}, info) => {
  const f = await mocks(page);
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Maintenance reports", exact: true }),
  ).toBeVisible();
  expect((await download(page, "Download PDF")).suggestedFilename()).toMatch(
    /^WH-C-work-orders-.*\.pdf$/,
  );
  expect((await download(page, "Download Excel")).suggestedFilename()).toMatch(
    /\.xlsx$/,
  );
  expect(f.exports).toHaveLength(2);
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Download Excel", exact: true }),
  ).toBeEnabled();
  expect(f.headers[0].authorization).toMatch(/^Bearer /);
  await page.getByRole("region", { name: "Report preview" }).screenshot({
    path: `test-results/reports-${info.project.name}.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("filter edits disable downloads until the new closed-date preview is applied", async ({
  page,
}) => {
  const f = await mocks(page);
  await open(page);
  await page.getByLabel("Date basis").selectOption("closed");
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("CLOSED");
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Filters changed.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  expect(f.queries.at(-1)!.searchParams.get("basis")).toBe("closed");
  await expect(
    page.getByRole("region", { name: "Report preview" }),
  ).toContainText("Closed date");
  await download(page, "Download Excel");
  expect(f.exports[0].searchParams.get("status")).toBe("CLOSED");
});

test("planned report uses fixed due dates and discloses ungenerated recurrences", async ({
  page,
}) => {
  const f = await mocks(page);
  await open(page);
  await page.getByLabel("Report type").selectOption("planned-maintenance");
  await expect(page.getByLabel("Date basis")).toHaveCount(0);
  await expect(page.getByLabel("Work type")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Planned maintenance report",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Some future recurrences", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open calendar", exact: true }),
  ).toBeVisible();
  await download(page, "Download PDF");
  expect(f.exports[0].searchParams.has("basis")).toBe(false);
});

test("investigation report retains synthetic provenance without introducing engineering actions", async ({
  page,
}) => {
  await mocks(page, { role: "MAINTENANCE_HEAD" });
  await open(page);
  await page.getByLabel("Report type").selectOption("investigations");
  await page
    .getByRole("button", { name: "Preview report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Investigation outcomes report",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("SYNTHETIC statistical evidence.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Approve|Assign|Close work order/ }),
  ).toHaveCount(0);
  await download(page, "Download Excel");
});

test("stale source blocks downloads until an explicit preview refresh", async ({
  page,
}) => {
  const f = await mocks(page, { failDownload: 409 });
  await open(page);
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download Excel", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Report records changed" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  await download(page, "Download PDF");
  expect(f.exports).toHaveLength(2);
  expect(f.exports[0].searchParams.get("fingerprint")).not.toBe(
    f.exports[1].searchParams.get("fingerprint"),
  );
});

test("failed preview can retry without losing selected dates", async ({
  page,
}) => {
  const fixture = await mocks(page, { failPreview: 503 });
  await page.goto(path);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "TEST report preview unavailable" }),
  ).toBeVisible();
  const from = await page.getByLabel("From (IST)").inputValue();
  fixture.recoverPreview();
  await page
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Report preview" }),
  ).toBeVisible();
  await expect(page.getByLabel("From (IST)")).toHaveValue(from);
});

test("empty report still offers explicit zero-record downloads", async ({
  page,
}) => {
  await mocks(page, { count: 0 });
  await open(page);
  await expect(
    page.getByText("No records match these filters.", { exact: false }),
  ).toBeVisible();
  await download(page, "Download PDF");
  await download(page, "Download Excel");
});

test("preview is capped but explains that downloads contain every matching record", async ({
  page,
}) => {
  await mocks(page, { count: 55 });
  await open(page);
  await expect(page.locator(".report-table-wrap tbody tr")).toHaveCount(50);
  await expect(
    page.getByText("Showing the first 50 of 55 records.", { exact: false }),
  ).toBeVisible();
  await download(page, "Download Excel");
});

test("operator can export scoped reports through a read-only page", async ({
  page,
}) => {
  await mocks(page, { role: "OPERATOR" });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  await download(page, "Download PDF");
  await expect(
    page.getByRole("button", { name: "Save issue report" }),
  ).toHaveCount(0);
});

test("expired report preview returns to sign-in", async ({ page }) => {
  await mocks(page, { failPreview: 401 });
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?reason=expired/);
});

test("expired export returns to sign-in without saving a file", async ({
  page,
}) => {
  await mocks(page, { failDownload: 401 });
  await open(page);
  let saved = false;
  page.on("download", () => {
    saved = true;
  });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired/);
  expect(saved).toBe(false);
});

function order() {
  return {
    id,
    title: "TEST report download order",
    kind: "BREAKDOWN",
    description: "Synthetic browser fixture only.",
    status: "CLOSED",
    version: 6,
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedAt: "2026-09-01T02:30:00Z",
    observedAt: null,
    reporter: { userId, displayName: "TEST reporter" },
    technician: { userId, displayName: "TEST technician" },
    startedAt: "2026-09-01T03:00:00Z",
    findings: "TEST findings",
    rootCause: "TEST human RCA",
    correctiveAction: "TEST repair",
    preventiveAction: "TEST prevention",
    restoredAt: "2026-09-01T04:00:00Z",
    submittedAt: "2026-09-01T05:00:00Z",
    returnReason: null,
    reviewedAt: "2026-09-01T06:00:00Z",
    reviewer: { userId, displayName: "TEST head" },
    closer: { userId, displayName: "TEST supervisor" },
    closedAt: "2026-09-01T07:00:00Z",
    updatedAt: "2026-09-01T07:00:00Z",
    performedAt: null,
    investigationOutcome: null,
    investigationReview: null,
    maintenanceOccurrence: null,
    events: [],
    historyNextVersion: null,
    allowedActions: [],
    attachments: [],
    canUploadAttachment: false,
    attachmentLimit: 20,
    attachmentMaxBytes: 5242880,
  };
}
test("individual work-order downloads pass the visible version and include both formats", async ({
  page,
}) => {
  const f = await mocks(page);
  await page.route("**/api/machines/WH-C/work-orders/**", (route) =>
    route.fulfill({ json: order() }),
  );
  await page.goto("/machines/WH-C/work-orders/" + id);
  expect(
    (await download(page, "Download work order PDF")).suggestedFilename(),
  ).toMatch(/-v6\.pdf$/);
  expect(
    (await download(page, "Download work order Excel")).suggestedFilename(),
  ).toMatch(/-v6\.xlsx$/);
  expect(f.exports.every((q) => q.searchParams.get("version") === "6")).toBe(
    true,
  );
  expect(
    f.exports.every((q) => q.pathname.includes("/reports/work-orders/")),
  ).toBe(true);
});

test("stale individual report follows the work-order reload flow", async ({
  page,
}) => {
  await mocks(page, { failDownload: 409 });
  await page.route("**/api/machines/WH-C/work-orders/**", (route) =>
    route.fulfill({ json: order() }),
  );
  await page.goto("/machines/WH-C/work-orders/" + id);
  await page
    .getByRole("button", { name: "Download work order PDF", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reload work order", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download work order Excel",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reload work order", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download work order PDF", exact: true }),
  ).toBeEnabled();
  await download(page, "Download work order PDF");
});
