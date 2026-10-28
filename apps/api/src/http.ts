import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
export const requestLog = new Logger("HTTP");
export function correlation(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header("x-request-id");
  const requestId =
    supplied && /^[a-zA-Z0-9_-]{1,64}$/.test(supplied)
      ? supplied
      : randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("Cache-Control", "no-store");
  const start = performance.now();
  res.on("finish", () =>
    requestLog.log({
      event: "request",
      requestId,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
    }),
  );
  // Never log URL queries, authorization headers, passwords or payloads.
  next();
}
@Catch()
export class Errors implements ExceptionFilter {
  private readonly logger = new Logger("Errors");
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const req = host
      .switchToHttp()
      .getRequest<Request & { requestId: string }>();
    const bodyError =
      error instanceof Error && "type" in error ? String(error.type) : "";
    const archivedWrite =
      !(error instanceof HttpException) &&
      error instanceof Error &&
      /Archived machines are read only|Restore the machine before changing/.test(
        error.message,
      );
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : archivedWrite
          ? 409
          : bodyError === "entity.parse.failed"
            ? 400
            : bodyError === "entity.too.large"
              ? 413
              : 503;
    const details =
      error instanceof HttpException ? error.getResponse() : undefined;
    if (typeof details === "object" && details && "status" in details) {
      response.status(status).json({ ...details, requestId: req.requestId });
      return;
    }
    const message = archivedWrite
      ? "This machine was archived before your change could be saved. Refresh the workspace."
      : bodyError === "entity.parse.failed"
        ? "Request body must contain valid JSON."
        : bodyError === "entity.too.large"
          ? "Request body exceeds the 64 KB limit."
          : typeof details === "object" && details && "message" in details
            ? details.message
            : typeof details === "string"
              ? details
              : "A required service is unavailable. Please try again.";
    if (!(error instanceof HttpException))
      this.logger.error({
        event: "dependency_failure",
        requestId: req.requestId,
        type: error instanceof Error ? error.name : "Unknown",
      });
    response
      .status(status)
      .json({ statusCode: status, message, requestId: req.requestId });
  }
}
