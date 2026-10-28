import { Role } from "@prisma/client";
import { z } from "zod";
import type { Config } from "../config";
import type { NotificationAction } from "../notifications/service";

// The intersection permits independent integration while Config remains parent-owned.
export type EmailConfig = Config & {
  EXTERNAL_NOTIFICATIONS_ENABLED?: "true" | "false";
  NOTIFICATION_EMAIL_PROVIDER?: "resend";
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL_FROM?: string;
};
export const MAX_ATTEMPTS = 6;
export const LEASE_SECONDS = 90;
export const RETRY_HORIZON_MS = 20 * 60 * 60 * 1000;
export const preferenceInput = z
  .object({
    enabled: z.boolean(),
    version: z.number().int().min(0).max(2147483646),
    requestId: z.string().uuid(),
  })
  .strict();
export type PreferenceInput = z.output<typeof preferenceInput>;
export const supportsEmail = (role: Role) =>
  role === Role.TECHNICIAN || role === Role.MAINTENANCE_HEAD;
export function emailConfigured(config: EmailConfig) {
  return (
    config.EXTERNAL_NOTIFICATIONS_ENABLED === "true" &&
    config.NOTIFICATION_EMAIL_PROVIDER === "resend" &&
    Boolean(config.RESEND_API_KEY?.trim()) &&
    z.email().max(254).safeParse(config.NOTIFICATION_EMAIL_FROM).success &&
    !/[\r\n]/.test(config.NOTIFICATION_EMAIL_FROM ?? "")
  );
}
export function retryDelay(attempt: number, retryAfterSeconds = 0) {
  return Math.max(
    Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600),
    Math.min(3600, Math.max(0, retryAfterSeconds)),
  );
}
export type EmailPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
const actionText: Record<NotificationAction, string> = {
  REPORT: "A breakdown report needs technician assignment.",
  ASSIGN: "A work order has been assigned to you.",
  SCHEDULE: "Planned maintenance has been released to you.",
  INVESTIGATE:
    "An investigation has been released to you. Synthetic evidence does not establish a fault cause.",
  SUBMIT: "A work order is awaiting maintenance-head review.",
  RETURN: "A work order has been returned to you for updated findings.",
};
export function emailPayload(input: {
  from: string;
  destination: string;
  origin: string;
  orderId: string;
  machineCode?: string;
  action: NotificationAction;
  at: Date;
}): EmailPayload {
  // Only fixed text, the immutable reference, event instant and configured origin.
  // Never include report titles, symptoms, attachments, human RCA or AI output.
  const origin = new URL(input.origin);
  if (
    origin.origin !== input.origin ||
    !["http:", "https:"].includes(origin.protocol) ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname)) ||
    !z.string().uuid().safeParse(input.orderId).success ||
    !/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(input.machineCode ?? "WH-C") ||
    !actionText[input.action] ||
    !z.email().safeParse(input.destination).success ||
    !z.email().safeParse(input.from).success
  )
    throw new Error("Notification template configuration is invalid.");
  const instant = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(input.at);
  return {
    from: input.from,
    to: [input.destination],
    subject: `${input.machineCode ?? "WH-C"} work-order action`,
    text: `${actionText[input.action]}\n\nWork order: ${input.orderId}\nEvent: ${instant} IST\nOpen: ${origin.origin}/machines/${input.machineCode ?? "WH-C"}/work-orders/${input.orderId}\n\nSign in using your authorized role. Current access and workflow state apply.\nEmail preferences: ${origin.origin}/machines/${input.machineCode ?? "WH-C"}/notification-settings\n`,
  };
}
