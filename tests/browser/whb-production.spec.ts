// Isolated Auth/API fixtures; real parser and XLSX bytes, no company data.
import { test, expect } from "@playwright/test";
import { setup, signIn, machine } from "./helpers";
import { whbProductionFixture } from "../../apps/api/src/tests/whb-production-fixture";
import { loadWorkbook, parseSheet } from "../../apps/api/src/production/parser";

test("WHB reviewed import shows its mapping and excludes unmapped cells before an explicit save", async ({
  page,
}) => {
  const buffer = await whbProductionFixture((s) => {
    s.getCell("A1").value = "W & H B M/C";
    s.getCell("AV12").value = 0.25;
  });
  const loaded = await loadWorkbook(buffer, "TEST-WHB.xlsx", "WHB");
  const parsed = parseSheet(loaded, "SEP-2026", "AUTHENTIC");
  const id = "2ed7477f-26bc-493f-8cc0-4e931f41aa99";
  await setup(page, "MAINTENANCE_HEAD");
  await page.route("**/api/machines/WHB**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/machines/WHB")
      return route.fulfill({
        json: { ...machine, code: "WHB", name: "TEST WHB" },
      });
    if (path.endsWith("/work-order-notifications"))
      return route.fulfill({
        json: { items: [], unread: 0, nextCursor: null },
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          source: "AUTHENTIC",
          from: "2026-09-01",
          to: "2026-09-30",
          hasData: false,
          importedDays: 0,
          jobRows: 0,
          productionKg: 0,
          scrapKg: 0,
          lastImportedAt: null,
          daily: [],
          imports: [],
        },
      });
    if (path.endsWith("/inspect"))
      return route.fulfill({
        status: 201,
        json: {
          filename: parsed.filename,
          workbookHash: parsed.workbookHash,
          sheets: loaded.sheets,
        },
      });
    if (path.endsWith("/commit")) {
      expect(route.request().postDataJSON()).toEqual({
        dayKeys: ["row-8"],
        acknowledgeWarnings: true,
      });
      return route.fulfill({
        status: 201,
        json: {
          importId: id,
          status: "COMMITTED",
          importedDays: 1,
          jobRows: 2,
          productionKg: 150,
          scrapKg: 3,
          alreadyCommitted: false,
        },
      });
    }
    if (path.includes("/previews"))
      return route.fulfill({
        status: 201,
        json: {
          ...parsed,
          id,
          status: "PREVIEW",
          createdAt: "2026-10-28T04:30:00Z",
          expiresAt: "2099-01-01T00:00:00Z",
          committedDayKeys: [],
        },
      });
    return route.fallback();
  });
  await signIn(page);
  await page.goto("/machines/WHB/production");
  await page
    .getByRole("button", { name: "Import workbook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import production Excel",
    exact: true,
  });
  await expect(dialog.getByText(/WHB also accepts the reviewed/)).toBeVisible();
  await dialog.locator("#production-file").setInputFiles({
    name: "TEST-WHB.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await dialog
    .getByRole("button", { name: "Read worksheets", exact: true })
    .click();
  await dialog
    .getByLabel("Worksheet", { exact: true })
    .selectOption("SEP-2026");
  await dialog
    .getByRole("button", { name: "Preview selected sheet", exact: true })
    .click();
  await expect(dialog.getByText(/Reviewed source mapping:/)).toBeVisible();
  await expect(
    dialog.getByLabel("Import 2026-09-02", { exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/outside the reviewed WHB mapping/),
  ).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: "Source rows (2)" })
    .click();
  await expect(
    dialog.getByRole("cell", { name: "TEST original remarks", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.local/whb-import/preview-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByLabel(
      "I reviewed the source, excluded blocks and cached-formula notes.",
    )
    .check();
  await dialog
    .getByRole("button", { name: "Import 1 valid day", exact: true })
    .click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "1 days saved" }),
  ).toBeVisible();
});
