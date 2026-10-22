import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
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
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import {
  AnomaliesService,
  anomalyQuery,
  reviewHistoryQuery,
  reviewInput,
  investigationInput,
} from "./service";
import {
  AnomalyListDto,
  AnomalyReceiptDto,
  AnomalyReviewInputDto,
  AnomalyHistoryDto,
  OpenInvestigationDto,
} from "./dto";
@ApiTags("Statistical pattern review")
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
@Controller("machines/:code/readings/anomalies")
export class AnomaliesController {
  constructor(
    @Inject(AnomaliesService) private readonly service: AnomaliesService,
  ) {}
  @Get()
  @ApiQuery({ name: "from", required: false, type: String })
  @ApiQuery({ name: "to", required: false, type: String })
  @ApiQuery({
    name: "parameter",
    required: false,
    enum: ["hotTempC", "coldTempC", "pressureBar"],
  })
  @ApiQuery({
    name: "kind",
    required: false,
    enum: ["SUDDEN_CHANGE", "SUSTAINED_SHIFT", "DRIFT"],
  })
  @ApiQuery({ name: "status", required: false, enum: ["PENDING", "REVIEWED"] })
  @ApiQuery({ name: "after", required: false, type: String })
  @ApiOkResponse({ type: AnomalyListDto })
  list(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.list(user, code, validated(anomalyQuery, query));
  }
  @Post("reviews")
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiBody({ type: AnomalyReviewInputDto })
  @ApiCreatedResponse({ type: AnomalyReceiptDto })
  review(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.review(user, code, validated(reviewInput, body));
  }
  @Post("reviews/:id/investigation")
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: OpenInvestigationDto })
  @ApiCreatedResponse({ type: AnomalyReceiptDto })
  openInvestigation(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.openInvestigation(
      user,
      code,
      id,
      validated(investigationInput, body).technicianId,
    );
  }
  @Get("reviews")
  @ApiQuery({ name: "after", required: false, type: String })
  @ApiOkResponse({ type: AnomalyHistoryDto })
  history(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.history(
      user,
      code,
      validated(reviewHistoryQuery, query).after,
    );
  }
}
