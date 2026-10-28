import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as yauzl from "yauzl";

export const PRODUCTION_TEMPLATE_HEADERS: Record<string, string> = {
  A4: "DATE",
  B4: "SHIFT",
  C4: "JOB / REFERENCE",
  D4: "PRODUCTION KG",
  E4: "JOB CHANGES",
  F4: "SCRAP KG",
  G4: "DAILY PRODUCTION CONTROL KG",
  H4: "DAILY SCRAP CONTROL KG",
  I4: "REMARKS",
};
export const PARSER_VERSION = "whc-production-v1";
export const SUPPORTED_PRODUCTION_PARSERS = [
  PARSER_VERSION,
  "machine-production-template-v1",
  "monthly-production-layout-v1",
  "whb-monthly-production-v1",
] as const;
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
// Owner-confirmed source identity, 28 October 2026. This is a reviewed mapping
// for WHB, not punctuation normalization or a general workbook identity bypass.
const whbHeading = (heading: string, machineCode: string) =>
  machineCode === "WHB" &&
  /^W\s*&\s*H\s+B\s+M\/C(?:\s*-\s*SYNTHETIC DEMONSTRATION)?$/i.test(
    heading.trim(),
  );
const whbCategoryHeaders: Record<string, string> = {
  G5: "JOB CHANGE",
  H5: "ROLL CHANGE",
  I5: "START UP",
  J5: "TRIM",
  K5: "FILTER CHANGE",
  L5: "PROCESS PROB",
  P5: "RW",
  Q5: "MECH",
  R5: "ELECT",
  S5: "POWER FAIL",
  T5: "DIE LIP",
  U5: "CLEARING",
  X5: "FLUSHING",
  AA5: "COLOUR CHANGE",
  AB5: "PUNCH/DIE CLEANING",
  AC5: "QC SAMPLE SCRAP",
  AG5: "JOB CHANGE",
  AH5: "START UP",
  AI5: "FILTER CHANGE",
  AJ5: "PROCESS PROB",
  AK5: "RM",
  AL5: "MECH",
  AM5: "ELECT",
  AN5: "PRE. MAINT",
  AO5: "POWER FAIL",
  AP5: "DIE LIP",
  AQ5: "FLUSHING",
  AR5: "PUNCH/DIE CLEANING",
  AS5: "NO PLANNING",
  L6: "OTHER",
  M6: "NYLON FLOW",
  N6: "PARTICAL",
  O6: "LUMPS",
  U6: "EVOH",
  V6: "NYLON",
  W6: "PE",
  X6: "EVOH",
  Y6: "NYLON",
  Z6: "PE",
};
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
function sheetInfo(sheet: ExcelJS.Worksheet, machineCode: string): SheetInfo {
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
  const prefix = machineCode
    .split("-")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*-\\s*");
  const whb = whbHeading(heading, machineCode);
  if (!whb && !new RegExp(`^${prefix}(?=$|[\\s:/|])`, "i").test(heading.trim()))
    return {
      ...result,
      reason: `The heading must identify the selected machine ${machineCode}.`,
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
  const standard = sheet.getCell("A2").value === "maintenance-production-v1";
  const required: Record<string, string> = standard
    ? PRODUCTION_TEMPLATE_HEADERS
    : {
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
        [whb ? "AT4" : "AS4"]: "REMARK",
      };
  for (const [address, label] of Object.entries(required))
    if (norm(text(sheet.getCell(address))) !== label)
      return {
        ...result,
        reason: `Unrecognized header at ${address}; this layout needs review.`,
      };
  if (whb && !standard) {
    for (const [address, label] of Object.entries(whbCategoryHeaders))
      if (norm(text(sheet.getCell(address))) !== label)
        return {
          ...result,
          reason: `Unrecognized WHB category at ${address}; this layout needs review.`,
        };
  }
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
  if (
    !standard &&
    categoryHeaders.some((address) => !text(sheet.getCell(address)).trim())
  )
    return {
      ...result,
      reason: "Missing category headers; this layout needs review.",
    };
  return { ...result, supported: true };
}

// Validate every decompressed entry before ExcelJS loads the archive into memory.
// This catches compressed bombs and duplicate/path-confused ZIP members without extracting files.
export async function guardArchive(buffer: Buffer): Promise<void> {
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
export async function loadWorkbook(
  buffer: Buffer,
  filename: string,
  machineCode = "WH-C",
) {
  if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(machineCode))
    throw new BadRequestException("Invalid selected machine code.");
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
    machineCode,
    sheets: workbook.worksheets.map((sheet) => sheetInfo(sheet, machineCode)),
  };
}
function rawRow(row: ExcelJS.Row, maxColumn = 45) {
  const output: Record<string, unknown> = {};
  for (let col = 1; col <= maxColumn; col++) {
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
      "This workbook is labeled synthetic and cannot be imported as company production.",
    );
  const standard = sheet.getCell("A2").value === "maintenance-production-v1";
  const whb = !standard && whbHeading(info.heading, loaded.machineCode);
  const controlColumn = standard ? 7 : 5,
    scrapControlColumn = standard ? 8 : 30,
    jobChangesColumn = standard ? 5 : 6,
    remarksColumn = standard ? 9 : whb ? 46 : 45;
  if (standard) {
    for (let row = 8; row <= sheet.rowCount; row++)
      for (let col = 10; col <= sheet.columnCount; col++)
        if (!blank(sheet.getCell(row, col)))
          throw new BadRequestException(
            `Unexpected data at ${sheet.getCell(row, col).address}; the standard template supports columns A–I only. Use an explicit mapping for other columns.`,
          );
  }
  const result: ParsedSheet = {
    parserVersion: standard
      ? "machine-production-template-v1"
      : whb
        ? "whb-monthly-production-v1"
        : loaded.machineCode === "WH-C"
          ? PARSER_VERSION
          : "monthly-production-layout-v1",
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
  if (whb)
    result.warnings.push(
      "Reviewed source mapping: “W & H B M/C” identifies registered machine WHB, confirmed by the owner. Scrap G–AC, daily controls E/AD, downtime AG–AS (unconfirmed units), remarks AT. Populated columns beyond AT exclude the affected date block; no values are silently dropped.",
    );
  const scrapHeaders: Record<number, string> = {};
  const downtimeHeaders: Record<number, string> = {};
  if (standard) scrapHeaders[6] = "F: Scrap kg";
  for (let col = 7; !standard && col <= 29; col++) {
    const parent = text(sheet.getCell(5, col)).trim();
    const child = text(sheet.getCell(6, col)).trim();
    scrapHeaders[col] =
      `${sheet.getColumn(col).letter}: ${parent}${child ? " / " + child : ""}`;
  }
  for (let col = 33; !standard && col <= (whb ? 45 : 44); col++)
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
      ...Array.from(
        {
          length:
            (whb ? Math.max(remarksColumn, sheet.columnCount) : remarksColumn) -
            6,
        },
        (_, j) => j + 7,
      ),
    ].some((col) => !blank(row.getCell(col)));
    // The reviewed WHB workbook leaves percentage formulas in otherwise empty
    // rows. They are derived ratios, not jobs or daily reconciliation controls.
    const populatedColumns = whb
      ? Array.from({ length: sheet.columnCount }, (_, j) => j + 1).filter(
          (col) => !blank(row.getCell(col)),
        )
      : [];
    if (whb && populatedColumns.length === 1 && populatedColumns[0] === 32)
      continue;
    if (!relevant) {
      current = null;
      continue;
    }
    const whbSummaryAhead =
      whb &&
      !description.trim() &&
      [1, 2, 3].some((offset) => {
        const next = sheet.getRow(i + offset);
        return (
          blank(next.getCell(1)) &&
          blank(next.getCell(2)) &&
          norm(text(next.getCell(3))) === "DOWN TIME" &&
          Array.from({ length: offset - 1 }, (_, j) =>
            sheet.getRow(i + j + 1),
          ).every(
            (r) =>
              blank(r.getCell(1)) &&
              blank(r.getCell(2)) &&
              !text(r.getCell(3)).trim(),
          )
        );
      });
    if (
      blank(a) &&
      !shiftRaw &&
      ((!whb && !description.trim()) ||
        whbSummaryAhead ||
        /DOWN TIME|SUMMARY\s*:|TOTAL/i.test(description))
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
    if (whb)
      for (let col = 47; col <= sheet.columnCount; col++)
        if (!blank(row.getCell(col)))
          problem(
            day,
            "UNMAPPED_COLUMN",
            row.getCell(col).address,
            "This populated column is outside the reviewed WHB mapping (A–AT). Review this date block before importing; no column meaning is guessed.",
          );
    if (!["A", "B", "C"].includes(shiftRaw))
      problem(
        day,
        "INVALID_SHIFT",
        `B${i}`,
        "Shift must be A, B or C; no shift start time is inferred.",
      );
    const productionKg = numeric(row.getCell(4), day, "Production kg");
    const changes = numeric(
      row.getCell(jobChangesColumn),
      day,
      "Job changes",
      true,
    );
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
    const control = numeric(
      row.getCell(controlColumn),
      day,
      "Daily production control",
    );
    if (control !== null) productionControls.get(day.key)!.push(control);
    const scrapControl = numeric(
      row.getCell(scrapControlColumn),
      day,
      "Daily scrap control",
    );
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
      remarks: text(row.getCell(remarksColumn)),
      rawCells: rawRow(
        row,
        whb ? Math.max(remarksColumn, sheet.columnCount) : remarksColumn,
      ),
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
          `${sheet.getColumn(field === "production" ? controlColumn : scrapControlColumn).letter}${day.sourceStartRow}`,
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
            `${sheet.getColumn(field === "production" ? controlColumn : scrapControlColumn).letter}${day.sourceStartRow}`,
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
            `${sheet.getColumn(field === "production" ? controlColumn : scrapControlColumn).letter}${day.sourceStartRow}`,
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
