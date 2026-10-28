// Invented fixtures model company imports through intercepted Auth/API responses only.
// Actual parsing/transactions/authorization are exercised by backend/database suites.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn } from "./helpers";
import { productionFixture } from "../../apps/api/src/tests/production-fixtures";
import {
  loadWorkbook,
  parseSheet,
  type ParsedSheet,
} from "../../apps/api/src/production/parser";
let buffer: Buffer, parsed: ParsedSheet;
const id = "2ed7477f-26bc-493f-8cc0-4e931f41aa99";
test.beforeAll(async () => {
  buffer = await productionFixture({ authentic: true });
  parsed = parseSheet(
    await loadWorkbook(buffer, "TEST-production.xlsx"),
    "SEP-2026",
    "AUTHENTIC",
  );
});
function dashboard(saved: boolean, source: string) {
  const hasData = saved && source === "AUTHENTIC";
  return {
    source,
    from: "2026-09-01",
    to: "2026-09-30",
    hasData,
    importedDays: hasData ? 2 : 0,
    jobRows: hasData ? 4 : 0,
    productionKg: hasData ? 280 : 0,
    scrapKg: hasData ? 12 : 0,
    lastImportedAt: hasData ? new Date().toISOString() : null,
    daily: Array.from({ length: 30 }, (_, i) => {
      const date = "2026-09-" + String(i + 1).padStart(2, "0");
      return {
        date,
        productionKg: hasData ? (i === 0 ? 200 : i === 2 ? 80 : null) : null,
        scrapKg: hasData ? (i === 0 ? 10 : i === 2 ? 2 : null) : null,
        jobRows: hasData ? (i === 0 ? 3 : i === 2 ? 1 : null) : null,
      };
    }),
    imports: hasData
      ? [
          {
            id,
            filename: "TEST-production.xlsx",
            sheet: "SEP-2026",
            source: "AUTHENTIC",
            committedAt: new Date().toISOString(),
            importedDays: 2,
          },
        ]
      : [],
  };
}
async function mockProduction(
  page: Page,
  options: { role?: string; commitConflict?: boolean; expired?: boolean } = {},
) {
  await setup(page, options.role || "ADMINISTRATOR");
  let saved = false;
  let conflict = !!options.commitConflict;
  await page.route("**/api/machines/WH-C/production/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (options.expired) {
      await route.fulfill({
        status: 401,
        json: { message: "Session expired." },
      });
      return;
    }
    if (path.endsWith("/dashboard")) {
      expect(url.searchParams.get("source")).toBe("AUTHENTIC");
      await route.fulfill({
        json: dashboard(saved, url.searchParams.get("source") || "AUTHENTIC"),
      });
      return;
    }
    if (path.endsWith("/inspect")) {
      await route.fulfill({
        status: 201,
        json: {
          filename: "TEST-production.xlsx",
          workbookHash: parsed.workbookHash,
          sheets: [
            {
              name: "SEP-2026",
              month: "2026-09",
              supported: true,
              reason: null,
              heading: "WH-C M/C",
            },
            {
              name: "SEP-2026 EPL",
              month: null,
              supported: false,
              reason: "EPL subset may overlap monthly records.",
              heading: "WH-C M/C",
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/commit")) {
      expect(route.request().postDataJSON()).toEqual({
        dayKeys: ["row-8", "row-14"],
        acknowledgeWarnings: true,
      });
      if (conflict) {
        conflict = false;
        await route.fulfill({
          status: 409,
          json: {
            message:
              "Another import saved these dates first. Refresh the preview.",
          },
        });
        return;
      }
      saved = true;
      await route.fulfill({
        status: 201,
        json: {
          importId: id,
          status: "COMMITTED",
          importedDays: 2,
          jobRows: 4,
          productionKg: 280,
          scrapKg: 12,
          alreadyCommitted: false,
        },
      });
      return;
    }
    if (path.endsWith("/previews") && route.request().method() === "POST")
      expect(route.request().postData()).toContain(
        'name="source"\r\n\r\nAUTHENTIC',
      );
    const snapshot = structuredClone(parsed);
    if (saved || options.commitConflict)
      for (const day of snapshot.days)
        if (day.eligible && saved) {
          day.eligible = false;
          day.alreadyImported = true;
        }
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: {
        ...snapshot,
        id,
        status: "PREVIEW",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        committedDayKeys: [],
      },
    });
  });
}
async function openProduction(page: Page) {
  await signIn(page);
  await page.goto("/machines/WH-C/production");
  await expect(
    page.getByRole("heading", { name: "Production records", exact: true }),
  ).toBeVisible();
}
async function stageWorkbook(page: Page) {
  await page
    .getByRole("button", { name: "Import workbook", exact: true })
    .click();
  await page.locator("#production-file").setInputFiles({
    name: "TEST-production.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "Read worksheets" }).click();
  await page.getByLabel("Worksheet", { exact: true }).selectOption("SEP-2026");
  await page.getByRole("button", { name: "Preview selected sheet" }).click();
  await expect(
    page.getByRole("heading", { name: "Validation preview" }),
  ).toBeVisible();
}
test("company workbook preview excludes bad dates, commits selected days and restores saved totals without a dataset selector", async ({
  page,
}) => {
  await mockProduction(page);
  await openProduction(page);
  await expect(
    page.getByRole("heading", { name: "No saved production for this period" }),
  ).toBeVisible();
  await stageWorkbook(page);
  const other = await page.context().newPage();
  await setup(other, "ADMINISTRATOR");
  await other.goto("/machines");
  await page.bringToFront();
  await other.close();
  await expect(
    page.getByRole("heading", { name: "Validation preview" }),
  ).toBeVisible();
  const sourceDetails = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Source details$/ }) });
  await expect(sourceDetails.locator("small")).toBeHidden();
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails).toContainText("Source hash");
  await expect(sourceDetails).toContainText("production-");
  await expect(
    page.getByLabel("Import source row 12", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/original date: 08-0-2026/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 2 valid days", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I reviewed the source, excluded blocks and cached-formula notes.",
    )
    .check();
  await page
    .getByRole("button", { name: "Import 2 valid days", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "2 days saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(page.locator(".metric-card").first()).toContainText("280");
  await expect(page.locator(".metric-card").nth(1)).toContainText("12");
  await page.reload();
  await expect(page.locator(".metric-card").first()).toContainText("280");
  await expect(
    page.getByRole("heading", { name: "Daily production & scrap" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/production-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect(
    page.getByRole("combobox", { name: "Dataset", exact: true }),
  ).toHaveCount(0);
});
test("operators can view persisted production but cannot see import controls", async ({
  page,
}) => {
  await mockProduction(page, { role: "OPERATOR" });
  await openProduction(page);
  await expect(
    page.getByRole("button", { name: "Import workbook", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "A supervisor, maintenance head or administrator can import production workbooks.",
    ),
  ).toBeVisible();
});
test("a conflicting commit keeps the preview and explains how to refresh it", async ({
  page,
}) => {
  await mockProduction(page, { commitConflict: true });
  await openProduction(page);
  await stageWorkbook(page);
  await page
    .getByLabel(
      "I reviewed the source, excluded blocks and cached-formula notes.",
    )
    .check();
  await page
    .getByRole("button", { name: "Import 2 valid days", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Another import saved these dates first" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Validation preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh preview" }).click();
  await expect(
    page.getByLabel(
      "I reviewed the source, excluded blocks and cached-formula notes.",
    ),
  ).not.toBeChecked();
});
test("an expired production request returns to sign-in with its reason preserved", async ({
  page,
}) => {
  await mockProduction(page, { expired: true });
  await signIn(page);
  await page.goto("/machines/WH-C/production");
  await expect(page).toHaveURL(/login\?reason=expired/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Your session expired" }),
  ).toBeVisible();
});
