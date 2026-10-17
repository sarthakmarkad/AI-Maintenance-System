import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as yauzl from "yauzl";

export const PARSER_VERSION = "whc-production-v1";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export type Source = "AUTHENTIC" | "SYNTHETIC";
export type Problem = {
  severity: "ERROR" | "WARNING";
  code: string;
  cell: string;
  message: string;
};
export type ParsedRow = {
  sourceRow: number;
  kind: "JOB" | "ACTIVITY";
  shift: "A" | "B" | "C" | null;
  description: string;
  productionKg: number | null;
  jobChanges: number | null;
  scrap: Record<string, number>;
  downtime: Record<string, number>;
  remarks: string;
  rawCells: Record<string, unknown>;
};
export type ParsedDay = {
  key: string;
  date: string | null;
  rawDate: string;
  sourceStartRow: number;
  sourceEndRow: number;
  productionKg: number;
  scrapKg: number;
  controlProductionKg: number | null;
  controlScrapKg: number | null;
  rows: ParsedRow[];
  problems: Problem[];
  eligible: boolean;
  alreadyImported: boolean;
};
export type ParsedSheet = {
  parserVersion: string;
  sheet: string;
  month: string;
  source: Source;
  filename: string;
  workbookHash: string;
  warnings: string[];
  days: ParsedDay[];
};
export type SheetInfo = {
  name: string;
  month: string | null;
  supported: boolean;
  reason: string | null;
  heading: string;
};
const months: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  SEP: 9,
  SEPT: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
const norm = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;
export const sumKg = (values: number[]) =>
  values.reduce((total, value) => total + Math.round(value * 1000), 0) / 1000;
function visible(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("formula" in value || "sharedFormula" in value) return value.result;
    if ("richText" in value)
      return value.richText.map((run) => run.text).join("");
    if ("text" in value) return value.text;
    if ("error" in value) return value.error;
  }
  return value;
}
function text(cell: ExcelJS.Cell): string {
  const value = visible(cell);
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}
function blank(cell: ExcelJS.Cell) {
  return cell.value === null || cell.value === undefined || cell.value === "";
}
export function strictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    +value.slice(0, 4) >= 2000 &&
    +value.slice(0, 4) <= 2100
  );
}
function dateValue(cell: ExcelJS.Cell, date1904: boolean): string | null {
  let value = visible(cell);
  if (value instanceof Date) {
    if (
      !Number.isFinite(value.getTime()) ||
      value.toISOString().slice(11) !== "00:00:00.000Z"
    )
      return null;
    const result = value.toISOString().slice(0, 10);
    return strictDate(result) ? result : null;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) return null;
    const date = new Date((value - (date1904 ? 24107 : 25569)) * 86400000);
    if (!Number.isFinite(date.getTime())) return null;
    const result = date.toISOString().slice(0, 10);
    return strictDate(result) ? result : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const dmy = /^(\d{2})[-.](\d{2})[-.](\d{4})$/.exec(trimmed);
  const result = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : trimmed;
  return strictDate(result) ? result : null;
}
function problem(
  day: ParsedDay,
  code: string,
  cell: string,
  message: string,
  severity: Problem["severity"] = "ERROR",
) {
  day.problems.push({ severity, code, cell, message });
}
function numeric(
  cell: ExcelJS.Cell,
  day: ParsedDay,
  name: string,
  integer = false,
): number | null {
  if (blank(cell)) return null;
  const value = visible(cell);
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^\d+(\.\d{1,3})?$/.test(value.trim()))
    parsed = Number(value);
  else {
    problem(
      day,
      "INVALID_NUMBER",
      cell.address,
      `${name} must be an unambiguous non-negative number. Formula cells need a saved numeric result.`,
    );
    return null;
  }
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 1_000_000_000 ||
    (integer && !Number.isInteger(parsed)) ||
    Math.abs(parsed - round(parsed)) > 0.00001
  ) {
    problem(
      day,
      "INVALID_NUMBER",
      cell.address,
      `${name} must be non-negative, within range, and ${integer ? "a whole number" : "at most three decimal places"}.`,
    );
    return null;
  }
  return round(parsed);
}
function sheetInfo(sheet: ExcelJS.Worksheet): SheetInfo {
  const heading = text(sheet.getCell("A1"));
  const result = {
    name: sheet.name,
    month: null as string | null,
    supported: false,
    reason: null as string | null,
    heading,
  };
  if (/EPL/i.test(sheet.name))
    return {
      ...result,
      reason:
        "EPL subset may overlap monthly records; choose the full monthly sheet.",
    };
  if (!/^WH\s*-\s*C\b/i.test(heading))
    return {
      ...result,
      reason: "The heading does not identify the WH-C pilot machine.",
    };
  const match = /^([A-Z]+)\s*-\s*(\d{2}|\d{4})$/.exec(norm(sheet.name));
  if (!match || !months[match[1]])
    return {
      ...result,
      reason:
        "An unambiguous monthly sheet name is required (for example SEP-2026).",
    };
  const year =
    match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  if (year < 2000 || year > 2100)
    return { ...result, reason: "Sheet year is outside the supported range." };
  result.month = `${year}-${String(months[match[1]]).padStart(2, "0")}`;
  const required: Record<string, string> = {
    A4: "DATE",
    B4: "SHIFT",
    C4: "CUSTOMER NAME",
    D4: "PRODUCTION KGS",
    E4: "PROD TOTAL",
    F4: "NO. OF JOB CHANGES",
    G4: "SCRAP",
    AD4: "SCRAP TOTAL",
    AE4: "PROD+SCRAP",
    AG4: "DOWN TIME",
    AS4: "REMARK",
  };
  for (const [address, label] of Object.entries(required))
    if (norm(text(sheet.getCell(address))) !== label)
      return {
        ...result,
        reason: `Unrecognized header at ${address}; this layout needs review.`,
      };
  const categoryHeaders = [
    "G5",
    "H5",
    "I5",
    "J5",
    "K5",
    "L5",
    "P5",
    "Q5",
    "R5",
    "S5",
    "T5",
    "U5",
    "X5",
    "AA5",
    "AB5",
    "AC5",
    "AG5",
    "AH5",
    "AI5",
    "AJ5",
    "AK5",
    "AL5",
    "AM5",
    "AN5",
    "AO5",
    "AP5",
    "AQ5",
    "AR5",
  ];
  if (categoryHeaders.some((address) => !text(sheet.getCell(address)).trim()))
    return {
      ...result,
      reason: "Missing category headers; this layout needs review.",
    };
  return { ...result, supported: true };
}

// Validate every decompressed entry before ExcelJS loads the archive into memory.
// This catches compressed bombs and duplicate/path-confused ZIP members without extracting files.
async function guardArchive(buffer: Buffer): Promise<void> {
  if (
    !buffer.length ||
    buffer.length > MAX_FILE_BYTES ||
    buffer.readUInt32LE(0) !== 0x04034b50
  )
    throw new BadRequestException("Upload an .xlsx workbook up to 8 MB.");
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(
            new BadRequestException(
              "The workbook is not a readable XLSX archive.",
            ),
          );
          return;
        }
        const names = new Set<string>();
        let count = 0;
        let actual = 0;
        let declared = 0;
        let ended = false;
        const fail = (message: string) => {
          if (!ended) {
            ended = true;
            zip.close();
            reject(new BadRequestException(message));
          }
        };
        zip.on("error", () =>
          fail("The XLSX archive is damaged or unsupported."),
        );
        zip.on("end", () => {
          if (!ended) {
            ended = true;
            if (!names.has("xl/workbook.xml"))
              reject(
                new BadRequestException(
                  "This archive is not an XLSX workbook.",
                ),
              );
            else resolve();
          }
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          const name = entry.fileName;
          if (
            ++count > 3000 ||
            names.has(name) ||
            /(^\/|(^|\/)\.\.(\/|$)|\\|externalLinks|vbaProject)/i.test(name) ||
            entry.generalPurposeBitFlag & 1
          ) {
            fail(
              "Encrypted, linked, macro-enabled or ambiguous workbook archives are not supported.",
            );
            return;
          }
          names.add(name);
          declared += entry.uncompressedSize;
          if (declared > 64 * 1024 * 1024) {
            fail("Expanded workbook exceeds the 64 MB processing limit.");
            return;
          }
          if (name.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail("A workbook archive entry could not be read.");
              return;
            }
            stream.on("data", (chunk: Buffer) => {
              actual += chunk.length;
              if (actual > 64 * 1024 * 1024) {
                stream.destroy();
                fail("Expanded workbook exceeds the 64 MB processing limit.");
              }
            });
            stream.on("error", () =>
              fail("The XLSX archive is damaged or unsupported."),
            );
            stream.on("end", () => {
              if (!ended) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
export async function loadWorkbook(buffer: Buffer, filename: string) {
  if (
    !/\.xlsx$/i.test(filename) ||
    path.win32.basename(path.basename(filename)).length > 180
  )
    throw new BadRequestException(
      "Only .xlsx production workbooks are supported.",
    );
  if (buffer.length < 4)
    throw new BadRequestException("The workbook is empty or invalid.");
  await guardArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new BadRequestException(
      "Could not read this workbook. Export a valid .xlsx file and try again.",
    );
  }
  if (
    workbook.worksheets.length > 100 ||
    workbook.worksheets.reduce((n, s) => n + s.rowCount, 0) > 80000 ||
    workbook.worksheets.some((s) => s.rowCount > 5000 || s.columnCount > 64)
  )
    throw new BadRequestException(
      "The workbook exceeds the supported sheet, row or column limits.",
    );
  return {
    workbook,
    filename: path.win32.basename(path.basename(filename)),
    workbookHash: createHash("sha256").update(buffer).digest("hex"),
    sheets: workbook.worksheets.map(sheetInfo),
  };
}
function rawRow(row: ExcelJS.Row) {
  const output: Record<string, unknown> = {};
  for (let col = 1; col <= 45; col++) {
    const cell = row.getCell(col);
    if (blank(cell)) continue;
    let serialized: unknown;
    try {
      serialized = JSON.parse(JSON.stringify(cell.value));
    } catch {
      serialized = cell.text;
    }
    if (JSON.stringify(serialized).length > 12000)
      throw new BadRequestException(
        `Cell ${cell.address} exceeds the supported text size.`,
      );
    output[cell.address] = serialized;
  }
  return output;
}
export function parseSheet(
  loaded: Awaited<ReturnType<typeof loadWorkbook>>,
  sheetName: string,
  source: Source,
): ParsedSheet {
  const sheet = loaded.workbook.getWorksheet(sheetName);
  const info = loaded.sheets.find((s) => s.name === sheetName);
  if (!sheet || !info)
    throw new BadRequestException("Select an existing worksheet.");
  if (!info.supported || !info.month)
    throw new BadRequestException(info.reason || "Unsupported worksheet.");
  if (
    source === "AUTHENTIC" &&
    /SYNTHETIC|DEMO/i.test(info.heading + " " + loaded.filename)
  )
    throw new BadRequestException(
      "This workbook is labeled synthetic. Select Synthetic demonstration as its source.",
    );
  const result: ParsedSheet = {
    parserVersion: PARSER_VERSION,
    sheet: sheetName,
    month: info.month,
    source,
    filename: loaded.filename,
    workbookHash: loaded.workbookHash,
    warnings: [
      "Formula cells use saved results; formulas are not recalculated. Daily production and scrap totals are reconciliation controls, not extra output.",
      "Downtime units and actual shift start times remain unconfirmed. Original workbook bytes are processed in memory and are not retained by the application. Keep your original file.",
    ],
    days: [],
  };
  const scrapHeaders: Record<number, string> = {};
  const downtimeHeaders: Record<number, string> = {};
  for (let col = 7; col <= 29; col++) {
    const parent = text(sheet.getCell(5, col)).trim();
    const child = text(sheet.getCell(6, col)).trim();
    scrapHeaders[col] =
      `${sheet.getColumn(col).letter}: ${parent}${child ? " / " + child : ""}`;
  }
  for (let col = 33; col <= 44; col++)
    downtimeHeaders[col] =
      `${sheet.getColumn(col).letter}: ${text(sheet.getCell(5, col)).trim()}`;
  let current: ParsedDay | null = null;
  const productionControls = new Map<string, number[]>(),
    scrapControls = new Map<string, number[]>();
  let footer = false;
  for (let i = 8; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const a = row.getCell(1),
      shiftRaw = norm(text(row.getCell(2))),
      description = text(row.getCell(3));
    const relevant = [
      1,
      2,
      3,
      4,
      5,
      6,
      ...Array.from({ length: 39 }, (_, j) => j + 7),
    ].some((col) => !blank(row.getCell(col)));
    if (!relevant) {
      current = null;
      continue;
    }
    if (
      blank(a) &&
      !shiftRaw &&
      (!description.trim() || /DOWN TIME|SUMMARY\s*:|TOTAL/i.test(description))
    ) {
      footer = true;
      current = null;
      continue;
    }
    if (footer) {
      // Footer statistics are never interpreted as production rows. A later shift block is unsupported.
      if (["A", "B", "C"].includes(shiftRaw))
        throw new BadRequestException(
          `Unexpected data after the summary at row ${i}; review this sheet layout.`,
        );
      continue;
    }
    if (!blank(a) || !current) {
      const date = dateValue(a, Boolean(loaded.workbook.properties.date1904));
      current = {
        key: `row-${i}`,
        date,
        rawDate: text(a),
        sourceStartRow: i,
        sourceEndRow: i,
        productionKg: 0,
        scrapKg: 0,
        controlProductionKg: null,
        controlScrapKg: null,
        rows: [],
        problems: [],
        eligible: false,
        alreadyImported: false,
      };
      result.days.push(current);
      productionControls.set(current.key, []);
      scrapControls.set(current.key, []);
      if (!date)
        problem(
          current,
          "INVALID_DATE",
          a.address,
          "Date is missing, malformed or ambiguous. This entire date block is excluded; no correction is guessed.",
        );
      else if (!date.startsWith(info.month))
        problem(
          current,
          "DATE_OUTSIDE_SHEET_MONTH",
          a.address,
          "Date does not match the selected sheet month.",
        );
    }
    const day = current;
    day.sourceEndRow = i;
    if (!["A", "B", "C"].includes(shiftRaw))
      problem(
        day,
        "INVALID_SHIFT",
        `B${i}`,
        "Shift must be A, B or C; no shift start time is inferred.",
      );
    const productionKg = numeric(row.getCell(4), day, "Production kg");
    const changes = numeric(row.getCell(6), day, "Job changes", true);
    const scrap: Record<string, number> = {},
      downtime: Record<string, number> = {};
    for (const [col, header] of Object.entries(scrapHeaders)) {
      const value = numeric(row.getCell(+col), day, "Scrap kg");
      if (value !== null) scrap[header] = value;
    }
    for (const [col, header] of Object.entries(downtimeHeaders)) {
      const value = numeric(
        row.getCell(+col),
        day,
        "Downtime (unconfirmed unit)",
      );
      if (value !== null) downtime[header] = value;
    }
    const control = numeric(row.getCell(5), day, "Daily production control");
    if (control !== null) productionControls.get(day.key)!.push(control);
    const scrapControl = numeric(row.getCell(30), day, "Daily scrap control");
    if (scrapControl !== null) scrapControls.get(day.key)!.push(scrapControl);
    if (description.trim() && productionKg === null)
      problem(
        day,
        "MISSING_PRODUCTION",
        `D${i}`,
        "A job description needs an explicit production quantity, including zero when appropriate.",
      );
    if (!description.trim() && productionKg !== null && productionKg > 0)
      problem(
        day,
        "MISSING_DESCRIPTION",
        `C${i}`,
        "A positive production quantity needs its original job description.",
      );
    day.rows.push({
      sourceRow: i,
      kind: description.trim() ? "JOB" : "ACTIVITY",
      shift: (["A", "B", "C"].includes(shiftRaw)
        ? shiftRaw
        : null) as ParsedRow["shift"],
      description,
      productionKg,
      jobChanges: changes,
      scrap,
      downtime,
      remarks: text(row.getCell(45)),
      rawCells: rawRow(row),
    });
  }
  const seen = new Map<string, ParsedDay[]>();
  for (const day of result.days) {
    day.productionKg = sumKg(day.rows.map((row) => row.productionKg ?? 0));
    day.scrapKg = sumKg(day.rows.flatMap((row) => Object.values(row.scrap)));
    for (const [controls, key, field] of [
      [productionControls, "controlProductionKg", "production"],
      [scrapControls, "controlScrapKg", "scrap"],
    ] as const) {
      const values = controls.get(day.key)!;
      const unique = [...new Set(values)];
      if (unique.length !== 1)
        problem(
          day,
          unique.length ? "CONFLICTING_CONTROL" : "MISSING_CONTROL",
          `${field === "production" ? "E" : "AD"}${day.sourceStartRow}`,
          unique.length
            ? `Conflicting daily ${field} control totals.`
            : `Daily ${field} control total is missing.`,
        );
      else {
        day[key] = unique[0];
        if (values.length > 1)
          problem(
            day,
            "REPEATED_CONTROL",
            `${field === "production" ? "E" : "AD"}${day.sourceStartRow}`,
            `Repeated equal daily ${field} controls are retained once.`,
            "WARNING",
          );
        if (
          Math.abs(
            unique[0] -
              (field === "production" ? day.productionKg : day.scrapKg),
          ) > 0.010001
        )
          problem(
            day,
            "CONTROL_MISMATCH",
            `${field === "production" ? "E" : "AD"}${day.sourceStartRow}`,
            `Job/category sum does not reconcile to the daily ${field} control within 0.01 kg.`,
          );
      }
    }
    if (day.date) seen.set(day.date, [...(seen.get(day.date) ?? []), day]);
  }
  for (const days of seen.values())
    if (days.length > 1)
      for (const day of days)
        problem(
          day,
          "REPEATED_DATE",
          `A${day.sourceStartRow}`,
          "Date occurs in multiple separate blocks; review before importing.",
        );
  for (const day of result.days)
    day.eligible = day.problems.every((p) => p.severity !== "ERROR");
  if (!result.days.length)
    throw new BadRequestException(
      "No dated shift/job records were found in this sheet.",
    );
  return result;
}
