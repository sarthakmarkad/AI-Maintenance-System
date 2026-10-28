import "dotenv/config";
import { Role } from "@prisma/client";
import { postgresClient } from "../apps/api/src/postgres";
import { z } from "zod";
const [userId, ...roles] = process.argv.slice(2);
const parsed = z
  .object({
    userId: z.string().uuid(),
    roles: z.array(z.nativeEnum(Role)).min(1).max(6),
  })
  .safeParse({ userId, roles });
if (!parsed.success || !process.env.DIRECT_URL)
  throw new Error(
    "Usage: npm run db:grant-roles -- <verified-existing-Auth-UUID> <ROLE...>. Requires trusted owner access.",
  );
const input = parsed.data;
const db = postgresClient(process.env.DIRECT_URL);
async function main() {
  const result = await db.$transaction(async (tx) => {
    const member = await tx.membership.findUnique({
      where: { userId: input.userId },
      include: { organization: true, roleGrants: true },
    });
    if (!member?.active || member.organization.slug !== "supreme-industries")
      throw new Error(
        "Verify an active existing membership in the pilot organization first.",
      );
    const additional = [...new Set(input.roles)].filter(
      (role) => role !== member.role,
    );
    if (member.roleGrants.some((g) => additional.includes(g.role) && !g.active))
      throw new Error(
        "A requested grant was revoked. Review reactivation explicitly; this command does not reactivate revoked grants.",
      );
    const fresh = additional.filter(
      (role) => !member.roleGrants.some((g) => g.role === role),
    );
    const addedMachines: string[] = [];
    if (
      input.roles.some(
        (role) => role === Role.OPERATOR || role === Role.TECHNICIAN,
      )
    ) {
      const machine = await tx.machine.findUniqueOrThrow({
        where: { orgId_code: { orgId: member.orgId, code: "WH-C" } },
      });
      const access = await tx.machineAccess.findUnique({
        where: {
          machineId_membershipId: {
            machineId: machine.id,
            membershipId: member.id,
          },
        },
      });
      await tx.machineAccess.upsert({
        where: {
          machineId_membershipId: {
            machineId: machine.id,
            membershipId: member.id,
          },
        },
        create: {
          orgId: member.orgId,
          machineId: machine.id,
          membershipId: member.id,
        },
        update: {},
      });
      if (!access) addedMachines.push(machine.code);
    }
    if (fresh.length) {
      await tx.membershipRoleGrant.createMany({
        data: fresh.map((role) => ({
          orgId: member.orgId,
          membershipId: member.id,
          role,
        })),
      });
    }
    if (fresh.length || addedMachines.length) {
      await tx.auditEvent.create({
        data: {
          orgId: member.orgId,
          action: "MEMBERSHIP_ROLES_GRANTED",
          entityId: member.id,
          detail: {
            roles: fresh,
            defaultRole: member.role,
            machineCodes: addedMachines,
            source:
              "trusted owner CLI; explicit user request for one-account pilot role testing; Auth UUID previously verified",
          },
        },
      });
    }
    return fresh.length;
  });
  console.log(
    `${result} additional role grants created. Default role unchanged; role selection never combines permissions.`,
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error && !("code" in e)
        ? e.message
        : "Role provisioning failed. Review trusted database configuration.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
