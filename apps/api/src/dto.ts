import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Role } from "@prisma/client";
export class ErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() requestId!: string;
}
export class MeDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "uuid" }) membershipId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: "uuid" }) orgId!: string;
  @ApiProperty() organization!: string;
  @ApiProperty({ enum: Role, enumName: "Role" }) role!: Role;
  @ApiProperty({
    enum: Role,
    isArray: true,
    description:
      "Trusted active roles this account may select. Permissions apply only to the selected role.",
  })
  availableRoles!: Role[];
}
export class NamedDto {
  @ApiProperty() name!: string;
}
export class MachinePhotoSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
}
export class MachineDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" })
  archivedAt?: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) archiveReason?:
    | string
    | null;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "WH-C" }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) manufacturer!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({
    example: "NOT_MONITORED",
    description: "Registry status, not live telemetry.",
  })
  operationalStatus!: string;
  @ApiProperty({ type: NamedDto, nullable: true }) department!: NamedDto | null;
  @ApiProperty({ type: NamedDto, nullable: true }) location!: NamedDto | null;
  @ApiPropertyOptional({ type: MachinePhotoSummaryDto, nullable: true })
  photo?: MachinePhotoSummaryDto | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date;
}
export class MachinesDto {
  @ApiProperty({ type: [MachineDto] }) items!: MachineDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class HealthDto {
  @ApiProperty({ enum: ["ok", "ready", "not_ready"] }) status!: string;
  @ApiPropertyOptional({ enum: ["connected", "unavailable"] })
  database?: string;
  @ApiPropertyOptional({
    enum: ["configured", "unconfigured"],
    description: "Configuration only; not a provider connectivity check.",
  })
  authentication?: string;
}
