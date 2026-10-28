import ExcelJS from "exceljs";
import { PRODUCTION_TEMPLATE_HEADERS } from "../production/parser";
import { READING_HEADERS } from "../readings/parser";
export const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const templateMonth = (date = new Date()) =>
  new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 7);
function heading(sheet: ExcelJS.Worksheet, row: number, lastColumn: number) {
  const range = sheet.getRow(row);
  range.height = 42;
  range.font = { bold: true, color: { argb: "FFFFFFFF" } };
  range.alignment = { vertical: "middle", wrapText: true };
  range.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF263E3A" },
  };
  sheet.views = [{ state: "frozen", ySplit: row }];
  sheet.autoFilter = {
    from: { row, column: 1 },
    to: { row, column: lastColumn },
  };
}
export async function productionTemplate(code: string, month: string) {
  const workbook = new ExcelJS.Workbook();
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const sheet = workbook.addWorksheet(
    `${months[Number(month.slice(5)) - 1]}-${month.slice(0, 4)}`,
  );
  sheet.getCell("A1").value = `${code} production records`;
  sheet.getCell("A1").font = { bold: true, size: 16 };
  sheet.getCell("A2").value = "maintenance-production-v1";
  sheet.mergeCells("A3:I3");
  sheet.getCell("A3").value =
    "Enter one job/activity per row, starting at row 8. Date only on the first row of each contiguous day; keep its other rows together. All production/scrap quantities are kg.";
  sheet.getRow(3).height = 42;
  sheet.getCell("A3").alignment = { wrapText: true };
  for (const [cell, label] of Object.entries(PRODUCTION_TEMPLATE_HEADERS))
    sheet.getCell(cell).value = label;
  sheet.mergeCells("A6:I6");
  sheet.getCell("A6").value =
    "Enter each daily production/scrap control once in G/H for that day. They must reconcile with its job/scrap rows. Use explicit zero controls when appropriate; do not add a monthly total as another job.";
  sheet.getCell("A6").alignment = { wrapText: true };
  sheet.getRow(6).height = 42;
  sheet.mergeCells("A7:I7");
  sheet.getCell("A7").value =
    `Machine: ${code}. Month: ${month}. Shift labels A/B/C do not establish actual working hours. Enter actual records only and declare their source during import. No sample production is included.`;
  sheet.getCell("A7").alignment = { wrapText: true };
  sheet.getRow(7).height = 42;
  sheet.columns.forEach((column, index) => {
    column.width = [17, 12, 32, 20, 16, 20, 24, 24, 36][index] ?? 20;
  });
  for (const col of [4, 6, 7, 8]) sheet.getColumn(col).numFmt = "0.000";
  sheet.getColumn(1).numFmt = "yyyy-mm-dd";
  sheet.getColumn(5).numFmt = "0";
  heading(sheet, 4, 9);
  sheet.views = [{ state: "frozen", ySplit: 7 }];
  sheet.autoFilter = undefined;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function readingsTemplate(code: string) {
  const workbook = new ExcelJS.Workbook(),
    guide = workbook.addWorksheet("Guide"),
    sheet = workbook.addWorksheet("Hourly_Readings");
  for (const [cell, value] of Object.entries({
    A1: "SYNTHETIC PROCESS READING TEMPLATE",
    A3: "Profile",
    B3: "Three demonstration parameters: hot temperature °C, cold temperature °C, pressure bar. Not a configurable industrial sensor schema.",
    A5: "Machine code",
    B5: code,
    A6: "Row machine_id",
    B6: `Every data row must identify ${code}. Add rows below the Hourly_Readings header. No observations are included.`,
    A8: "Timestamp",
    B8: "Use whole-hour local ISO timestamps, e.g. YYYY-MM-DDTHH:00:00, interpreted in Asia/Kolkata. measured_at and receipt time remain distinct.",
    A9: "Demo shift",
    B9: "Invented A 00–08 / B 08–16 / C 16–24; not the plant's actual working hours.",
    A10: "Source",
    B10: "SYNTHETIC",
    A12: "Time zone",
    B12: "Asia/Kolkata (UTC+05:30)",
    A14: "Bands below are invented software-demo values, NOT engineering operating limits.",
    A16: "Hot temperature °C",
    C16: 180,
    D16: 220,
    A17: "Cold temperature °C",
    C17: 40,
    D17: 50,
    A18: "Pressure bar",
    C18: 80,
    D18: 120,
    A20: "Review columns",
    B20: "hot_review/cold_review/pressure_review are optional provenance only. Calculations use numeric measurements; formula flags never establish a fault.",
    A22: "Limits",
    B22: "1–1,000 synthetic rows over at most 31 days. Three-decimal numeric values. Unique reading_id and measurement hour per machine. Use the exact headers; preserve the Guide. This file contains no actual or sample observations.",
  }))
    guide.getCell(cell).value = value;
  guide.getColumn(1).width = 32;
  guide.getColumn(2).width = 95;
  guide.getColumn(3).width = 15;
  guide.getColumn(4).width = 15;
  guide.getColumn(2).alignment = { wrapText: true };
  for (const i of [3, 6, 8, 9, 20, 22]) guide.getRow(i).height = 48;
  guide.getCell("A1").font = { bold: true, size: 16 };
  guide.getCell("A14").font = { bold: true, color: { argb: "FF9A4300" } };
  sheet.addRow([...READING_HEADERS]);
  sheet.columns.forEach((column, index) => {
    column.width = index === 2 ? 28 : 23;
  });
  for (const col of [5, 6, 7]) sheet.getColumn(col).numFmt = "0.000";
  sheet.getColumn(3).numFmt = "@";
  heading(sheet, 1, READING_HEADERS.length);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
