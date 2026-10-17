import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { loadWorkbook, parseSheet, strictDate } from "../production/parser";
import { productionFixture } from "./production-fixtures";
const parse = async (options: Parameters<typeof productionFixture>[0] = {}) =>
  parseSheet(
    await loadWorkbook(
      await productionFixture(options),
      "synthetic-production.xlsx",
    ),
    `${options?.month?.startsWith("2026-10") ? "OCT" : "SEP"}-2026`,
    "SYNTHETIC",
  );
test("job grain, activity rows, cached formulas and controls preserve source without double-counting", async () => {
  const result = await parse();
  assert.equal(result.days.length, 3);
  const first = result.days[0];
  assert.equal(first.rows.length, 3);
  assert.equal(first.rows.filter((row) => row.shift === "A").length, 2);
  assert.equal(first.productionKg, 200);
  assert.equal(first.controlProductionKg, 200);
  assert.equal(first.scrapKg, 10);
  assert.equal(first.eligible, true);
  assert.equal(
    first.rows[0].description,
    "SYNTHETIC job one, original description",
  );
  assert.deepEqual(first.rows[0].rawCells.D8, {
    formula: "50+50",
    result: 100,
  });
  assert.equal(result.days[2].rows[0].kind, "ACTIVITY");
  assert.equal(result.days[2].rows[0].productionKg, null);
  assert.equal(result.days[2].productionKg, 80);
  assert.equal(result.days[2].rows[0].downtime["AL: CAUSE 38"], 0.5);
  assert.equal(
    result.days
      .filter((day) => day.eligible)
      .reduce((n, day) => n + day.productionKg, 0),
    280,
  );
});
test("malformed dates quarantine the entire block and do not guess the next date", async () => {
  const result = await parse({
    mutate: (sheet) => {
      sheet.getCell("B13").value = "B";
      sheet.getCell("C13").value = "SYNTHETIC second job";
      sheet.getCell("D13").value = 10;
      sheet.getCell("E12").value = 100;
    },
  });
  assert.equal(result.days[1].date, null);
  assert.equal(result.days[1].rawDate, "08-0-2026");
  assert.equal(result.days[1].rows.length, 2);
  assert.equal(result.days[1].eligible, false);
  assert(
    result.days[1].problems.some(
      (p) => p.cell === "A12" && p.code === "INVALID_DATE",
    ),
  );
  assert.equal(strictDate("2026-02-30"), false);
  assert.equal(strictDate("2026-09-01"), true);
});
test("ambiguous numeric strings, missing formula caches, invalid shifts and control mismatches block import", async () => {
  const invalid = await parse({
    mutate: (sheet) => {
      sheet.getCell("D9").value = "1,000";
      sheet.getCell("D8").value = { formula: "50+50" };
      sheet.getCell("B10").value = "NIGHT";
      sheet.getCell("AD14").value = 99;
    },
  });
  assert(invalid.days[0].problems.some((p) => p.code === "INVALID_NUMBER"));
  assert(invalid.days[0].problems.some((p) => p.code === "INVALID_SHIFT"));
  assert.equal(invalid.days[0].rows[2].shift, null);
  assert.equal(invalid.days[0].eligible, false);
  assert.equal(invalid.days[2].eligible, false);
});
test("missing controls, inconsistent controls, repeated dates and month mismatches cannot silently pass", async () => {
  const missing = await parse({
    mutate: (sheet) => {
      sheet.getCell("E9").value = null;
      sheet.getCell("E10").value = 199;
      sheet.getCell("E8").value = 200;
      sheet.getCell("A14").value = new Date("2026-09-01T00:00:00Z");
    },
  });
  assert(
    missing.days[0].problems.some((p) => p.code === "CONFLICTING_CONTROL"),
  );
  assert(missing.days[0].problems.some((p) => p.code === "REPEATED_DATE"));
  const another = await parse({
    mutate: (sheet) => {
      sheet.getCell("A14").value = new Date("2026-10-03T00:00:00Z");
      sheet.getCell("AD8").value = null;
    },
  });
  assert(another.days[0].problems.some((p) => p.code === "MISSING_CONTROL"));
  assert(
    another.days[2].problems.some((p) => p.code === "DATE_OUTSIDE_SHEET_MONTH"),
  );
});
test("EPL subsets, wrong machine headings, changed layouts and synthetic-as-authentic are rejected", async () => {
  const wb = await loadWorkbook(
    await productionFixture(),
    "synthetic-production.xlsx",
  );
  assert.throws(
    () => parseSheet(wb, "SEP-2026", "AUTHENTIC"),
    /labeled synthetic/,
  );
  const wrong = await loadWorkbook(
    await productionFixture({
      mutate: (sheet) => {
        sheet.getCell("A1").value = "WH-B M\/C";
      },
    }),
    "production.xlsx",
  );
  assert.equal(wrong.sheets[0].supported, false);
  const changed = await loadWorkbook(
    await productionFixture({
      mutate: (sheet) => {
        sheet.getCell("D4").value = "UNRECOGNIZED";
      },
    }),
    "production.xlsx",
  );
  assert.throws(() => parseSheet(changed, "SEP-2026", "AUTHENTIC"), /header/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await productionFixture()) as unknown as Parameters<
      typeof book.xlsx.load
    >[0],
  );
  book.worksheets[0].name = "SEP-2026 EPL";
  const subset = await loadWorkbook(
    Buffer.from(await book.xlsx.writeBuffer()),
    "production.xlsx",
  );
  assert.equal(subset.sheets[0].supported, false);
  assert.match(subset.sheets[0].reason!, /overlap/);
});
test("empty, forged and oversized archives are rejected before spreadsheet processing", async () => {
  await assert.rejects(loadWorkbook(Buffer.from("bad"), "bad.xlsx"), /invalid/);
  await assert.rejects(
    loadWorkbook(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("invalid archive"),
      ]),
      "bad.xlsx",
    ),
    /XLSX/,
  );
  await assert.rejects(
    loadWorkbook(Buffer.alloc(8 * 1024 * 1024 + 1), "oversize.xlsx"),
    /8 MB/,
  );
  await assert.rejects(
    loadWorkbook(await productionFixture(), "legacy.xls"),
    /Only .xlsx/,
  );
});
