import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { z } from "zod";
import { CONFIG, type Config } from "./config";
import { REPOSITORY, type Principal, type Repository } from "./repository";
export const VERIFIER = Symbol("IDENTITY_VERIFIER");
export interface IdentityVerifier {
  verify(token: string): Promise<string>;
}
export type AuthenticatedRequest = Request & {
  principal?: Principal;
  requestId: string;
};
@Injectable()
export class SupabaseVerifier implements IdentityVerifier {
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
  async verify(token: string) {
    if (!this.client)
      throw new ServiceUnavailableException(
        "Supabase authentication is not configured.",
      );
    try {
      // getUser contacts the configured Auth server. Never decode-and-trust browser claims.
      const { data, error } = await this.client.auth.getUser(token);
      if (error) {
        if (!error.status || error.status >= 500)
          throw new ServiceUnavailableException(
            "Authentication service is unavailable. Try again.",
          );
        throw new UnauthorizedException(
          "Your session is invalid or expired. Sign in again.",
        );
      }
      if (!data.user || !z.string().uuid().safeParse(data.user.id).success)
        throw new UnauthorizedException("Invalid authenticated identity.");
      return data.user.id;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        "Authentication service is unavailable. Try again.",
      );
    }
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(VERIFIER) private readonly verifier: IdentityVerifier,
    @Inject(REPOSITORY) private readonly repo: Repository,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer ([^\s,]+)$/i);
    if (!match || match[1].length > 8192)
      throw new UnauthorizedException("Sign in to access this resource.");
    const id = await this.verifier.verify(match[1]);
    const requested = req.headers["x-workspace-role"];
    const selected =
      requested === undefined
        ? undefined
        : z.nativeEnum(Role).safeParse(requested);
    if (selected && !selected.success)
      throw new ForbiddenException("Choose an authorized workspace role.");
    const requestedRole = selected?.success ? selected.data : undefined;
    const principal = await this.repo.principal(id, requestedRole);
    if (!principal)
      throw new ForbiddenException(
        "Your account has no active application membership. Contact your administrator.",
      );
    if (requestedRole && principal.role !== requestedRole)
      throw new ForbiddenException("This role is not granted to your account.");
    req.principal = principal;
    return true;
  }
}
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().principal;
    if (!principal || !roles || !roles.includes(principal.role))
      throw new ForbiddenException("Your role cannot access this operation.");
    return true;
  }
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal!,
);
