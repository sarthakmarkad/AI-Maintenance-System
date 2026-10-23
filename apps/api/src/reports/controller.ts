import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import type { Response } from "express";
import { finalize } from "rxjs";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { ErrorDto } from "../dto";
import { validated } from "../production/service";
import { ReportsService } from "./service";
import { reportQuery, exportQuery, detailExportQuery } from "./model";
import { ReportPreviewDto } from "./dto";
@Injectable()
export class ReportExportLimit implements NestInterceptor {
  private readonly active = new Set<string>();
  intercept(context: ExecutionContext, next: CallHandler) {
    const user = context
      .switchToHttp()
      .getRequest<{ principal: Principal }>().principal;
    if (this.active.size >= 2 || this.active.has(user.userId))
      throw new HttpException(
        "Another report is being generated. Try again shortly.",
        429,
      );
    this.active.add(user.userId);
    return next.handle().pipe(
      finalize(() => {
        this.active.delete(user.userId);
      }),
    );
  }
}
@ApiTags("Maintenance reports")
@ApiBearerAuth()
@ApiParam({ name: "code", example: "WH-C" })
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 422, type: ErrorDto })
@ApiResponse({ status: 429, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/reports")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly service: ReportsService,
  ) {}
  @Get("preview")
  @ApiQuery({
    name: "report",
    enum: ["work-orders", "planned-maintenance", "investigations"],
    required: false,
  })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "basis", enum: ["created", "closed"], required: false })
  @ApiQuery({
    name: "status",
    enum: ["ALL", "OPEN", "CLOSED"],
    required: false,
  })
  @ApiQuery({
    name: "kind",
    enum: ["BREAKDOWN", "PLANNED", "INVESTIGATION"],
    required: false,
  })
  @ApiOkResponse({ type: ReportPreviewDto })
  preview(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.preview(user, code, validated(reportQuery, query));
  }
  @Get("export")
  @UseInterceptors(ReportExportLimit)
  @ApiQuery({ name: "format", enum: ["pdf", "xlsx"] })
  @ApiQuery({
    name: "fingerprint",
    required: false,
    description: "Expected preview fingerprint; stale source returns 409.",
  })
  @ApiQuery({
    name: "report",
    enum: ["work-orders", "planned-maintenance", "investigations"],
    required: false,
  })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "basis", enum: ["created", "closed"], required: false })
  @ApiQuery({
    name: "status",
    enum: ["ALL", "OPEN", "CLOSED"],
    required: false,
  })
  @ApiQuery({
    name: "kind",
    enum: ["BREAKDOWN", "PLANNED", "INVESTIGATION"],
    required: false,
  })
  @ApiProduces(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async export(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const { format, fingerprint, ...q } = validated(exportQuery, query),
      s = await this.service.snapshot(user, code, q);
    this.send(
      response,
      await this.service.export(user, code, s, format, fingerprint),
      format,
    );
  }
  @Get("work-orders/:id/export")
  @UseInterceptors(ReportExportLimit)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiQuery({ name: "format", enum: ["pdf", "xlsx"] })
  @ApiQuery({
    name: "version",
    type: Number,
    description: "Expected current work-order version.",
  })
  @ApiProduces(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async detail(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Query() query: unknown,
    @Res() response: Response,
  ) {
    const q = validated(detailExportQuery, query),
      s = await this.service.detail(
        user,
        code,
        validated(z.string().uuid(), id),
        q.version,
      );
    this.send(
      response,
      await this.service.export(user, code, s, q.format),
      q.format,
    );
  }
  private send(
    response: Response,
    result: { bytes: Buffer; filename: string },
    format: "pdf" | "xlsx",
  ) {
    response.setHeader(
      "Content-Type",
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    response.setHeader("Content-Length", result.bytes.length);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'",
    );
    response.end(result.bytes);
  }
}
