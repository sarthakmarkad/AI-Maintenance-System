import { ApiProperty } from "@nestjs/swagger";
export class ProductionProblemDto {
  @ApiProperty({ enum: ["ERROR", "WARNING"] }) severity!: string;
  @ApiProperty() code!: string;
  @ApiProperty() cell!: string;
  @ApiProperty() message!: string;
}
export class SheetInfoDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) month!: string | null;
  @ApiProperty() supported!: boolean;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty() heading!: string;
}
export class WorkbookInfoDto {
  @ApiProperty() filename!: string;
  @ApiProperty() workbookHash!: string;
  @ApiProperty({ type: [SheetInfoDto] }) sheets!: SheetInfoDto[];
}
export class ProductionRowDto {
  @ApiProperty() sourceRow!: number;
  @ApiProperty({ enum: ["JOB", "ACTIVITY"] }) kind!: string;
  @ApiProperty({ type: String, nullable: true, enum: ["A", "B", "C"] }) shift!:
    | string
    | null;
  @ApiProperty() description!: string;
  @ApiProperty({ type: Number, nullable: true }) productionKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) jobChanges!: number | null;
  @ApiProperty({ type: "object", additionalProperties: { type: "number" } })
  scrap!: Record<string, number>;
  @ApiProperty({ type: "object", additionalProperties: { type: "number" } })
  downtime!: Record<string, number>;
  @ApiProperty() remarks!: string;
  @ApiProperty({ type: "object", additionalProperties: true })
  rawCells!: Record<string, unknown>;
}
export class ProductionDayDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: String, nullable: true }) date!: string | null;
  @ApiProperty() rawDate!: string;
  @ApiProperty() sourceStartRow!: number;
  @ApiProperty() sourceEndRow!: number;
  @ApiProperty() productionKg!: number;
  @ApiProperty() scrapKg!: number;
  @ApiProperty({ type: Number, nullable: true }) controlProductionKg!:
    | number
    | null;
  @ApiProperty({ type: Number, nullable: true }) controlScrapKg!: number | null;
  @ApiProperty({ type: [ProductionRowDto] }) rows!: ProductionRowDto[];
  @ApiProperty({ type: [ProductionProblemDto] })
  problems!: ProductionProblemDto[];
  @ApiProperty() eligible!: boolean;
  @ApiProperty() alreadyImported!: boolean;
}
export class ProductionPreviewDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() workbookHash!: string;
  @ApiProperty() sheet!: string;
  @ApiProperty() month!: string;
  @ApiProperty() parserVersion!: string;
  @ApiProperty({ enum: ["AUTHENTIC", "SYNTHETIC"] }) source!: string;
  @ApiProperty({ enum: ["PREVIEW", "COMMITTED"] }) status!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: [String] }) committedDayKeys!: string[];
  @ApiProperty({ type: [ProductionDayDto] }) days!: ProductionDayDto[];
}
export class CommitProductionDto {
  @ApiProperty({ type: [String], example: ["row-8"] }) dayKeys!: string[];
  @ApiProperty({ example: true }) acknowledgeWarnings!: boolean;
}
export class ProductionCommitDto {
  @ApiProperty({ format: "uuid" }) importId!: string;
  @ApiProperty({ enum: ["COMMITTED"] }) status!: string;
  @ApiProperty() importedDays!: number;
  @ApiProperty() jobRows!: number;
  @ApiProperty() productionKg!: number;
  @ApiProperty() scrapKg!: number;
  @ApiProperty() alreadyCommitted!: boolean;
}
export class DailyProductionDto {
  @ApiProperty() date!: string;
  @ApiProperty({ type: Number, nullable: true }) productionKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) scrapKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) jobRows!: number | null;
}
export class ProductionImportHistoryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() sheet!: string;
  @ApiProperty({ enum: ["AUTHENTIC", "SYNTHETIC"] }) source!: string;
  @ApiProperty({ format: "date-time" }) committedAt!: string;
  @ApiProperty() importedDays!: number;
}
export class ProductionDashboardDto {
  @ApiProperty({ enum: ["AUTHENTIC", "SYNTHETIC"] }) source!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() hasData!: boolean;
  @ApiProperty() importedDays!: number;
  @ApiProperty() jobRows!: number;
  @ApiProperty() productionKg!: number;
  @ApiProperty() scrapKg!: number;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  lastImportedAt!: string | null;
  @ApiProperty({ type: [DailyProductionDto] }) daily!: DailyProductionDto[];
  @ApiProperty({ type: [ProductionImportHistoryDto] })
  imports!: ProductionImportHistoryDto[];
}
