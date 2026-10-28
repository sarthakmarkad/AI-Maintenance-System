import { ApiProperty } from "@nestjs/swagger";
export class RcaHumanFieldsDto {
  @ApiProperty({
    maxLength: 4000,
    description:
      "Current unsubmitted human inspection text, or empty. Not independent verification.",
  })
  findings!: string;
  @ApiProperty({ maxLength: 4000 }) rootCause!: string;
  @ApiProperty({ maxLength: 4000 }) correctiveAction!: string;
  @ApiProperty({ maxLength: 4000 }) preventiveAction!: string;
}
export class GenerateRcaDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Stable key for exact retries of this payload; never automatically repeats a provider call.",
  })
  requestId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: RcaHumanFieldsDto }) human!: RcaHumanFieldsDto;
}
export class RcaSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() attribution!: string;
  @ApiProperty() text!: string;
  @ApiProperty({
    enum: ["ORIGINAL_REPORT", "RETAINED_HISTORY", "CURRENT_HUMAN_INPUT"],
  })
  origin!: string;
  @ApiProperty({ type: String, nullable: true }) eventId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) eventVersion!: number | null;
  @ApiProperty({ type: String, nullable: true }) recordedAt!: string | null;
}
export class RcaReportEvidenceDto {
  @ApiProperty() priority!: string;
  @ApiProperty() impact!: string;
  @ApiProperty() reportedBy!: string;
  @ApiProperty() reportedAt!: string;
  @ApiProperty({ type: String, nullable: true }) observedAt!: string | null;
}
export class RcaHistoryEvidenceDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() action!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty() actorRole!: string;
  @ApiProperty() at!: string;
}
export class RcaSnapshotDto {
  @ApiProperty() policy!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() kind!: string;
  @ApiProperty() machineCode!: string;
  @ApiProperty() capturedAt!: string;
  @ApiProperty({ type: RcaReportEvidenceDto }) report!: RcaReportEvidenceDto;
  @ApiProperty({ type: [RcaHistoryEvidenceDto] })
  history!: RcaHistoryEvidenceDto[];
  @ApiProperty({ type: [RcaSourceDto] }) sources!: RcaSourceDto[];
  @ApiProperty() coverage!: string;
}
export class RcaAdvisoryDto {
  @ApiProperty() text!: string;
  @ApiProperty({ type: [String] }) sourceIds!: string[];
}
export class RcaDraftDto {
  @ApiProperty({ enum: ["LIMITED_EVIDENCE", "INSUFFICIENT_EVIDENCE"] })
  status!: string;
  @ApiProperty({ type: [String] }) factSourceIds!: string[];
  @ApiProperty({ type: [RcaSourceDto] }) facts!: RcaSourceDto[];
  @ApiProperty({ type: [RcaAdvisoryDto] }) hypotheses!: RcaAdvisoryDto[];
  @ApiProperty({ type: [RcaAdvisoryDto] }) missingChecks!: RcaAdvisoryDto[];
  @ApiProperty({ type: [RcaAdvisoryDto] })
  correctiveProposals!: RcaAdvisoryDto[];
  @ApiProperty({ type: [RcaAdvisoryDto] })
  preventiveProposals!: RcaAdvisoryDto[];
  @ApiProperty({ type: RcaHumanFieldsDto }) proposed!: RcaHumanFieldsDto;
  @ApiProperty() limitations!: string;
}
export class RcaReceiptDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() sourceHash!: string;
  @ApiProperty() model!: string;
  @ApiProperty() policy!: string;
  @ApiProperty() requestedBy!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) completedAt!: string | null;
  @ApiProperty({ enum: ["GENERATED", "FAILED", "STALE", "PENDING"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: RcaDraftDto, nullable: true })
  draft!: RcaDraftDto | null;
  @ApiProperty({ type: RcaSnapshotDto }) snapshot!: RcaSnapshotDto;
  @ApiProperty() stale!: boolean;
}
export class RcaHistoryDto {
  @ApiProperty({ type: [RcaReceiptDto] }) items!: RcaReceiptDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
