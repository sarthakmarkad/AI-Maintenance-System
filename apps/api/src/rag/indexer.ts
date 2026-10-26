import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { CONFIG, type Config } from "../config";
import { Database } from "../database";
import { PDF_EXTRACTOR, type PdfTextExtractor } from "./extractor";
import { RAG_AI, type RagAi } from "./provider";
import { RagError, settings, validateVectors } from "./policy";
import {
  approvedSql,
  currentApproved,
  enqueue,
  type Approved,
  type Scope,
} from "./store";
@Injectable()
export class DocumentIndexer {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RAG_AI) private readonly ai: RagAi,
    @Inject(PDF_EXTRACTOR) private readonly extractor: PdfTextExtractor,
  ) {}
  async runOnce(scope?: Scope) {
    const db = this.database.client;
    if (!db || !settings(this.config).configured) return;
    const { profile } = settings(this.config);
    // Discover approvals retained before this feature/key was configured. Bound each catch-up run.
    const missing = await db.$queryRaw<
      Approved[]
    >(Prisma.sql`SELECT a.* FROM (${approvedSql(scope)}) a
      WHERE NOT EXISTS(SELECT 1 FROM maintenance."DocumentRagIndex" i WHERE i."fileId"=a."fileId" AND i.profile=${profile}) LIMIT 20`);
    for (const source of missing)
      await db.$transaction((tx) => enqueue(tx, source, profile));
    const leaseId = randomUUID();
    const claimed = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >(Prisma.sql`SELECT id FROM maintenance."DocumentRagIndex"
        WHERE profile=${profile} AND ((status='QUEUED' AND "nextAttemptAt"<=now()) OR (status='PROCESSING' AND "leaseUntil"<now()))
        ${scope ? Prisma.sql`AND "orgId"=${scope.orgId}::uuid AND "machineId"=${scope.machineId}::uuid` : Prisma.empty}
        ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      const job = await tx.documentRagIndex.findUniqueOrThrow({
        where: { id: rows[0].id },
      });
      if (job.attempts >= 3) {
        await tx.documentRagIndex.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            leaseId: null,
            leaseUntil: null,
            lastError: "INDEX_ATTEMPTS_EXHAUSTED",
            updatedAt: new Date(),
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: job.orgId,
            entityId: job.id,
            action: "DOCUMENT_AI_INDEX_STOPPED",
            detail: {
              code: "INDEX_ATTEMPTS_EXHAUSTED",
              attempt: job.attempts,
              system: true,
            },
          },
        });
        return null;
      }
      return tx.documentRagIndex.update({
        where: { id: rows[0].id },
        data: {
          status: "PROCESSING",
          leaseId,
          leaseUntil: new Date(Date.now() + 10 * 60000),
          attempts: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    });
    if (!claimed) return;
    const active = async (tx: Prisma.TransactionClient) =>
      (await currentApproved(tx, claimed)).find(
        (s) => s.fileId === claimed.fileId,
      );
    try {
      if (!(await db.$transaction(active)))
        throw new RagError("SOURCE_NO_LONGER_APPROVED");
      const file = await db.machineDocumentFile.findUniqueOrThrow({
        where: { id: claimed.fileId },
        select: { content: true },
      });
      if (
        createHash("sha256").update(file.content).digest("hex") !==
        claimed.sourceHash
      )
        throw new RagError("SOURCE_HASH_MISMATCH");
      const extracted = await this.extractor.extract(file.content);
      if (!(await db.$transaction(active)))
        throw new RagError("SOURCE_NO_LONGER_APPROVED");
      const vectors = validateVectors(
        await this.ai.embed(extracted.chunks.map((c) => c.text)),
        extracted.chunks.length,
      );
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM maintenance."DocumentRagIndex" WHERE id=${claimed.id}::uuid FOR UPDATE`;
          const latest = await tx.documentRagIndex.findUniqueOrThrow({
            where: { id: claimed.id },
          });
          if (latest.leaseId !== leaseId || latest.status !== "PROCESSING")
            return;
          // Lifecycle writers use this same advisory lock. No stale source can publish after withdrawal.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${claimed.orgId}:${claimed.machineId}`}))`;
          if (!(await active(tx)))
            throw new RagError("SOURCE_NO_LONGER_APPROVED");
          for (let i = 0; i < extracted.chunks.length; i++) {
            const c = extracted.chunks[i],
              vector = JSON.stringify(vectors[i]);
            await tx.$executeRaw`INSERT INTO maintenance."DocumentRagChunk" (id,"orgId","machineId","documentId","fileId","indexId",ordinal,page,text,hash,embedding)
           VALUES (${randomUUID()}::uuid,${claimed.orgId}::uuid,${claimed.machineId}::uuid,${claimed.documentId}::uuid,${claimed.fileId}::uuid,${claimed.id}::uuid,${c.ordinal},${c.page},${c.text},${c.hash},${vector}::extensions.vector)`;
          }
          const now = new Date();
          await tx.documentRagIndex.update({
            where: { id: claimed.id },
            data: {
              status: "READY",
              leaseId: null,
              leaseUntil: null,
              pageCount: extracted.pages,
              chunkCount: extracted.chunks.length,
              lastError: null,
              readyAt: now,
              updatedAt: now,
            },
          });
          await tx.auditEvent.create({
            data: {
              orgId: claimed.orgId,
              entityId: claimed.id,
              action: "DOCUMENT_AI_INDEX_READY",
              detail: {
                fileId: claimed.fileId,
                sourceHash: claimed.sourceHash,
                profile,
                chunks: extracted.chunks.length,
                pages: extracted.pages,
                system: true,
              },
            },
          });
        },
        { timeout: 20000 },
      );
    } catch (error) {
      const code =
        error instanceof RagError ? error.code : "INDEX_PROCESSING_FAILED";
      const transient = [
        "AI_RATE_LIMITED",
        "AI_PROVIDER_FAILED",
        "AI_PROVIDER_UNAVAILABLE",
        "LOCAL_EMBEDDINGS_UNAVAILABLE",
        "INDEX_PROCESSING_FAILED",
      ].includes(code);
      await db.$transaction(async (tx) => {
        const updated = await tx.documentRagIndex.updateMany({
          where: { id: claimed.id, status: "PROCESSING", leaseId },
          data: {
            status:
              code === "SOURCE_NO_LONGER_APPROVED"
                ? "INACTIVE"
                : transient && claimed.attempts < 3
                  ? "QUEUED"
                  : "FAILED",
            leaseId: null,
            leaseUntil: null,
            lastError: code,
            nextAttemptAt: new Date(
              Date.now() + Math.min(300000, 30000 * claimed.attempts),
            ),
            updatedAt: new Date(),
          },
        });
        if (updated.count)
          await tx.auditEvent.create({
            data: {
              orgId: claimed.orgId,
              entityId: claimed.id,
              action: "DOCUMENT_AI_INDEX_STOPPED",
              detail: { code, system: true, attempt: claimed.attempts },
            },
          });
      });
    }
  }
}
