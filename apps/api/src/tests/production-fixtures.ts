import ExcelJS from "exceljs";
export async function productionFixture(
  options: {
    month?: string;
    authentic?: boolean;
    mutate?: (sheet: ExcelJS.Worksheet) => void;
  } = {},
) {
  const workbook = new ExcelJS.Workbook();
  const month = options.month || "2026-09";
  const names = [
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
    `${names[Number(month.slice(5)) - 1]}-${month.slice(0, 4)}`,
  );
  sheet.getCell("A1").value = options.authentic
    ? "WH-C M/C"
    : "WH-C M/C - SYNTHETIC DEMONSTRATION";
  const headers: Record<string, string> = {
    A4: "DATE",
    B4: "SHIFT",
    C4: "Customer Name",
    D4: "PRODUCTION KGS",
    E4: "PROD TOTAL",
    F4: "NO. OF JOB CHANGES",
    G4: "SCRAP",
    AD4: "SCRAP TOTAL",
    AE4: "PROD+SCRAP",
    AG4: "DOWN TIME",
    AS4: "REMARK",
  };
  for (const [cell, value] of Object.entries(headers))
    sheet.getCell(cell).value = value;
  const categories = {
    7: "JOB CHANGE",
    8: "Roll change",
    9: "START UP",
    10: "TRIM",
    11: "FILTER CHANGE",
    12: "PROCESS PROB",
    16: "RW",
    17: "MECH",
    18: "ELECT",
    19: "POWER FAIL",
    20: "DIE LIP",
    21: "CLEARING",
    24: "FLUSHING",
    27: "COLOUR CHANGE",
    28: "PUNCH/DIE CLEANING",
    29: "QC SAMPLE SCRAP",
  };
  for (const [col, value] of Object.entries(categories))
    sheet.getCell(5, +col).value = value;
  for (let col = 33; col <= 44; col++)
    sheet.getCell(5, col).value = "CAUSE " + col;
  sheet.getCell("A8").value = new Date(month + "-01T00:00:00Z");
  sheet.getCell("B8").value = "A";
  sheet.getCell("C8").value = "SYNTHETIC job one, original description";
  sheet.getCell("D8").value = { formula: "50+50", result: 100 };
  sheet.getCell("J8").value = 2;
  sheet.getCell("AD8").value = 10;
  sheet.getCell("AS8").value = "Synthetic fixture remarks";
  sheet.getCell("B9").value = "A";
  sheet.getCell("C9").value = "SYNTHETIC job two";
  sheet.getCell("D9").value = 50;
  sheet.getCell("E9").value = 200;
  sheet.getCell("F9").value = 1;
  sheet.getCell("L9").value = 3;
  sheet.getCell("B10").value = "B";
  sheet.getCell("C10").value = "SYNTHETIC job three";
  sheet.getCell("D10").value = 50;
  sheet.getCell("L10").value = 5;
  sheet.getCell("A12").value = "08-0-2026";
  sheet.getCell("B12").value = "A";
  sheet.getCell("C12").value = "SYNTHETIC ambiguous day";
  sheet.getCell("D12").value = 90;
  sheet.getCell("E12").value = 90;
  sheet.getCell("AD12").value = 1;
  sheet.getCell("J12").value = 1;
  sheet.getCell("A14").value = new Date(month + "-03T00:00:00Z");
  sheet.getCell("B14").value = "A";
  sheet.getCell("AD14").value = 2;
  sheet.getCell("J14").value = 2;
  sheet.getCell("AL14").value = 0.5;
  sheet.getCell("AS14").value = "SYNTHETIC activity row, no production job";
  sheet.getCell("B15").value = "B";
  sheet.getCell("C15").value = "SYNTHETIC job four";
  sheet.getCell("D15").value = 80;
  sheet.getCell("E15").value = 80;
  sheet.getCell("D18").value = 370;
  sheet.getCell("E18").value = 370;
  sheet.getCell("AD18").value = 13;
  options.mutate?.(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
