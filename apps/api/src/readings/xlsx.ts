import { BadRequestException } from "@nestjs/common";
import { SaxesParser } from "saxes";
import * as yauzl from "yauzl";
import { guardArchive } from "../production/parser";

// A small namespace-aware OOXML reader. The supplied workbook uses x: prefixes,
// which ExcelJS's workbook parser does not support. No XML or formulas execute.
type Node = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: Node[];
};
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function xml(data: Buffer): Node {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Node[] = [];
  let root: Node | undefined,
    count = 0;
  parser.on("doctype", () => {
    throw new Error("DTD is not supported");
  });
  parser.on("opentag", (tag) => {
    if (++count > 100000 || stack.length > 20) throw new Error("XML limit");
    const node: Node = { name: tag.local, attrs: {}, text: "", children: [] };
    for (const attr of Object.values(tag.attributes))
      node.attrs[attr.name] = attr.value;
    node.attrs.$namespace = tag.uri;
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (text) => {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on("cdata", (text) => {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(data.toString("utf8").replace(/^\uFEFF/, "")).close();
  if (!root) throw new Error("Missing XML root");
  return root;
}
const child = (node: Node, name: string) =>
  node.children.find((n) => n.name === name);
function content(node: Node): string {
  return node.text + node.children.map(content).join("");
}
export type Cell = {
  value: string | number | null;
  formula?: string;
  type?: string;
};
export type SheetRows = Map<number, Record<string, Cell>>;
export async function readingWorkbook(buffer: Buffer) {
  await guardArchive(buffer);
  const parts = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error("Invalid ZIP"));
      const files = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(files));
      zip.on("entry", (entry) => {
        if (
          !/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(
            entry.fileName,
          )
        ) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream)
            return reject(error || new Error("Unreadable XML"));
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("error", reject);
          stream.on("end", () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
  try {
    const required = (name: string) => {
      const data = parts.get(name);
      if (!data) throw new Error("Missing part");
      return xml(data);
    };
    const workbook = required("xl/workbook.xml");
    if (workbook.name !== "workbook" || workbook.attrs.$namespace !== MAIN)
      throw new Error("Unsupported workbook namespace");
    const date1904 = ["1", "true"].includes(
      child(workbook, "workbookPr")?.attrs.date1904 || "",
    );
    const rels = required("xl/_rels/workbook.xml.rels").children;
    const sheetNames = (child(workbook, "sheets")?.children || []).map((s) =>
      s.attrs.name?.toUpperCase(),
    );
    if (
      sheetNames.length > 100 ||
      new Set(sheetNames).size !== sheetNames.length ||
      new Set(rels.map((r) => r.attrs.Id)).size !== rels.length
    )
      throw new Error("Ambiguous workbook relationships");
    const strings = parts.has("xl/sharedStrings.xml")
      ? required("xl/sharedStrings.xml").children.map(content)
      : [];
    function sheet(name: string): SheetRows {
      const info = child(workbook, "sheets")?.children.find(
        (s) => s.attrs.name === name,
      );
      if (!info) throw new Error(`Missing ${name} sheet`);
      const id = Object.entries(info.attrs).find(([key]) =>
        key.endsWith(":id"),
      )?.[1];
      const rel = rels.find((r) => r.attrs.Id === id);
      if (
        !rel ||
        rel.attrs.TargetMode === "External" ||
        !rel.attrs.Type.endsWith("/worksheet")
      )
        throw new Error("Invalid worksheet relationship");
      const target = rel.attrs.Target.replace(/^\//, "");
      const part = target.startsWith("xl/") ? target : "xl/" + target;
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(part))
        throw new Error("Unsupported worksheet path");
      const document = required(part);
      if (document.name !== "worksheet" || document.attrs.$namespace !== MAIN)
        throw new Error("Unsupported worksheet namespace");
      const rows: SheetRows = new Map();
      for (const row of child(document, "sheetData")?.children || []) {
        const index = Number(row.attrs.r);
        if (
          !Number.isInteger(index) ||
          index < 1 ||
          index > 1100 ||
          rows.has(index)
        )
          throw new Error("Invalid or excessive source rows");
        const cells: Record<string, Cell> = {};
        for (const c of row.children.filter((c) => c.name === "c")) {
          const address = c.attrs.r;
          if (
            !/^[A-K]\d+$/.test(address) ||
            +address.slice(1) !== index ||
            cells[address]
          )
            throw new Error("Unexpected or duplicate source cell");
          const v = child(c, "v")?.text ?? null,
            type = c.attrs.t;
          let value: Cell["value"] = v;
          if (type === "s") {
            if (v === null || !/^\d+$/.test(v) || strings[+v] === undefined)
              throw new Error("Invalid shared string");
            value = strings[+v];
          } else if (type === "inlineStr")
            value = child(c, "is") ? content(child(c, "is")!) : null;
          else if ((!type || type === "n") && v !== null) {
            if (!v.trim()) value = null;
            else if (
              /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(v.trim())
            )
              value = Number(v);
            else throw new Error("Invalid numeric XML value");
          }
          if (String(value).length > 4096)
            throw new Error("Source cell too long");
          cells[address] = {
            value,
            ...(child(c, "f") ? { formula: child(c, "f")!.text } : {}),
            ...(type ? { type } : {}),
          };
        }
        rows.set(index, cells);
      }
      return rows;
    }
    return { rows: sheet("Hourly_Readings"), guide: sheet("Guide"), date1904 };
  } catch {
    throw new BadRequestException(
      "Unsupported or damaged synthetic workbook. Use the supplied Guide and Hourly_Readings layout (up to 1,000 observations).",
    );
  }
}
