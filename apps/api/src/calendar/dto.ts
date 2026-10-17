import { ApiProperty } from "@nestjs/swagger";
import {
  MaintenanceFrequency,
  MaintenanceReminderKind,
  WorkOrderPriority,
} from "@prisma/client";
import { WorkOrderPersonDto } from "../work-orders/dto";
export class PlanInputDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ minLength: 3, maxLength: 160 }) title!: string;
  @ApiProperty({ minLength: 3, maxLength: 4000 }) instructions!: string;
  @ApiProperty({ enum: MaintenanceFrequency }) frequency!: string;
  @ApiProperty({ minimum: 1, maximum: 12 }) interval!: number;
  @ApiProperty({
    format: "date-time",
    description:
      "Explicit offset timestamp; recurrence follows Asia/Kolkata fixed calendar dates. Monthly anchor days clamp without drifting.",
  })
  firstDueAt!: string;
  @ApiProperty({ format: "uuid" }) technicianId!: string;
  @ApiProperty({ enum: WorkOrderPriority }) priority!: string;
  @ApiProperty({ minimum: 1, maximum: 14 }) remindDays!: number;
}
export class PlanDto extends PlanInputDto {
  @ApiProperty() technicianName!: string;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) pauseReason!: string | null;
  @ApiProperty() nextSequence!: number;
  @ApiProperty({ format: "date-time" }) nextDueAt!: string;
  @ApiProperty({ type: String, nullable: true }) lastGeneratedAt!:
    | string
    | null;
  @ApiProperty() catchingUp!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
export class PlansDto {
  @ApiProperty({ type: [PlanDto] }) items!: PlanDto[];
  @ApiProperty() canManage!: boolean;
}
export class PlanStateDto {
  @ApiProperty() version!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ minLength: 3, maxLength: 4000 }) reason!: string;
}
export class ReleaseTaskDto {
  @ApiProperty() version!: number;
  @ApiProperty({ format: "uuid" }) technicianId!: string;
}
export class ReleasedTaskDto {
  @ApiProperty({ format: "uuid" }) orderId!: string;
  @ApiProperty() alreadyReleased!: boolean;
}
export class SkipTaskDto {
  @ApiProperty() version!: number;
  @ApiProperty({ minLength: 3, maxLength: 4000 }) reason!: string;
}
export class SkippedTaskDto {
  @ApiProperty() skipped!: boolean;
}
export class CalendarOccurrenceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) planId!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() title!: string;
  @ApiProperty() instructions!: string;
  @ApiProperty({ format: "date-time" }) dueAt!: string;
  @ApiProperty({ enum: WorkOrderPriority }) priority!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: WorkOrderPersonDto }) technician!: WorkOrderPersonDto;
  @ApiProperty({ type: String, nullable: true }) workOrderId!: string | null;
  @ApiProperty({ type: String, nullable: true }) workOrderStatus!:
    | string
    | null;
  @ApiProperty({ enum: ["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "SKIPPED"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) skippedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) skipReason!: string | null;
  @ApiProperty() planActive!: boolean;
}
export class ScheduleStatusDto {
  @ApiProperty({ type: String, nullable: true }) lastJobAt!: string | null;
  @ApiProperty() failed!: boolean;
  @ApiProperty() catchingUp!: boolean;
}
export class CalendarDto {
  @ApiProperty({ type: [CalendarOccurrenceDto] })
  items!: CalendarOccurrenceDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({ type: "object", additionalProperties: { type: "integer" } })
  counts!: Record<string, number>;
  @ApiProperty({ type: "object", additionalProperties: { type: "integer" } })
  dayCounts!: Record<string, number>;
  @ApiProperty() canManage!: boolean;
  @ApiProperty() serverTime!: string;
  @ApiProperty({ type: ScheduleStatusDto }) scheduling!: ScheduleStatusDto;
}
export class ReminderDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: MaintenanceReminderKind }) kind!: string;
  @ApiProperty({ format: "uuid" }) occurrenceId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: "date-time" }) dueAt!: string;
  @ApiProperty({ type: String, nullable: true }) orderId!: string | null;
  @ApiProperty() read!: boolean;
  @ApiProperty() createdAt!: string;
}
export class RemindersDto {
  @ApiProperty() unread!: number;
  @ApiProperty({ type: [ReminderDto] }) items!: ReminderDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class ReminderReadDto {
  @ApiProperty() read!: boolean;
}
