import { BadRequestException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { inspectAttachment } from "../attachments/policy";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS = 200;
export const MAX_DOCUMENT_VERSIONS = 100;
export const managesDocuments = (role: Role) =>
  role === Role.ADMINISTRATOR || role === Role.MAINTENANCE_HEAD;
export function inspectDocument(bytes: Buffer, filename: string, mime: string) {
  const checked = inspectAttachment(bytes, filename, mime);
  if (checked.mediaType !== "application/pdf")
    throw new BadRequestException(
      "Manuals and SOPs must be PDF files, at most 5 MB.",
    );
  // Reject obvious appended archives/polyglots; no archive expansion or document execution.
  if (
    bytes.includes(Buffer.from("504b0304", "hex")) ||
    bytes.includes(Buffer.from("504b0506", "hex"))
  )
    throw new BadRequestException(
      "Archive payloads are not accepted in reference PDFs.",
    );
  return checked;
}
export type LifecycleEvent = {
  action: string;
  fileId: string;
  revision: number;
};
export function currentFile(events: LifecycleEvent[]) {
  const last = [...events]
    .filter((e) => e.action !== "UPLOAD")
    .sort((a, b) => b.revision - a.revision)[0];
  return last?.action === "APPROVE" ? last.fileId : null;
}
export function fileStatus(id: string, events: LifecycleEvent[]) {
  if (currentFile(events) === id) return "CURRENT";
  const own = events.filter((e) => e.fileId === id);
  return own.some((e) => e.action === "WITHDRAW")
    ? "WITHDRAWN"
    : own.some((e) => e.action === "APPROVE")
      ? "SUPERSEDED"
      : "DRAFT";
}
