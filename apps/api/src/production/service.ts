import { productionTemplate, templateMonth } from "../imports/templates";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Database } from "../database";
import { REPOSITORY, type Principal, type Repository } from "../repository";
import {
  loadWorkbook,
  parseSheet,
  SUPPORTED_PRODUCTION_PARSERS,
  strictDate,
  sumKg,
  type ParsedSheet,
  type Source,
} from "./parser";

const dateSchema = z
  .string()
  .refine(strictDate, "Use a real date in YYYY-MM-DD format.");
export const sourceSchema = z.enum(["AUTHENTIC", "SYNTHETIC"]);
export const dashboardQuery = z
  .object({
    source: sourceSchema.default("AUTHENTIC"),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (Boolean(q.from) !== Boolean(q.to))
      ctx.addIssue({
        code: "custom",
        message: "Provide both from and to dates.",
      });
    if (
      q.from &&
      q.to &&
      (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 365 * 86400000)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose an ordered date range of at most 366 days.",
      });
  });
export const commitSchema = z
  .object({
    dayKeys: z
      .array(z.string().regex(/^row-\d+$/))
      .min(1)
      .max(31)
      .refine(
        (keys) => new Set(keys).size === keys.length,
        "Select each day only once.",
      ),
    acknowledgeWarnings: z.literal(true, {
      error: "Acknowledge the source and validation notes before importing.",
    }),
  })
  .strict();
export function validated<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "request"}: ${issue.message}`,
        )
        .join("; "),
    );
  return parsed.data;
}
@Injectable()
export class ProductionService {
  private active = new Set<string>();
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
    if (code === "WH-B")
      throw new NotFoundException("WH-B remains reference-only.");
    const record = await this.repo.machine(user, code);
    if (!record)
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return record;
  }
  async template(user: Principal, code: string, month = templateMonth()) {
    await this.machine(user, code);
    return this.process(user, () => productionTemplate(code, month));
  }
  private async process<T>(
    user: Principal,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.active.has(user.userId) || this.active.size >= 2)
      throw new ServiceUnavailableException(
        "A workbook is already being processed. Wait for it to finish and try again.",
      );
    this.active.add(user.userId);
    try {
      return await work();
    } finally {
      this.active.delete(user.userId);
    }
  }
  async inspect(
    user: Principal,
    code: string,
    buffer: Buffer,
    filename: string,
  ) {
    await this.machine(user, code);
    return this.process(user, async () => {
      const loaded = await loadWorkbook(buffer, filename, code);
      return {
        filename: loaded.filename,
        workbookHash: loaded.workbookHash,
        sheets: loaded.sheets,
      };
    });
  }
  async preview(
    user: Principal,
    code: string,
    buffer: Buffer,
    filename: string,
    sheet: string,
    source: Source,
  ) {
    const machine = await this.machine(user, code);
    return this.process(user, async () => {
      const loaded = await loadWorkbook(buffer, filename, code);
      const staged = parseSheet(loaded, sheet, source);
      await this.markExisting(staged, user.orgId, machine.id);
      const record = await this.db.$transaction(async (tx) => {
        const row = await tx.productionImport.create({
          data: {
            orgId: user.orgId,
            machineId: machine.id,
            source,
            filename: loaded.filename,
            workbookHash: loaded.workbookHash,
            sheet,
            parserVersion: staged.parserVersion,
            staged: staged as unknown as Prisma.InputJsonValue,
            createdBy: user.userId,
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: user.orgId,
            actorId: user.userId,
            action: "PRODUCTION_PREVIEWED",
            entityId: row.id,
            detail: {
              workbookHash: loaded.workbookHash,
              sheet,
              source,
              eligibleDays: staged.days.filter((day) => day.eligible).length,
            },
          },
        });
        return row;
      });
      return this.view(record, staged);
    });
  }
  private async markExisting(
    staged: ParsedSheet,
    orgId: string,
    machineId: string,
  ) {
    const existing = await this.db.productionDay.findMany({
      where: {
        orgId,
        machineId,
        source: staged.source,
        date: {
          in: staged.days
            .filter((d) => d.date)
            .map((d) => new Date(d.date! + "T00:00:00Z")),
        },
      },
      select: { date: true },
    });
    const dates = new Set(
      existing.map((row) => row.date.toISOString().slice(0, 10)),
    );
    for (const day of staged.days)
      if (day.date && dates.has(day.date)) {
        day.alreadyImported = true;
        day.eligible = false;
        if (!day.problems.some((p) => p.code === "ALREADY_IMPORTED"))
          day.problems.push({
            severity: "WARNING",
            code: "ALREADY_IMPORTED",
            cell: `A${day.sourceStartRow}`,
            message:
              "This date is already imported for this machine and source; it will not be added again.",
          });
      }
  }
  private view(
    record: {
      id: string;
      status: string;
      createdAt: Date;
      expiresAt: Date;
      committedDayKeys: string[];
    },
    staged: ParsedSheet,
  ) {
    return {
      ...staged,
      id: record.id,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      committedDayKeys: record.committedDayKeys,
    };
  }
  async getPreview(user: Principal, code: string, id: string) {
    const machine = await this.machine(user, code);
    const row = await this.db.productionImport.findFirst({
      where: { id, orgId: user.orgId, machineId: machine.id },
    });
    if (!row) throw new NotFoundException("Import preview not found.");
    const staged = row.staged as unknown as ParsedSheet;
    if (row.status === "PREVIEW")
      await this.markExisting(staged, user.orgId, machine.id);
    return this.view(row, staged);
  }
  async commit(
    user: Principal,
    code: string,
    id: string,
    input: z.infer<typeof commitSchema>,
  ) {
    const machine = await this.machine(user, code);
    try {
      return await this.db.$transaction(
        async (tx) => {
          // Lock just this scoped preview: a retry cannot create a second commit/audit event.
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM maintenance."ProductionImport" WHERE id=${id}::uuid AND "orgId"=${user.orgId}::uuid AND "machineId"=${machine.id}::uuid FOR UPDATE`;
          if (!locked.length)
            throw new NotFoundException("Import preview not found.");
          const row = await tx.productionImport.findFirstOrThrow({
            where: { id, orgId: user.orgId, machineId: machine.id },
          });
          if (row.status === "COMMITTED") {
            if (
              [...row.committedDayKeys].sort().join(",") !==
              [...input.dayKeys].sort().join(",")
            )
              throw new ConflictException(
                "This preview was already committed with a different selection. Create a new preview.",
              );
            return this.committedResult(tx, id, user.orgId, machine.id, true);
          }
          if (row.expiresAt.getTime() < Date.now())
            throw new GoneException(
              "This preview expired. Upload the workbook again to create a fresh preview.",
            );
          const staged = row.staged as unknown as ParsedSheet;
          if (
            !SUPPORTED_PRODUCTION_PARSERS.includes(
              staged.parserVersion as (typeof SUPPORTED_PRODUCTION_PARSERS)[number],
            ) ||
            staged.parserVersion !== row.parserVersion ||
            staged.source !== row.source ||
            staged.sheet !== row.sheet
          )
            throw new ConflictException(
              "The parser contract changed. Create a new preview.",
            );
          const days = staged.days.filter((day) =>
            input.dayKeys.includes(day.key),
          );
          if (
            days.length !== input.dayKeys.length ||
            days.some(
              (day) =>
                !day.eligible ||
                !day.date ||
                !strictDate(day.date) ||
                day.problems.some((p) => p.severity === "ERROR") ||
                day.alreadyImported ||
                day.controlProductionKg === null ||
                day.controlScrapKg === null,
            )
          )
            throw new BadRequestException(
              "Select only valid, not-yet-imported date blocks from this preview.",
            );
          const duplicate = await tx.productionDay.findFirst({
            where: {
              orgId: user.orgId,
              machineId: machine.id,
              source: row.source,
              date: {
                in: days.map((day) => new Date(day.date! + "T00:00:00Z")),
              },
            },
          });
          if (duplicate)
            throw new ConflictException(
              "One or more selected dates were already imported. Refresh the preview before importing.",
            );
          for (const day of days.sort((a, b) =>
            a.date!.localeCompare(b.date!),
          )) {
            const saved = await tx.productionDay.create({
              data: {
                orgId: user.orgId,
                machineId: machine.id,
                importId: id,
                source: row.source,
                date: new Date(day.date! + "T00:00:00Z"),
                productionKg: day.productionKg,
                scrapKg: day.scrapKg,
                controlProductionKg: day.controlProductionKg!,
                controlScrapKg: day.controlScrapKg!,
                sourceStartRow: day.sourceStartRow,
                sourceEndRow: day.sourceEndRow,
              },
            });
            await tx.productionRow.createMany({
              data: day.rows.map((record) => ({
                orgId: user.orgId,
                machineId: machine.id,
                dayId: saved.id,
                sourceRow: record.sourceRow,
                kind: record.kind,
                shift: record.shift!,
                description: record.description,
                productionKg: record.productionKg,
                jobChanges: record.jobChanges,
                scrap: record.scrap,
                downtime: record.downtime,
                downtimeUnit: "UNCONFIRMED",
                remarks: record.remarks,
                rawCells: record.rawCells as Prisma.InputJsonObject,
              })),
            });
          }
          await tx.productionImport.update({
            where: { id },
            data: {
              status: "COMMITTED",
              committedAt: new Date(),
              committedDayKeys: input.dayKeys,
            },
          });
          await tx.auditEvent.create({
            data: {
              orgId: user.orgId,
              actorId: user.userId,
              action: "PRODUCTION_COMMITTED",
              entityId: id,
              detail: {
                source: row.source,
                sheet: row.sheet,
                days: days.map((day) => day.date),
                selectedBlocks: input.dayKeys,
                excludedBlocks: staged.days.length - days.length,
              },
            },
          });
          return this.committedResult(tx, id, user.orgId, machine.id, false);
        },
        { timeout: 20000, maxWait: 5000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      )
        throw new ConflictException(
          "Another import saved these dates first. Refresh the preview; no duplicate production was added.",
        );
      throw error;
    }
  }
  private async committedResult(
    tx: Prisma.TransactionClient,
    id: string,
    orgId: string,
    machineId: string,
    alreadyCommitted: boolean,
  ) {
    const days = await tx.productionDay.findMany({
      where: { importId: id, orgId, machineId },
      include: { _count: { select: { rows: { where: { kind: "JOB" } } } } },
    });
    return {
      importId: id,
      status: "COMMITTED" as const,
      importedDays: days.length,
      jobRows: days.reduce((n, d) => n + d._count.rows, 0),
      productionKg: sumKg(days.map((d) => Number(d.productionKg))),
      scrapKg: sumKg(days.map((d) => Number(d.scrapKg))),
      alreadyCommitted,
    };
  }
  async dashboard(
    user: Principal,
    code: string,
    input: z.infer<typeof dashboardQuery>,
  ) {
    const machine = await this.machine(user, code);
    const scope = {
      orgId: user.orgId,
      machineId: machine.id,
      source: input.source,
    };
    const latest = await this.db.productionDay.findFirst({
      where: scope,
      orderBy: { date: "desc" },
      select: { date: true },
    });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const month = (latest?.date.toISOString().slice(0, 10) || today).slice(
      0,
      7,
    );
    const from = input.from || month + "-01";
    const to =
      input.to ||
      new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
    const days = await this.db.productionDay.findMany({
      where: {
        ...scope,
        date: {
          gte: new Date(from + "T00:00:00Z"),
          lte: new Date(to + "T00:00:00Z"),
        },
      },
      orderBy: { date: "asc" },
      include: {
        _count: { select: { rows: { where: { kind: "JOB" } } } },
        import: { select: { committedAt: true } },
      },
    });
    const byDate = new Map(
      days.map((day) => [day.date.toISOString().slice(0, 10), day]),
    );
    const daily = [];
    for (
      let stamp = Date.parse(from);
      stamp <= Date.parse(to);
      stamp += 86400000
    ) {
      const date = new Date(stamp).toISOString().slice(0, 10),
        day = byDate.get(date);
      daily.push({
        date,
        productionKg: day ? Number(day.productionKg) : null,
        scrapKg: day ? Number(day.scrapKg) : null,
        jobRows: day ? day._count.rows : null,
      });
    }
    const imports = await this.db.productionImport.findMany({
      where: {
        ...scope,
        status: "COMMITTED",
        days: {
          some: {
            date: {
              gte: new Date(from + "T00:00:00Z"),
              lte: new Date(to + "T00:00:00Z"),
            },
          },
        },
      },
      orderBy: { committedAt: "desc" },
      take: 20,
      select: {
        id: true,
        filename: true,
        sheet: true,
        source: true,
        committedAt: true,
        _count: { select: { days: true } },
      },
    });
    const lastImported = days
      .map((day) => day.import.committedAt)
      .filter((v): v is Date => v !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      source: input.source,
      from,
      to,
      hasData: days.length > 0,
      importedDays: days.length,
      jobRows: days.reduce((n, d) => n + d._count.rows, 0),
      productionKg: sumKg(days.map((d) => Number(d.productionKg))),
      scrapKg: sumKg(days.map((d) => Number(d.scrapKg))),
      lastImportedAt: lastImported?.toISOString() || null,
      daily,
      imports: imports.map((row) => ({
        id: row.id,
        filename: row.filename,
        sheet: row.sheet,
        source: row.source,
        committedAt: row.committedAt!.toISOString(),
        importedDays: row._count.days,
      })),
    };
  }
}
