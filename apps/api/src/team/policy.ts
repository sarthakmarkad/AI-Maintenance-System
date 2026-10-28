import type { Config } from "../config";
import { emailConfigured } from "../external-notifications/policy";
// The Resend account-only onboarding sender cannot deliver staff invitations.
export const staffEmailConfigured = (config: Config) =>
  emailConfigured(config) &&
  !config.NOTIFICATION_EMAIL_FROM?.toLowerCase().endsWith("@resend.dev");
