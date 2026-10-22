import { ApiProperty } from "@nestjs/swagger";
import {
  WorkOrderStatus,
  WorkOrderPriority,
  ReportedImpact,
  Role,
  WorkOrderKind,
  InvestigationOutcome,
} from "@prisma/client";
import { AnomalyEvidenceDto } from "../anomalies/dto";
export class WorkOrderPersonDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty() displayName!: string;
}
export class WorkOrderEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({
    enum: [
      "REPORT",
      "SCHEDULE",
      "INVESTIGATE",
      "ASSIGN",
      "START",
      "SUBMIT",
      "APPROVE",
      "RETURN",
      "CLOSE",
    ],
  })
  action!: string;
  @ApiProperty({ type: String, enum: WorkOrderStatus, nullable: true })
  fromStatus!: string | null;
  @ApiProperty({ enum: WorkOrderStatus }) toStatus!: string;
  @ApiProperty({ type: WorkOrderPersonDto }) actor!: WorkOrderPersonDto;
  @ApiProperty({ enum: Role }) actorRole!: string;
  @ApiProperty({ format: "date-time" }) at!: string;
  @ApiProperty({ type: "object", additionalProperties: true }) detail!: Record<
    string,
    unknown
  >;
}
export class WorkOrderSummaryDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  anomalyReviewId!: string | null;
  @ApiProperty({ enum: WorkOrderKind }) kind!: string;
  @ApiProperty({ type: () => WorkOrderOccurrenceDto, nullable: true })
  maintenanceOccurrence!: WorkOrderOccurrenceDto | null;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: WorkOrderStatus }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: WorkOrderPriority }) priority!: string;
  @ApiProperty({ enum: ReportedImpact }) impact!: string;
  @ApiProperty({ format: "date-time" }) reportedAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  observedAt!: string | null;
  @ApiProperty({ type: WorkOrderPersonDto }) reporter!: WorkOrderPersonDto;
  @ApiProperty({ type: WorkOrderPersonDto, nullable: true })
  technician!: WorkOrderPersonDto | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  restoredAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  closedAt!: string | null;
  @ApiProperty({
    type: [String],
    enum: ["assign", "start", "submit", "approve", "return", "close"],
  })
  allowedActions!: string[];
}
export class WorkOrderInvestigationDto {
  @ApiProperty() id!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: WorkOrderPersonDto }) reviewer!: WorkOrderPersonDto;
  @ApiProperty({ type: AnomalyEvidenceDto }) evidence!: AnomalyEvidenceDto;
}
export class WorkOrderDto extends WorkOrderSummaryDto {
  @ApiProperty({ type: String, enum: InvestigationOutcome, nullable: true })
  investigationOutcome!: string | null;
  @ApiProperty({ type: WorkOrderInvestigationDto, nullable: true })
  investigationReview!: WorkOrderInvestigationDto | null;
  @ApiProperty({ type: String, nullable: true }) performedAt!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) startedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) findings!: string | null;
  @ApiProperty({ type: String, nullable: true }) rootCause!: string | null;
  @ApiProperty({ type: String, nullable: true }) correctiveAction!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) preventiveAction!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) submittedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) returnReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) reviewedAt!: string | null;
  @ApiProperty({ type: WorkOrderPersonDto, nullable: true })
  reviewer!: WorkOrderPersonDto | null;
  @ApiProperty({ type: WorkOrderPersonDto, nullable: true })
  closer!: WorkOrderPersonDto | null;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: [WorkOrderEventDto] }) events!: WorkOrderEventDto[];
  @ApiProperty({ type: Number, nullable: true }) historyNextVersion!:
    | number
    | null;
}
export class WorkOrderReportedDto extends WorkOrderDto {
  @ApiProperty() alreadyReported!: boolean;
}
export class WorkOrderListDto {
  @ApiProperty({ type: [WorkOrderSummaryDto] }) items!: WorkOrderSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({ type: "object", additionalProperties: { type: "integer" } })
  counts!: Record<string, number>;
  @ApiProperty() total!: number;
}
export class WorkOrderHistoryDto {
  @ApiProperty({ type: [WorkOrderEventDto] }) items!: WorkOrderEventDto[];
  @ApiProperty({ type: Number, nullable: true }) nextBeforeVersion!:
    | number
    | null;
}
export class EligibleTechniciansDto {
  @ApiProperty({ type: [WorkOrderPersonDto] }) items!: WorkOrderPersonDto[];
}
export class ReportWorkOrderDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Stable client retry key for one report; same key with changed content conflicts.",
  })
  requestId!: string;
  @ApiProperty({ minLength: 3, maxLength: 160 }) title!: string;
  @ApiProperty({ minLength: 3, maxLength: 4000 }) description!: string;
  @ApiProperty({ enum: WorkOrderPriority }) priority!: string;
  @ApiProperty({ enum: ReportedImpact }) impact!: string;
  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    required: false,
    description:
      "Optional explicitly observed time; never inferred from imported data.",
  })
  observedAt?: string | null;
}
export class WorkOrderActionDto {
  @ApiProperty({
    required: false,
    enum: InvestigationOutcome,
    description:
      "INVESTIGATION submit only; required. Maintenance/sensor follow-up outcomes also require preventiveAction with next steps.",
  })
  investigationOutcome?: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({
    required: false,
    format: "uuid",
    description: "assign only; active in-org technician with machine grant",
  })
  technicianId?: string;
  @ApiProperty({
    required: false,
    description:
      "Required for return and for reassignment; 3–4,000 characters.",
  })
  reason?: string;
  @ApiProperty({
    required: false,
    description: "Required on submit; 3–4,000 characters.",
  })
  findings?: string;
  @ApiProperty({
    required: false,
    description:
      "Required on BREAKDOWN submit only; human RCA, 3–4,000 characters. Rejected for planned maintenance and investigations.",
  })
  rootCause?: string;
  @ApiProperty({
    required: false,
    description:
      "Required on submit; corrective action for breakdowns, checks/work performed for planned maintenance and investigations; 3–4,000 characters.",
  })
  correctiveAction?: string;
  @ApiProperty({
    required: false,
    description:
      "Required on BREAKDOWN submit; optional planned/investigation follow-up (mandatory for maintenance/sensor investigation outcomes); 3–4,000 characters when provided.",
  })
  preventiveAction?: string;
  @ApiProperty({
    required: false,
    format: "date-time",
    description:
      "BREAKDOWN submit only; explicit offset timestamp between report and submission. Rejected for planned maintenance and investigations.",
  })
  restoredAt?: string;
  @ApiProperty({
    required: false,
    format: "date-time",
    description:
      "PLANNED/INVESTIGATION submission only; explicit completion time between creation and submission. Findings/work performed are required; breakdown RCA/restoration fields are rejected.",
  })
  performedAt?: string;
  @ApiProperty({
    required: false,
    description:
      "approve/close only; optional 3–4,000-character note. Extra fields for each action are rejected.",
  })
  note?: string;
}
export class WorkOrderOccurrenceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) planId!: string;
  @ApiProperty({ format: "date-time" }) dueAt!: string;
}
