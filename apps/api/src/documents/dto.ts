import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
export class DocumentFileDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty() filename!: string;
  @ApiProperty() description!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ enum: ["CURRENT", "DRAFT", "SUPERSEDED", "WITHDRAWN"] })
  status!: string;
}
export class DocumentEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() revision!: number;
  @ApiProperty({ enum: ["UPLOAD", "APPROVE", "WITHDRAW"] }) action!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty() actorName!: string;
  @ApiProperty({ enum: Role }) actorRole!: string;
  @ApiProperty({ format: "date-time" }) at!: string;
}
export class MachineDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ["MANUAL", "SOP"] }) kind!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) currentFileId!: string | null;
  @ApiProperty({ type: [DocumentFileDto] }) files!: DocumentFileDto[];
  @ApiProperty({ type: [DocumentEventDto] }) events!: DocumentEventDto[];
}
export class DocumentLibraryDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: [MachineDocumentDto] }) items!: MachineDocumentDto[];
  @ApiProperty() canManage!: boolean;
  @ApiProperty() canApprove!: boolean;
  @ApiProperty() maxBytes!: number;
  @ApiProperty() maxDocuments!: number;
  @ApiProperty() maxVersions!: number;
}
export class DocumentReceiptDto {
  @ApiProperty() documentId!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() revision!: number;
  @ApiProperty() alreadyApplied!: boolean;
}
