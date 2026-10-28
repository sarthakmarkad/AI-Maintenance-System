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
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import { validated } from "../production/service";
import type { Principal } from "../repository";
import { GenerateRcaDto, RcaHistoryDto, RcaReceiptDto } from "./dto";
import { generateRcaSchema } from "./policy";
import { RcaService } from "./service";
@ApiTags("AI RCA drafting")
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/work-orders/:id/rca-drafts")
export class RcaController {
  constructor(@Inject(RcaService) private readonly service: RcaService) {}
  @Post()
  @HttpCode(200)
  @Roles(Role.TECHNICIAN)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: GenerateRcaDto })
  @ApiOkResponse({ type: RcaReceiptDto })
  generate(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(
      user,
      code,
      validated(z.string().uuid(), id),
      validated(generateRcaSchema, body),
    );
  }
  @Get()
  @ApiQuery({ name: "before", required: false, type: String })
  @ApiOkResponse({ type: RcaHistoryDto })
  list(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Query() raw: unknown,
  ) {
    const query = validated(
      z.object({ before: z.string().uuid().optional() }).strict(),
      raw,
    );
    return this.service.list(
      user,
      code,
      validated(z.string().uuid(), id),
      query.before,
    );
  }
}
