import { UnprocessableEntityException } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { openSync, type Font } from "fontkit";
import { resolve } from "node:path";
import { ist, label, literal, type ReportSnapshot } from "./model";
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const assets = resolve(__dirname, "../../assets/fonts");
let fonts: { regular: Font; devanagari: Font } | undefined;
function getFonts() {
  if (!fonts) {
    const regular = openSync(resolve(assets, "NotoSans-Regular.ttf")),
      devanagari = openSync(resolve(assets, "NotoSansDevanagari-Regular.ttf"));
    if (
      !("hasGlyphForCodePoint" in regular) ||
      !("hasGlyphForCodePoint" in devanagari)
    )
      throw Error("Report font is invalid");
    fonts = { regular, devanagari };
  }
  return fonts;
}
export function pdfText(value: string) {
  const font = /[\u0900-\u097f\ua8e0-\ua8ff]/.test(value)
      ? "devanagari"
      : "regular",
    face = getFonts()[font];
  const text = Array.from(literal(value))
    .map((c) =>
      ["\n", "\r", "\t", "\u200c", "\u200d"].includes(c) ||
      face.hasGlyphForCodePoint(c.codePointAt(0)!)
        ? c
        : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`,
    )
    .join("");
  return { text, font };
}
function metadata(s: ReportSnapshot) {
  return [
    ["Report", s.title],
    ["Organization", s.organization],
    ["Machine", s.machineCode + " / " + s.machineName],
    ["Date basis", s.basis],
    ["From (IST)", s.from || "Single record"],
    ["To (IST)", s.to || "Single record"],
    ["Status filter", label(s.status)],
    ["Work type filter", s.kind ? label(s.kind) : "All applicable types"],
    ["Generated (IST)", ist(s.generatedAt)],
    ["Generated (UTC)", s.generatedAt],
    ["Requested by", s.requestedBy],
    ["Active role", s.requestedRole],
    ["Records", s.total],
    ["Open", s.counts.open],
    ["Closed", s.counts.closed],
    ["Skipped", s.counts.skipped],
    ["Source fingerprint", s.fingerprint],
    ["Coverage / provenance", s.warning ?? "See report notes"],
    ...s.notes.map((n, i) => ["Note " + (i + 1), n]),
  ] as (string | number)[][];
}
export async function renderWorkbook(s: ReportSnapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "Maintenance Intelligence";
  book.created = new Date(s.generatedAt);
  book.modified = new Date(s.generatedAt);
  for (const sheet of [
    {
      name: "Report information",
      headers: ["Field", "Value"],
      rows: metadata(s),
    },
    ...s.sheets,
  ]) {
    const ws = book.addWorksheet(sheet.name, {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "1:1",
      },
    });
    ws.addRow(sheet.headers);
    for (const values of sheet.rows) {
      const row = values.map((v) => {
        if (typeof v !== "string") return v;
        const value = literal(v);
        if (value.length > 32767)
          throw new UnprocessableEntityException(
            "A report field exceeds Excel’s cell limit. Request an archival export.",
          );
        return value;
      });
      // Strings remain explicit string cells. No formula/hyperlink objects are accepted.
      ws.addRow(row);
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, ws.rowCount), column: sheet.headers.length },
    };
    ws.getRow(1).height = 32;
    ws.getRow(1).eachCell((cell) => {
      cell.font = {
        name: "Arial",
        bold: true,
        color: { argb: "FFFFFFFF" },
        size: 11,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF176B52" },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    ws.columns.forEach((column, i) => {
      column.width =
        sheet.headers.length === 2
          ? i === 0
            ? 27
            : 100
          : /description|instructions|findings|detail|evidence|action|reason|follow-up/i.test(
                sheet.headers[i],
              )
            ? 65
            : /ID|SHA|fingerprint/i.test(sheet.headers[i])
              ? 40
              : 26;
    });
    for (let n = 2; n <= ws.rowCount; n++)
      ws.getRow(n).eachCell((cell) => {
        cell.font = { name: "Arial", size: 10 };
        cell.alignment = { vertical: "top", wrapText: true };
        if (n % 2 === 0)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF4F7F4" },
          };
      });
  }
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  if (bytes.length > MAX_OUTPUT_BYTES)
    throw new UnprocessableEntityException(
      "The report exceeds the 16 MB download limit. Choose a narrower range.",
    );
  return bytes;
}
export function renderPdf(s: ReportSnapshot): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const detail = !!s.sections;
    const doc = new PDFDocument({
      size: "A4",
      layout: detail ? "portrait" : "landscape",
      margins: { top: 60, bottom: 54, left: 42, right: 42 },
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: s.title,
        Author: "Maintenance Intelligence",
        Subject: `${s.machineCode} / private maintenance snapshot`,
      },
    });
    const chunks: Buffer[] = [];
    let length = 0,
      pages = 0;
    doc.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_OUTPUT_BYTES)
        doc.destroy(
          new UnprocessableEntityException(
            "The PDF exceeds the 16 MB download limit. Choose a narrower report.",
          ),
        );
      else chunks.push(chunk);
    });
    doc.on("error", reject);
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    try {
      doc.registerFont("regular", resolve(assets, "NotoSans-Regular.ttf"));
      doc.registerFont(
        "devanagari",
        resolve(assets, "NotoSansDevanagari-Regular.ttf"),
      );
      doc.on("pageAdded", () => {
        pages++;
        if (pages > 100)
          throw new UnprocessableEntityException(
            "The PDF exceeds 100 pages. Choose a narrower report or request an archival export.",
          );
      });
      doc.addPage();
      const left = 42,
        width = doc.page.width - 84;
      const text = (
        value: string,
        size = 10,
        color = "#142a2c",
        options: PDFKit.Mixins.TextOptions = {},
      ) => {
        const t = pdfText(value);
        doc
          .font(t.font)
          .fontSize(size)
          .fillColor(color)
          .text(t.text, left, doc.y, { width, lineGap: 2, ...options });
      };
      const room = (height: number) => {
        if (doc.y + height > doc.page.height - 54) doc.addPage();
      };
      text(s.title, 21);
      doc.moveDown(0.3);
      text(s.organization + " | " + s.machineCode + " - " + s.machineName, 11);
      text(
        `${s.basis}${s.from ? " | " + s.from + " to " + s.to + " (IST)" : ""} | Status: ${label(s.status)}${s.kind ? " | " + label(s.kind) : ""}`,
        9,
      );
      text(
        `Generated: ${ist(s.generatedAt)} | Requested by ${s.requestedBy} (${s.requestedRole})`,
        8,
        "#657472",
      );
      text(
        `Records: ${s.total} | Open: ${s.counts.open} | Closed: ${s.counts.closed}${s.report === "planned-maintenance" ? " | Skipped: " + s.counts.skipped : ""}`,
        10,
      );
      if (s.warning) {
        doc.moveDown(0.3);
        text(s.warning, 9, "#875b10");
      }
      for (const note of s.notes) text(note, 8, "#657472");
      doc.moveDown(0.8);
      if (detail) {
        for (const section of s.sections!) {
          room(82);
          text(section.title, 13, "#176b52");
          doc.moveDown(0.3);
          if (!section.fields.length) text("None recorded.", 10, "#657472");
          for (const field of section.fields) {
            room(55);
            text(field.label, 8, "#657472");
            text(field.value, 10);
            doc.moveDown(0.45);
          }
          doc.moveDown(0.5);
        }
      } else {
        const proportions =
          s.report === "planned-maintenance"
            ? [0.14, 0.27, 0.17, 0.12, 0.15, 0.15]
            : [0.26, 0.11, 0.14, 0.17, 0.16, 0.16];
        const widths = proportions.map((p) => p * width);
        const row = (cells: string[], header = false) => {
          const size = header ? 8 : 8.5,
            prepared = cells.map(pdfText);
          const height = Math.max(
            header ? 32 : 30,
            ...prepared.map(
              (t, i) =>
                doc
                  .font(t.font)
                  .fontSize(size)
                  .heightOfString(t.text, {
                    width: widths[i] - 14,
                    lineGap: 2,
                  }) + 16,
            ),
          );
          if (height > doc.page.height - 130)
            throw new UnprocessableEntityException(
              "A PDF table row is too large. Use Excel or an individual work-order report.",
            );
          if (doc.y + height > doc.page.height - 54) {
            doc.addPage();
            row(s.columns, true);
          }
          const y = doc.y;
          doc.rect(left, y, width, height).fill(header ? "#176b52" : "#f3f6f3");
          let x = left;
          prepared.forEach((t, i) => {
            doc
              .font(t.font)
              .fontSize(size)
              .fillColor(header ? "#ffffff" : "#142a2c")
              .text(t.text, x + 7, y + 8, {
                width: widths[i] - 14,
                lineGap: 2,
              });
            x += widths[i];
          });
          doc
            .strokeColor("#dce5dc")
            .lineWidth(0.5)
            .moveTo(left, y + height)
            .lineTo(left + width, y + height)
            .stroke();
          doc.y = y + height;
        };
        row(s.columns, true);
        for (const r of s.rows) row(r.cells);
        if (!s.rows.length) {
          doc.moveDown();
          text("No records match these filters.", 11);
        }
      }
      // Draw running headers/footers only after all flowing text. Changing a font
      // inside pageAdded would corrupt a long multilingual paragraph mid-flow.
      const range = doc.bufferedPageRange();
      for (let n = range.start; n < range.start + range.count; n++) {
        doc.switchToPage(n);
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .font("regular")
          .fontSize(8)
          .fillColor("#657472")
          .text(`MAINTENANCE / ${s.machineCode}`, 42, 27, { lineBreak: false });
        doc.text("PRIVATE TEAM REPORT", doc.page.width - 180, 27, {
          width: 138,
          align: "right",
          lineBreak: false,
        });
        doc
          .strokeColor("#dce5dc")
          .moveTo(42, 46)
          .lineTo(doc.page.width - 42, 46)
          .stroke();
        doc.text(
          `Snapshot ${s.fingerprint.slice(0, 12)} | Times: IST`,
          42,
          doc.page.height - 33,
          { lineBreak: false },
        );
        doc.text(
          `Page ${n + 1} of ${range.count}`,
          doc.page.width - 160,
          doc.page.height - 33,
          { width: 118, align: "right", lineBreak: false },
        );
        doc.page.margins.bottom = bottom;
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
