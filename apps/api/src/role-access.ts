import { Role, type Membership, type Prisma } from "@prisma/client";

// The requested view is only a selection among trusted grants. It never grants
// authority by itself, and never combines permissions from multiple roles.
export async function resolveRole(
  tx: Prisma.TransactionClient,
  member: Pick<Membership, "id" | "orgId" | "role" | "active">,
  requested: Role,
): Promise<Role | null> {
  if (!member.active) return null;
  if (member.role === requested) return requested;
  const grant = await tx.membershipRoleGrant.findFirst({
    where: {
      orgId: member.orgId,
      membershipId: member.id,
      role: requested,
      active: true,
    },
    select: { id: true },
  });
  return grant ? requested : null;
}

export const technicianMembership = {
  OR: [
    { role: Role.TECHNICIAN },
    { roleGrants: { some: { role: Role.TECHNICIAN, active: true } } },
  ],
} satisfies Prisma.MembershipWhereInput;
