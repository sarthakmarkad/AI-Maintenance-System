import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { Database } from "./database";
export type Principal = {
  userId: string;
  membershipId: string;
  displayName: string;
  orgId: string;
  organization: string;
  role: Role;
  availableRoles?: Role[];
};
export const REPOSITORY = Symbol("REPOSITORY");
export const machineSelect = {
  id: true,
  version: true,
  code: true,
  name: true,
  manufacturer: true,
  model: true,
  operationalStatus: true,
  archivedAt: true,
  archiveReason: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { name: true } },
  location: { select: { name: true } },
  photo: { select: { id: true, width: true, height: true } },
} satisfies Prisma.MachineSelect;
export type MachineRecord = Prisma.MachineGetPayload<{
  select: typeof machineSelect;
}>;
export interface Repository {
  principal(userId: string, requestedRole?: Role): Promise<Principal | null>;
  machines(
    user: Principal,
    limit: number,
    after?: string,
    q?: string,
    archived?: boolean,
  ): Promise<MachineRecord[]>;
  machine(user: Principal, code: string): Promise<MachineRecord | null>;
}
@Injectable()
export class PrismaRepository implements Repository {
  constructor(@Inject(Database) private readonly db: Database) {}
  private get client() {
    if (!this.db.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.db.client;
  }
  async principal(userId: string, requestedRole?: Role) {
    const membership = await this.client.membership.findUnique({
      where: { userId },
      include: {
        user: true,
        organization: true,
        roleGrants: { where: { active: true } },
      },
    });
    if (!membership?.active) return null;
    const availableRoles = [
      ...new Set([
        membership.role,
        ...membership.roleGrants.map((g) => g.role),
      ]),
    ];
    const role = requestedRole ?? membership.role;
    if (!availableRoles.includes(role)) return null;
    return {
      userId,
      membershipId: membership.id,
      displayName: membership.user.displayName,
      orgId: membership.orgId,
      organization: membership.organization.name,
      role,
      availableRoles,
    };
  }
  private scope(user: Principal): Prisma.MachineWhereInput {
    return {
      orgId: user.orgId,
      ...([Role.OPERATOR, Role.TECHNICIAN].includes(
        user.role as "OPERATOR" | "TECHNICIAN",
      )
        ? {
            access: {
              some: { membershipId: user.membershipId, orgId: user.orgId },
            },
          }
        : {}),
    };
  }
  machines(
    user: Principal,
    limit: number,
    after?: string,
    q?: string,
    archived = false,
  ) {
    return this.client.machine.findMany({
      where: {
        ...this.scope(user),
        archivedAt: archived ? { not: null } : null,
        ...(after ? { code: { gt: after } } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: machineSelect,
      orderBy: { code: "asc" },
      take: limit,
    });
  }
  machine(user: Principal, code: string) {
    return this.client.machine.findFirst({
      where: { ...this.scope(user), code },
      select: machineSelect,
    });
  }
}
