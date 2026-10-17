import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import path from "node:path";
import { readingWorkbook, type Cell } from "./xlsx";
import { strictDate } from "../production/parser";
export const READING_PARSER = "whc-synthetic-readings-v1";
export const REVIEW_POLICY = "demo-hourly-bands-v1";
export const PARAMETERS = [
  {
    key: "hotTempC",
    name: "Hot temperature",
    unit: "°C assumed",
    low: 180,
    high: 220,
  },
  {
    key: "coldTempC",
    name: "Cold temperature",
    unit: "°C assumed",
    low: 40,
    high: 50,
  },
  { key: "pressureBar", name: "Pressure", unit: "bar", low: 80, high: 120 },
] as const;
export const IST_OFFSET = 330 * 60000;
export const localTime = (date: Date) =>
  new Date(date.getTime() + IST_OFFSET).toISOString().slice(0, 19);
export const localDayStart = (date: string) =>
  new Date(date + "T00:00:00+05:30");
export type ReadingRow = {
  sourceRow: number;
  sourceId: string;
  localMeasuredAt: string | null;
  measuredAt: string | null;
  demoShift: string;
  hotTempC: number | null;
  coldTempC: number | null;
  pressureBar: number | null;
  problems: string[];
  eligible: boolean;
  alreadyImported: boolean;
  rawCells: Record<string, Cell>;
};
export type ReadingStage = {
  parserVersion: string;
  policyVersion: string;
  source: "SYNTHETIC";
  sheet: string;
  filename: string;
  workbookHash: string;
  warnings: string[];
  rows: ReadingRow[];
};
function timestamp(cell: Cell | undefined, date1904: boolean): string | null {
  const value = cell?.value;
  if (cell?.formula !== undefined) return null;
  let local: string;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.round((value - (date1904 ? 24107 : 25569)) * 86400000);
    if (!Number.isFinite(ms) || Math.abs(ms) > 8e15) return null;
    local = new Date(ms).toISOString().slice(0, 19);
  } else if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:00(?::00)?$/.test(value)
  )
    local = value.replace(" ", "T").padEnd(19, ":00");
  else return null;
  if (
    !strictDate(local.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00:00$/.test(local)
  )
    return null;
  return local;
}
function number(cell: Cell | undefined): number | null {
  const v = cell?.value;
  // Booleans, errors, strings and absent formula caches are never quantities.
  if (
    typeof v !== "number" ||
    (cell?.type && cell.type !== "n") ||
    !Number.isFinite(v) ||
    Math.abs(v) > 1000000 ||
    Math.abs(v * 1000 - Math.round(v * 1000)) > 0.00001
  )
    return null;
  return Math.round(v * 1000) / 1000;
}
export async function parseReadings(
  buffer: Buffer,
  filename: string,
): Promise<ReadingStage> {
  filename = path.win32.basename(path.basename(filename));
  if (!/\.xlsx$/i.test(filename) || filename.length > 180 || buffer.length < 4)
    throw new BadRequestException(
      "Choose a synthetic .xlsx workbook up to 8 MB.",
    );
  const workbook = await readingWorkbook(buffer);
  const guide = (address: string) =>
    workbook.guide.get(+address.slice(1))?.[address]?.value;
  if (
    guide("B5") !== "WH-C" ||
    guide("B10") !== "SYNTHETIC" ||
    guide("B12") !== "Asia/Kolkata (UTC+05:30)" ||
    ["C16", "D16", "C17", "D17", "C18", "D18"].some(
      (a, i) => guide(a) !== [180, 220, 40, 50, 80, 120][i],
    )
  )
    throw new BadRequestException(
      "Guide must identify WH-C, SYNTHETIC, Asia/Kolkata and the supplied demonstration bands. Engineering limits are not imported.",
    );
  const headers = [
    "reading_id",
    "machine_id",
    "measured_at_ist",
    "demo_shift",
    "hot_temp_c",
    "cold_temp_c",
    "pressure_bar",
    "data_source",
    "hot_review",
    "cold_review",
    "pressure_review",
  ];
  if (
    headers.some(
      (h, i) =>
        workbook.rows.get(1)?.[String.fromCharCode(65 + i) + "1"]?.value !== h,
    )
  )
    throw new BadRequestException(
      "Hourly_Readings headers or parameter units do not match the supported layout.",
    );
  const rows: ReadingRow[] = [];
  for (const [index, cells] of workbook.rows) {
    if (
      index === 1 ||
      Object.values(cells).every((c) => c.value === null || c.value === "")
    )
      continue;
    const v = (col: string) => cells[col + index]?.value;
    const local = timestamp(cells["C" + index], workbook.date1904);
    const row: ReadingRow = {
      sourceRow: index,
      sourceId: typeof v("A") === "string" ? String(v("A")) : "",
      localMeasuredAt: local,
      measuredAt: local ? new Date(local + "+05:30").toISOString() : null,
      demoShift: String(v("D") ?? ""),
      hotTempC: number(cells["E" + index]),
      coldTempC: number(cells["F" + index]),
      pressureBar: number(cells["G" + index]),
      problems: [],
      eligible: false,
      alreadyImported: false,
      rawCells: cells,
    };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.sourceId))
      row.problems.push(`A${index}: missing or invalid reading ID.`);
    if (v("B") !== "WH-C" || v("H") !== "SYNTHETIC")
      row.problems.push(
        `B${index}/H${index}: only WH-C synthetic observations are accepted.`,
      );
    if (!local)
      row.problems.push(
        `C${index}: a real whole-hour Asia/Kolkata timestamp is required; no date is guessed.`,
      );
    const shift = local
      ? ["A", "B", "C"][Math.floor(+local.slice(11, 13) / 8)]
      : null;
    if (row.demoShift !== shift)
      row.problems.push(
        `D${index}: shift must match the workbook's invented 00–08 / 08–16 / 16–24 schedule.`,
      );
    for (const [i, key] of ["hotTempC", "coldTempC", "pressureBar"].entries())
      if (row[key as "hotTempC"] === null)
        row.problems.push(
          `${String.fromCharCode(69 + i)}${index}: numeric value required, up to three decimals. Formulas need saved numeric results.`,
        );
    rows.push(row);
  }
  if (!rows.length || rows.length > 1000)
    throw new BadRequestException(
      "The workbook must contain 1–1,000 observations.",
    );
  for (const row of rows) {
    if (rows.filter((r) => r.sourceId === row.sourceId).length > 1)
      row.problems.push(
        "Duplicate reading ID within this file; all conflicting rows are excluded.",
      );
    if (
      row.measuredAt &&
      rows.filter((r) => r.measuredAt === row.measuredAt).length > 1
    )
      row.problems.push(
        "Duplicate measurement time within this file; all conflicting rows are excluded.",
      );
    row.eligible = !row.problems.length;
  }
  const times = rows
    .filter((r) => r.measuredAt)
    .map((r) => Date.parse(r.measuredAt!));
  if (
    times.length &&
    Math.max(...times) - Math.min(...times) > 31 * 86400000 - 3600000
  )
    throw new BadRequestException(
      "Choose a workbook spanning at most 31 days.",
    );
  return {
    parserVersion: READING_PARSER,
    policyVersion: REVIEW_POLICY,
    source: "SYNTHETIC",
    sheet: "Hourly_Readings",
    filename,
    workbookHash: createHash("sha256").update(buffer).digest("hex"),
    warnings: [
      "SYNTHETIC demonstration only. Review bands are invented software rules, not engineering limits or machine alarms.",
      "Measurements are hourly Asia/Kolkata snapshots; import time is separate. Between-sample events can be missed. No live monitoring or automatic breakdown diagnosis.",
      "Demo_Events and workbook formula review flags are excluded from trend and review calculations. Original workbook bytes are not retained.",
    ],
    rows,
  };
}
