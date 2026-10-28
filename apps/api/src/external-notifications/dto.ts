import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
export class ExternalNotificationPreferenceInputDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({
    minimum: 0,
    description: "Last loaded preference version; zero before enrollment.",
  })
  version!: number;
  @ApiProperty({ format: "uuid", description: "Retain on an identical retry." })
  requestId!: string;
}
export class ExternalNotificationPreferenceDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Only the signed-in recipient's verified destination.",
  })
  destination!: string | null;
  @ApiProperty({ type: String, nullable: true }) enabledAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) verifiedAt!: string | null;
}
export class ExternalNotificationAttemptDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() attempt!: number;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) code!: string | null;
  @ApiProperty() at!: string;
  @ApiProperty() late!: boolean;
}
export class ExternalNotificationDeliveryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) eventId!: string;
  @ApiProperty({ format: "uuid" }) orderId!: string;
  @ApiProperty() action!: string;
  @ApiProperty() eventAt!: string;
  @ApiProperty({ enum: ["PENDING", "SENDING", "SENT", "FAILED", "SUPPRESSED"] })
  status!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty({ type: String, nullable: true }) code!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: String, nullable: true }) nextAttemptAt!: string | null;
  @ApiProperty({ type: [ExternalNotificationAttemptDto] })
  attempts!: ExternalNotificationAttemptDto[];
}
export class ExternalNotificationSettingsDto {
  @ApiProperty() supported!: boolean;
  @ApiProperty() configured!: boolean;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ type: ExternalNotificationPreferenceDto })
  preference!: ExternalNotificationPreferenceDto;
  @ApiProperty({ type: [ExternalNotificationDeliveryDto] })
  deliveries!: ExternalNotificationDeliveryDto[];
}
