import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import {
  AuthGuard,
  CurrentUser,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from "../auth";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import type { Principal } from "../repository";
import {
  ExternalNotificationPreferenceInputDto,
  ExternalNotificationSettingsDto,
} from "./dto";
import { preferenceInput } from "./policy";
import { ExternalNotificationsService } from "./service";
@ApiTags("External work-order notifications")
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
@Controller("machines/:code/external-notifications")
export class ExternalNotificationsController {
  constructor(
    @Inject(ExternalNotificationsService)
    private readonly service: ExternalNotificationsService,
  ) {}
  @Get()
  @ApiOkResponse({ type: ExternalNotificationSettingsDto })
  settings(@CurrentUser() user: Principal, @Param("code") code: string) {
    return this.service.settings(user, code);
  }
  @Put("preference")
  @HttpCode(200)
  @ApiBody({ type: ExternalNotificationPreferenceInputDto })
  @ApiOkResponse({ type: ExternalNotificationSettingsDto })
  save(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.save(
      user,
      code,
      validated(preferenceInput, body),
      req.headers.authorization!.replace(/^Bearer /i, ""),
    );
  }
}
