import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { WorkOrderKind, WorkOrderStatus } from "@prisma/client";
import { ScheduleStatusDto } from "../calendar/dto";
export class PerformanceCountDto {
  @ApiProperty() key!: string;
  @ApiProperty() count!: number;
}
export class PerformanceCohortDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [PerformanceCountDto] })
  statuses!: PerformanceCountDto[];
  @ApiProperty({ type: [PerformanceCountDto] }) kinds!: PerformanceCountDto[];
}
export class PerformanceActivityDto {
  @ApiProperty() date!: string;
  @ApiProperty() created!: number;
  @ApiProperty() closed!: number;
}
export class PerformanceOpenOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: WorkOrderKind }) kind!: string;
  @ApiProperty({ enum: WorkOrderStatus }) status!: string;
  @ApiProperty() reportedAt!: string;
  @ApiProperty() ageHours!: number;
  @ApiProperty({ type: String, nullable: true }) technicianName!: string | null;
}
export class PerformanceCurrentDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: Number, nullable: true }) overduePlanned!: number | null;
  @ApiProperty({ type: [PerformanceCountDto] })
  statuses!: PerformanceCountDto[];
  @ApiProperty({ type: Number, nullable: true }) oldestAgeHours!: number | null;
  @ApiProperty({ type: Number, nullable: true }) myOpen!: number | null;
  @ApiProperty({ type: [PerformanceOpenOrderDto] })
  items!: PerformanceOpenOrderDto[];
}
export class PerformancePlannedDto {
  @ApiPropertyOptional() cancelled?: number;
  @ApiProperty() applicable!: boolean;
  @ApiProperty() due!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() eligible!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() onTime!: number;
  @ApiProperty() late!: number;
  @ApiProperty() open!: number;
  @ApiProperty({ type: Number, nullable: true }) completionPercent!:
    | number
    | null;
  @ApiProperty({ type: Number, nullable: true }) onTimePercent!: number | null;
  @ApiProperty({ type: ScheduleStatusDto }) scheduling!: ScheduleStatusDto;
}
export class PerformanceOutcomeDto extends PerformanceCountDto {
  @ApiProperty() approvedOrClosed!: number;
}
export class PerformanceInvestigationsDto {
  @ApiProperty() total!: number;
  @ApiProperty() unsubmitted!: number;
  @ApiProperty() legacyUnrecorded!: number;
  @ApiProperty({ type: [PerformanceOutcomeDto] })
  outcomes!: PerformanceOutcomeDto[];
}
export class PerformanceDto {
  @ApiProperty() policyVersion!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: String, enum: WorkOrderKind, nullable: true }) kind!:
    | string
    | null;
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ type: PerformanceCohortDto }) cohort!: PerformanceCohortDto;
  @ApiProperty({ type: PerformanceCurrentDto }) current!: PerformanceCurrentDto;
  @ApiProperty({ type: [PerformanceActivityDto] })
  activity!: PerformanceActivityDto[];
  @ApiProperty() closedInRange!: number;
  @ApiProperty({ type: PerformancePlannedDto }) planned!: PerformancePlannedDto;
  @ApiProperty({ type: PerformanceInvestigationsDto })
  investigations!: PerformanceInvestigationsDto;
}
