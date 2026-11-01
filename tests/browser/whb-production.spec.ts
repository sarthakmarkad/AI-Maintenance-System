// Isolated Auth/API fixtures; real parser and XLSX bytes, no company data.
import { test, expect } from "@playwright/test";
import { setup, signIn, machine } from "./helpers";
import { whbProductionFixture } from "../../apps/api/src/tests/whb-production-fixture";
import { loadWorkbook, parseSheet } from "../../apps/api/src/production/parser";

for (const code of ["WHB", "WHB1"])
  test(`${code} reviewed import shows its mapping and excludes unmapped cells before an explicit save`, async ({
    page,
  }) => {
    const buffer = await whbProductionFixture((s) => {
      s.getCell("A1").value = "W & H B M/C";
      s.getCell("AV12").value = 0.25;
    });
    const loaded = await loadWorkbook(buffer, "TEST-WHB.xlsx", code);
    const parsed = parseSheet(loaded, "SEP-2026", "AUTHENTIC");
    const id = "2ed7477f-26bc-493f-8cc0-4e931f41aa99";
    await setup(page, "MAINTENANCE_HEAD");
    await page.route(`**/api/machines/${code}**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/machines/${code}`)
        return route.fulfill({
          json: { ...machine, code, name: `TEST ${code}` },
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
    await page.goto(`/machines/${code}/production`);
    await page
      .getByRole("button", { name: "Import workbook", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Import production Excel",
      exact: true,
    });
    await expect(
      dialog.getByText(new RegExp(`${code} also accepts the reviewed`)),
    ).toBeVisible();
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

test("a newly registered machine connects a detected workbook explicitly and reuses its successful mapping", async ({
  page,
}) => {
  const code = "ROLL-03",
    buffer = await whbProductionFixture((s) => {
      s.getCell("A1").value = "W & H B M/C";
    });
  const initial = await loadWorkbook(buffer, "TEST.xlsx", code);
  const mapping = initial.mappingOptions.find(
    (o) => o.layout === "MONTHLY_WHB",
  )!;
  const mapped = await loadWorkbook(buffer, "TEST.xlsx", code, mapping);
  const parsed = parseSheet(mapped, "SEP-2026", "AUTHENTIC");
  let saved = false,
    confirmations = 0;
  await setup(page, "MAINTENANCE_HEAD");
  await page.route(`**/api/machines/${code}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/machines/${code}`)
      return route.fulfill({
        json: { ...machine, code, name: "TEST registered roller" },
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
    if (path.endsWith("/inspect")) {
      const explicit = route
        .request()
        .postDataBuffer()
        ?.toString()
        .includes('"confirmed":true');
      if (explicit) confirmations++;
      const loaded = explicit || saved ? mapped : initial;
      return route.fulfill({
        status: 201,
        json: {
          filename: "TEST.xlsx",
          workbookHash: loaded.workbookHash,
          sheets: loaded.sheets,
          mapping: explicit || saved ? mapping : null,
          mappingOptions: loaded.mappingOptions,
        },
      });
    }
    if (path.endsWith("/commit")) {
      saved = true;
      return route.fulfill({
        status: 201,
        json: {
          importId: "2ed7477f-26bc-493f-8cc0-4e931f41aa99",
          status: "COMMITTED",
          importedDays: 2,
          jobRows: 3,
          productionKg: 200,
          scrapKg: 4,
          alreadyCommitted: false,
        },
      });
    }
    if (path.includes("/previews")) {
      expect(route.request().postDataBuffer()?.toString()).toContain(
        '"confirmed":true',
      );
      return route.fulfill({
        status: 201,
        json: {
          ...parsed,
          id: "2ed7477f-26bc-493f-8cc0-4e931f41aa99",
          status: "PREVIEW",
          createdAt: "2026-11-01T00:00:00Z",
          expiresAt: "2099-01-01T00:00:00Z",
          committedDayKeys: [],
        },
      });
    }
    return route.fallback();
  });
  await signIn(page);
  await page.goto(`/machines/${code}/production`);
  const read = async () => {
    await page
      .getByRole("button", { name: "Import workbook", exact: true })
      .click();
    await page.locator("#production-file").setInputFiles({
      name: "TEST.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    await page
      .getByRole("button", { name: "Read worksheets", exact: true })
      .click();
  };
  await read();
  await expect(
    page.getByRole("heading", { name: `Connect this workbook to ${code}` }),
  ).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Confirm mapping and read worksheets",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("Workbook heading and layout", { exact: true })
    .selectOption("0");
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel(
      `I confirm this workbook heading identifies ${code} (TEST registered roller).`,
      { exact: true },
    )
    .check();
  await page
    .getByRole("heading", { name: `Connect this workbook to ${code}` })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `.local/whb-import/mapping-setup-${test.info().project.name}.png`,
    fullPage: true,
  });
  await confirm.click();
  await expect(page.getByLabel("Worksheet", { exact: true })).toBeEnabled();
  expect(confirmations).toBe(1);
  await page
    .getByRole("button", { name: "Preview selected sheet", exact: true })
    .click();
  await expect(page.getByText(/Confirmed workbook mapping:/)).toBeVisible();
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
  await page.reload();
  await read();
  await expect(page.getByLabel("Worksheet", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: `Connect this workbook to ${code}` }),
  ).toHaveCount(0);
  expect(confirmations).toBe(1);
});
