import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  NestInterceptor,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpException,
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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { finalize } from "rxjs";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { validated } from "../production/service";
import { ErrorDto } from "../dto";
import { AttachmentsService, uploadSchema } from "./service";
import { AttachmentReceiptDto } from "./dto";
import { MAX_ATTACHMENT_BYTES } from "./policy";
@Injectable()
export class AttachmentUploadLimit implements NestInterceptor {
  private readonly active = new Map<string, number>();
  private total = 0;
  intercept(context: ExecutionContext, next: CallHandler) {
    const user = context
      .switchToHttp()
      .getRequest<{ principal: Principal }>().principal;
    if (this.total >= 4 || (this.active.get(user.userId) ?? 0) >= 2)
      throw new HttpException(
        "Another file upload is in progress. Try again shortly.",
        429,
      );
    this.total++;
    this.active.set(user.userId, (this.active.get(user.userId) ?? 0) + 1);
    return next.handle().pipe(
      finalize(() => {
        this.total--;
        const n = (this.active.get(user.userId) ?? 1) - 1;
        if (n) this.active.set(user.userId, n);
        else this.active.delete(user.userId);
      }),
    );
  }
}
@ApiTags("Work-order attachments")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiParam({ name: "orderId", format: "uuid" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/work-orders/:orderId/attachments")
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly service: AttachmentsService,
  ) {}
  @Post()
  @Roles(Role.OPERATOR, Role.TECHNICIAN)
  @UseInterceptors(
    AttachmentUploadLimit,
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        files: 1,
        fileSize: MAX_ATTACHMENT_BYTES,
        fields: 3,
        parts: 4,
        fieldSize: 4096,
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: AttachmentReceiptDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiResponse({ status: 429, type: ErrorDto })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "requestId", "version", "description"],
      properties: {
        file: { type: "string", format: "binary" },
        requestId: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
        description: { type: "string", minLength: 3, maxLength: 1000 },
      },
    },
  })
  upload(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const id = validated(z.string().uuid(), orderId),
      input = validated(uploadSchema, body);
    if (!file)
      throw new BadRequestException(
        "Choose one JPEG, PNG or PDF in the file field.",
      );
    return this.service.upload(user, code, id, input, file);
  }
  @Get(":id/download")
  @ApiParam({ name: "id", format: "uuid" })
  @ApiProduces("application/octet-stream")
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async download(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("orderId") orderId: string,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const file = await this.service.download(
      user,
      code,
      validated(z.string().uuid(), orderId),
      validated(z.string().uuid(), id),
    );
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="maintenance-attachment.${file.mediaType === "application/pdf" ? "pdf" : file.mediaType === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", file.byteSize);
    response.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'",
    );
    response.end(Buffer.from(file.content));
  }
}
