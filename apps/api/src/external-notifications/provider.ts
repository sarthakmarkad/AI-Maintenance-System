import { Inject, Injectable } from "@nestjs/common";
import { CONFIG } from "../config";
import { emailConfigured, type EmailConfig, type EmailPayload } from "./policy";
export const NOTIFICATION_EMAIL = Symbol("NOTIFICATION_EMAIL_PROVIDER");
export type DeliveryResult =
  | { outcome: "SENT"; providerId: string }
  | { outcome: "RETRY" | "FAILED"; code: string; retryAfterSeconds?: number };
export interface NotificationEmailProvider {
  send(id: string, payload: EmailPayload): Promise<DeliveryResult>;
}
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
@Injectable()
export class ResendNotificationEmailProvider
  implements NotificationEmailProvider
{
  constructor(@Inject(CONFIG) private readonly config: EmailConfig) {}
  async send(id: string, payload: EmailPayload): Promise<DeliveryResult> {
    if (!emailConfigured(this.config))
      return { outcome: "FAILED", code: "NOT_CONFIGURED" };
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${this.config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `maintenance-email/${id}`,
        },
        body: JSON.stringify(payload),
      });
      // Never persist or log the provider's arbitrary response/error strings.
      if (!response.ok) {
        let code = "PROVIDER_REJECTED",
          retry = response.status === 429 || response.status >= 500;
        if (response.status === 409) {
          // Only a concurrent in-flight duplicate is retryable; changed-body conflicts are terminal.
          const body = await boundedJson(response);
          retry = body?.name === "concurrent_idempotent_requests";
          code = retry ? "PROVIDER_BUSY" : "IDEMPOTENCY_CONFLICT";
        } else
          code =
            response.status === 429
              ? "RATE_LIMITED"
              : response.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_REJECTED";
        const value = response.headers.get("retry-after");
        const seconds =
          value && /^\d{1,6}$/.test(value)
            ? Math.min(3600, Number(value))
            : undefined;
        await response.body?.cancel().catch(() => {});
        return {
          outcome: retry ? "RETRY" : "FAILED",
          code,
          retryAfterSeconds: seconds,
        };
      }
      const data = await boundedJson(response);
      if (
        !data ||
        typeof data.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)
      )
        return { outcome: "RETRY", code: "INVALID_PROVIDER_RESPONSE" };
      return { outcome: "SENT", providerId: data.id };
    } catch {
      return { outcome: "RETRY", code: "NETWORK_UNCERTAIN" };
    }
  }
}
async function boundedJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return null;
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
