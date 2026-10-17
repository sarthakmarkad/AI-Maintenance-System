import ExcelJS from "exceljs";
import JSZip from "jszip";
export async function readingFixture(
  options: {
    month?: string;
    invalid?: boolean;
    duplicate?: boolean;
    prefix?: boolean;
    forgedFlags?: boolean;
    missing?: boolean;
  } = {},
) {
  const w = new ExcelJS.Workbook(),
    g = w.addWorksheet("Guide"),
    s = w.addWorksheet("Hourly_Readings");
  for (const [a, v] of Object.entries({
    B5: "WH-C",
    B10: "SYNTHETIC",
    B12: "Asia/Kolkata (UTC+05:30)",
    C16: 180,
    D16: 220,
    C17: 40,
    D17: 50,
    C18: 80,
    D18: 120,
  }))
    g.getCell(a).value = v;
  s.addRow([
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
  ]);
  const day = options.month ?? "2026-09";
  for (let i = 0; i < 4; i++) {
    if (options.missing && i === 1) continue;
    const r = s.addRow([
      "TEST-" + i,
      "WH-C",
      `${day}-01T0${i}:00:00`,
      "A",
      i < 2 ? 230 : 200,
      45,
      i === 3 ? 130 : 100,
      "SYNTHETIC",
      options.forgedFlags ? 999 : 0,
      options.forgedFlags ? 999 : 0,
      options.forgedFlags ? 999 : 0,
    ]);
    if (options.invalid && i === 2) r.getCell(3).value = "08-0-2026";
    if (options.duplicate && i === 3) r.getCell(1).value = "TEST-0";
  }
  const zip = await JSZip.loadAsync(await w.xlsx.writeBuffer());
  if (options.prefix)
    for (const name of [
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]) {
      const original = await zip.file(name)!.async("string");
      zip.file(
        name,
        original
          .replace(
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
            'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          )
          .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "<$1x:$2"),
      );
    }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
