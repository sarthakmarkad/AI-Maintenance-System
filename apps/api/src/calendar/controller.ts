import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import {
  CalendarService,
  calendarQuery,
  planInput,
  planState,
  releaseInput,
  reminderQuery,
  skipInput,
} from "./service";
import {
  CalendarDto,
  PlanDto,
  PlanInputDto,
  PlansDto,
  PlanStateDto,
  ReleaseTaskDto,
  ReleasedTaskDto,
  ReminderReadDto,
  RemindersDto,
  SkippedTaskDto,
  SkipTaskDto,
} from "./dto";
@ApiTags("Planned maintenance")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/calendar")
export class CalendarController {
  constructor(
    @Inject(CalendarService) private readonly service: CalendarService,
  ) {}
  @Get()
  @ApiQuery({ name: "from", required: true })
  @ApiQuery({ name: "to", required: true })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "SKIPPED", "CANCELLED"],
  })
  @ApiQuery({ name: "after", required: false })
  @ApiOkResponse({ type: CalendarDto })
  calendar(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Query() q: unknown,
  ) {
    return this.service.calendar(u, code, validated(calendarQuery, q));
  }
  @Get("plans") @ApiOkResponse({ type: PlansDto }) plans(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
  ) {
    return this.service.plans(u, code);
  }
  @Post("plans")
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiBody({ type: PlanInputDto })
  @ApiCreatedResponse({ type: PlanDto })
  create(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Body() b: unknown,
  ) {
    return this.service.create(u, code, validated(planInput, b));
  }
  @Post("plans/:id/state")
  @HttpCode(200)
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: PlanStateDto })
  @ApiOkResponse({ type: PlanDto })
  state(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.service.state(
      u,
      code,
      validated(z.string().uuid(), id),
      validated(planState, b),
    );
  }
  @Post("occurrences/:id/release")
  @HttpCode(200)
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: ReleaseTaskDto })
  @ApiOkResponse({ type: ReleasedTaskDto })
  release(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.service.release(
      u,
      code,
      validated(z.string().uuid(), id),
      validated(releaseInput, b),
    );
  }
  @Post("occurrences/:id/skip")
  @HttpCode(200)
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: SkipTaskDto })
  @ApiOkResponse({ type: SkippedTaskDto })
  skip(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.service.skip(
      u,
      code,
      validated(z.string().uuid(), id),
      validated(skipInput, b),
    );
  }
  @Get("reminders")
  @ApiQuery({ name: "after", required: false })
  @ApiOkResponse({ type: RemindersDto })
  reminders(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Query() q: unknown,
  ) {
    return this.service.reminders(u, code, validated(reminderQuery, q));
  }
  @Post("reminders/:id/read")
  @HttpCode(200)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: ReminderReadDto })
  read(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    validated(z.object({}).strict(), b);
    return this.service.read(u, code, validated(z.string().uuid(), id));
  }
}
