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
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import { ErrorDto } from "../dto";
import type { Principal } from "../repository";
import { validated } from "../production/service";
import {
  NotificationsService,
  notificationQuery,
  notificationRead,
} from "./service";
import { WorkOrderNotificationReadDto, WorkOrderNotificationsDto } from "./dto";

@ApiTags("Work-order notifications")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/work-order-notifications")
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly service: NotificationsService,
  ) {}
  @Get()
  @ApiQuery({ name: "after", required: false, format: "uuid" })
  @ApiOkResponse({ type: WorkOrderNotificationsDto })
  list(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.list(user, code, validated(notificationQuery, query));
  }
  @Post(":id/read")
  @HttpCode(200)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ schema: { type: "object", additionalProperties: false } })
  @ApiOkResponse({ type: WorkOrderNotificationReadDto })
  read(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    validated(notificationRead, body);
    return this.service.read(user, code, validated(z.string().uuid(), id));
  }
}
