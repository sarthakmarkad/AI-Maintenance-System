import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role, WorkOrderKind } from "@prisma/client";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import { PerformanceDto } from "./dto";
import { PerformanceService, performanceQuery } from "./service";
@ApiTags("Maintenance performance")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/performance")
export class PerformanceController {
  constructor(
    @Inject(PerformanceService) private readonly service: PerformanceService,
  ) {}
  @Get()
  @ApiQuery({
    name: "from",
    type: String,
    required: false,
    description:
      "Inclusive IST creation/due/activity date. Both dates required together; max 366 days.",
  })
  @ApiQuery({
    name: "to",
    type: String,
    required: false,
    description:
      "Inclusive IST date, not beyond today. Current backlog ignores these dates.",
  })
  @ApiQuery({ name: "kind", enum: WorkOrderKind, required: false })
  @ApiOkResponse({ type: PerformanceDto })
  dashboard(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.dashboard(
      user,
      code,
      validated(performanceQuery, query),
    );
  }
}
