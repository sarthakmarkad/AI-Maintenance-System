import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import {
  currentFile,
  fileStatus,
  inspectDocument,
  managesDocuments,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_VERSIONS,
} from "./policy";
import { CONFIG, type Config } from "../config";
import { settings } from "../rag/policy";
import { currentApproved, enqueue } from "../rag/store";
const text = z.string().trim().min(3).max(1000);
export const draftSchema = z
  .object({
    requestId: z.string().uuid(),
    version: z.coerce.number().int().min(0).max(2147483646),
    title: z.string().trim().min(3).max(160),
    kind: z.enum(["MANUAL", "SOP"]),
    description: text,
  })
  .strict();
export const actionSchema = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().min(1).max(2147483646),
    fileId: z.string().uuid(),
    reason: text,
  })
  .strict();
export const listSchema = z
  .object({
    q: z.string().trim().max(160).default(""),
    kind: z.enum(["ALL", "MANUAL", "SOP"]).default("ALL"),
    status: z.enum(["ALL", "CURRENT", "DRAFT", "WITHDRAWN"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10).default(1),
  })
  .strict();
const fileSelect = {
  id: true,
  number: true,
  filename: true,
  description: true,
  byteSize: true,
  sha256: true,
} as const;
const eventsSelect = {
  id: true,
  fileId: true,
  revision: true,
  action: true,
  reason: true,
  actorId: true,
  actorName: true,
  actorRole: true,
  at: true,
} as const;
const include = {
  files: { select: fileSelect, orderBy: { number: "desc" as const } },
  events: { select: eventsSelect, orderBy: { revision: "asc" as const } },
};
type Document = Prisma.MachineDocumentGetPayload<{ include: typeof include }>;
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private view(d: Document, role: Role) {
    const current = currentFile(d.events),
      manager = managesDocuments(role);
    if (!manager && !current)
      throw new NotFoundException("Approved reference not found.");
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      currentFileId: current,
      files: d.files
        .filter((f) => manager || f.id === current)
        .map((f) => ({ ...f, status: fileStatus(f.id, d.events) })),
      events: d.events
        .filter(
          (e) =>
            manager ||
            (e.fileId === current && ["UPLOAD", "APPROVE"].includes(e.action)),
        )
        .map((e) => ({ ...e, at: e.at.toISOString() })),
    };
  }
  async list(
    user: Principal,
    code: string,
    input: z.output<typeof listSchema>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code),
          manager = managesDocuments(c.user.role);
        const docs = await tx.machineDocument.findMany({
          where: {
            ...c.scope,
            ...(input.q
              ? { title: { contains: input.q, mode: "insensitive" as const } }
              : {}),
            ...(input.kind !== "ALL" ? { kind: input.kind } : {}),
          },
          select: {
            id: true,
            events: { select: { fileId: true, action: true, revision: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: MAX_DOCUMENTS,
        });
        const matches = docs.filter((d) => {
          if (!manager && !currentFile(d.events)) return false;
          if (input.status === "ALL") return true;
          return [...new Set(d.events.map((e) => e.fileId))].some(
            (id) =>
              (manager || id === currentFile(d.events)) &&
              fileStatus(id, d.events) === input.status,
          );
        });
        const selected = matches.slice((input.page - 1) * 20, input.page * 20);
        const items = await Promise.all(
          selected.map(async (d) =>
            this.view(
              await tx.machineDocument.findUniqueOrThrow({
                where: { id: d.id },
                include,
              }),
              c.user.role,
            ),
          ),
        );
        return {
          items,
          total: matches.length,
          page: input.page,
          pageSize: 20,
          canManage: manager && !c.machine.archivedAt,
          canApprove:
            !c.machine.archivedAt && c.user.role === Role.MAINTENANCE_HEAD,
          maxBytes: 5 * 1024 * 1024,
          maxDocuments: MAX_DOCUMENTS,
          maxVersions: MAX_DOCUMENT_VERSIONS,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async detail(user: Principal, code: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code);
        const d = await tx.machineDocument.findFirst({
          where: { ...c.scope, id },
          include,
        });
        if (!d) throw new NotFoundException("Reference not found.");
        return this.view(d, c.user.role);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async upload(
    user: Principal,
    code: string,
    id: string | null,
    input: z.output<typeof draftSchema>,
    file: Express.Multer.File,
  ) {
    const checked = inspectDocument(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return this.mutate(
      user,
      code,
      id,
      input.requestId,
      { action: "UPLOAD", id, input, ...checked },
      async (tx, c, documentId) => {
        if (!managesDocuments(c.user.role))
          throw new ForbiddenException(
            "Only Administrator or Maintenance head can upload reference drafts.",
          );
        let d = await tx.machineDocument.findFirst({
          where: { ...c.scope, id: documentId },
          include,
        });
        if (id) {
          if (!d) throw new NotFoundException("Reference not found.");
          if (d.title !== input.title || d.kind !== input.kind)
            throw new ConflictException(
              "Revisions retain the logical reference title and kind.",
            );
        } else {
          if (input.version !== 0)
            throw new ConflictException(
              "A new reference starts at version zero.",
            );
          if (
            (await tx.machineDocument.count({ where: c.scope })) >=
            MAX_DOCUMENTS
          )
            throw new ConflictException(
              "This machine has reached its 200-reference limit.",
            );
          d = await tx.machineDocument.create({
            data: {
              ...c.scope,
              id: documentId,
              title: input.title,
              kind: input.kind,
            },
            include,
          });
        }
        if (!d) throw new NotFoundException();
        if (id && d.version !== input.version)
          throw new ConflictException(
            "Reference changed. Reload before uploading a revision.",
          );
        if (d.files.length >= MAX_DOCUMENT_VERSIONS)
          throw new ConflictException(
            "This reference has reached its 100-version limit.",
          );
        const revision = id ? d.version + 1 : 1;
        if (id) await this.advance(tx, c.scope, documentId, input.version);
        const f = await tx.machineDocumentFile.create({
          data: {
            ...c.scope,
            documentId,
            number: d.files.length + 1,
            filename: checked.filename,
            description: input.description,
            byteSize: file.buffer.length,
            sha256: checked.sha256,
            content: new Uint8Array(file.buffer),
          },
        });
        return {
          fileId: f.id,
          revision,
          reason: input.description,
          action: "UPLOAD",
        };
      },
    );
  }
  async action(
    user: Principal,
    code: string,
    id: string,
    action: "APPROVE" | "WITHDRAW",
    input: z.output<typeof actionSchema>,
  ) {
    return this.mutate(
      user,
      code,
      id,
      input.requestId,
      { action, id, input },
      async (tx, c, documentId) => {
        if (c.user.role !== Role.MAINTENANCE_HEAD)
          throw new ForbiddenException(
            "Only the active Maintenance head can approve or withdraw references.",
          );
        const d = await tx.machineDocument.findFirst({
          where: { ...c.scope, id: documentId },
          include,
        });
        if (!d) throw new NotFoundException("Reference not found.");
        if (d.version !== input.version)
          throw new ConflictException(
            "Reference changed. Reload and review it before acting.",
          );
        if (!d.files.some((f) => f.id === input.fileId))
          throw new NotFoundException("Reference version not found.");
        const status = fileStatus(input.fileId, d.events);
        if (action === "APPROVE" ? status !== "DRAFT" : status !== "CURRENT")
          throw new ConflictException(
            "Only a draft can be approved; only the current approval can be withdrawn.",
          );
        await this.advance(tx, c.scope, id, input.version);
        return {
          fileId: input.fileId,
          revision: d.version + 1,
          reason: input.reason,
          action,
        };
      },
    );
  }
  private async advance(
    tx: Prisma.TransactionClient,
    scope: { orgId: string; machineId: string },
    id: string,
    version: number,
  ) {
    const updated = await tx.machineDocument.updateMany({
      where: { ...scope, id, version },
      data: { version: version + 1 },
    });
    if (updated.count !== 1)
      throw new ConflictException("Reference changed. Reload before acting.");
  }
  private async mutate(
    user: Principal,
    code: string,
    id: string | null,
    requestId: string,
    payload: unknown,
    work: (
      tx: Prisma.TransactionClient,
      c: Awaited<ReturnType<WorkOrdersService["context"]>>,
      id: string,
    ) => Promise<{
      fileId: string;
      revision: number;
      reason: string;
      action: string;
    }>,
  ) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ payload, actorRole: user.role }))
      .digest("hex");
    return this.db.$transaction(
      async (tx) => {
        const initial = await this.orders.context(tx, user, code);
        // One bounded machine lock covers creation limits, retries and all lifecycle changes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${initial.scope.orgId}:${initial.scope.machineId}`}))`;
        // A queued mutation must observe grants revoked while it waited for the lock.
        const c = await this.orders.context(tx, user, code);
        const prior = await tx.machineDocumentEvent.findFirst({
          where: { ...c.scope, actorId: c.user.userId, requestId },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException(
              "This request key was used for different reference evidence.",
            );
          return {
            documentId: prior.documentId,
            fileId: prior.fileId,
            revision: prior.revision,
            alreadyApplied: true,
          };
        }
        const documentId = id ?? randomUUID(),
          result = await work(tx, c, documentId),
          at = new Date();
        await tx.machineDocumentEvent.create({
          data: {
            ...c.scope,
            ...result,
            documentId,
            actorId: c.user.userId,
            actorName: c.user.displayName,
            actorRole: c.user.role,
            requestId,
            fingerprint,
            at,
          },
        });
        const evidence = await tx.machineDocumentFile.findUniqueOrThrow({
          where: { id: result.fileId },
          select: fileSelect,
        });
        await tx.auditEvent.create({
          data: {
            orgId: c.scope.orgId,
            actorId: c.user.userId,
            entityId: documentId,
            action: `MACHINE_DOCUMENT_${result.action}`,
            at,
            detail: { ...result, actorRole: c.user.role, file: evidence },
          },
        });
        if (result.action === "APPROVE") {
          const source = (await currentApproved(tx, c.scope)).find(
            (s) => s.fileId === result.fileId,
          );
          if (source) await enqueue(tx, source, settings(this.config).profile);
        }
        return {
          documentId,
          fileId: result.fileId,
          revision: result.revision,
          alreadyApplied: false,
        };
      },
      { timeout: 15000 },
    );
  }
  async download(
    user: Principal,
    code: string,
    id: string,
    fileId: string,
    version: number,
  ) {
    return this.db.$transaction(async (tx) => {
      const initial = await this.orders.context(tx, user, code);
      // Serialize bytes/approval checks against lifecycle version changes. A
      // queued download must recheck its grants after acquiring the row lock.
      await tx.$queryRaw`SELECT id FROM maintenance."MachineDocument"
        WHERE id=${id}::uuid AND "orgId"=${initial.scope.orgId}::uuid
          AND "machineId"=${initial.scope.machineId}::uuid FOR SHARE`;
      const c = await this.orders.context(tx, user, code),
        d = await tx.machineDocument.findFirst({
          where: { ...c.scope, id },
          include,
        });
      if (
        !d ||
        (!managesDocuments(c.user.role) && currentFile(d.events) !== fileId)
      )
        throw new NotFoundException("Approved reference not found.");
      if (d.version !== version)
        throw new ConflictException(
          "Reference changed. Reload before downloading.",
        );
      const f = await tx.machineDocumentFile.findFirst({
        where: { ...c.scope, documentId: id, id: fileId },
      });
      if (!f) throw new NotFoundException("Reference version not found.");
      return f;
    });
  }
}
