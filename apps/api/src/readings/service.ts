import { readingsTemplate } from "../imports/templates";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type ReadingImport } from "@prisma/client";
import { z } from "zod";
import { Database } from "../database";
import { REPOSITORY, type Principal, type Repository } from "../repository";
import { strictDate } from "../production/parser";
import {
  parseReadings,
  localDayStart,
  localTime,
  REVIEW_POLICY,
  type ReadingStage,
} from "./parser";
import { analyse } from "./analysis";
export const trendQuery = z
  .object({
    from: z.string().refine(strictDate).optional(),
    to: z.string().refine(strictDate).optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      Boolean(q.from) !== Boolean(q.to) ||
      (q.from &&
        q.to &&
        (q.from > q.to ||
          Date.parse(q.to) - Date.parse(q.from) > 30 * 86400000))
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose both dates, in order, spanning at most 31 days.",
      });
  });
export const readingCommit = z
  .object({ acknowledgeWarnings: z.literal(true) })
  .strict();
@Injectable()
export class ReadingsService {
  private active = new Set<string>();
  private importer(user: Principal) {
    if (
      !["ADMINISTRATOR", "MAINTENANCE_HEAD", "SUPERVISOR"].includes(user.role)
    )
      throw new ForbiddenException("Your role cannot import process readings.");
  }
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(REPOSITORY) private readonly repo: Repository,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async machine(user: Principal, code: string) {
    const m = code !== "WH-B" ? await this.repo.machine(user, code) : null;
    if (!m)
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return m;
  }
  async template(user: Principal, code: string) {
    this.importer(user);
    await this.machine(user, code);
    return readingsTemplate(code);
  }
  private async markExisting(
    stage: ReadingStage,
    orgId: string,
    machineId: string,
    db: Prisma.TransactionClient = this.db,
  ) {
    const valid = stage.rows.filter((r) => r.eligible);
    if (!valid.length) return;
    const saved = await db.processReading.findMany({
      where: {
        orgId,
        machineId,
        source: "SYNTHETIC",
        OR: [
          { measuredAt: { in: valid.map((r) => new Date(r.measuredAt!)) } },
          { sourceId: { in: valid.map((r) => r.sourceId) } },
        ],
      },
      select: { measuredAt: true, sourceId: true },
    });
    const ids = new Set(saved.map((r) => r.sourceId)),
      times = new Set(saved.map((r) => r.measuredAt.toISOString()));
    for (const row of valid)
      if (ids.has(row.sourceId) || times.has(row.measuredAt!)) {
        row.alreadyImported = true;
        row.eligible = false;
        row.problems.push(
          "Reading ID or measurement time already saved. Existing values are never overwritten.",
        );
      }
  }
  private stage(row: ReadingImport) {
    return structuredClone(row.staged) as unknown as ReadingStage;
  }
  private response(row: ReadingImport, stage: ReadingStage) {
    return {
      ...stage,
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
    };
  }
  async preview(
    user: Principal,
    code: string,
    buffer: Buffer,
    filename: string,
    entryPoint: "API" | "LOCAL_CLI" = "API",
  ) {
    this.importer(user);
    const m = await this.machine(user, code);
    if (this.active.has(user.userId) || this.active.size >= 2)
      throw new ServiceUnavailableException(
        "A reading workbook is already being processed. Try again shortly.",
      );
    this.active.add(user.userId);
    try {
      const stage = await parseReadings(buffer, filename, code);
      await this.markExisting(stage, user.orgId, m.id);
      const row = await this.db.$transaction(async (tx) => {
        const row = await tx.readingImport.create({
          data: {
            orgId: user.orgId,
            machineId: m.id,
            createdBy: user.userId,
            filename: stage.filename,
            workbookHash: stage.workbookHash,
            parserVersion: stage.parserVersion,
            policyVersion: stage.policyVersion,
            staged: stage as unknown as Prisma.InputJsonObject,
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: user.orgId,
            actorId: user.userId,
            action: "READINGS_PREVIEWED",
            entityId: row.id,
            detail: {
              entryPoint,
              source: "SYNTHETIC",
              rows: stage.rows.length,
              eligible: stage.rows.filter((r) => r.eligible).length,
            },
          },
        });
        return row;
      });
      return this.response(row, stage);
    } finally {
      this.active.delete(user.userId);
    }
  }
  async getPreview(user: Principal, code: string, id: string) {
    this.importer(user);
    const m = await this.machine(user, code);
    const row = await this.db.readingImport.findFirst({
      where: { id, orgId: user.orgId, machineId: m.id },
    });
    if (!row) throw new NotFoundException("Reading preview not found.");
    const stage = this.stage(row);
    if (row.status === "PREVIEW")
      await this.markExisting(stage, user.orgId, m.id);
    return this.response(row, stage);
  }
  async commit(
    user: Principal,
    code: string,
    id: string,
    entryPoint: "API" | "LOCAL_CLI" = "API",
  ) {
    this.importer(user);
    const m = await this.machine(user, code);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const found = await tx.$queryRaw<
            ReadingImport[]
          >`SELECT * FROM maintenance."ReadingImport" WHERE id=${id}::uuid AND "orgId"=${user.orgId}::uuid AND "machineId"=${m.id}::uuid FOR UPDATE`;
          const row = found[0];
          if (!row) throw new NotFoundException("Reading preview not found.");
          if (row.status === "COMMITTED")
            return {
              importId: id,
              importedReadings: await tx.processReading.count({
                where: { importId: id, orgId: user.orgId, machineId: m.id },
              }),
              alreadyCommitted: true,
            };
          if (row.expiresAt.getTime() < Date.now())
            throw new GoneException(
              "Preview expired. Upload the workbook again.",
            );
          const stage = this.stage(row),
            selected = stage.rows.filter((r) => r.eligible);
          if (!selected.length)
            throw new BadRequestException(
              "There are no valid new observations to import.",
            );
          const checked = structuredClone(stage);
          await this.markExisting(checked, user.orgId, m.id, tx);
          if (checked.rows.filter((r) => r.eligible).length !== selected.length)
            throw new ConflictException(
              "Some observations were saved by another import. Refresh the preview before continuing.",
            );
          const receivedAt = new Date();
          await tx.processReading.createMany({
            data: selected.map((r) => ({
              orgId: user.orgId,
              machineId: m.id,
              importId: id,
              source: "SYNTHETIC",
              sourceId: r.sourceId,
              sourceRow: r.sourceRow,
              measuredAt: new Date(r.measuredAt!),
              localMeasuredAt: r.localMeasuredAt!,
              receivedAt,
              demoShift: r.demoShift as "A" | "B" | "C",
              hotTempC: r.hotTempC!,
              coldTempC: r.coldTempC!,
              pressureBar: r.pressureBar!,
              rawCells: r.rawCells as unknown as Prisma.InputJsonObject,
            })),
          });
          await tx.readingImport.update({
            where: { id },
            data: { status: "COMMITTED", committedAt: receivedAt },
          });
          await tx.auditEvent.create({
            data: {
              orgId: user.orgId,
              actorId: user.userId,
              action: "READINGS_COMMITTED",
              entityId: id,
              detail: {
                entryPoint,
                source: "SYNTHETIC",
                readings: selected.length,
                excluded: stage.rows.length - selected.length,
                policyVersion: stage.policyVersion,
              },
            },
          });
          return {
            importId: id,
            importedReadings: selected.length,
            alreadyCommitted: false,
          };
        },
        { timeout: 20000, maxWait: 5000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(e.code)
      )
        throw new ConflictException(
          "Another import saved these readings. Refresh the preview; no duplicates were added.",
        );
      throw e;
    }
  }
  async trends(
    user: Principal,
    code: string,
    query: z.output<typeof trendQuery>,
  ) {
    const m = await this.machine(user, code),
      scope = {
        orgId: user.orgId,
        machineId: m.id,
        source: "SYNTHETIC" as const,
      };
    // One snapshot keeps chart points, provenance and coverage consistent during commits.
    return this.db.$transaction(
      async (tx) => {
        const latest = await tx.processReading.findFirst({
          where: scope,
          orderBy: { measuredAt: "desc" },
          select: { measuredAt: true },
        });
        const lastReceived = await tx.processReading.findFirst({
          where: scope,
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true },
        });
        const to =
          query.to ?? localTime(latest?.measuredAt ?? new Date()).slice(0, 10);
        const from =
          query.from ??
          new Date(Date.parse(to + "T00:00:00Z") - 13 * 86400000)
            .toISOString()
            .slice(0, 10);
        const start = localDayStart(from),
          end = new Date(localDayStart(to).getTime() + 86400000);
        const rows = await tx.processReading.findMany({
          where: { ...scope, measuredAt: { gte: start, lt: end } },
          orderBy: { measuredAt: "asc" },
          include: {
            import: {
              select: {
                filename: true,
                sheet: true,
                workbookHash: true,
                policyVersion: true,
              },
            },
          },
        });
        const history = await tx.readingImport.findMany({
          where: {
            ...scope,
            status: "COMMITTED",
            readings: { some: { measuredAt: { gte: start, lt: end } } },
          },
          orderBy: { committedAt: "desc" },
          take: 20,
          select: {
            id: true,
            filename: true,
            sheet: true,
            workbookHash: true,
            committedAt: true,
            _count: { select: { readings: true } },
          },
        });
        const observations = rows.map((r) => ({
          ...r,
          hotTempC: Number(r.hotTempC),
          coldTempC: Number(r.coldTempC),
          pressureBar: Number(r.pressureBar),
        }));
        return {
          source: "SYNTHETIC" as const,
          timezone: "Asia/Kolkata",
          policyVersion: REVIEW_POLICY,
          from,
          to,
          hasData: !!rows.length,
          observations: rows.length,
          latestMeasuredAt: latest?.measuredAt.toISOString() ?? null,
          lastReceivedAt: lastReceived?.receivedAt.toISOString() ?? null,
          ...analyse(observations, start, end),
          rows: observations.map((r) => ({
            sourceId: r.sourceId,
            sourceRow: r.sourceRow,
            importId: r.importId,
            measuredAt: r.measuredAt.toISOString(),
            localMeasuredAt: r.localMeasuredAt,
            receivedAt: r.receivedAt.toISOString(),
            demoShift: r.demoShift,
            hotTempC: r.hotTempC,
            coldTempC: r.coldTempC,
            pressureBar: r.pressureBar,
            filename: r.import.filename,
            sheet: r.import.sheet,
            workbookHash: r.import.workbookHash,
          })),
          imports: history.map((r) => ({
            id: r.id,
            filename: r.filename,
            sheet: r.sheet,
            workbookHash: r.workbookHash,
            receivedAt: r.committedAt!.toISOString(),
            observations: r._count.readings,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
