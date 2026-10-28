import type { Response } from "express";
import { XLSX_TYPE, templateMonth } from "../imports/templates";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import { ErrorDto } from "../dto";
import type { Principal } from "../repository";
import { MAX_FILE_BYTES } from "./parser";
import {
  ProductionService,
  commitSchema,
  dashboardQuery,
  sourceSchema,
  validated,
} from "./service";
import {
  CommitProductionDto,
  ProductionCommitDto,
  ProductionDashboardDto,
  ProductionPreviewDto,
  WorkbookInfoDto,
} from "./dto";
const upload = () =>
  FileInterceptor("file", {
    storage: memoryStorage(),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 1024,
    },
  });
const importers = [Role.ADMINISTRATOR, Role.MAINTENANCE_HEAD, Role.SUPERVISOR];
function fileData(file: Express.Multer.File | undefined) {
  if (!file)
    throw new BadRequestException(
      "Choose an .xlsx workbook in the file field.",
    );
  return file;
}
@ApiTags("Production")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/production")
export class ProductionController {
  constructor(
    @Inject(ProductionService) private readonly service: ProductionService,
  ) {}
  @Get("template")
  @ApiProduces(XLSX_TYPE)
  @Roles(...importers)
  @ApiQuery({
    name: "month",
    required: false,
    type: String,
    description: "YYYY-MM; defaults to the current IST month.",
  })
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async template(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() raw: unknown,
    @Res() response: Response,
  ) {
    const input = validated(
      z
        .object({
          month: z
            .string()
            .regex(/^(?:20[0-9]{2}|2100)-(?:0[1-9]|1[0-2])$/)
            .optional(),
        })
        .strict(),
      raw,
    );
    const month = input.month ?? templateMonth();
    const bytes = await this.service.template(user, code, month);
    response
      .type(XLSX_TYPE)
      .attachment(`${code}-production-${month}.xlsx`)
      .send(bytes);
  }
  @Post("inspect")
  @Roles(...importers)
  @UseInterceptors(upload())
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: WorkbookInfoDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  inspect(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    validated(z.object({}).strict(), body);
    const data = fileData(file);
    return this.service.inspect(user, code, data.buffer, data.originalname);
  }
  @Post("previews")
  @Roles(...importers)
  @UseInterceptors(upload())
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: ProductionPreviewDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "sheet", "source"],
      properties: {
        file: { type: "string", format: "binary" },
        sheet: { type: "string" },
        source: { type: "string", enum: ["AUTHENTIC", "SYNTHETIC"] },
      },
    },
  })
  preview(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    const input = validated(
      z
        .object({ sheet: z.string().min(1).max(100), source: sourceSchema })
        .strict(),
      body,
    );
    const data = fileData(file);
    return this.service.preview(
      user,
      code,
      data.buffer,
      data.originalname,
      input.sheet,
      input.source,
    );
  }
  @Get("previews/:id")
  @Roles(...importers)
  @ApiOkResponse({ type: ProductionPreviewDto })
  @ApiParam({ name: "id", format: "uuid" })
  getPreview(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
  ) {
    return this.service.getPreview(
      user,
      code,
      validated(z.string().uuid(), id),
    );
  }
  @Post("previews/:id/commit")
  @Roles(...importers)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ type: CommitProductionDto })
  @ApiCreatedResponse({ type: ProductionCommitDto })
  @ApiResponse({ status: 409, type: ErrorDto })
  @ApiResponse({ status: 410, type: ErrorDto })
  commit(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.commit(
      user,
      code,
      validated(z.string().uuid(), id),
      validated(commitSchema, body),
    );
  }
  @Get("dashboard")
  @ApiOkResponse({ type: ProductionDashboardDto })
  @ApiQuery({
    name: "source",
    required: false,
    enum: ["AUTHENTIC", "SYNTHETIC"],
  })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    example: "2026-09-01",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    example: "2026-09-30",
  })
  dashboard(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.dashboard(user, code, validated(dashboardQuery, query));
  }
}
