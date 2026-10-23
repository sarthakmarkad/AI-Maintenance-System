import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import {
  canAttach,
  inspectAttachment,
  MAX_ATTACHMENT_BYTES,
} from "../attachments/policy";
import { uploadSchema } from "../attachments/service";
import type { Principal } from "../repository";
import { AttachmentUploadLimit } from "../attachments/controller";
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
} from "@nestjs/common";
import { Subject, of, throwError } from "rxjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const principal = (role: Role) => ({ userId: "self", role }) as Principal;
test("upload capacity limits concurrent work and is released after completion, cancellation and failure", () => {
  const limiter = new AttachmentUploadLimit();
  const context = (userId: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ principal: { userId } }) }),
    }) as ExecutionContext;
  const pending = new Subject<void>(),
    handler = { handle: () => pending } as CallHandler;
  const first = limiter.intercept(context("one"), handler).subscribe();
  const second = limiter.intercept(context("one"), handler).subscribe();
  const denied = (userId: string) =>
    assert.throws(
      () => limiter.intercept(context(userId), handler),
      (e: unknown) => e instanceof HttpException && e.getStatus() === 429,
    );
  denied("one");
  const third = limiter.intercept(context("two"), handler).subscribe();
  const fourth = limiter.intercept(context("two"), handler).subscribe();
  denied("three");
  first.unsubscribe();
  limiter.intercept(context("three"), { handle: () => of(1) }).subscribe();
  limiter
    .intercept(context("three"), {
      handle: () => throwError(() => new Error("test failure")),
    })
    .subscribe({ error: () => {} });
  limiter.intercept(context("three"), { handle: () => of(1) }).subscribe();
  pending.complete();
  assert(second.closed && third.closed && fourth.closed);
});
test("attachment upload authority is one active role, own report or own in-progress assignment only", () => {
  for (const role of Object.values(Role))
    for (const status of [
      "REPORTED",
      "ASSIGNED",
      "IN_PROGRESS",
      "AWAITING_REVIEW",
      "APPROVED",
      "CLOSED",
    ] as const) {
      assert.equal(
        canAttach(
          { status, reportedBy: "self", technicianId: "self" },
          principal(role),
        ),
        (role === "OPERATOR" && status === "REPORTED") ||
          (role === "TECHNICIAN" && status === "IN_PROGRESS"),
      );
      assert.equal(
        canAttach(
          { status, reportedBy: "other", technicianId: "other" },
          principal(role),
        ),
        false,
      );
    }
});
test("attachment types require matching extension, declared MIME and byte signatures; unsafe/empty/oversized inputs fail", () => {
  const valid = inspectAttachment(png, "photo.PNG", "image/png");
  assert.equal(valid.mediaType, "image/png");
  assert.equal(valid.sha256.length, 64);
  assert.equal(
    inspectAttachment(
      Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"),
      "inspection.pdf",
      "application/pdf",
    ).mediaType,
    "application/pdf",
  );
  for (const [b, n, m] of [
    [png, "fake.pdf", "application/pdf"],
    [png, "photo.png", "text/html"],
    [Buffer.from("<svg></svg>"), "photo.png", "image/png"],
    [png, "../photo.png", "image/png"],
    [png, "photo\r\n.png", "image/png"],
    [png, "photo\u202e.png", "image/png"],
    [png.subarray(0, 40), "cut.png", "image/png"],
    [Buffer.alloc(0), "empty.png", "image/png"],
    [Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), "large.png", "image/png"],
  ] as [Buffer, string, string][])
    assert.throws(() => inspectAttachment(b, n, m));
});
test("multipart metadata is strict, normalized and version bounded", () => {
  const value = {
    requestId: "c25dfdba-fb43-47d5-8055-34d10a22834a",
    version: "2",
    description: "  TEST evidence  ",
  };
  assert.deepEqual(uploadSchema.parse(value), {
    ...value,
    version: 2,
    description: "TEST evidence",
  });
  for (const patch of [
    { version: "2.5" },
    { version: "0" },
    { description: "x" },
    { uploadedBy: "forged" },
    { orgId: "forged" },
    { requestId: "bad" },
  ])
    assert.equal(uploadSchema.safeParse({ ...value, ...patch }).success, false);
});

test("JPEG envelope is accepted with matching metadata; filenames preserve ordinary Unicode", () => {
  const jpeg = Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z",
    "base64",
  );
  assert.equal(
    inspectAttachment(jpeg, "inspection.jpg", "image/jpeg").mediaType,
    "image/jpeg",
  );
  assert.equal(
    inspectAttachment(png, "तपासणी.png", "image/png").filename,
    "तपासणी.png",
  );
});
