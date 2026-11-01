import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  productionTemplate,
  readingsTemplate,
  templateMonth,
} from "../imports/templates";
import { loadWorkbook, parseSheet } from "../production/parser";
import { parseReadings } from "../readings/parser";
import { productionFixture } from "./production-fixtures";
async function open(buffer: Buffer) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buffer as never);
  return w;
}
async function production(
  code = "PUMP-01",
  mutate?: (s: ExcelJS.Worksheet) => void,
) {
  const w = await open(await productionTemplate(code, "2026-09"));
  const s = w.getWorksheet("SEP-2026")!;
  s.getRow(8).values = [
    "2026-09-01",
    "A",
    "TEST job one",
    100,
    1,
    2,
    150,
    3,
    "TEST original remarks",
  ];
  s.getRow(9).values = [null, "A", "TEST job two", 50, 0, 1];
  mutate?.(s);
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function readings(
  code = "PUMP-01",
  mutate?: (w: ExcelJS.Workbook) => void,
) {
  const w = await open(await readingsTemplate(code));
  w.getWorksheet("Hourly_Readings")!.addRow([
    "TEST-1",
    code,
    "2026-09-01T00:00:00",
    "A",
    200,
    45,
    100,
    "SYNTHETIC",
    999,
    999,
    999,
  ]);
  mutate?.(w);
  return Buffer.from(await w.xlsx.writeBuffer());
}
test("standard templates contain machine identity and instructions with no fabricated records", async () => {
  const p = await open(await productionTemplate("PUMP-01", "2026-09"));
  const s = p.getWorksheet("SEP-2026")!;
  assert.match(s.getCell("A1").text, /PUMP-01/);
  assert.equal(s.rowCount, 7);
  assert.equal(s.getCell("G4").text, "DAILY PRODUCTION CONTROL KG");
  const r = await open(await readingsTemplate("PUMP-01"));
  assert.equal(r.getWorksheet("Guide")!.getCell("B5").value, "PUMP-01");
  assert.equal(r.getWorksheet("Hourly_Readings")!.rowCount, 1);
  assert.match(r.getWorksheet("Guide")!.getCell("A14").text, /NOT engineering/);
  assert.equal(templateMonth(new Date("2026-09-30T19:00:00Z")), "2026-10");
});
test("compact production import retains actual source cells, multiple jobs and separate reconciled controls", async () => {
  const loaded = await loadWorkbook(
    await production(),
    "records.xlsx",
    "PUMP-01",
  );
  assert(loaded.sheets[0].supported);
  const parsed = parseSheet(loaded, "SEP-2026", "AUTHENTIC"),
    day = parsed.days[0];
  assert.equal(parsed.parserVersion, "machine-production-template-v1");
  assert(day.eligible);
  assert.equal(day.productionKg, 150);
  assert.equal(day.scrapKg, 3);
  assert.equal(day.controlProductionKg, 150);
  assert.equal(day.controlScrapKg, 3);
  assert.equal(day.rows.length, 2);
  assert.equal(day.rows[0].remarks, "TEST original remarks");
  assert.equal(day.rows[0].jobChanges, 1);
  assert.equal(day.rows[0].rawCells.G8, 150);
  assert.deepEqual(day.rows[0].scrap, { "F: Scrap kg": 2 });
  assert.deepEqual(day.rows[0].downtime, {});
});
test("standard production excludes invalid controls/dates and rejects wrong-machine or unrecognized columns", async () => {
  for (const [cell, value, issue] of [
    ["G8", 999, "CONTROL_MISMATCH"],
    ["H8", null, "MISSING_CONTROL"],
    ["A8", "2026-10-01", "DATE_OUTSIDE_SHEET_MONTH"],
  ] as const) {
    const l = await loadWorkbook(
      await production("PUMP-01", (s) => {
        s.getCell(cell).value = value;
      }),
      "records.xlsx",
      "PUMP-01",
    );
    const p = parseSheet(l, "SEP-2026", "AUTHENTIC");
    assert.equal(p.days[0].eligible, false);
    assert(p.days[0].problems.some((p) => p.code === issue));
  }
  const wrong = await loadWorkbook(
    await production(),
    "records.xlsx",
    "PUMP-010",
  );
  assert(!wrong.sheets[0].supported);
  assert.match(wrong.sheets[0].reason!, /PUMP-010/);
  const unknown = await loadWorkbook(
    await production("PUMP-01", (s) => {
      s.getCell("J8").value = 20;
    }),
    "records.xlsx",
    "PUMP-01",
  );
  assert.throws(
    () => parseSheet(unknown, "SEP-2026", "AUTHENTIC"),
    /Unexpected data at J8/,
  );
});
test("legacy monthly layout remains supported only when its heading matches the selected machine", async () => {
  const bytes = await productionFixture({
    mutate: (s) => {
      s.getCell("A1").value = "PUMP-01 M/C - SYNTHETIC DEMONSTRATION";
    },
  });
  const l = await loadWorkbook(bytes, "synthetic.xlsx", "PUMP-01");
  assert(l.sheets[0].supported);
  assert.equal(
    parseSheet(l, "SEP-2026", "SYNTHETIC").days[0].productionKg,
    200,
  );
  const mismatch = await loadWorkbook(bytes, "synthetic.xlsx", "WH-C");
  assert(!mismatch.sheets[0].supported);
});
test("synthetic reading templates validate both Guide and row machine IDs while retaining IST and labels", async () => {
  const parsed = await parseReadings(
    await readings(),
    "synthetic.xlsx",
    "PUMP-01",
  );
  assert(parsed.rows[0].eligible);
  assert.equal(parsed.rows[0].measuredAt, "2026-08-31T18:30:00.000Z");
  assert.equal(parsed.rows[0].rawCells.I2.value, 999);
  assert.equal(parsed.parserVersion, "machine-synthetic-readings-v1");
  await assert.rejects(
    parseReadings(await readings(), "synthetic.xlsx", "WH-C"),
    /Guide must identify WH-C/,
  );
  const wrong = await parseReadings(
    await readings("PUMP-01", (w) => {
      w.getWorksheet("Hourly_Readings")!.getCell("B2").value = "WH-C";
    }),
    "synthetic.xlsx",
    "PUMP-01",
  );
  assert(!wrong.rows[0].eligible);
  assert(wrong.rows[0].problems.some((s) => s.includes("only PUMP-01")));
});

test("any registered code can explicitly map only a recognized layout and exact source heading", async () => {
  const { whbProductionFixture } = await import("./whb-production-fixture");
  const bytes = await whbProductionFixture();
  const unconfirmed = await loadWorkbook(bytes, "TEST.xlsx", "EXTRUDER-99");
  assert.equal(unconfirmed.sheets[0].supported, false);
  const mapping = unconfirmed.mappingOptions.find(
    (o) => o.layout === "MONTHLY_WHB",
  )!;
  assert(mapping);
  const loaded = await loadWorkbook(bytes, "TEST.xlsx", "EXTRUDER-99", mapping);
  assert(loaded.sheets[0].supported);
  const parsed = parseSheet(loaded, "SEP-2026", "SYNTHETIC");
  assert.equal(parsed.parserVersion, "whb-monthly-production-v1");
  assert.deepEqual(parsed.workbookMapping, mapping);
  assert.equal(parsed.days[0].rows[0].rawCells.AS8, 0.5);
  assert.equal(parsed.days[0].rows[0].remarks, "TEST original remarks");
  assert.throws(
    () => parseSheet(loaded, "SEP-2026", "AUTHENTIC"),
    /labeled synthetic/,
  );
  assert.equal(
    (
      await loadWorkbook(bytes, "TEST.xlsx", "EXTRUDER-99", {
        ...mapping,
        heading: "Other machine",
      })
    ).sheets[0].supported,
    false,
  );
  assert.equal(
    (
      await loadWorkbook(bytes, "TEST.xlsx", "EXTRUDER-99", {
        ...mapping,
        layout: "STANDARD",
      })
    ).sheets[0].supported,
    false,
  );
  const broken = await whbProductionFixture((s) => {
    s.getCell("AT4").value = "OTHER UNIT";
  });
  const invalid = await loadWorkbook(
    broken,
    "TEST.xlsx",
    "EXTRUDER-99",
    mapping,
  );
  assert.equal(invalid.sheets[0].supported, false);
  assert.equal(invalid.mappingOptions.length, 0);
});

test("mapping confirmation rejects missing consent, unknown layouts and forged mapping fields", async () => {
  const { mappingInput } = await import("../production/service");
  const mapping = {
    heading: "Original machine heading",
    layout: "MONTHLY_WHB",
    confirmed: true,
  };
  assert.deepEqual(mappingInput(JSON.stringify(mapping)), {
    heading: mapping.heading,
    layout: mapping.layout,
  });
  for (const value of [
    "bad JSON",
    JSON.stringify({ ...mapping, confirmed: false }),
    JSON.stringify({ ...mapping, layout: "GUESS" }),
    JSON.stringify({ ...mapping, orgId: "forged" }),
  ])
    assert.throws(() => mappingInput(value));
});

test("confirmed standard and monthly layouts retain units and block extra mapped columns", async () => {
  const bytes = await production("SOURCE-01");
  const inspected = await loadWorkbook(bytes, "TEST.xlsx", "REGISTERED-01");
  const standard = inspected.mappingOptions.find(
    (o) => o.layout === "STANDARD",
  )!;
  assert(standard);
  const parsed = parseSheet(
    await loadWorkbook(bytes, "TEST.xlsx", "REGISTERED-01", standard),
    "SEP-2026",
    "SYNTHETIC",
  );
  assert(parsed.days[0].eligible);
  const monthlyBytes = await productionFixture();
  const monthly = await loadWorkbook(
    monthlyBytes,
    "TEST.xlsx",
    "REGISTERED-01",
  );
  const mapping = monthly.mappingOptions.find(
    (o) => o.layout === "MONTHLY_WHC",
  )!;
  assert(mapping);
  assert(
    parseSheet(
      await loadWorkbook(monthlyBytes, "TEST.xlsx", "REGISTERED-01", mapping),
      "SEP-2026",
      "SYNTHETIC",
    ).days.some((d) => d.eligible),
  );
  const changed = await productionFixture({
    mutate: (s) => {
      s.getCell("AT8").value = 999;
    },
  });
  const loaded = await loadWorkbook(
    changed,
    "TEST.xlsx",
    "REGISTERED-01",
    mapping,
  );
  assert.throws(
    () => parseSheet(loaded, "SEP-2026", "SYNTHETIC"),
    /outside the confirmed monthly layout/,
  );
});
