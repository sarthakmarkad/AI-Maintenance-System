import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Inject,
  UseGuards,
  UnauthorizedException,
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { z } from "zod";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  VERIFIER,
  type IdentityVerifier,
} from "../auth";
import type { Principal } from "../repository";
import {
  NOTIFICATION_CONTACT,
  type VerifiedContactResolver,
} from "../external-notifications/contact";
import { validated } from "../production/service";
import { TeamService } from "./service";
import {
  InviteStaffDto,
  UpdateStaffDto,
  TeamActionDto,
  StaffListDto,
  TeamInvitationsDto,
  TeamReceiptDto,
  TeamInvitationTokenDto,
  AcceptTeamInvitationDto,
  TeamInvitationDto,
  TeamAcceptanceDto,
} from "./dto";
const id = (value: string) => validated(z.string().uuid(), value);
function bearer(req: Request) {
  const match = req.headers.authorization?.match(/^Bearer ([^\s,]+)$/i);
  if (!match || match[1].length > 8192)
    throw new UnauthorizedException("Sign in to accept your invitation.");
  return match[1];
}
@Injectable()
export class TeamPublicLimit implements CanActivate {
  private readonly requests = new Map<
    string,
    { start: number; count: number }
  >();
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>(),
      key = req.ip ?? "unknown",
      now = Date.now();
    for (const [k, v] of this.requests)
      if (now - v.start >= 60000) this.requests.delete(k);
    const v = this.requests.get(key);
    if ((v && v.count >= 60) || (!v && this.requests.size >= 5000))
      throw new HttpException(
        "Too many invitation checks. Try again shortly.",
        429,
      );
    this.requests.set(
      key,
      v ? { ...v, count: v.count + 1 } : { start: now, count: 1 },
    );
    return true;
  }
}
@ApiTags("Team")
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMINISTRATOR)
@Controller("team")
export class TeamController {
  constructor(
    @Inject(TeamService) private readonly service: TeamService,
    @Inject(NOTIFICATION_CONTACT)
    private readonly contacts: VerifiedContactResolver,
  ) {}
  @Get("members")
  @ApiOkResponse({ type: StaffListDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "q", required: false, type: String })
  members(@CurrentUser() user: Principal, @Query() q: unknown) {
    return this.service.members(user, q);
  }
  @Get("invitations")
  @ApiOkResponse({ type: TeamInvitationsDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "q", required: false, type: String })
  invitations(@CurrentUser() user: Principal, @Query() q: unknown) {
    return this.service.invitations(user, q);
  }
  @Post("invitations")
  @ApiBody({ type: InviteStaffDto })
  @ApiCreatedResponse({ type: TeamReceiptDto })
  async invite(
    @CurrentUser() user: Principal,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const email = await this.contacts.resolve(bearer(req), user.userId);
    return this.service.invite(user, body, email);
  }
  @Put("members/:id")
  @ApiBody({ type: UpdateStaffDto })
  @ApiOkResponse({ type: TeamReceiptDto })
  update(
    @CurrentUser() user: Principal,
    @Param("id") target: string,
    @Body() body: unknown,
  ) {
    return this.service.update(user, id(target), body);
  }
  @Post("invitations/:id/revoke")
  @ApiBody({ type: TeamActionDto })
  @ApiCreatedResponse({ type: TeamReceiptDto })
  revoke(
    @CurrentUser() user: Principal,
    @Param("id") target: string,
    @Body() body: unknown,
  ) {
    return this.service.revoke(user, id(target), body);
  }
  @Post("invitations/:id/link")
  @ApiCreatedResponse({ type: TeamReceiptDto })
  link(
    @CurrentUser() user: Principal,
    @Param("id") target: string,
    @Body() body: unknown,
  ) {
    validated(z.object({}).strict(), body);
    return this.service.invitationLink(user, id(target));
  }
  @Post("invitations/:id/email")
  @ApiBody({ type: TeamActionDto })
  @ApiCreatedResponse({ type: TeamReceiptDto })
  send(
    @CurrentUser() user: Principal,
    @Param("id") target: string,
    @Body() body: unknown,
  ) {
    return this.service.send(user, id(target), body);
  }
}
// Supabase-verified identity is deliberately sufficient here; an invitation is
// precisely how a person obtains their first membership. Never accept an email
// or role from this request as authority.
@ApiTags("Staff onboarding")
@UseGuards(TeamPublicLimit)
@Controller("team/onboarding")
export class TeamOnboardingController {
  constructor(
    @Inject(TeamService) private readonly service: TeamService,
    @Inject(VERIFIER) private readonly verifier: IdentityVerifier,
    @Inject(NOTIFICATION_CONTACT)
    private readonly contacts: VerifiedContactResolver,
  ) {}
  private async identity(req: Request) {
    const token = bearer(req),
      userId = await this.verifier.verify(token),
      email = await this.contacts.resolve(token, userId);
    return { userId, email };
  }
  @Get("options")
  options() {
    return this.service.onboardingOptions();
  }
  @Post("preview")
  @ApiBody({ type: TeamInvitationTokenDto })
  @ApiCreatedResponse({ type: TeamInvitationDto })
  preview(@Body() body: unknown) {
    return this.service.preview(body);
  }
  @Post("available")
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: TeamInvitationsDto })
  async available(@Req() req: Request, @Body() body: unknown) {
    validated(z.object({}).strict(), body);
    const { email } = await this.identity(req);
    return this.service.available(email);
  }
  @Post("accept")
  @ApiBearerAuth()
  @ApiBody({ type: AcceptTeamInvitationDto })
  @ApiCreatedResponse({ type: TeamAcceptanceDto })
  async accept(@Req() req: Request, @Body() body: unknown) {
    const { userId, email } = await this.identity(req);
    return this.service.accept(userId, email, body);
  }
}
