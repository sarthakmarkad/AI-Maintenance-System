// Intercepted Auth/API fixtures; actual parser/storage/scope are covered in *_test.
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { setup, signIn, machine } from "./helpers";
import { emptyPatterns } from "./anomalies-fixtures";
import {
  productionTemplate,
  readingsTemplate,
  XLSX_TYPE,
} from "../../apps/api/src/imports/templates";
import {
  loadWorkbook,
  parseSheet,
  type ParsedSheet,
} from "../../apps/api/src/production/parser";
import {
  parseReadings,
  localDayStart,
  type ReadingStage,
} from "../../apps/api/src/readings/parser";
import {
  analyse,
  type Observation,
} from "../../apps/api/src/readings/analysis";
const code = "PACK-01",
  id = "2ed7477f-26bc-493f-8cc0-4e931f41aa99",
  readingId = "36e821c7-e4c3-4029-8f14-e01893b97893",
  receipt = "2026-10-28T04:30:00.000Z";
let productionBytes: Buffer,
  readingBytes: Buffer,
  parsed: ParsedSheet,
  stage: ReadingStage;
async function workbook(bytes: Buffer) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(bytes as never);
  return w;
}
test.beforeAll(async () => {
  const p = await workbook(await productionTemplate(code, "2026-09"));
  p.getWorksheet("SEP-2026")!.getRow(8).values = [
    "2026-09-01",
    "A",
    "TEST standard production job",
    150,
    1,
    3,
    150,
    3,
    "TEST fixture only",
  ];
  productionBytes = Buffer.from(await p.xlsx.writeBuffer());
  parsed = parseSheet(
    await loadWorkbook(productionBytes, "TEST-standard.xlsx", code),
    "SEP-2026",
    "AUTHENTIC",
  );
  const r = await workbook(await readingsTemplate(code));
  r.getWorksheet("Hourly_Readings")!.addRow([
    "TEST-001",
    code,
    "2026-09-01T00:00:00",
    "A",
    200,
    45,
    100,
    "SYNTHETIC",
  ]);
  readingBytes = Buffer.from(await r.xlsx.writeBuffer());
  stage = await parseReadings(readingBytes, "TEST-synthetic.xlsx", code);
});
function dashboard(saved: boolean, source: string) {
  const hasData = saved && source === "AUTHENTIC";
  return {
    source,
    from: "2026-09-01",
    to: "2026-09-30",
    hasData,
    importedDays: hasData ? 1 : 0,
    jobRows: hasData ? 1 : 0,
    productionKg: hasData ? 150 : 0,
    scrapKg: hasData ? 3 : 0,
    lastImportedAt: hasData ? receipt : null,
    daily: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      productionKg: hasData && i === 0 ? 150 : null,
      scrapKg: hasData && i === 0 ? 3 : null,
      jobRows: hasData && i === 0 ? 1 : null,
    })),
    imports: hasData
      ? [
          {
            id,
            filename: "TEST-standard.xlsx",
            sheet: "SEP-2026",
            source: "AUTHENTIC",
            committedAt: receipt,
            importedDays: 1,
          },
        ]
      : [],
  };
}
function trends(saved: boolean) {
  const rows = (saved ? stage.rows : []).map((r) => ({
    ...r,
    hotTempC: r.hotTempC!,
    coldTempC: r.coldTempC!,
    pressureBar: r.pressureBar!,
    measuredAt: new Date(r.measuredAt!),
    receivedAt: new Date(receipt),
    importId: readingId,
  }));
  return {
    source: "SYNTHETIC",
    timezone: "Asia/Kolkata",
    policyVersion: stage.policyVersion,
    from: "2026-09-01",
    to: "2026-09-01",
    hasData: saved,
    observations: rows.length,
    latestMeasuredAt: saved ? rows[0].measuredAt.toISOString() : null,
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
            id: readingId,
            filename: stage.filename,
            sheet: stage.sheet,
            workbookHash: stage.workbookHash,
            receivedAt: receipt,
            observations: 1,
          },
        ]
      : [],
  };
}
async function mocks(page: Page, role = "ADMINISTRATOR") {
  await setup(page, role);
  let productionSaved = false,
    readingsSaved = false,
    templateError = false;
  const paths: string[] = [];
  await page.route("**/api/machines**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    paths.push(path);
    if (path === `/api/machines/${code}`)
      return route.fulfill({
        json: {
          ...machine,
          id: "TEST-pack",
          code,
          name: "TEST packaging line",
          version: 1,
        },
      });
    if (path === `/api/machines/${code}/work-order-notifications`)
      return route.fulfill({
        json: { items: [], unread: 0, nextCursor: null },
      });
    if (path.endsWith("/production/template")) {
      if (templateError)
        return route.fulfill({
          status: 503,
          json: { message: "TEST template service unavailable" },
        });
      return route.fulfill({
        contentType: XLSX_TYPE,
        body: await productionTemplate(
          code,
          url.searchParams.get("month") || "2026-09",
        ),
      });
    }
    if (path.endsWith("/readings/template"))
      return route.fulfill({
        contentType: XLSX_TYPE,
        body: await readingsTemplate(code),
      });
    if (path.endsWith("/production/dashboard"))
      return route.fulfill({
        json: dashboard(
          productionSaved,
          url.searchParams.get("source") || "AUTHENTIC",
        ),
      });
    if (path.endsWith("/production/inspect"))
      return route.fulfill({
        status: 201,
        json: {
          filename: parsed.filename,
          workbookHash: parsed.workbookHash,
          sheets: [
            {
              name: "SEP-2026",
              month: "2026-09",
              supported: true,
              reason: null,
              heading: `${code} production records`,
            },
          ],
        },
      });
    if (path.includes("/production/") && path.endsWith("/commit")) {
      expect(route.request().postDataJSON()).toEqual({
        dayKeys: ["row-8"],
        acknowledgeWarnings: true,
      });
      productionSaved = true;
      return route.fulfill({
        status: 201,
        json: {
          importId: id,
          status: "COMMITTED",
          importedDays: 1,
          jobRows: 1,
          productionKg: 150,
          scrapKg: 3,
          alreadyCommitted: false,
        },
      });
    }
    if (path.includes("/production/previews"))
      return route.fulfill({
        status: route.request().method() === "POST" ? 201 : 200,
        json: {
          ...parsed,
          id,
          status: "PREVIEW",
          createdAt: receipt,
          expiresAt: "2099-01-01T00:00:00Z",
          committedDayKeys: [],
        },
      });
    if (path.includes("/readings/anomalies"))
      return route.fulfill({ json: emptyPatterns() });
    if (path.endsWith("/readings/trends"))
      return route.fulfill({ json: trends(readingsSaved) });
    if (path.includes("/readings/") && path.endsWith("/commit")) {
      expect(route.request().postDataJSON()).toEqual({
        acknowledgeWarnings: true,
      });
      readingsSaved = true;
      return route.fulfill({
        status: 201,
        json: {
          importId: readingId,
          importedReadings: 1,
          alreadyCommitted: false,
        },
      });
    }
    if (path.includes("/readings/previews"))
      return route.fulfill({
        status: route.request().method() === "POST" ? 201 : 200,
        json: {
          ...stage,
          id: readingId,
          status: "PREVIEW",
          createdAt: receipt,
          expiresAt: "2099-01-01T00:00:00Z",
          committedAt: null,
        },
      });
    return route.fallback();
  });
  return {
    paths,
    setTemplateError: (v: boolean) => {
      templateError = v;
    },
  };
}
test("new-machine production tab downloads its selected-month template and completes Excel import", async ({
  page,
}) => {
  const state = await mocks(page);
  await signIn(page);
  await page.goto(`/machines/${code}/production`);
  await expect(
    page.getByRole("heading", { name: "Production records", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import workbook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import production Excel",
    exact: true,
  });
  await dialog.getByLabel("Template month").fill("2026-09");
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download Excel template", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(
    `${code}-production-2026-09-template.xlsx`,
  );
  const w = await workbook(await readFile((await file.path())!));
  expect(w.getWorksheet("SEP-2026")!.getCell("A1").text).toContain(code);
  expect(w.getWorksheet("SEP-2026")!.rowCount).toBe(7);
  await dialog.locator("#production-file").setInputFiles({
    name: "TEST-standard.xlsx",
    mimeType: XLSX_TYPE,
    buffer: productionBytes,
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
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(page.locator(".metric-card").first()).toContainText("150");
  await page.reload();
  await expect(page.locator(".metric-card").first()).toContainText("150");
  expect(
    state.paths.some((p) => /\/WH-C\/(production|readings)(\/|$)/.test(p)),
  ).toBe(false);
  await page.screenshot({
    path: `.local/all-machine-data/production-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("new-machine Process trends downloads a matching Guide and imports synthetic parameters", async ({
  page,
}) => {
  const state = await mocks(page);
  await signIn(page);
  await page.goto(`/machines/${code}/readings`);
  await expect(
    page.getByRole("heading", { name: "Process trends", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import synthetic readings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import hourly observations",
    exact: true,
  });
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download Excel template", exact: true })
    .click();
  const w = await workbook(await readFile((await (await download).path())!));
  expect(w.getWorksheet("Guide")!.getCell("B5").value).toBe(code);
  expect(w.getWorksheet("Hourly_Readings")!.rowCount).toBe(1);
  await dialog.locator("#reading-file").setInputFiles({
    name: "TEST-synthetic.xlsx",
    mimeType: XLSX_TYPE,
    buffer: readingBytes,
  });
  await dialog
    .getByRole("button", { name: "Preview reading workbook", exact: true })
    .click();
  const ack = dialog.getByRole("checkbox");
  await ack.check();
  await dialog
    .getByRole("button", { name: "Import 1 valid observations", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "1 synthetic observations saved" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pressure", exact: true, level: 2 }),
  ).toBeVisible();
  expect(
    state.paths.some((p) => /\/WH-C\/(production|readings)(\/|$)/.test(p)),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/all-machine-data/readings-${test.info().project.name}.png`,
    fullPage: true,
  });
});
for (const role of ["OPERATOR", "TECHNICIAN", "MANAGEMENT"])
  test(`${role} sees both new-machine data tabs without importer controls`, async ({
    page,
    isMobile,
  }) => {
    await mocks(page, role);
    await signIn(page);
    await page.goto(`/machines/${code}/production`);
    await expect(
      page.getByRole("heading", { name: "Production records", exact: true }),
    ).toBeVisible();
    if (isMobile)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("link", { name: "Production", exact: true }),
    ).toHaveAttribute("href", `/machines/${code}/production`);
    await page
      .getByRole("link", { name: "Process trends", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Process trends", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Import synthetic readings",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Download Excel template",
        exact: true,
      }),
    ).toHaveCount(0);
  });
test("template errors stay inside the popup and can be retried without losing the file or selected month", async ({
  page,
}) => {
  const state = await mocks(page);
  await signIn(page);
  await page.goto(`/machines/${code}/production`);
  await page
    .getByRole("button", { name: "Import workbook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import production Excel",
    exact: true,
  });
  await dialog.getByLabel("Template month").fill("2026-09");
  await dialog.locator("#production-file").setInputFiles({
    name: "TEST-standard.xlsx",
    mimeType: XLSX_TYPE,
    buffer: productionBytes,
  });
  state.setTemplateError(true);
  await dialog
    .getByRole("button", { name: "Download Excel template", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("alert")
      .filter({ hasText: "TEST template service unavailable" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Template month")).toHaveValue("2026-09");
  expect(
    await dialog
      .locator("#production-file")
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("TEST-standard.xlsx");
  state.setTemplateError(false);
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download Excel template", exact: true })
    .click();
  await download;
  await expect(
    dialog
      .getByRole("alert")
      .filter({ hasText: "TEST template service unavailable" }),
  ).toHaveCount(0);
});
