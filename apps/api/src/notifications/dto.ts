import { ApiProperty } from "@nestjs/swagger";
export class WorkOrderNotificationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) orderId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ["BREAKDOWN", "PLANNED", "INVESTIGATION"] })
  kind!: string;
  @ApiProperty({
    enum: ["REPORT", "ASSIGN", "SCHEDULE", "INVESTIGATE", "SUBMIT", "RETURN"],
  })
  action!: string;
  @ApiProperty() eventVersion!: number;
  @ApiProperty() actorName!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: "date-time" }) readAt!:
    | string
    | null;
}
export class WorkOrderNotificationsDto {
  @ApiProperty() unread!: number;
  @ApiProperty({ type: [WorkOrderNotificationDto] })
  items!: WorkOrderNotificationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class WorkOrderNotificationReadDto {
  @ApiProperty() read!: boolean;
  @ApiProperty({ format: "date-time" }) readAt!: string;
}
