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
import { Role, WorkOrderStatus } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import {
  WorkOrdersService,
  reportSchema,
  listQuery,
  historyQuery,
  actionName,
  actionSchemas,
} from "./service";
import {
  EligibleTechniciansDto,
  ReportWorkOrderDto,
  WorkOrderActionDto,
  WorkOrderDto,
  WorkOrderHistoryDto,
  WorkOrderListDto,
  WorkOrderReportedDto,
} from "./dto";
@ApiTags("Maintenance work orders")
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
@Controller("machines/:code/work-orders")
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly service: WorkOrdersService,
  ) {}
  @Post()
  @Roles(Role.OPERATOR)
  @ApiBody({ type: ReportWorkOrderDto })
  @ApiCreatedResponse({ type: WorkOrderReportedDto })
  report(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.report(u, code, validated(reportSchema, body));
  }
  @Get()
  @ApiQuery({ name: "status", required: false, enum: WorkOrderStatus })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "after", required: false, type: String })
  @ApiOkResponse({ type: WorkOrderListDto })
  list(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Query() q: unknown,
  ) {
    return this.service.list(u, code, validated(listQuery, q));
  }
  @Get("technicians")
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiOkResponse({ type: EligibleTechniciansDto })
  technicians(@CurrentUser() u: Principal, @Param("code") code: string) {
    return this.service.technicians(u, code);
  }
  @Get(":id")
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: WorkOrderDto })
  get(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
  ) {
    return this.service.get(u, code, validated(z.string().uuid(), id));
  }
  @Get(":id/history")
  @ApiParam({ name: "id", format: "uuid" })
  @ApiQuery({ name: "beforeVersion", required: false, type: Number })
  @ApiOkResponse({ type: WorkOrderHistoryDto })
  history(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    const input = validated(historyQuery, q);
    return this.service.history(
      u,
      code,
      validated(z.string().uuid(), id),
      input.beforeVersion,
    );
  }
  @Post(":id/actions/:action")
  @HttpCode(200)
  @Roles(Role.MAINTENANCE_HEAD, Role.TECHNICIAN, Role.SUPERVISOR)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "action", enum: actionName.options })
  @ApiBody({ type: WorkOrderActionDto })
  @ApiOkResponse({ type: WorkOrderDto })
  act(
    @CurrentUser() u: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() body: unknown,
  ) {
    const name = validated(actionName, action);
    const input = validated(
      actionSchemas[name] as z.ZodTypeAny,
      body,
    ) as Record<string, unknown>;
    return this.service.act(
      u,
      code,
      validated(z.string().uuid(), id),
      name,
      input,
    );
  }
}
