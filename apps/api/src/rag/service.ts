import { formatInlineSteps } from "@maintenance/api-client/chat-format";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { CONFIG, type Config } from "../config";
import { Database } from "../database";
import type { Principal } from "../repository";
import { WorkOrdersService } from "../work-orders/service";
import { RAG_AI, type RagAi } from "./provider";
import {
  POLICY,
  RagError,
  settings,
  sha256,
  validateCitations,
  validateVectors,
  requiresDocuments,
  type Passage,
  type ChatContext,
} from "./policy";
import {
  catalogRequest,
  explicitDocumentSummary,
  summaryRequest,
  selectReference,
} from "./planning";
import { currentApproved, type Approved } from "./store";
@Injectable()
export class DocumentAiService {
  private busy = new Set<string>();
  private rates = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(RAG_AI) private readonly ai: RagAi,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  async status(user: Principal, code: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.orders.context(tx, user, code),
          sources = await currentApproved(tx, c.scope);
        const indexes = await tx.documentRagIndex.findMany({
          where: {
            ...c.scope,
            profile: settings(this.config).profile,
            fileId: { in: sources.map((s) => s.fileId) },
          },
          select: {
            id: true,
            fileId: true,
            status: true,
            pageCount: true,
            chunkCount: true,
            lastError: true,
          },
        });
        return {
          configured: settings(this.config).configured,
          provider: settings(this.config).provider,
          embeddingModel: settings(this.config).embeddingModel,
          canManage:
            c.user.role === Role.ADMINISTRATOR ||
            c.user.role === Role.MAINTENANCE_HEAD,
          approved: sources.length,
          ready: indexes.filter((i) => i.status === "READY").length,
          items: sources.map((s) => {
            const i = indexes.find((i) => i.fileId === s.fileId);
            return {
              documentId: s.documentId,
              fileId: s.fileId,
              title: s.title,
              fileNumber: s.number,
              indexId: i?.id ?? null,
              status: i?.status ?? "QUEUED",
              pages: i?.pageCount ?? null,
              chunks: i?.chunkCount ?? null,
              error: i?.lastError ?? null,
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async retry(user: Principal, code: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      if (
        c.user.role !== Role.ADMINISTRATOR &&
        c.user.role !== Role.MAINTENANCE_HEAD
      )
        throw new ForbiddenException(
          "Only a head or administrator can retry indexing.",
        );
      const index = await tx.documentRagIndex.findFirst({
        where: { id, ...c.scope, profile: settings(this.config).profile },
      });
      if (
        !index ||
        !(await currentApproved(tx, c.scope)).some(
          (s) => s.fileId === index.fileId,
        )
      )
        throw new NotFoundException("Current approved index not found.");
      if (
        index.status === "READY" ||
        index.status === "PROCESSING" ||
        index.status === "QUEUED"
      )
        return { queued: false };
      const changed = await tx.documentRagIndex.updateMany({
        where: { id, status: index.status },
        data: {
          status: "QUEUED",
          attempts: 0,
          lastError: null,
          nextAttemptAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (changed.count)
        await tx.auditEvent.create({
          data: {
            orgId: c.scope.orgId,
            actorId: c.user.userId,
            entityId: id,
            action: "DOCUMENT_AI_INDEX_RETRY",
            detail: { actorRole: c.user.role },
          },
        });
      return { queued: Boolean(changed.count) };
    });
  }
  private enter(key: string) {
    const now = Date.now();
    for (const [k, v] of this.rates) if (v.until <= now) this.rates.delete(k);
    const r = this.rates.get(key) ?? { count: 0, until: now + 600000 };
    if (this.busy.size >= 2 || this.busy.has(key) || r.count >= 10)
      throw new HttpException(
        "Document assistant is busy or the question limit was reached. Try again shortly.",
        429,
      );
    if (this.rates.size >= 10000 && !this.rates.has(key))
      throw new HttpException(
        "Document assistant is busy. Try again shortly.",
        429,
      );
    r.count++;
    this.rates.set(key, r);
    this.busy.add(key);
  }
  private async retrieve(
    tx: Prisma.TransactionClient,
    sources: Approved[],
    question: string,
    vector: number[],
    perDocument = 3,
  ) {
    const ids = sources.map((s) => s.fileId),
      profile = settings(this.config).profile;
    const rows = await tx.$queryRaw<
      (Omit<
        Passage,
        | "id"
        | "title"
        | "filename"
        | "fileNumber"
        | "documentVersion"
        | "approvalId"
      > & { vr: number; lr: number; lex: number })[]
    >(Prisma.sql`
      WITH candidates AS (
        SELECT c.id AS "chunkId", c."indexId",c."documentId",c."fileId",c.page,c.text,c.hash,
          1-(c.embedding OPERATOR(extensions.<=>) ${JSON.stringify(vector)}::extensions.vector) AS similarity,
          ts_rank_cd(c.search,plainto_tsquery('simple',${question})) AS lex
        FROM maintenance."DocumentRagChunk" c JOIN maintenance."DocumentRagIndex" i ON i.id=c."indexId"
        WHERE c."fileId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND i.profile=${profile} AND i.status='READY'
      ), ranked AS (
        SELECT *,row_number() OVER(ORDER BY similarity DESC,"chunkId")::int AS vr,
        row_number() OVER(ORDER BY lex DESC,"chunkId")::int AS lr FROM candidates
      ) SELECT * FROM ranked WHERE (vr<=24 OR (lex>0 AND lr<=24)) AND (similarity>=0.25 OR lex>0)
        ORDER BY (1.0/(60+vr)+CASE WHEN lex>0 THEN 1.0/(60+lr) ELSE 0 END) DESC,"chunkId" LIMIT 48`);
    const chosen: Passage[] = [];
    for (const row of rows) {
      if (
        chosen.filter((x) => x.documentId === row.documentId).length >=
        perDocument
      )
        continue;
      if (
        chosen.some(
          (x) =>
            x.fileId === row.fileId &&
            x.page === row.page &&
            (x.text.includes(row.text) || row.text.includes(x.text)),
        )
      )
        continue;
      const s = sources.find((s) => s.fileId === row.fileId)!;
      chosen.push({
        chunkId: row.chunkId,
        indexId: row.indexId,
        documentId: row.documentId,
        fileId: row.fileId,
        page: row.page,
        text: row.text,
        hash: row.hash,
        similarity: row.similarity,
        id: `S${chosen.length + 1}`,
        title: s.title,
        filename: s.filename,
        fileNumber: s.number,
        documentVersion: s.version,
        approvalId: s.approvalId,
      });
      if (chosen.length === (perDocument === 3 ? 6 : 8)) break;
    }
    return chosen;
  }
  private referenceList(sources: Approved[]) {
    return sources.map((s) => ({
      documentId: s.documentId,
      fileId: s.fileId,
      approvalId: s.approvalId,
      title: s.title,
      kind: s.kind,
      fileNumber: s.number,
    }));
  }
  private async catalog(user: Principal, code: string, question: string) {
    return this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code),
        all = await currentApproved(tx, c.scope),
        manualOnly = /manual|maual/i.test(question) && !/sop/i.test(question),
        sopOnly = /sop/i.test(question) && !/manu|maual/i.test(question),
        sources = all.filter(
          (s) =>
            (!manualOnly && !sopOnly) ||
            s.kind === (manualOnly ? "MANUAL" : "SOP"),
        );
      return {
        status: "REFERENCE_LIST",
        message: sources.length
          ? `Current library references approved for search (${sources.length}):\n` +
            sources
              .map((s) => `• ${s.title} — file revision ${s.number}`)
              .join("\n") +
            "\nAsk about a reference by name. Library approval does not override warnings or draft/training labels inside a document."
          : `There are no current approved ${manualOnly ? "manuals" : sopOnly ? "SOPs" : "references"} matching this request. General chat is still available.`,
        references: this.referenceList(sources),
        statements: [],
        sources: [],
        policy: "reference-catalog-v1",
        coverage: { approved: sources.length, ready: 0 },
      };
    });
  }
  private async completeReference(source: Approved) {
    const index = await this.db.documentRagIndex.findFirst({
      where: {
        fileId: source.fileId,
        profile: settings(this.config).profile,
        status: "READY",
      },
    });
    if (!index || index.chunkCount === null || index.chunkCount > 8)
      return null;
    const chunks = await this.db.documentRagChunk.findMany({
      where: { indexId: index.id },
      orderBy: { ordinal: "asc" },
      take: 9,
    });
    if (chunks.length !== index.chunkCount || chunks.length > 8) return null;
    return {
      totalPages: index.pageCount ?? 0,
      passages: chunks.map(
        (row, i): Passage => ({
          chunkId: row.id,
          indexId: index.id,
          documentId: source.documentId,
          fileId: source.fileId,
          page: row.page,
          text: row.text,
          hash: row.hash,
          similarity: 1,
          id: `S${i + 1}`,
          title: source.title,
          filename: source.filename,
          fileNumber: source.number,
          documentVersion: source.version,
          approvalId: source.approvalId,
        }),
      ),
    };
  }
  async respond(
    user: Principal,
    code: string,
    question: string,
    history: ChatContext[] = [],
  ) {
    await this.db.$transaction((tx) => this.orders.context(tx, user, code));
    if (!settings(this.config).configured)
      throw new ServiceUnavailableException(
        "The assistant is not configured on the backend.",
      );
    if (catalogRequest(question)) return this.catalog(user, code, question);
    this.enter(user.userId);
    try {
      // An explicit reference/equipment request needs no paid routing call.
      const reply =
        requiresDocuments(question) ||
        explicitDocumentSummary(question) ||
        (history.at(-1)?.mode === "DOCUMENTS" &&
          /^(?:explain|simplify|make) (?:that|it)\b/i.test(question))
          ? { mode: "DOCUMENTS" as const, reply: "" }
          : await this.ai.converse(question, history);
      if (reply.mode === "DOCUMENTS")
        return await this.ask(user, code, question, history, true);
      return {
        status: "GENERAL_ANSWER",
        message: formatInlineSteps(reply.reply),
        statements: [],
        sources: [],
        policy: "hybrid-chat-v1",
        coverage: { approved: 0, ready: 0 },
      };
    } catch (e) {
      if (e instanceof RagError)
        throw new ServiceUnavailableException(
          `The assistant could not complete this request (${e.code}). Try again shortly.`,
        );
      throw e;
    } finally {
      this.busy.delete(user.userId);
    }
  }
  async ask(
    user: Principal,
    code: string,
    question: string,
    history: ChatContext[] = [],
    reserved = false,
  ) {
    const initial = await this.db.$transaction(async (tx) => {
      const c = await this.orders.context(tx, user, code);
      return { c, sources: await currentApproved(tx, c.scope) };
    });
    const empty = (status: string, message: string) => ({
      status,
      message,
      statements: [],
      sources: [],
      policy: POLICY,
      coverage: { approved: initial.sources.length, ready: 0 },
    });
    if (!initial.sources.length)
      return empty(
        "NO_APPROVED_DOCUMENTS",
        "No approved manual or SOP is available. Ask the Maintenance head to approve a reference first.",
      );
    const summary = summaryRequest(question);
    const target = summary
      ? selectReference(question, initial.sources, history)
      : null;
    if (summary && initial.sources.length > 1 && !target)
      return {
        ...empty(
          "CLARIFICATION",
          "Which reference should I summarize? Please include its title: " +
            initial.sources.map((s) => s.title).join("; "),
        ),
        references: this.referenceList(initial.sources),
      };
    const selectedSources = target ? [target] : initial.sources;
    if (!settings(this.config).configured)
      throw new ServiceUnavailableException(
        "Document AI is not configured on the backend.",
      );
    const key = user.userId;
    if (!reserved) this.enter(key);
    try {
      const ready = await this.db.documentRagIndex.count({
        where: {
          ...initial.c.scope,
          fileId: { in: selectedSources.map((s) => s.fileId) },
          profile: settings(this.config).profile,
          status: "READY",
        },
      });
      if (!ready)
        return empty(
          "INDEXING_REQUIRED",
          "Approved documents are not ready for questions. Check indexing status below.",
        );
      const documentHistory = history.filter((h) => h.mode !== "GENERAL");
      const retrievalQuestion = documentHistory.length
        ? `${documentHistory[0].question.slice(0, 400)}\n${documentHistory.at(-1)!.question.slice(0, 300)}\n${question}`
        : question;
      const complete = target ? await this.completeReference(target) : null;
      const vector = complete
        ? null
        : validateVectors(
            await this.ai.embed([retrievalQuestion], "query"),
            1,
          )[0];
      const { sources, passages, currentReady } = await this.db.$transaction(
        async (tx) => {
          const c = await this.orders.context(tx, user, code),
            approved = await currentApproved(tx, c.scope),
            sources = target
              ? approved.filter((s) => s.documentId === target.documentId)
              : approved;
          if (
            target &&
            !sources.some(
              (s) =>
                s.fileId === target.fileId &&
                s.approvalId === target.approvalId,
            )
          )
            throw new ConflictException(
              "The selected reference changed. Reload and ask again.",
            );
          return {
            sources,
            currentReady: await tx.documentRagIndex.count({
              where: {
                ...c.scope,
                fileId: { in: sources.map((s) => s.fileId) },
                profile: settings(this.config).profile,
                status: "READY",
              },
            }),
            passages: complete
              ? complete.passages
              : sources.length
                ? await this.retrieve(
                    tx,
                    sources,
                    retrievalQuestion,
                    vector!,
                    summary ? 8 : 3,
                  )
                : [],
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      let answer = {
        status: "INSUFFICIENT_EVIDENCE" as
          | "ANSWERED"
          | "INSUFFICIENT_EVIDENCE"
          | "CONFLICTING_SOURCES"
          | "REFERENCE_EXCERPTS",
        statements: [] as Awaited<ReturnType<RagAi["answer"]>>["statements"],
      };
      let omittedStatements = 0;
      let reason = passages.length ? "MODEL_ABSTAINED" : "NO_RELEVANT_PASSAGES";
      if (passages.length) {
        try {
          const generated = await this.ai.answer(
            question +
              (summary && !complete
                ? " [Only excerpts are available: summarize these and do not claim all instructions are covered.]"
                : ""),
            passages,
            history,
          );
          const retained =
            summary && generated.status === "ANSWERED"
              ? generated.statements.filter((statement) => {
                  try {
                    validateCitations(
                      { status: "ANSWERED", statements: [statement] },
                      passages,
                    );
                    return true;
                  } catch (e) {
                    if (e instanceof RagError) return false;
                    throw e;
                  }
                })
              : generated.statements;
          omittedStatements = generated.statements.length - retained.length;
          const draft = validateCitations(
            { ...generated, statements: retained },
            passages,
          );
          if (
            draft.status === "INSUFFICIENT_EVIDENCE" ||
            (await this.ai.verify(question, passages, draft, history))
          ) {
            answer = draft;
            reason =
              draft.status === "INSUFFICIENT_EVIDENCE"
                ? "MODEL_ABSTAINED"
                : omittedStatements
                  ? "SUPPORTED_PARTIAL"
                  : "SUPPORTED";
          } else reason = "SUPPORT_CHECK_FAILED";
        } catch (e) {
          if (e instanceof RagError) reason = e.code;
          if (
            !(
              e instanceof RagError &&
              [
                "INVALID_CITATIONS",
                "UNSUPPORTED_NUMBERS",
                "AI_INVALID_RESPONSE",
                ...(summary
                  ? [
                      "AI_INCOMPLETE_RESPONSE",
                      "AI_PROVIDER_UNAVAILABLE",
                      "AI_PROVIDER_FAILED",
                      "AI_RATE_LIMITED",
                      "AI_QUOTA_EXCEEDED",
                    ]
                  : []),
              ].includes(e.code)
            )
          )
            throw e;
        }
      }
      if (
        summary &&
        passages.length &&
        answer.status === "INSUFFICIENT_EVIDENCE"
      ) {
        // A mechanical quotation is not an unchecked generated summary. Keep
        // the provider/verification reason and clearly label this degraded path.
        answer = {
          status: "REFERENCE_EXCERPTS",
          statements: passages.map((p) => ({
            text: p.text,
            citations: [{ sourceId: p.id, quote: p.text }],
          })),
        };
        omittedStatements = 0;
      }
      // Verify every supplied passage, including ones omitted by the model. A revoked approval invalidates the whole answer.
      await this.db.$transaction(async (tx) => {
        await this.orders.context(tx, user, code);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${initial.c.scope.orgId}:${initial.c.scope.machineId}`}))`;
        await this.orders.context(tx, user, code);
        const current = await currentApproved(tx, initial.c.scope);
        if (
          passages.some(
            (p) =>
              !current.some(
                (s) => s.fileId === p.fileId && s.approvalId === p.approvalId,
              ),
          )
        )
          throw new ConflictException(
            "Approved sources changed while answering. Reload and ask again.",
          );
        await tx.auditEvent.create({
          data: {
            orgId: initial.c.scope.orgId,
            actorId: user.userId,
            entityId: initial.c.scope.machineId,
            action: "DOCUMENT_AI_ANSWER",
            detail: {
              questionHash: sha256(question),
              policy: POLICY,
              profile: settings(this.config).profile,
              model: settings(this.config).answerModel,
              provider: settings(this.config).provider,
              status: answer.status,
              reason,
              omittedStatements,
              retrievalScope: complete ? "FULL_INDEXED_REFERENCE" : "EXCERPTS",
              sourceChunks: passages.map((p) => p.chunkId),
              actorRole: user.role,
            },
          },
        });
      });
      const used = new Set(
        answer.statements.flatMap((s) => s.citations.map((c) => c.sourceId)),
      );
      return {
        status: answer.status,
        reason,
        message:
          answer.status === "REFERENCE_EXCERPTS"
            ? "I could not finish a verified AI summary. Here is the reference text verbatim instead; this is not a generated summary. Keep any training or draft warnings in mind."
            : answer.status === "ANSWERED"
              ? "Answer from approved references. Check the cited passages before applying it."
              : answer.status === "CONFLICTING_SOURCES"
                ? "Approved passages conflict. Ask the Maintenance head to resolve them before acting."
                : [
                      "INVALID_CITATIONS",
                      "UNSUPPORTED_NUMBERS",
                      "AI_INVALID_RESPONSE",
                      "SUPPORT_CHECK_FAILED",
                    ].includes(reason)
                  ? "I found reference text, but could not verify a reliable answer from the generated draft. Try a more focused question or view the source PDF in the library."
                  : "I could not find enough supported information in the selected reference text. Please name the reference or ask about a specific section.",
        statements: answer.statements,
        sources: passages
          .filter((p) => used.has(p.id))
          .map(({ similarity, chunkId, indexId, hash, ...s }) => s),
        policy: POLICY,
        coverage: {
          ...(omittedStatements && answer.status === "ANSWERED"
            ? { omittedStatements }
            : {}),
          approved: sources.length,
          ready: currentReady,
          ...(summary
            ? {
                scope: complete ? "FULL_INDEXED_REFERENCE" : "EXCERPTS",
                referenceTitle: target?.title,
                pages: [...new Set(passages.map((p) => p.page))].sort(
                  (a, b) => a - b,
                ),
                totalPages: complete?.totalPages,
              }
            : {}),
        },
      };
    } catch (e) {
      if (e instanceof RagError)
        throw new ServiceUnavailableException(
          `Document AI could not complete this request (${e.code}). Try again or contact your administrator.`,
        );
      throw e;
    } finally {
      if (!reserved) this.busy.delete(key);
    }
  }
}
