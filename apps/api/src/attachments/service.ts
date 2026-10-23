import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import {
  attachmentMetadata,
  attachmentSelect,
  canAttach,
  inspectAttachment,
  MAX_ATTACHMENTS,
} from "./policy";
export const uploadSchema = z
  .object({
    requestId: z.string().uuid(),
    version: z.coerce.number().int().min(1).max(2147483646),
    description: z.string().trim().min(3).max(1000),
  })
  .strict();
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  async upload(
    user: Principal,
    code: string,
    orderId: string,
    input: z.output<typeof uploadSchema>,
    file: Express.Multer.File,
  ) {
    const checked = inspectAttachment(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...checked,
          description: input.description,
          actorRole: user.role,
        }),
      )
      .digest("hex");
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        // Serialize retries/count limits. Workflow actions still use the shared version CAS.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attachment:${c.scope.orgId}:${orderId}`}))`;
        const o = await tx.workOrder.findFirst({
          where: { ...c.scope, id: orderId },
        });
        if (!o) throw new NotFoundException("Work order not found.");
        const existing = await tx.workOrderAttachment.findFirst({
          where: {
            ...c.scope,
            orderId,
            uploadedBy: c.user.userId,
            requestId: input.requestId,
          },
          select: { ...attachmentSelect, fingerprint: true },
        });
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new ConflictException(
              "This upload request was already used for different evidence. Choose a new file to start another upload.",
            );
          return {
            attachment: attachmentMetadata(existing),
            alreadyUploaded: true,
          };
        }
        if (o.version !== input.version)
          throw new ConflictException(
            "This work order changed. Reload and review it before uploading.",
          );
        if (!canAttach(o, c.user))
          throw new ForbiddenException(
            "Only the reporting operator on a new report or the assigned technician on work in progress can add evidence. Submitted evidence is frozen until the head returns the work.",
          );
        if (
          (await tx.workOrderAttachment.count({
            where: { ...c.scope, orderId },
          })) >= MAX_ATTACHMENTS
        )
          throw new ConflictException(
            "This work order has reached its 20-attachment limit.",
          );
        const now = new Date(),
          id = randomUUID(),
          version = o.version + 1;
        const updated = await tx.workOrder.updateMany({
          where: {
            ...c.scope,
            id: orderId,
            version: o.version,
            status: o.status,
          },
          data: { version, updatedAt: now },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "This work order changed. Reload and review it before uploading.",
          );
        await tx.workOrderEvent.create({
          data: {
            ...c.scope,
            orderId,
            version,
            action: "ATTACH",
            fromStatus: o.status,
            toStatus: o.status,
            actorId: c.user.userId,
            actorName: c.user.displayName,
            actorRole: c.user.role,
            at: now,
            detail: {
              attachmentId: id,
              filename: checked.filename,
              description: input.description,
              mediaType: checked.mediaType,
              byteSize: file.buffer.length,
              sha256: checked.sha256,
            },
          },
        });
        const attachment = await tx.workOrderAttachment.create({
          data: {
            ...c.scope,
            id,
            orderId,
            orderVersion: version,
            requestId: input.requestId,
            fingerprint,
            ...checked,
            description: input.description,
            byteSize: file.buffer.length,
            content: new Uint8Array(file.buffer),
            uploadedBy: c.user.userId,
            uploaderName: c.user.displayName,
            actorRole: c.user.role,
            status: o.status,
            createdAt: now,
          },
          select: attachmentSelect,
        });
        await tx.auditEvent.create({
          data: {
            orgId: c.scope.orgId,
            actorId: c.user.userId,
            entityId: orderId,
            action: "WORK_ORDER_ATTACH",
            at: now,
            detail: {
              attachmentId: id,
              version,
              actorRole: c.user.role,
              sha256: checked.sha256,
              byteSize: file.buffer.length,
            },
          },
        });
        return {
          attachment: attachmentMetadata(attachment),
          alreadyUploaded: false,
        };
      },
      { timeout: 15000 },
    );
  }
  async download(user: Principal, code: string, orderId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      const file = await tx.workOrderAttachment.findFirst({
        where: { ...c.scope, orderId, id },
        select: {
          content: true,
          filename: true,
          mediaType: true,
          byteSize: true,
          sha256: true,
        },
      });
      if (!file) throw new NotFoundException("Attachment not found.");
      return file;
    });
  }
}
