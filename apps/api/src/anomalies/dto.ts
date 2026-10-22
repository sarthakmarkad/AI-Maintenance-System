import { ApiProperty } from "@nestjs/swagger";
import { WorkOrderStatus } from "@prisma/client";
export class AnomalySampleDto {
  @ApiProperty() id!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() sourceRow!: number;
  @ApiProperty() importId!: string;
  @ApiProperty() measuredAt!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty() value!: number;
}
export class AnomalyReceiptDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty({ enum: ["INVESTIGATE", "DISMISSED"] }) decision!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() reviewedBy!: string;
  @ApiProperty() reviewerName!: string;
  @ApiProperty({ enum: ["MAINTENANCE_HEAD"] }) actorRole!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) workOrderId!: string | null;
  @ApiProperty({ type: String, enum: WorkOrderStatus, nullable: true })
  workOrderStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) technicianId!: string | null;
}
export class AnomalyEvidenceDto {
  @ApiProperty() key!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty({ enum: ["hotTempC", "coldTempC", "pressureBar"] })
  parameter!: string;
  @ApiProperty({ enum: ["SUDDEN_CHANGE", "SUSTAINED_SHIFT", "DRIFT"] })
  kind!: string;
  @ApiProperty({ enum: ["UP", "DOWN"] }) direction!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() measuredAt!: string;
  @ApiProperty() availableAt!: string;
  @ApiProperty() value!: number;
  @ApiProperty() baselineMedian!: number;
  @ApiProperty() baselineMad!: number;
  @ApiProperty() scale!: number;
  @ApiProperty() threshold!: number;
  @ApiProperty() change!: number;
  @ApiProperty({ type: Number, nullable: true }) slope!: number | null;
  @ApiProperty({ type: [AnomalySampleDto] }) baseline!: AnomalySampleDto[];
  @ApiProperty({ type: [AnomalySampleDto] }) samples!: AnomalySampleDto[];
}
export class AnomalyFlagDto extends AnomalyEvidenceDto {
  @ApiProperty({ type: AnomalyReceiptDto, nullable: true })
  review!: AnomalyReceiptDto | null;
}
export class AnomalyMarkerDto {
  @ApiProperty({ enum: ["hotTempC", "coldTempC", "pressureBar"] })
  parameter!: string;
  @ApiProperty() measuredAt!: string;
  @ApiProperty() value!: number;
}
export class AnomalyEligibilityDto {
  @ApiProperty() SUDDEN_CHANGE!: number;
  @ApiProperty() SUSTAINED_SHIFT!: number;
  @ApiProperty() DRIFT!: number;
}
export class AnomalyListDto {
  @ApiProperty({ enum: ["SYNTHETIC"] }) source!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() evaluatedAt!: string;
  @ApiProperty() canReview!: boolean;
  @ApiProperty() observations!: number;
  @ApiProperty({ type: AnomalyEligibilityDto })
  eligible!: AnomalyEligibilityDto;
  @ApiProperty() insufficientHistory!: number;
  @ApiProperty() total!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() reviewed!: number;
  @ApiProperty() matching!: number;
  @ApiProperty({ type: [AnomalyMarkerDto] }) markers!: AnomalyMarkerDto[];
  @ApiProperty({ type: [AnomalyFlagDto] }) items!: AnomalyFlagDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class AnomalyReviewInputDto {
  @ApiProperty({ pattern: "^[0-9a-f]{64}$" }) key!: string;
  @ApiProperty({ format: "date-time" }) measuredAt!: string;
  @ApiProperty({ enum: ["INVESTIGATE", "DISMISSED"] }) decision!: string;
  @ApiProperty({ minLength: 3, maxLength: 2000 }) reason!: string;
  @ApiProperty({
    required: false,
    format: "uuid",
    description:
      "Optional explicit combined review/open action for INVESTIGATE; otherwise open from the saved review. Rejected for dismissals.",
  })
  technicianId?: string;
}
export class OpenInvestigationDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Active technician with machine access. Exact retries return the existing order; reassignment uses the versioned order action.",
  })
  technicianId!: string;
}
export class AnomalyHistoryItemDto extends AnomalyReceiptDto {
  @ApiProperty({ type: AnomalyEvidenceDto }) evidence!: AnomalyEvidenceDto;
}
export class AnomalyHistoryDto {
  @ApiProperty() canOpenInvestigation!: boolean;
  @ApiProperty({ type: [AnomalyHistoryItemDto] })
  items!: AnomalyHistoryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
