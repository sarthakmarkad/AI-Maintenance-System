import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import {
  currentFile,
  fileStatus,
  inspectDocument,
  managesDocuments,
  MAX_DOCUMENT_BYTES,
} from "../documents/policy";
import { actionSchema, draftSchema, listSchema } from "../documents/service";
const pdf = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);
test("document policy accepts bounded PDF envelopes, normalizes filenames and preserves byte hash", () => {
  const checked = inspectDocument(
    pdf,
    "  TEST reference.PDF  ",
    "application/pdf",
  );
  assert.equal(checked.filename, "TEST reference.PDF");
  assert.equal(checked.sha256, createHash("sha256").update(pdf).digest("hex"));
  assert.equal(
    inspectDocument(pdf, "तपासणी.pdf", "application/octet-stream").mediaType,
    "application/pdf",
  );
  assert.equal(
    inspectDocument(pdf, "reference.pdf", "").mediaType,
    "application/pdf",
  );
  const max = Buffer.concat([
    pdf.subarray(0, -6),
    Buffer.alloc(MAX_DOCUMENT_BYTES - pdf.length, 32),
    pdf.subarray(-6),
  ]);
  assert.equal(max.length, MAX_DOCUMENT_BYTES);
  assert.doesNotThrow(() =>
    inspectDocument(max, "limit.pdf", "application/pdf"),
  );
});
test("document policy rejects active types, archives, MIME/signature mismatch and unsafe names without expanding files", () => {
  for (const [bytes, name, mime] of [
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
      "TEST image.png",
      "image/png",
    ],
    [Buffer.from("<html>fake</html>"), "fake.pdf", "application/pdf"],
    [pdf, "reference.html", "text/html"],
    [pdf, "reference.pdf", "text/html"],
    [Buffer.alloc(0), "empty.pdf", "application/pdf"],
    [Buffer.alloc(MAX_DOCUMENT_BYTES + 1), "large.pdf", "application/pdf"],
    [pdf, "../manual.pdf", "application/pdf"],
    [pdf, "manual\r\n.pdf", "application/pdf"],
    [pdf, "manual\u202e.pdf", "application/pdf"],
    [pdf, "manual\\file.pdf", "application/pdf"],
    [pdf, "a".repeat(160) + ".pdf", "application/pdf"],
    [pdf.subarray(0, -6), "truncated.pdf", "application/pdf"],
    [
      Buffer.concat([
        Buffer.from("%PDF-1.7\n"),
        Buffer.from("504b0304", "hex"),
        Buffer.from("\n%%EOF\n"),
      ]),
      "archive.pdf",
      "application/pdf",
    ],
    [Buffer.from("PK\x03\x04\n%%EOF\n"), "archive.pdf", "application/pdf"],
  ] as [Buffer, string, string][])
    assert.throws(() => inspectDocument(bytes, name, mime));
});
test("document management permissions select one active role; Administrator is upload-only", () => {
  for (const role of Object.values(Role))
    assert.equal(
      managesDocuments(role),
      role === Role.MAINTENANCE_HEAD || role === Role.ADMINISTRATOR,
    );
});
test("new drafts preserve current approval; approval supersedes and withdrawal never restores older approval", () => {
  const events = [
    { action: "UPLOAD", fileId: "first", revision: 1 },
    { action: "APPROVE", fileId: "first", revision: 2 },
    { action: "UPLOAD", fileId: "second", revision: 3 },
  ];
  assert.equal(currentFile(events), "first");
  assert.equal(fileStatus("first", events), "CURRENT");
  assert.equal(fileStatus("second", events), "DRAFT");
  events.push({ action: "APPROVE", fileId: "second", revision: 4 });
  assert.equal(currentFile(events), "second");
  assert.equal(fileStatus("first", events), "SUPERSEDED");
  events.push({ action: "WITHDRAW", fileId: "second", revision: 5 });
  assert.equal(currentFile(events), null);
  assert.equal(fileStatus("second", events), "WITHDRAWN");
  assert.equal(fileStatus("first", events), "SUPERSEDED");
  assert.equal(currentFile([...events].reverse()), null);
  assert.equal(currentFile([]), null);
});
test("strict upload/action/query contracts reject forged scope, approvers, malformed versions and missing reasons", () => {
  const draft = {
    requestId: randomUUID(),
    version: "0",
    title: "  TEST manual  ",
    kind: "MANUAL",
    description: "  TEST draft  ",
  };
  assert.equal(draftSchema.parse(draft).title, "TEST manual");
  assert.equal(draftSchema.parse(draft).version, 0);
  for (const patch of [
    { orgId: "forged" },
    { actorRole: "MAINTENANCE_HEAD" },
    { version: -1 },
    { version: "1.5" },
    { version: 2147483647 },
    { title: "x" },
    { kind: "SCRIPT" },
    { description: " " },
    { requestId: "bad" },
  ])
    assert.equal(draftSchema.safeParse({ ...draft, ...patch }).success, false);
  const action = {
    requestId: randomUUID(),
    version: 2,
    fileId: randomUUID(),
    reason: "TEST review",
  };
  assert(actionSchema.safeParse(action).success);
  for (const patch of [
    { reason: "" },
    { reason: "x" },
    { version: 0 },
    { fileId: "bad" },
    { approvedBy: randomUUID() },
    { version: "2" },
  ])
    assert.equal(
      actionSchema.safeParse({ ...action, ...patch }).success,
      false,
    );
  assert.deepEqual(listSchema.parse({}), {
    q: "",
    kind: "ALL",
    status: "ALL",
    page: 1,
  });
  assert.equal(listSchema.safeParse({ page: 11 }).success, false);
  assert.equal(listSchema.safeParse({ orgId: "forged" }).success, false);
});
