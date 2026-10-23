import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { Role, type WorkOrder } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Principal } from "../repository";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
export const attachmentSelect = {
  id: true,
  orderVersion: true,
  filename: true,
  description: true,
  mediaType: true,
  byteSize: true,
  sha256: true,
  uploadedBy: true,
  uploaderName: true,
  actorRole: true,
  status: true,
  createdAt: true,
} as const;
export function canAttach(
  order: Pick<WorkOrder, "status" | "reportedBy" | "technicianId">,
  user: Principal,
) {
  return (
    (user.role === Role.OPERATOR &&
      order.status === "REPORTED" &&
      order.reportedBy === user.userId) ||
    (user.role === Role.TECHNICIAN &&
      order.status === "IN_PROGRESS" &&
      order.technicianId === user.userId)
  );
}
export function attachmentMetadata(a: {
  id: string;
  orderVersion: number;
  filename: string;
  description: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string;
  uploaderName: string;
  actorRole: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: a.id,
    orderVersion: a.orderVersion,
    filename: a.filename,
    description: a.description,
    mediaType: a.mediaType,
    byteSize: a.byteSize,
    sha256: a.sha256,
    uploader: { userId: a.uploadedBy, displayName: a.uploaderName },
    actorRole: a.actorRole,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}
// Validate type envelopes without decoding images or executing document content.
// Files are always delivered as downloads, never embedded in the application.
export function inspectAttachment(
  bytes: Buffer,
  originalName: string,
  declaredType: string,
) {
  if (!bytes.length)
    throw new BadRequestException("The selected file is empty.");
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    throw new PayloadTooLargeException(
      "Each attachment must be 5 MB or smaller.",
    );
  const filename = originalName.normalize("NFKC").trim();
  if (
    !filename ||
    filename.length > 160 ||
    /[\x00-\x1f\x7f/\\"<>:\u202a-\u202e\u2066-\u2069]/u.test(filename)
  )
    throw new BadRequestException(
      "Use a filename of at most 160 characters without path or control characters.",
    );
  const extension = filename.split(".").pop()?.toLowerCase();
  let mediaType = "";
  if (
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
  )
    mediaType = "image/png";
  else if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[3] !== 0 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
    mediaType = "image/jpeg";
  else if (
    /^%PDF-(1\.[0-7]|2\.0)(\r|\n|\s)/.test(bytes.toString("ascii", 0, 12)) &&
    /%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))
  )
    mediaType = "application/pdf";
  const expected =
    extension === "png"
      ? "image/png"
      : ["jpg", "jpeg"].includes(extension ?? "")
        ? "image/jpeg"
        : extension === "pdf"
          ? "application/pdf"
          : "";
  if (
    !mediaType ||
    expected !== mediaType ||
    (declaredType &&
      declaredType !== "application/octet-stream" &&
      declaredType !== mediaType)
  )
    throw new BadRequestException(
      "Choose a JPEG, PNG or PDF whose contents match its file type.",
    );
  return {
    filename,
    mediaType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
