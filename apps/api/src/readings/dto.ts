import { ApiProperty } from "@nestjs/swagger";
export class ReadingPreviewRowDto {
  @ApiProperty() sourceRow!: number;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ type: String, nullable: true }) localMeasuredAt!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  measuredAt!: string | null;
  @ApiProperty() demoShift!: string;
  @ApiProperty({ type: Number, nullable: true }) hotTempC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) coldTempC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) pressureBar!: number | null;
  @ApiProperty({ type: [String] }) problems!: string[];
  @ApiProperty() eligible!: boolean;
  @ApiProperty() alreadyImported!: boolean;
  @ApiProperty({ type: "object", additionalProperties: true })
  rawCells!: Record<string, unknown>;
}
export class ReadingPreviewDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["SYNTHETIC"] }) source!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() workbookHash!: string;
  @ApiProperty() sheet!: string;
  @ApiProperty() parserVersion!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty({ enum: ["PREVIEW", "COMMITTED"] }) status!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ type: String, nullable: true }) committedAt!: string | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: [ReadingPreviewRowDto] }) rows!: ReadingPreviewRowDto[];
}
export class ReadingCommitInputDto {
  @ApiProperty({ enum: [true] }) acknowledgeWarnings!: boolean;
}
export class ReadingCommitDto {
  @ApiProperty() importId!: string;
  @ApiProperty() importedReadings!: number;
  @ApiProperty() alreadyCommitted!: boolean;
}
export class TrendPointDto {
  @ApiProperty() measuredAt!: string;
  @ApiProperty() localMeasuredAt!: string;
  @ApiProperty({ type: Number, nullable: true }) hotTempC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) coldTempC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) pressureBar!: number | null;
}
export class ReadingRecordDto {
  @ApiProperty() sourceId!: string;
  @ApiProperty() sourceRow!: number;
  @ApiProperty() importId!: string;
  @ApiProperty() measuredAt!: string;
  @ApiProperty() localMeasuredAt!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty() demoShift!: string;
  @ApiProperty() hotTempC!: number;
  @ApiProperty() coldTempC!: number;
  @ApiProperty() pressureBar!: number;
  @ApiProperty() filename!: string;
  @ApiProperty() sheet!: string;
  @ApiProperty() workbookHash!: string;
}
export class ReadingStatisticDto {
  @ApiProperty({ enum: ["hotTempC", "coldTempC", "pressureBar"] }) key!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() low!: number;
  @ApiProperty() high!: number;
  @ApiProperty({ type: Number, nullable: true }) min!: number | null;
  @ApiProperty({ type: Number, nullable: true }) max!: number | null;
  @ApiProperty({ type: Number, nullable: true }) mean!: number | null;
  @ApiProperty() reviewCount!: number;
}
export class ReadingReviewDto {
  @ApiProperty() parameter!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() low!: number;
  @ApiProperty() high!: number;
  @ApiProperty({ enum: ["BELOW", "ABOVE"] }) direction!: string;
  @ApiProperty() firstMeasuredAt!: string;
  @ApiProperty() lastMeasuredAt!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty() samples!: number;
  @ApiProperty({ enum: ["ISOLATED", "CONSECUTIVE"] }) kind!: string;
}
export class ReadingImportHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() sheet!: string;
  @ApiProperty() workbookHash!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty() observations!: number;
}
export class ReadingTrendsDto {
  @ApiProperty({ enum: ["SYNTHETIC"] }) source!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() hasData!: boolean;
  @ApiProperty() observations!: number;
  @ApiProperty() expectedHours!: number;
  @ApiProperty() missingHours!: number;
  @ApiProperty() reviewObservations!: number;
  @ApiProperty({ type: String, nullable: true }) latestMeasuredAt!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) lastReceivedAt!: string | null;
  @ApiProperty({ type: [TrendPointDto] }) points!: TrendPointDto[];
  @ApiProperty({ type: [ReadingStatisticDto] })
  statistics!: ReadingStatisticDto[];
  @ApiProperty({ type: [ReadingReviewDto] }) reviews!: ReadingReviewDto[];
  @ApiProperty({ type: [ReadingRecordDto] }) rows!: ReadingRecordDto[];
  @ApiProperty({ type: [ReadingImportHistoryDto] })
  imports!: ReadingImportHistoryDto[];
}
