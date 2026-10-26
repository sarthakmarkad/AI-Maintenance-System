import PDFDocument from "pdfkit";
export async function textPdf(pages: string[]) {
  const doc = new PDFDocument({ autoFirstPage: false }),
    parts: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (p) => parts.push(p));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
  });
  for (const page of pages) {
    doc.addPage();
    doc.text(page);
  }
  doc.end();
  return result;
}
