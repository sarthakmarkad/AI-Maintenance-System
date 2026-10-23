import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { Subject, of } from "rxjs";
import { type ExecutionContext, HttpException } from "@nestjs/common";
import {
  detailExportQuery,
  exportQuery,
  finish,
  literal,
  historyText,
  reportQuery,
  reportWindow,
} from "../reports/model";
import { renderPdf, renderWorkbook, pdfText } from "../reports/render";
import { ReportExportLimit } from "../reports/controller";
import { reportFixture } from "./reports-fixtures";
test("report filters reject invalid dates, forged fields and contradictory date/type combinations", () => {
  const valid = { report: "work-orders", from: "2026-09-01", to: "2026-09-02" };
  assert(reportQuery.safeParse(valid).success);
  for (const patch of [
    { from: "2026-02-30" },
    { to: "2026-08-31" },
    { to: "2028-01-01" },
    { orgId: "forged" },
    { status: "REPORTED" },
    { report: "planned-maintenance", basis: "closed" },
    { report: "investigations", kind: "BREAKDOWN" },
    { basis: "closed", status: "OPEN" },
  ])
    assert.equal(reportQuery.safeParse({ ...valid, ...patch }).success, false);
  assert.equal(reportQuery.safeParse({ from: "2026-09-01" }).success, false);
  assert.equal(
    exportQuery.safeParse({ ...valid, format: "csv" }).success,
    false,
  );
  assert.equal(
    exportQuery.safeParse({ ...valid, format: "pdf", fingerprint: "bad" })
      .success,
    false,
  );
  assert.equal(
    detailExportQuery.safeParse({ format: "pdf", version: 1, orgId: "forged" })
      .success,
    false,
  );
});
test("default windows follow IST midnight and future due reports remain distinct from closed/created cohorts", () => {
  const q = reportQuery.parse({});
  assert.equal(
    reportWindow(q, new Date("2026-10-22T18:29:59Z")).to,
    "2026-10-22",
  );
  assert.equal(
    reportWindow(q, new Date("2026-10-22T18:30:00Z")).to,
    "2026-10-23",
  );
  const planned = reportWindow(
    reportQuery.parse({ report: "planned-maintenance" }),
    new Date("2026-10-23T10:00:00Z"),
  );
  assert.equal(planned.from, "2026-10-23");
  assert.equal(planned.to, "2026-11-21");
  assert.equal(planned.basis, "Due date");
  assert.throws(() =>
    reportWindow(
      reportQuery.parse({ from: "2026-10-23", to: "2026-10-24" }),
      new Date("2026-10-23T10:00:00Z"),
    ),
  );
});
test("source fingerprints ignore refresh time and requester but change with exported evidence", () => {
  const first = reportFixture();
  const { fingerprint: _, ...unsigned } = first;
  assert.equal(
    first.fingerprint,
    finish({
      ...unsigned,
      generatedAt: "2026-10-23T11:00:00Z",
      requestedBy: "Another authorized person",
    }).fingerprint,
  );
  const changed = structuredClone(unsigned);
  changed.sheets[0].rows[0][1] = "Changed findings";
  assert.notEqual(first.fingerprint, finish(changed).fingerprint);
});
test("Excel exports retain literal formula-like values, zero values, Unicode and visible control-character escapes", async () => {
  const s = reportFixture();
  s.sheets[0].rows[0][1] = '=HYPERLINK("https://example.invalid","TEST")';
  s.sheets[0].rows[1][1] = "TEST तपासणी\u0001";
  const bytes = await renderWorkbook(s),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const sheet = book.getWorksheet("Fixture records")!;
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("B2").value, s.sheets[0].rows[0][1]);
  assert.equal(sheet.getCell("D2").value, 0);
  assert.equal(sheet.getCell("B3").value, "TEST तपासणी[U+0001]");
  assert.equal(
    book.getWorksheet("Report information")!.getCell("B11").value,
    s.generatedAt,
  );
  assert.equal(literal("A\nB\tC"), "A\nB\tC");
});
test("PDFs render multi-page history, empty registers and Devanagari without silently discarding unsupported characters", async () => {
  assert.equal(pdfText("TEST तपासणी").text, "TEST तपासणी");
  assert.equal(pdfText("TEST तपासणी").font, "devanagari");
  assert.match(pdfText("漢").text, /U\+6F22/);
  const detail = await renderPdf(reportFixture("work-order-detail", 1, true));
  assert.equal(detail.subarray(0, 4).toString(), "%PDF");
  assert(
    (detail.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length > 1,
  );
  const empty = await renderPdf(reportFixture("work-orders", 0));
  assert.equal(
    (empty.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length,
    1,
  );
});
test("report generation capacity is bounded and recovers after completion/cancellation", () => {
  const limit = new ReportExportLimit(),
    source = new Subject<void>();
  const context = (id: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ principal: { userId: id } }),
      }),
    }) as ExecutionContext;
  const a = limit
    .intercept(context("one"), { handle: () => source })
    .subscribe();
  assert.throws(
    () => limit.intercept(context("one"), { handle: () => source }),
    (e: unknown) => e instanceof HttpException && e.getStatus() === 429,
  );
  limit.intercept(context("two"), { handle: () => source }).subscribe();
  assert.throws(
    () => limit.intercept(context("three"), { handle: () => source }),
    (e: unknown) => e instanceof HttpException && e.getStatus() === 429,
  );
  a.unsubscribe();
  limit.intercept(context("three"), { handle: () => of(1) }).subscribe();
  source.complete();
  limit.intercept(context("two"), { handle: () => of(1) }).subscribe();
});

test("PDF history uses readable kind-specific labels and IST without losing zero values", () => {
  const text = historyText(
    {
      workPerformed: "TEST sensor check",
      performedAt: "2026-09-01T00:00:00Z",
      preventiveAction: "TEST follow-up",
      investigationOutcome: "NO_FAULT_FOUND",
      byteSize: 0,
      reason: null,
    },
    "INVESTIGATION",
  );
  assert.match(text, /Checks \/ work performed: TEST sensor check/);
  assert.match(text, /IST/);
  assert.match(text, /Follow-up recommendations/);
  assert.match(text, /No fault found/);
  assert.match(text, /File size \(bytes\): 0/);
  assert(!text.includes("Reason:"));
});
