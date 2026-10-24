import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
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
import { FileInterceptor } from "@nestjs/platform-express";
import { Role } from "@prisma/client";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { validated } from "../production/service";
import { AttachmentUploadLimit } from "../attachments/controller";
import { ErrorDto } from "../dto";
import {
  DocumentsService,
  actionSchema,
  draftSchema,
  listSchema,
} from "./service";
import {
  DocumentLibraryDto,
  DocumentReceiptDto,
  MachineDocumentDto,
} from "./dto";
import { MAX_DOCUMENT_BYTES } from "./policy";
const idSchema = z.string().uuid();
const upload = FileInterceptor("file", {
  storage: memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_DOCUMENT_BYTES,
    fields: 6,
    parts: 7,
    fieldSize: 4096,
  },
});
const uploadBody = {
  schema: {
    type: "object" as const,
    required: ["file", "requestId", "version", "title", "kind", "description"],
    properties: {
      file: { type: "string" as const, format: "binary" },
      requestId: { type: "string" as const, format: "uuid" },
      version: { type: "integer" as const, minimum: 0 },
      title: { type: "string" as const, minLength: 3, maxLength: 160 },
      kind: { type: "string" as const, enum: ["MANUAL", "SOP"] },
      description: { type: "string" as const, minLength: 3, maxLength: 1000 },
    },
  },
};
@ApiTags("Machine document library")
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
@Controller("machines/:code/documents")
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly service: DocumentsService,
  ) {}
  @Get()
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 10,
  })
  @ApiQuery({ name: "q", required: false, maxLength: 160 })
  @ApiQuery({ name: "kind", required: false, enum: ["ALL", "MANUAL", "SOP"] })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["ALL", "CURRENT", "DRAFT", "WITHDRAWN"],
  })
  @ApiOkResponse({ type: DocumentLibraryDto })
  list(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.list(user, code, validated(listSchema, query));
  }
  @Get(":id")
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: MachineDocumentDto })
  detail(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
  ) {
    return this.service.detail(user, code, validated(idSchema, id));
  }
  @Post()
  @Roles(Role.ADMINISTRATOR, Role.MAINTENANCE_HEAD)
  @UseInterceptors(AttachmentUploadLimit, upload)
  @ApiConsumes("multipart/form-data")
  @ApiBody(uploadBody)
  @ApiCreatedResponse({ type: DocumentReceiptDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiResponse({ status: 429, type: ErrorDto })
  create(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("Choose one PDF file.");
    return this.service.upload(
      user,
      code,
      null,
      validated(draftSchema, body),
      file,
    );
  }
  @Post(":id/versions")
  @ApiParam({ name: "id", format: "uuid" })
  @Roles(Role.ADMINISTRATOR, Role.MAINTENANCE_HEAD)
  @UseInterceptors(AttachmentUploadLimit, upload)
  @ApiConsumes("multipart/form-data")
  @ApiBody(uploadBody)
  @ApiCreatedResponse({ type: DocumentReceiptDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiResponse({ status: 429, type: ErrorDto })
  revision(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("Choose one PDF file.");
    return this.service.upload(
      user,
      code,
      validated(idSchema, id),
      validated(draftSchema, body),
      file,
    );
  }
  @Post(":id/actions/:action")
  @ApiParam({ name: "id", format: "uuid" })
  @HttpCode(200)
  @Roles(Role.MAINTENANCE_HEAD)
  @ApiParam({ name: "action", enum: ["approve", "withdraw"] })
  @ApiBody({
    schema: {
      type: "object",
      required: ["requestId", "version", "fileId", "reason"],
      properties: {
        requestId: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
        fileId: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 3, maxLength: 1000 },
      },
    },
  })
  @ApiOkResponse({ type: DocumentReceiptDto })
  action(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() body: unknown,
  ) {
    return this.service.action(
      user,
      code,
      validated(idSchema, id),
      validated(z.enum(["approve", "withdraw"]), action) === "approve"
        ? "APPROVE"
        : "WITHDRAW",
      validated(actionSchema, body),
    );
  }
  @Get(":id/versions/:fileId/download")
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "fileId", format: "uuid" })
  @ApiProduces("application/octet-stream")
  @ApiQuery({ name: "version", type: Number, minimum: 1 })
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async download(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const { version } = validated(
      z.object({ version: z.coerce.number().int().positive() }).strict(),
      query,
    );
    const file = await this.service.download(
      user,
      code,
      validated(idSchema, id),
      validated(idSchema, fileId),
      version,
    );
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="machine-reference.pdf"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'",
    );
    response.setHeader("Content-Length", file.byteSize);
    response.end(Buffer.from(file.content));
  }
}
