import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseReadings, localDayStart, PARAMETERS } from "../readings/parser";
import { analyse, type Observation } from "../readings/analysis";
import { readingFixture } from "./readings-fixtures";
test("default and namespace-prefixed OOXML preserve IST instants and source cells", async () => {
  for (const prefix of [false, true]) {
    const p = await parseReadings(
      await readingFixture({ prefix }),
      "synthetic.xlsx",
    );
    assert.equal(p.rows.length, 4);
    assert(p.rows.every((r) => r.eligible));
    assert.equal(p.rows[0].measuredAt, "2026-08-31T18:30:00.000Z");
    assert.equal(p.rows[0].localMeasuredAt, "2026-09-01T00:00:00");
    assert.equal(p.rows[0].rawCells.E2.value, 230);
  }
});
test("invalid dates and every conflicting ID are excluded without repairing source values", async () => {
  const p = await parseReadings(
    await readingFixture({ invalid: true, duplicate: true }),
    "synthetic.xlsx",
  );
  assert.equal(p.rows.filter((r) => r.eligible).length, 1);
  assert.equal(p.rows[2].measuredAt, null);
  assert.equal(p.rows[2].rawCells.C4.value, "08-0-2026");
  assert(p.rows[0].problems.some((p) => p.includes("Duplicate")));
  assert(!p.rows[3].eligible);
});
test("review bands use values, ignore forged workbook labels, and gaps break consecutive runs", async () => {
  const stage = await parseReadings(
    await readingFixture({ forgedFlags: true, missing: true }),
    "synthetic.xlsx",
  );
  const rows = stage.rows.map((r) => ({
    ...r,
    importId: "test",
    receivedAt: new Date("2026-10-17T10:00:00Z"),
    measuredAt: new Date(r.measuredAt!),
  })) as Observation[];
  const a = analyse(
    rows,
    localDayStart("2026-09-01"),
    localDayStart("2026-09-02"),
  );
  assert.equal(a.missingHours, 21);
  assert.equal(a.statistics[0].reviewCount, 1);
  assert.equal(a.statistics[1].reviewCount, 0);
  assert.equal(a.statistics[2].reviewCount, 1);
  assert.equal(a.points[1].hotTempC, null);
  assert.equal(a.reviews[0].kind, "ISOLATED");
  const full = await parseReadings(await readingFixture(), "synthetic.xlsx");
  const b = analyse(
    full.rows.map((r) => ({
      ...r,
      importId: "test",
      receivedAt: new Date(),
      measuredAt: new Date(r.measuredAt!),
    })) as Observation[],
    localDayStart("2026-09-01"),
    localDayStart("2026-09-02"),
  );
  assert.equal(b.reviews[0].samples, 2);
  assert.equal(b.reviews[0].kind, "CONSECUTIVE");
});
test("threshold boundaries are inclusive and measured/received times never become one timestamp", () => {
  const rows = [0, 1].map((i) => ({
    measuredAt: new Date(localDayStart("2026-09-01").getTime() + i * 3600000),
    receivedAt: new Date("2026-10-17T10:00:00Z"),
    hotTempC: PARAMETERS[0][i ? "high" : "low"],
    coldTempC: 40,
    pressureBar: 80,
    sourceId: String(i),
    sourceRow: i + 2,
    importId: "test",
    demoShift: "A",
  }));
  const a = analyse(
    rows,
    localDayStart("2026-09-01"),
    localDayStart("2026-09-02"),
  );
  assert.equal(a.reviewObservations, 0);
  assert.equal(a.statistics[0].mean, 200);
  assert.notEqual(
    rows[0].measuredAt.toISOString(),
    rows[0].receivedAt.toISOString(),
  );
});
test("wrong guide, booleans, fractional-hour times and missing formula caches fail conservatively", async () => {
  for (const [cell, value] of [
    ["E2", true],
    ["C2", "2026-09-01T00:01:00"],
    ["F2", { formula: "1+1" }],
  ] as const) {
    const zip = await JSZip.loadAsync(await readingFixture());
    const w = new (await import("exceljs")).default.Workbook();
    await w.xlsx.load(
      (await zip.generateAsync({
        type: "nodebuffer",
      })) as unknown as Parameters<typeof w.xlsx.load>[0],
    );
    w.getWorksheet("Hourly_Readings")!.getCell(cell).value =
      value as ExcelJS.CellValue;
    const p = await parseReadings(
      Buffer.from(await w.xlsx.writeBuffer()),
      "synthetic.xlsx",
    );
    assert(!p.rows[0].eligible);
  }
  const zip = await JSZip.loadAsync(await readingFixture());
  let guide = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  guide = guide.replace("<v>180</v>", "<v>30</v>");
  zip.file("xl/worksheets/sheet1.xml", guide);
  await assert.rejects(
    parseReadings(
      await zip.generateAsync({ type: "nodebuffer" }),
      "synthetic.xlsx",
    ),
  );
  await assert.rejects(parseReadings(Buffer.from("bad"), "synthetic.xlsx"));
});
import type ExcelJS from "exceljs";
test("empty numeric XML caches stay missing instead of becoming zero", async () => {
  const zip = await JSZip.loadAsync(await readingFixture());
  const name = "xl/worksheets/sheet2.xml";
  const original = await zip.file(name)!.async("string");
  assert(original.includes("<v>230</v>"));
  zip.file(name, original.replace("<v>230</v>", "<v/>"));
  const p = await parseReadings(
    await zip.generateAsync({ type: "nodebuffer" }),
    "synthetic.xlsx",
  );
  assert.equal(p.rows[0].hotTempC, null);
  assert.equal(p.rows[0].eligible, false);
});
test("numeric Excel timestamps honor both date systems without shifting local reporting dates", async () => {
  const Excel = (await import("exceljs")).default;
  for (const date1904 of [false, true]) {
    const w = new Excel.Workbook();
    await w.xlsx.load(
      (await readingFixture()) as unknown as Parameters<typeof w.xlsx.load>[0],
    );
    w.properties.date1904 = date1904;
    for (let i = 2; i <= 5; i++)
      w.getWorksheet("Hourly_Readings")!.getCell("C" + i).value = new Date(
        `2026-09-01T0${i - 2}:00:00Z`,
      );
    const parsed = await parseReadings(
      Buffer.from(await w.xlsx.writeBuffer()),
      "synthetic.xlsx",
    );
    assert(parsed.rows.every((r) => r.eligible));
    assert.equal(parsed.rows[0].localMeasuredAt, "2026-09-01T00:00:00");
    assert.equal(parsed.rows[0].measuredAt, "2026-08-31T18:30:00.000Z");
    assert.equal(parsed.rows[3].measuredAt, "2026-08-31T21:30:00.000Z");
  }
});
