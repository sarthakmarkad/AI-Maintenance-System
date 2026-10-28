import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { z } from "zod";
import { CONFIG, type Config } from "../config";
export const NOTIFICATION_CONTACT = Symbol("NOTIFICATION_VERIFIED_CONTACT");
export interface VerifiedContactResolver {
  resolve(token: string, authenticatedId: string): Promise<string>;
}
export function verifiedContact(
  user: Pick<User, "id" | "email" | "email_confirmed_at"> | null,
  authenticatedId: string,
) {
  if (
    !user ||
    user.id !== authenticatedId ||
    !z.string().uuid().safeParse(user.id).success
  )
    throw new UnauthorizedException(
      "The verified contact does not match your signed-in identity.",
    );
  if (
    !user.email_confirmed_at ||
    !z.iso.datetime({ offset: true }).safeParse(user.email_confirmed_at)
      .success ||
    !z.email().max(254).safeParse(user.email).success ||
    /[\r\n]/.test(user.email ?? "")
  )
    throw new ForbiddenException(
      "Confirm your account email with the configured sign-in provider before enabling email notifications.",
    );
  // Preserve the provider's exact confirmed address; never use profile metadata.
  return user.email!;
}
@Injectable()
export class SupabaseNotificationContactResolver
  implements VerifiedContactResolver
{
  private readonly client?: SupabaseClient;
  constructor(@Inject(CONFIG) config: Config) {
    if (config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY)
      this.client = createClient(
        config.SUPABASE_URL,
        config.SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: {
            fetch: (input, init) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
          },
        },
      );
  }
  async resolve(token: string, authenticatedId: string) {
    if (!this.client)
      throw new ServiceUnavailableException(
        "Verified email lookup is not configured.",
      );
    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error) {
        if (!error.status || error.status >= 500)
          throw new ServiceUnavailableException(
            "Verified email lookup is unavailable. Try again.",
          );
        throw new UnauthorizedException(
          "Your session is invalid or expired. Sign in again.",
        );
      }
      return verifiedContact(data.user, authenticatedId);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        "Verified email lookup is unavailable. Try again.",
      );
    }
  }
}
