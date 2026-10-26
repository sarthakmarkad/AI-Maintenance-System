import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type DocumentChatTurn } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import { DocumentAiService } from "./service";
import { currentApproved, type Approved } from "./store";
import { sha256, type ChatContext } from "./policy";
import type { DocumentAiAnswerDto } from "./dto";
export const chatMessageSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    requestId: z.string().uuid(),
    chatId: z.string().uuid().optional(),
  })
  .strict();
export const chatPageSchema = z
  .object({ before: z.string().uuid().optional() })
  .strict();
export const turnPageSchema = z
  .object({ before: z.coerce.number().int().min(1).max(61).optional() })
  .strict();
type Answer = DocumentAiAnswerDto;
@Injectable()
export class DocumentChatService {
  private rates = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(DocumentAiService) private readonly assistant: DocumentAiService,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async context(
    tx: Prisma.TransactionClient,
    user: Principal,
    code: string,
  ) {
    const c = await this.orders.context(tx, user, code);
    return {
      ...c,
      owner: { ...c.scope, userId: c.user.userId, actorRole: c.user.role },
    };
  }
  private view(turn: DocumentChatTurn, current: Approved[]) {
    const saved = turn.answer as unknown as Answer;
    const stale = [...saved.sources, ...(saved.references ?? [])].some(
      (s) =>
        !current.some(
          (c) => c.fileId === s.fileId && c.approvalId === s.approvalId,
        ),
    );
    const answer: Answer = stale
      ? {
          status: "SOURCE_CHANGED",
          message:
            "The references used for this reply have changed. Ask again to check the current approved documents.",
          statements: [],
          sources: [],
          policy: saved.policy,
          coverage: { approved: current.length, ready: 0 },
        }
      : {
          ...saved,
          sources: saved.sources.map((s) => ({
            ...s,
            documentVersion:
              current.find((c) => c.fileId === s.fileId)?.version ??
              s.documentVersion,
          })),
        };
    return {
      id: turn.id,
      ordinal: turn.ordinal,
      question: turn.question,
      at: turn.at.toISOString(),
      answer,
    };
  }
  async list(user: Principal, code: string, before?: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.context(tx, user, code);
        const cursor = before
          ? await tx.documentChat.findFirst({
              where: { ...c.owner, id: before },
            })
          : null;
        if (before && !cursor)
          throw new NotFoundException("Conversation not found.");
        const rows = await tx.documentChat.findMany({
          where: {
            ...c.owner,
            ...(cursor
              ? {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 21,
        });
        return {
          items: rows.slice(0, 20).map((c) => ({
            id: c.id,
            title: c.title,
            turns: c.version,
            updatedAt: c.updatedAt.toISOString(),
          })),
          nextCursor: rows.length > 20 ? rows[19].id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async detail(user: Principal, code: string, id: string, before?: number) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.context(tx, user, code),
          chat = await tx.documentChat.findFirst({ where: { ...c.owner, id } });
        if (!chat) throw new NotFoundException("Conversation not found.");
        const rows = await tx.documentChatTurn.findMany({
          where: { chatId: id, ...(before ? { ordinal: { lt: before } } : {}) },
          orderBy: { ordinal: "desc" },
          take: 21,
        });
        const current = await currentApproved(tx, c.scope),
          selected = rows.slice(0, 20).reverse();
        return {
          id: chat.id,
          title: chat.title,
          total: chat.version,
          turns: selected.map((t) => this.view(t, current)),
          before: rows.length > 20 ? selected[0].ordinal : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async send(
    user: Principal,
    code: string,
    input: z.infer<typeof chatMessageSchema>,
  ) {
    const fingerprint = sha256(
      JSON.stringify({
        question: input.question,
        chatId: input.chatId ?? null,
      }),
    );
    const initial = await this.db.$transaction(
      async (tx) => {
        const c = await this.context(tx, user, code),
          prior = await tx.documentChatTurn.findFirst({
            where: { ...c.owner, requestId: input.requestId },
          }),
          current = await currentApproved(tx, c.scope);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException(
              "This message key was already used for different content.",
            );
          return {
            c,
            prior,
            chat: null,
            history: [] as ChatContext[],
            current,
          };
        }
        const chat = input.chatId
          ? await tx.documentChat.findFirst({
              where: { ...c.owner, id: input.chatId },
            })
          : null;
        if (input.chatId && !chat)
          throw new NotFoundException("Conversation not found.");
        if (chat && chat.version >= 60)
          throw new ConflictException(
            "This conversation has reached 60 replies. Start a new chat to continue.",
          );
        const turns = chat
          ? await tx.documentChatTurn.findMany({
              where: { chatId: chat.id },
              orderBy: { ordinal: "asc" },
              take: 60,
            })
          : [];
        const valid = turns.map((t) => this.view(t, current));
        const selected = [
          ...new Map(
            [valid[0], ...valid.slice(-3)]
              .filter(Boolean)
              .map((t) => [t.id, t]),
          ).values(),
        ];
        return {
          c,
          prior: null,
          chat,
          history: selected.map((t) => ({
            question: t.question,
            answer: (t.answer.statements.length
              ? t.answer.statements.map((s) => s.text).join(" ")
              : t.answer.message
            ).slice(0, 1000),
            mode: ["GENERAL_ANSWER", "GUIDANCE"].includes(t.answer.status)
              ? ("GENERAL" as const)
              : ("DOCUMENTS" as const),
            referenceIds: [
              ...new Set(
                [...t.answer.sources, ...(t.answer.references ?? [])].map(
                  (s) => s.documentId,
                ),
              ),
            ],
          })),
          current,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (initial.prior)
      return {
        chatId: initial.prior.chatId,
        turn: this.view(initial.prior, initial.current),
        alreadyApplied: true,
      };
    const now = Date.now();
    for (const [k, v] of this.rates) if (v.until <= now) this.rates.delete(k);
    const rate = this.rates.get(user.userId) ?? {
      count: 0,
      until: now + 60000,
    };
    if (
      rate.count >= 60 ||
      (!this.rates.has(user.userId) && this.rates.size >= 10000)
    )
      throw new HttpException(
        "You’re sending messages too quickly. Please wait a moment.",
        429,
      );
    rate.count++;
    this.rates.set(user.userId, rate);
    const answer: Answer = await this.assistant.respond(
      user,
      code,
      input.question,
      initial.history,
    );
    if (Buffer.byteLength(JSON.stringify(answer), "utf8") > 60000)
      throw new ServiceUnavailableException(
        "The reply was too long to save. Please ask a more focused question.",
      );
    return this.db.$transaction(
      async (tx) => {
        const first = await this.context(tx, user, code);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${first.scope.orgId}:${first.scope.machineId}:${user.userId}:${user.role}`}))`;
        const c = await this.context(tx, user, code),
          prior = await tx.documentChatTurn.findFirst({
            where: { ...c.owner, requestId: input.requestId },
          });
        const current = await currentApproved(tx, c.scope);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException(
              "This message key was already used for different content.",
            );
          return {
            chatId: prior.chatId,
            turn: this.view(prior, current),
            alreadyApplied: true,
          };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${c.scope.orgId}:${c.scope.machineId}`}))`;
        await this.context(tx, user, code);
        const approved = await currentApproved(tx, c.scope);
        if (
          [...answer.sources, ...(answer.references ?? [])].some(
            (s) =>
              !approved.some(
                (a) => a.fileId === s.fileId && a.approvalId === s.approvalId,
              ),
          )
        )
          throw new ConflictException(
            "References changed before the reply was saved. Please ask again.",
          );
        const chatId = initial.chat?.id ?? randomUUID(),
          ordinal = (initial.chat?.version ?? 0) + 1,
          at = new Date();
        if (initial.chat) {
          const changed = await tx.documentChat.updateMany({
            where: { id: chatId, ...c.owner, version: initial.chat.version },
            data: { version: ordinal, updatedAt: at },
          });
          if (!changed.count)
            throw new ConflictException(
              "The conversation changed. Reload it before sending again.",
            );
        } else
          await tx.documentChat.create({
            data: {
              id: chatId,
              ...c.owner,
              title: input.question.slice(0, 80),
              version: 1,
              createdAt: at,
              updatedAt: at,
            },
          });
        const turn = await tx.documentChatTurn.create({
          data: {
            ...c.owner,
            chatId,
            ordinal,
            requestId: input.requestId,
            fingerprint,
            question: input.question,
            answer: answer as unknown as Prisma.InputJsonValue,
            at,
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: c.scope.orgId,
            actorId: c.user.userId,
            entityId: turn.id,
            action: "DOCUMENT_CHAT_TURN",
            detail: {
              chatId,
              ordinal,
              actorRole: c.user.role,
              questionHash: sha256(input.question),
              status: answer.status,
              responseMode:
                answer.status === "GENERAL_ANSWER" ? "GENERAL" : "DOCUMENTS",
            },
          },
        });
        return {
          chatId,
          turn: this.view(turn, approved),
          alreadyApplied: false,
        };
      },
      { timeout: 15000 },
    );
  }
}
