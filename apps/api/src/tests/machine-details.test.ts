import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { detailsInput, photoInput } from "../machines/dto";
import {
  machinePhoto,
  MAX_MACHINE_PHOTO_BYTES,
  digest,
} from "../machines/photo";
const details = {
  requestId: randomUUID(),
  version: 1,
  name: " TEST pump ",
  manufacturer: null,
  model: null,
  department: null,
  location: null,
};
test("machine details require full explicit metadata, integer CAS and immutable identity", () => {
  assert.equal(detailsInput.parse(details).name, "TEST pump");
  for (const patch of [
    { code: "NEW" },
    { orgId: randomUUID() },
    { id: randomUUID() },
    { version: "1" },
    { version: 0 },
    { manufacturer: "" },
    { name: "x" },
    { name: "a".repeat(161) },
    { department: undefined },
    { operationalStatus: "RUNNING" },
  ])
    assert.equal(
      detailsInput.safeParse({ ...details, ...patch }).success,
      false,
    );
  assert.equal(
    photoInput.parse({ requestId: randomUUID(), version: "2" }).version,
    2,
  );
  assert.equal(
    photoInput.safeParse({
      requestId: randomUUID(),
      version: 1,
      url: "https://example.test/photo",
    }).success,
    false,
  );
});
for (const format of ["png", "jpeg", "webp"] as const)
  test(`photo decodes ${format}, strips metadata and stores a bounded WebP`, async () => {
    const bytes = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "yellow" },
    })
      .withMetadata({ exif: { IFD0: { Artist: "TEST private author" } } })
      [format]()
      .toBuffer();
    const photo = await machinePhoto({
      buffer: bytes,
      originalname: `TEST.${format}`,
      mimetype: `image/${format}`,
    });
    const meta = await sharp(photo.content).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
    assert.equal(photo.width, 60);
    assert.equal(photo.height, 40);
    assert.equal(photo.sha256, digest(photo.content));
    assert.equal(photo.source.sha256, digest(bytes));
    assert.equal(photo.source.byteSize, bytes.length);
  });
test("photo rejects bad signatures, MIME/extensions, paths, control names, truncation and byte bounds", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  const base = { buffer: png, originalname: "TEST.png", mimetype: "image/png" };
  for (const patch of [
    { buffer: Buffer.alloc(0) },
    { buffer: Buffer.from("<svg/>") },
    { buffer: png.subarray(0, 35) },
    { buffer: Buffer.alloc(MAX_MACHINE_PHOTO_BYTES + 1) },
    { originalname: "../photo.png" },
    { originalname: "TEST\n.png" },
    { originalname: "TEST\u202e.png" },
    { originalname: "TEST.jpg" },
    { mimetype: "text/html" },
    { mimetype: "application/octet-stream" },
  ])
    await assert.rejects(machinePhoto({ ...base, ...patch }));
});
test("oversized dimensions and decompression pixel budgets fail before rasterization", async () => {
  // Compresses to a small file, but a single side exceeds the independent 8192-pixel bound.
  const wide = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    machinePhoto({
      buffer: wide,
      originalname: "TEST.png",
      mimetype: "image/png",
    }),
  );
  const bomb = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    machinePhoto({
      buffer: bomb,
      originalname: "TEST.png",
      mimetype: "image/png",
    }),
  );
});
test("large valid photo is resized within display bounds", async () => {
  const bytes = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  const photo = await machinePhoto({
    buffer: bytes,
    originalname: "TEST.png",
    mimetype: "image/png",
  });
  assert.equal(photo.width, 2048);
  assert(photo.height <= 2048);
});
test("animated WebP is rejected instead of silently taking its first frame", async () => {
  const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(bytes, { animated: true }).metadata()).pages, 2);
  await assert.rejects(
    machinePhoto({
      buffer: bytes,
      originalname: "TEST.webp",
      mimetype: "image/webp",
    }),
  );
});
