import { ApiProperty } from "@nestjs/swagger";
export class DocumentAiIndexDto {
  @ApiProperty() documentId!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() fileNumber!: number;
  @ApiProperty({ type: String, nullable: true }) indexId!: string | null;
  @ApiProperty({
    enum: ["QUEUED", "PROCESSING", "READY", "FAILED", "INACTIVE"],
  })
  status!: string;
  @ApiProperty({ type: Number, nullable: true }) pages!: number | null;
  @ApiProperty({ type: Number, nullable: true }) chunks!: number | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
}
export class DocumentAiStatusDto {
  @ApiProperty({ enum: ["commandcode", "openai"] }) provider!: string;
  @ApiProperty() embeddingModel!: string;
  @ApiProperty() configured!: boolean;
  @ApiProperty() canManage!: boolean;
  @ApiProperty() approved!: number;
  @ApiProperty() ready!: number;
  @ApiProperty({ type: [DocumentAiIndexDto] }) items!: DocumentAiIndexDto[];
}
export class DocumentAiCitationDto {
  @ApiProperty() sourceId!: string;
  @ApiProperty() quote!: string;
}
export class DocumentAiStatementDto {
  @ApiProperty() text!: string;
  @ApiProperty({ type: [DocumentAiCitationDto] })
  citations!: DocumentAiCitationDto[];
}
export class DocumentAiSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() documentId!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() fileNumber!: number;
  @ApiProperty() documentVersion!: number;
  @ApiProperty() approvalId!: string;
  @ApiProperty() page!: number;
  @ApiProperty() text!: string;
}
export class DocumentAiCoverageDto {
  @ApiProperty({ required: false }) omittedStatements?: number;
  @ApiProperty() approved!: number;
  @ApiProperty() ready!: number;
  @ApiProperty({
    required: false,
    enum: ["FULL_INDEXED_REFERENCE", "EXCERPTS"],
  })
  scope?: string;
  @ApiProperty({ required: false }) referenceTitle?: string;
  @ApiProperty({ required: false, type: [Number] }) pages?: number[];
  @ApiProperty({ required: false }) totalPages?: number;
}
export class DocumentAiReferenceDto {
  @ApiProperty({ required: false }) kind?: string;
  @ApiProperty() documentId!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() approvalId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() fileNumber!: number;
}
export class DocumentAiAnswerDto {
  @ApiProperty({
    enum: [
      "ANSWERED",
      "GENERAL_ANSWER",
      "REFERENCE_LIST",
      "REFERENCE_EXCERPTS",
      "CLARIFICATION",
      "GUIDANCE",
      "SOURCE_CHANGED",
      "INSUFFICIENT_EVIDENCE",
      "CONFLICTING_SOURCES",
      "NO_APPROVED_DOCUMENTS",
      "INDEXING_REQUIRED",
    ],
  })
  status!: string;
  @ApiProperty({ required: false }) reason?: string;
  @ApiProperty({ required: false, type: [DocumentAiReferenceDto] })
  references?: DocumentAiReferenceDto[];
  @ApiProperty() message!: string;
  @ApiProperty() policy!: string;
  @ApiProperty({ type: [DocumentAiStatementDto] })
  statements!: DocumentAiStatementDto[];
  @ApiProperty({ type: [DocumentAiSourceDto] }) sources!: DocumentAiSourceDto[];
  @ApiProperty({ type: DocumentAiCoverageDto })
  coverage!: DocumentAiCoverageDto;
}
export class DocumentAiRetryDto {
  @ApiProperty() queued!: boolean;
}
export class DocumentChatSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() turns!: number;
  @ApiProperty() updatedAt!: string;
}
export class DocumentChatListDto {
  @ApiProperty({ type: [DocumentChatSummaryDto] })
  items!: DocumentChatSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class DocumentChatTurnDto {
  @ApiProperty() id!: string;
  @ApiProperty() ordinal!: number;
  @ApiProperty() question!: string;
  @ApiProperty() at!: string;
  @ApiProperty({ type: DocumentAiAnswerDto }) answer!: DocumentAiAnswerDto;
}
export class DocumentChatDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [DocumentChatTurnDto] }) turns!: DocumentChatTurnDto[];
  @ApiProperty({ type: Number, nullable: true }) before!: number | null;
}
export class DocumentChatReceiptDto {
  @ApiProperty() chatId!: string;
  @ApiProperty({ type: DocumentChatTurnDto }) turn!: DocumentChatTurnDto;
  @ApiProperty() alreadyApplied!: boolean;
}
