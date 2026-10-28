import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { createHash } from "node:crypto";
import sharp from "sharp";
export const MAX_MACHINE_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_MACHINE_PHOTO_PIXELS = 16_000_000;
export const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
// Decode before storing. Re-encoding strips metadata, trailing payloads and animation.
export async function machinePhoto(
  file: Pick<Express.Multer.File, "buffer" | "originalname" | "mimetype">,
) {
  const bytes = file.buffer;
  if (bytes.length > MAX_MACHINE_PHOTO_BYTES)
    throw new PayloadTooLargeException("Choose a photo no larger than 5 MiB.");
  if (
    !bytes.length ||
    file.originalname.length > 160 ||
    /[/\\\p{Cc}\p{Cf}]/u.test(file.originalname)
  )
    throw new BadRequestException(
      "Choose a photo with a plain filename (up to 160 characters).",
    );
  const type = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP" &&
          bytes.length >= 20 &&
          bytes.readUInt32LE(4) === bytes.length - 8
        ? "webp"
        : null;
  const extension = file.originalname.split(".").at(-1)?.toLowerCase();
  if (
    !type ||
    !(type === "jpeg"
      ? ["jpg", "jpeg"].includes(extension || "")
      : extension === type) ||
    file.mimetype !== `image/${type}`
  )
    throw new BadRequestException(
      "Filename, MIME type and bytes must identify the same JPEG, PNG or WebP photo.",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_MACHINE_PHOTO_PIXELS,
      failOn: "warning",
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== type ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      metadata.width * metadata.height > MAX_MACHINE_PHOTO_PIXELS ||
      (metadata.pages ?? 1) !== 1
    )
      throw Error("dimensions or animation");
    const result = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_MACHINE_PHOTO_BYTES)
      throw Error("output size");
    return {
      content: result.data,
      sha256: digest(result.data),
      byteSize: result.data.length,
      width: result.info.width,
      height: result.info.height,
      source: {
        filename: file.originalname,
        mediaType: file.mimetype,
        byteSize: bytes.length,
        sha256: digest(bytes),
        width: metadata.width,
        height: metadata.height,
      },
    };
  } catch {
    throw new BadRequestException(
      "The photo could not be safely decoded. Use a still JPEG, PNG or WebP up to 8192 pixels per side and 16 million pixels.",
    );
  }
}
