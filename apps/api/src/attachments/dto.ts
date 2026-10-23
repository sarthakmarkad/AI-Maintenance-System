import { ApiProperty } from "@nestjs/swagger";
import { Role, WorkOrderStatus } from "@prisma/client";
export class AttachmentUploaderDto {
  @ApiProperty() userId!: string;
  @ApiProperty() displayName!: string;
}
export class AttachmentDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() orderVersion!: number;
  @ApiProperty() filename!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ["image/jpeg", "image/png", "application/pdf"] })
  mediaType!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ type: AttachmentUploaderDto })
  uploader!: AttachmentUploaderDto;
  @ApiProperty({ enum: Role }) actorRole!: string;
  @ApiProperty({ enum: WorkOrderStatus }) status!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class AttachmentReceiptDto {
  @ApiProperty({ type: AttachmentDto }) attachment!: AttachmentDto;
  @ApiProperty() alreadyUploaded!: boolean;
}
