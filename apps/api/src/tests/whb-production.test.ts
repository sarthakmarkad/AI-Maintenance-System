import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorkbook, parseSheet } from "../production/parser";
import { whbProductionFixture } from "./whb-production-fixture";

const parse = async (mutate?: Parameters<typeof whbProductionFixture>[0]) =>
  parseSheet(
    await loadWorkbook(await whbProductionFixture(mutate), "TEST.xlsx", "WHB"),
    "SEP-2026",
    "SYNTHETIC",
  );

test("reviewed WHB mapping retains AS downtime, AT remarks, cells and independent controls; footer is not output", async () => {
  const r = await parse();
  assert.equal(r.parserVersion, "whb-monthly-production-v1");
  assert.equal(r.days.length, 2);
  assert(r.days.every((d) => d.eligible));
  assert.equal(r.days[0].productionKg, 150);
  assert.equal(r.days[0].scrapKg, 3);
  assert.equal(r.days[0].controlProductionKg, 150);
  assert.equal(r.days[0].rows[0].downtime["AS: no planning"], 0.5);
  assert.equal(r.days[0].rows[0].remarks, "TEST original remarks");
  assert.equal(r.days[0].rows[0].rawCells.AS8, 0.5);
  assert.equal(r.days[0].rows[0].rawCells.AT8, "TEST original remarks");
  assert(r.warnings.some((w) => /Reviewed source mapping/.test(w)));
});
test("WHB source mapping cannot relabel another machine, guess category layouts or declare synthetic values authentic", async () => {
  for (const code of ["WH-C", "WH-B", "WHB2", "PUMP-01"]) {
    const l = await loadWorkbook(
      await whbProductionFixture(),
      "TEST.xlsx",
      code,
    );
    assert.equal(l.sheets[0].supported, false);
  }
  for (const [cell, value] of [
    ["A1", "W & H C M/C"],
    ["A1", "W & H B M/C extra"],
    ["AT4", "UNKNOWN"],
    ["AS5", "Unknown cause"],
    ["N6", "Unknown category"],
  ]) {
    const l = await loadWorkbook(
      await whbProductionFixture((s) => {
        s.getCell(cell).value = value;
      }),
      "TEST.xlsx",
      "WHB",
    );
    assert.equal(l.sheets[0].supported, false, cell);
  }
  const l = await loadWorkbook(
    await whbProductionFixture(),
    "TEST.xlsx",
    "WHB",
  );
  assert.throws(
    () => parseSheet(l, "SEP-2026", "AUTHENTIC"),
    /labeled synthetic/,
  );
});
test("blank-shift activity does not terminate WHB sheets or acquire an invented shift", async () => {
  const r = await parse((s) => {
    s.getCell("L10").value = 1;
    s.getCell("AD8").value = 4;
  });
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].eligible, false);
  assert(
    r.days[0].problems.some(
      (p) => p.code === "INVALID_SHIFT" && p.cell === "B10",
    ),
  );
  assert.equal(r.days[0].rows[2].shift, null);
  assert.equal(r.days[0].rows[2].rawCells.L10, 1);
  assert(r.days[1].eligible);
});
test("separate daily controls retain evidence without inventing a shift or becoming footer totals", async () => {
  const r = await parse((s) => {
    s.getCell("AD8").value = null;
    s.getCell("AD10").value = 3;
    s.getCell("AE10").value = 153;
    s.getCell("AF11").value = { formula: "1/0", result: { error: "#DIV/0!" } };
  });
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].eligible, false);
  assert(
    r.days[0].problems.some(
      (p) => p.code === "INVALID_SHIFT" && p.cell === "B10",
    ),
  );
  assert.equal(r.days[0].rows.length, 3);
  assert.equal(r.days[0].rows[2].kind, "ACTIVITY");
  assert.equal(r.days[0].rows[2].shift, null);
  assert.equal(r.days[0].controlScrapKg, 3);
});
test("unmapped populated cells are retained and quarantine the affected date only", async () => {
  const r = await parse((s) => {
    s.getCell("AV9").value = 0.25;
    s.getCell("BC9").value = "TEST unmapped note";
  });
  assert.equal(r.days[0].eligible, false);
  assert.equal(r.days[0].rows[1].rawCells.BC9, "TEST unmapped note");
  assert.equal(
    r.days[0].problems.filter((p) => p.code === "UNMAPPED_COLUMN").length,
    2,
  );
  assert(r.days[1].eligible);
});
test("WHB date/control errors and unexpected data after explicit summary remain blocked", async () => {
  const r = await parse((s) => {
    s.getCell("A8").value = "08-0-2026";
    s.getCell("E12").value = 999;
  });
  assert(r.days[0].problems.some((p) => p.code === "INVALID_DATE"));
  assert(r.days[1].problems.some((p) => p.code === "CONTROL_MISMATCH"));
  await assert.rejects(
    parse((s) => {
      s.getCell("A19").value = "2026-09-03";
      s.getCell("B19").value = "A";
    }),
    /Unexpected data after the summary/,
  );
});
