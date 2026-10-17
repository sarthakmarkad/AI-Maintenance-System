import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
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
import { MAX_FILE_BYTES } from "../production/parser";
import { validated } from "../production/service";
import { ReadingsService, readingCommit, trendQuery } from "./service";
import {
  ReadingCommitDto,
  ReadingCommitInputDto,
  ReadingPreviewDto,
  ReadingTrendsDto,
} from "./dto";
const importers = [Role.ADMINISTRATOR, Role.MAINTENANCE_HEAD, Role.SUPERVISOR];
@ApiTags("Synthetic process readings")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/readings")
export class ReadingsController {
  constructor(
    @Inject(ReadingsService) private readonly service: ReadingsService,
  ) {}
  @Post("previews")
  @Roles(...importers)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiCreatedResponse({ type: ReadingPreviewDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  preview(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    validated(z.object({}).strict(), body);
    if (!file)
      throw new BadRequestException("Choose a synthetic .xlsx workbook.");
    return this.service.preview(user, code, file.buffer, file.originalname);
  }
  @Get("previews/:id")
  @Roles(...importers)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: ReadingPreviewDto })
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
  @ApiBody({ type: ReadingCommitInputDto })
  @ApiCreatedResponse({ type: ReadingCommitDto })
  @ApiResponse({ status: 409, type: ErrorDto })
  @ApiResponse({ status: 410, type: ErrorDto })
  commit(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    validated(readingCommit, body);
    return this.service.commit(user, code, validated(z.string().uuid(), id));
  }
  @Get("trends")
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
    example: "2026-09-14",
  })
  @ApiOkResponse({ type: ReadingTrendsDto })
  trends(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.trends(user, code, validated(trendQuery, query));
  }
}
