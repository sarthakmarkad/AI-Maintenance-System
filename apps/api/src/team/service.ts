import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { Prisma, Role, type TeamInvitation } from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG, type Config } from "../config";
import { Database } from "../database";
import type { Principal } from "../repository";
import { validated } from "../production/service";
import {
  actionInput,
  invitationInput,
  memberInput,
  listInput,
  tokenInput,
  acceptInput,
} from "./dto";
import {
  NOTIFICATION_EMAIL,
  type NotificationEmailProvider,
} from "../external-notifications/provider";
import { staffEmailConfigured } from "./policy";

@Injectable()
export class TeamService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(NOTIFICATION_EMAIL)
    private readonly email: NotificationEmailProvider,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async admin(user: Principal) {
    if (
      user.role !== Role.ADMINISTRATOR ||
      !(await this.db.membership.findFirst({
        where: {
          orgId: user.orgId,
          userId: user.userId,
          active: true,
          OR: [
            { role: Role.ADMINISTRATOR },
            {
              roleGrants: { some: { role: Role.ADMINISTRATOR, active: true } },
            },
          ],
        },
      }))
    )
      throw new ForbiddenException(
        "Only the active Administrator can manage staff.",
      );
  }
  private token(id: string) {
    id = id.toLowerCase();
    if (!this.config.TEAM_INVITATION_SECRET)
      throw new ServiceUnavailableException(
        "Staff invitation signing is not configured.",
      );
    return (
      id +
      "." +
      createHmac("sha256", this.config.TEAM_INVITATION_SECRET)
        .update("maintenance-staff-invitation:" + id)
        .digest("base64url")
    );
  }
  private link(id: string) {
    return this.config.WEB_ORIGIN + "/join#invitation=" + this.token(id);
  }
  private failure(e: unknown): never {
    const message = e instanceof Error ? e.message : "";
    const causes = {
      TEAM_FORBIDDEN:
        "Administrator authority was revoked. Refresh your workspace.",
      TEAM_SELF:
        "You cannot change your own account from Team. Ask another Administrator.",
      TEAM_LAST_ADMIN: "Keep at least one active Administrator.",
      TEAM_NOT_FOUND: "This staff record or invitation is unavailable.",
      TEAM_CONFLICT:
        "This record changed, expired or was revoked. Refresh before trying again.",
      TEAM_EXISTS:
        "This email already has a staff account or pending invitation. Review the existing record.",
      TEAM_MEMBER_EXISTS:
        "This identity already belongs to a workspace. An Administrator must manage its existing membership.",
      TEAM_MACHINES:
        "Choose valid active machines for this role. The selected machine access may have changed.",
      TEAM_ROLE_CONFIRMATION:
        "Confirm replacement of the additional role grants.",
      TEAM_RATE_LIMITED:
        "Invitation email limit reached. Wait before sending another message.",
    };
    for (const [code, text] of Object.entries(causes))
      if (message.includes(code)) {
        if (code === "TEAM_NOT_FOUND") throw new NotFoundException(text);
        if (["TEAM_FORBIDDEN", "TEAM_SELF"].includes(code))
          throw new ForbiddenException(text);
        if (code === "TEAM_RATE_LIMITED") throw new HttpException(text, 429);
        throw new ConflictException(text);
      }
    if (e instanceof HttpException) throw e;
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2002" ||
        (e.code === "P2010" && String(e.meta?.code) === "23505"))
    )
      throw new ConflictException(
        "This identity or request already exists. Refresh the staff list before retrying.",
      );
    throw new ServiceUnavailableException(
      "The staff change could not be confirmed. Refresh and retry with the same request.",
    );
  }
  private async action(
    user: Principal,
    requestId: string,
    action: string,
    id: string,
    p: unknown,
  ) {
    try {
      const rows = await this.db.$queryRaw<
        { result: Record<string, any> }[]
      >`SELECT maintenance.team_admin_action(${user.orgId}::uuid,${user.userId}::uuid,${requestId}::uuid,${action},${id}::uuid,${JSON.stringify(p)}::jsonb) AS result`;
      return rows[0].result;
    } catch (e) {
      this.failure(e);
    }
  }
  onboardingOptions() {
    return {
      passwordEmailConfigured: this.config.TEAM_PASSWORD_EMAIL_READY === "true",
    };
  }
  async members(user: Principal, raw: unknown) {
    await this.admin(user);
    const q = validated(listInput, raw);
    const where: Prisma.MembershipWhereInput = {
      orgId: user.orgId,
      ...(q.q
        ? {
            OR: [
              { user: { displayName: { contains: q.q, mode: "insensitive" } } },
              { staffEmail: { contains: q.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [members, total] = await this.db.$transaction(
      [
        this.db.membership.findMany({
          where,
          include: {
            user: true,
            roleGrants: { where: { active: true } },
            machineAccess: {
              include: {
                machine: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    archivedAt: true,
                  },
                },
              },
            },
            _count: {
              select: {
                assignedOrders: {
                  where: { status: { notIn: ["CLOSED", "CANCELLED"] } },
                },
                technicianPlans: { where: { active: true } },
              },
            },
          },
          orderBy: { id: "asc" },
          skip: (q.page - 1) * 25,
          take: 25,
        }),
        this.db.membership.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      page: q.page,
      total,
      items: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.user.displayName,
        email: m.staffEmail,
        role: m.role,
        additionalRoles: m.roleGrants
          .filter((g) => g.role !== m.role)
          .map((g) => g.role),
        active: m.active,
        version: m.teamVersion,
        machines: m.machineAccess
          .map((a) => a.machine)
          .sort((a, b) => a.id.localeCompare(b.id)),
        openWorkOrders: m._count.assignedOrders,
        activePlans: m._count.technicianPlans,
      })),
    };
  }
  private async invitationView(inv: TeamInvitation) {
    const [org, machines, delivery] = await Promise.all([
      this.db.organization.findUniqueOrThrow({
        where: { id: inv.orgId },
        select: { name: true },
      }),
      this.db.machine.findMany({
        where: { orgId: inv.orgId, id: { in: inv.machineIds } },
        select: { id: true, code: true, name: true, archivedAt: true },
        orderBy: { code: "asc" },
      }),
      this.db.teamInvitationEmail.findFirst({
        where: { invitationId: inv.id, orgId: inv.orgId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      id: inv.id,
      email: inv.email,
      displayName: inv.displayName,
      role: inv.role,
      organization: org.name,
      machines,
      status:
        inv.status === "PENDING" && inv.expiresAt.getTime() <= Date.now()
          ? "EXPIRED"
          : inv.status,
      version: inv.version,
      expiresAt: inv.expiresAt.toISOString(),
      deliveryStatus: delivery?.status ?? null,
      deliveryCode: delivery?.code ?? null,
    };
  }
  async invitations(user: Principal, raw: unknown) {
    await this.admin(user);
    const q = validated(listInput, raw);
    const where = {
      orgId: user.orgId,
      ...(q.q
        ? { email: { contains: q.q, mode: "insensitive" as const } }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.teamInvitation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * 25,
        take: 25,
      }),
      this.db.teamInvitation.count({ where }),
    ]);
    return {
      page: q.page,
      total,
      items: await Promise.all(rows.map((i) => this.invitationView(i))),
      invitationsConfigured: !!this.config.TEAM_INVITATION_SECRET,
      emailConfigured: staffEmailConfigured(this.config),
      passwordEmailConfigured: this.config.TEAM_PASSWORD_EMAIL_READY === "true",
    };
  }
  async invite(user: Principal, raw: unknown, ownEmail: string) {
    await this.admin(user);
    const input = validated(invitationInput, raw);
    if (input.email === ownEmail.toLowerCase())
      throw new BadRequestException(
        "Use a separate staff email. Your own account is already active.",
      );
    const token = this.token(input.requestId);
    const result = await this.action(
      user,
      input.requestId,
      "INVITE",
      input.requestId,
      { ...input, tokenHash: createHash("sha256").update(token).digest("hex") },
    );
    return { ...result, invitationUrl: this.link(result.id) };
  }
  async update(user: Principal, id: string, raw: unknown) {
    await this.admin(user);
    const input = validated(memberInput, raw);
    return this.action(user, input.requestId, "UPDATE_MEMBER", id, input);
  }
  async revoke(user: Principal, id: string, raw: unknown) {
    await this.admin(user);
    const input = validated(actionInput, raw);
    return this.action(user, input.requestId, "REVOKE_INVITATION", id, input);
  }
  async invitationLink(user: Principal, id: string) {
    await this.admin(user);
    const inv = await this.db.teamInvitation.findFirst({
      where: {
        id,
        orgId: user.orgId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    });
    if (!inv)
      throw new NotFoundException("Invitation is unavailable or expired.");
    const invitationUrl = this.checkedLink(inv);
    return { id, alreadyApplied: true, invitationUrl };
  }
  private checkedLink(inv: TeamInvitation) {
    const token = this.token(inv.id);
    const hash = createHash("sha256").update(token).digest("hex");
    if (!timingSafeEqual(Buffer.from(inv.tokenHash), Buffer.from(hash)))
      throw new ConflictException(
        "Invitation signing changed. Revoke this invitation and create a new one.",
      );
    return this.link(inv.id);
  }
  async preview(raw: unknown) {
    const { token } = validated(tokenInput, raw);
    const id = token.split(".")[0];
    const inv = await this.db.teamInvitation.findFirst({
      where: { id, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    const hash = createHash("sha256").update(token).digest("hex");
    if (!inv || !timingSafeEqual(Buffer.from(inv.tokenHash), Buffer.from(hash)))
      throw new NotFoundException(
        "Invitation is unavailable, expired or revoked.",
      );
    return this.invitationView(inv);
  }
  async available(email: string) {
    const rows = await this.db.teamInvitation.findMany({
      where: {
        email: email.toLowerCase(),
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return {
      items: await Promise.all(rows.map((i) => this.invitationView(i))),
      total: rows.length,
      page: 1,
      invitationsConfigured: true,
      emailConfigured: false,
      passwordEmailConfigured: this.config.TEAM_PASSWORD_EMAIL_READY === "true",
    };
  }
  async accept(userId: string, email: string, raw: unknown) {
    const { invitationId } = validated(acceptInput, raw);
    try {
      const rows = await this.db.$queryRaw<
        { result: any }[]
      >`SELECT maintenance.team_accept_invitation(${invitationId}::uuid,${userId}::uuid,${email.toLowerCase()}) AS result`;
      return rows[0].result;
    } catch (e) {
      this.failure(e);
    }
  }
  async send(user: Principal, id: string, raw: unknown) {
    await this.admin(user);
    const input = validated(actionInput, raw);
    if (!staffEmailConfigured(this.config))
      throw new ServiceUnavailableException(
        "Staff email needs a verified sending domain. Share the invitation link until setup is complete.",
      );
    const inv = await this.db.teamInvitation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!inv) throw new NotFoundException("Invitation is unavailable.");
    if (inv.version !== input.version)
      throw new ConflictException(
        "Invitation changed. Refresh before sending.",
      );
    const link = this.checkedLink(inv);
    const receipt = await this.action(
      user,
      input.requestId,
      "EMAIL_RESERVE",
      id,
      input,
    );
    if (!receipt.alreadyApplied) {
      const result = await this.email.send("staff-" + receipt.id, {
        from: this.config.NOTIFICATION_EMAIL_FROM!,
        to: [inv.email],
        subject: "Your Maintenance workspace invitation",
        text: `You have been invited to Maintenance.\n\nOpen this private invitation and sign in with ${inv.email}:\n${link}\n\nThe invitation expires on ${inv.expiresAt.toISOString()}. Your role and machine access are assigned by your organization. If you did not expect this invitation, you can ignore it. Do not forward this link.\n`,
      });
      const status =
        result.outcome === "SENT"
          ? "SENT"
          : result.outcome === "FAILED"
            ? "FAILED"
            : "UNCERTAIN";
      try {
        await this.db
          .$queryRaw`SELECT maintenance.team_email_result(${receipt.id}::uuid,${status},${result.outcome === "SENT" ? null : result.code},${result.outcome === "SENT" ? result.providerId : null})::text`;
      } catch (e) {
        this.failure(e);
      }
    }
    const delivery = await this.db.teamInvitationEmail.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    return { ...receipt, deliveryStatus: delivery.status };
  }
}
