import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "../database";
import { machineSelect, type Principal } from "../repository";
import { resolveRole } from "../role-access";
import {
  accessInput,
  registrationInput,
  rosterQuery,
  detailsInput,
  photoInput,
  lifecycleInput,
} from "./dto";
import { validated } from "../production/service";
import { machinePhoto } from "./photo";
const photoSelect = {
  id: true,
  sha256: true,
  byteSize: true,
  width: true,
  height: true,
  source: true,
  uploadedBy: true,
  uploaderName: true,
  createdAt: true,
} as const;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const operationalRoles = [Role.OPERATOR, Role.TECHNICIAN];
const eligible = {
  OR: [
    { role: { in: operationalRoles } },
    { roleGrants: { some: { active: true, role: { in: operationalRoles } } } },
  ],
} satisfies Prisma.MembershipWhereInput;
@Injectable()
export class MachinesService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private get db() {
    if (!this.database.client)
      throw new ServiceUnavailableException("Database is not configured.");
    return this.database.client;
  }
  private async administrator(tx: Prisma.TransactionClient, user: Principal) {
    const member = await tx.membership.findUnique({
      where: { userId: user.userId },
    });
    if (
      !member?.active ||
      member.orgId !== user.orgId ||
      user.role !== Role.ADMINISTRATOR ||
      !(await resolveRole(tx, member, Role.ADMINISTRATOR))
    )
      throw new ForbiddenException(
        "Only an active Administrator can manage the machine registry and access.",
      );
  }
  private async machine(
    tx: Prisma.TransactionClient,
    user: Principal,
    code: string,
  ) {
    const machine = await tx.machine.findFirst({
      where: { orgId: user.orgId, code },
    });
    if (!machine)
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return machine;
  }
  async register(user: Principal, raw: unknown) {
    const input = validated(registrationInput, raw);
    const fingerprint = hash({ actorId: user.userId, ...input });
    try {
      return await this.db.$transaction(
        async (tx) => {
          // Retry serialization is local to this organization/request, not a global registry lock.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.orgId + ":" + input.requestId},0))::text`;
          await this.administrator(tx, user);
          const prior = await tx.machine.findUnique({
            where: {
              orgId_registrationKey: {
                orgId: user.orgId,
                registrationKey: input.requestId,
              },
            },
          });
          if (prior) {
            if (prior.registrationHash !== fingerprint)
              throw new ConflictException(
                "This registration request was already used with different details. Start a new registration.",
              );
            return tx.machine.findUniqueOrThrow({
              where: { id: prior.id },
              select: machineSelect,
            });
          }
          if (input.department)
            await tx.$executeRaw`INSERT INTO maintenance."Department" (id,"orgId",name) VALUES (${randomUUID()}::uuid,${user.orgId}::uuid,${input.department}) ON CONFLICT ("orgId",name) DO NOTHING`;
          if (input.location)
            await tx.$executeRaw`INSERT INTO maintenance."Location" (id,"orgId",name) VALUES (${randomUUID()}::uuid,${user.orgId}::uuid,${input.location}) ON CONFLICT ("orgId",name) DO NOTHING`;
          const department = input.department
            ? await tx.department.findUniqueOrThrow({
                where: {
                  orgId_name: { orgId: user.orgId, name: input.department },
                },
                select: { id: true },
              })
            : null;
          const location = input.location
            ? await tx.location.findUniqueOrThrow({
                where: {
                  orgId_name: { orgId: user.orgId, name: input.location },
                },
                select: { id: true },
              })
            : null;
          const machine = await tx.machine.create({
            data: {
              orgId: user.orgId,
              code: input.code,
              name: input.name,
              manufacturer: input.manufacturer,
              model: input.model,
              departmentId: department?.id,
              locationId: location?.id,
              registrationKey: input.requestId,
              registrationHash: fingerprint,
            },
            select: machineSelect,
          });
          await tx.auditEvent.create({
            data: {
              orgId: user.orgId,
              actorId: user.userId,
              entityId: machine.id,
              action: "MACHINE_REGISTER",
              detail: { ...input, actorRole: user.role },
            },
          });
          return machine;
        },
        { timeout: 10000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException(
          "This machine code is already registered in your organization. Choose a different code or open the existing machine.",
        );
      throw e;
    }
  }
  async roster(user: Principal, code: string, raw: unknown) {
    const q = validated(rosterQuery, raw);
    return this.db.$transaction(async (tx) => {
      await this.administrator(tx, user);
      const machine = await this.machine(tx, user, code);
      const rows = await tx.membership.findMany({
        where: {
          orgId: user.orgId,
          OR: [
            { active: true, ...eligible },
            {
              machineAccess: {
                some: { orgId: user.orgId, machineId: machine.id },
              },
            },
          ],
          ...(q.after ? { id: { gt: q.after } } : {}),
          ...(q.q
            ? {
                user: {
                  displayName: { contains: q.q, mode: "insensitive" as const },
                },
              }
            : {}),
        },
        include: {
          user: { select: { displayName: true } },
          roleGrants: { where: { active: true } },
          machineAccess: {
            where: { orgId: user.orgId, machineId: machine.id },
            select: { machineId: true },
          },
        },
        orderBy: { id: "asc" },
        take: q.limit + 1,
      });
      return {
        version: machine.version,
        items: rows.slice(0, q.limit).map((m) => ({
          membershipId: m.id,
          displayName: m.user.displayName,
          active: m.active,
          roles: [
            ...new Set([m.role, ...m.roleGrants.map((g) => g.role)]),
          ].filter((r) =>
            operationalRoles.includes(r as "OPERATOR" | "TECHNICIAN"),
          ),
          granted: m.machineAccess.length > 0,
        })),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    });
  }
  async access(user: Principal, code: string, raw: unknown) {
    const input = validated(accessInput, raw);
    const changes = [...input.changes].sort((a, b) =>
      a.membershipId.localeCompare(b.membershipId),
    );
    const fingerprint = hash({ actorId: user.userId, ...input, changes });
    return this.db.$transaction(
      async (tx) => {
        await this.administrator(tx, user);
        await tx.$queryRaw`SELECT id FROM maintenance."Machine" WHERE "orgId"=${user.orgId}::uuid AND code=${code} FOR UPDATE`;
        await this.administrator(tx, user);
        const machine = await this.machine(tx, user, code);
        const previous = await tx.auditEvent.findFirst({
          where: {
            orgId: user.orgId,
            entityId: machine.id,
            action: "MACHINE_ACCESS_UPDATE",
            detail: { path: ["requestId"], equals: input.requestId },
          },
        });
        if (previous) {
          const receipt = previous.detail as {
            fingerprint: string;
            version: number;
          };
          if (receipt.fingerprint !== fingerprint)
            throw new ConflictException(
              "This access request was already used with different details.",
            );
          return { version: receipt.version, alreadySaved: true };
        }
        if (machine.version !== input.version)
          throw new ConflictException(
            "Machine access changed. Reload the access list before saving.",
          );
        const people = await tx.membership.findMany({
          where: {
            orgId: user.orgId,
            id: { in: changes.map((c) => c.membershipId) },
          },
          include: {
            roleGrants: {
              where: { active: true, role: { in: operationalRoles } },
              select: { id: true },
            },
          },
        });
        if (people.length !== changes.length)
          throw new BadRequestException(
            "Select people from this organization's access list.",
          );
        // Grants require a current operational role. Revocation remains possible after a role was revoked.
        for (const change of changes.filter((c) => c.granted)) {
          const person = people.find((p) => p.id === change.membershipId)!;
          if (
            !person.active ||
            (!operationalRoles.includes(
              person.role as "OPERATOR" | "TECHNICIAN",
            ) &&
              person.roleGrants.length === 0)
          )
            throw new BadRequestException(
              "Only active Operators and Technicians can receive machine grants.",
            );
        }
        const before = await tx.machineAccess.findMany({
          where: {
            orgId: user.orgId,
            machineId: machine.id,
            membershipId: { in: changes.map((c) => c.membershipId) },
          },
          select: { membershipId: true },
        });
        const additions = changes
          .filter((c) => c.granted)
          .map((c) => ({
            orgId: user.orgId,
            machineId: machine.id,
            membershipId: c.membershipId,
          }));
        const removals = changes
          .filter((c) => !c.granted)
          .map((c) => c.membershipId);
        if (additions.length)
          await tx.machineAccess.createMany({
            data: additions,
            skipDuplicates: true,
          });
        if (removals.length)
          await tx.machineAccess.deleteMany({
            where: {
              orgId: user.orgId,
              machineId: machine.id,
              membershipId: { in: removals },
            },
          });
        await tx.machine.update({
          where: { id: machine.id },
          data: { version: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            orgId: user.orgId,
            actorId: user.userId,
            entityId: machine.id,
            action: "MACHINE_ACCESS_UPDATE",
            detail: {
              requestId: input.requestId,
              fingerprint,
              actorRole: user.role,
              version: machine.version + 1,
              before: before.map((p) => p.membershipId),
              changes,
            },
          },
        });
        return { version: machine.version + 1, alreadySaved: false };
      },
      { timeout: 10000 },
    );
  }
  private async scoped(
    tx: Prisma.TransactionClient,
    user: Principal,
    code: string,
  ) {
    const member = await tx.membership.findUnique({
      where: { userId: user.userId },
    });
    if (
      !member?.active ||
      member.orgId !== user.orgId ||
      !(await resolveRole(tx, member, user.role))
    )
      throw new ForbiddenException(
        "Your workspace access changed. Sign in again.",
      );
    const machine = await this.machine(tx, user, code);
    if (
      [Role.OPERATOR, Role.TECHNICIAN].includes(
        user.role as "OPERATOR" | "TECHNICIAN",
      ) &&
      !(await tx.machineAccess.findUnique({
        where: {
          machineId_membershipId: {
            membershipId: member.id,
            machineId: machine.id,
          },
        },
      }))
    )
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return machine;
  }
  async details(user: Principal, code: string) {
    return this.db.$transaction(async (tx) => {
      const m = await this.scoped(tx, user, code);
      const machine = await tx.machine.findUniqueOrThrow({
        where: { id: m.id },
        select: machineSelect,
      });
      const photo = await tx.machinePhoto.findUnique({
        where: { machineId: m.id },
        select: photoSelect,
      });
      return { machine, photo, canManage: user.role === Role.ADMINISTRATOR };
    });
  }
  async photo(user: Principal, code: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const machine = await this.scoped(tx, user, code);
      const photo = await tx.machinePhoto.findFirst({
        where: { orgId: user.orgId, machineId: machine.id, id },
      });
      if (!photo)
        throw new NotFoundException(
          "This photo is no longer available. Refresh the machine.",
        );
      return photo;
    });
  }
  private async mutate(
    user: Principal,
    code: string,
    input: { requestId: string; version: number },
    action: string,
    intent: unknown,
    apply: (
      tx: Prisma.TransactionClient,
      machine: Awaited<ReturnType<MachinesService["machine"]>>,
    ) => Promise<unknown>,
  ) {
    const fingerprint = hash({
      actorId: user.userId,
      actorRole: user.role,
      input,
      intent,
    });
    return this.db.$transaction(
      async (tx) => {
        await this.administrator(tx, user);
        await tx.$queryRaw`SELECT id FROM maintenance."Machine" WHERE "orgId"=${user.orgId}::uuid AND code=${code} FOR UPDATE`;
        await this.administrator(tx, user);
        const machine = await this.machine(tx, user, code);
        const prior = await tx.auditEvent.findFirst({
          where: {
            orgId: user.orgId,
            entityId: machine.id,
            action,
            detail: { path: ["requestId"], equals: input.requestId },
          },
        });
        if (prior) {
          const receipt = prior.detail as {
            fingerprint: string;
            version: number;
          };
          if (receipt.fingerprint !== fingerprint)
            throw new ConflictException(
              "This request was already used with different details. Refresh and review before saving.",
            );
          return { version: receipt.version, alreadySaved: true };
        }
        if (machine.version !== input.version)
          throw new ConflictException(
            "Machine changed. Refresh and review the latest details before saving.",
          );
        const evidence = await apply(tx, machine);
        const updated = await tx.machine.updateMany({
          where: { id: machine.id, orgId: user.orgId, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "Machine changed. Refresh before saving.",
          );
        await tx.auditEvent.create({
          data: {
            orgId: user.orgId,
            actorId: user.userId,
            entityId: machine.id,
            action,
            detail: {
              requestId: input.requestId,
              fingerprint,
              actorRole: user.role,
              version: machine.version + 1,
              evidence: evidence as Prisma.InputJsonValue,
            },
          },
        });
        return { version: machine.version + 1, alreadySaved: false };
      },
      { timeout: 10000 },
    );
  }
  async lifecycle(user: Principal, code: string, raw: unknown) {
    const input = validated(lifecycleInput, raw);
    return this.mutate(
      user,
      code,
      input,
      input.archived ? "MACHINE_ARCHIVE" : "MACHINE_RESTORE",
      input,
      async (tx, machine) => {
        if (Boolean(machine.archivedAt) === input.archived)
          throw new ConflictException(
            input.archived
              ? "This machine is already archived."
              : "This machine is already active.",
          );
        if (input.archived) {
          const [work, plans, tasks] = await Promise.all([
            tx.workOrder.count({
              where: {
                machineId: machine.id,
                status: { notIn: ["CLOSED", "CANCELLED"] },
              },
            }),
            tx.maintenancePlan.count({
              where: { machineId: machine.id, active: true },
            }),
            tx.maintenanceOccurrence.count({
              where: {
                machineId: machine.id,
                skippedAt: null,
                OR: [
                  { workOrder: { is: null } },
                  {
                    workOrder: {
                      is: { status: { notIn: ["CLOSED", "CANCELLED"] } },
                    },
                  },
                ],
              },
            }),
          ]);
          if (work || plans || tasks)
            throw new ConflictException(
              "Before archiving: close or cancel open work orders, pause recurring plans, and skip unreleased calendar tasks.",
            );
        }
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            archivedAt: input.archived ? new Date() : null,
            archiveReason: input.archived ? input.reason : null,
          },
        });
        return {
          reason: input.reason,
          previousArchivedAt: machine.archivedAt?.toISOString() ?? null,
        };
      },
    );
  }
  async updateDetails(user: Principal, code: string, raw: unknown) {
    const input = validated(detailsInput, raw);
    return this.mutate(
      user,
      code,
      input,
      "MACHINE_DETAILS_UPDATE",
      input,
      async (tx, machine) => {
        const before = await tx.machine.findUniqueOrThrow({
          where: { id: machine.id },
          select: machineSelect,
        });
        if (input.department)
          await tx.$executeRaw`INSERT INTO maintenance."Department" (id,"orgId",name) VALUES (${randomUUID()}::uuid,${user.orgId}::uuid,${input.department}) ON CONFLICT ("orgId",name) DO NOTHING`;
        if (input.location)
          await tx.$executeRaw`INSERT INTO maintenance."Location" (id,"orgId",name) VALUES (${randomUUID()}::uuid,${user.orgId}::uuid,${input.location}) ON CONFLICT ("orgId",name) DO NOTHING`;
        const department = input.department
          ? await tx.department.findUniqueOrThrow({
              where: {
                orgId_name: { orgId: user.orgId, name: input.department },
              },
            })
          : null;
        const location = input.location
          ? await tx.location.findUniqueOrThrow({
              where: {
                orgId_name: { orgId: user.orgId, name: input.location },
              },
            })
          : null;
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            name: input.name,
            manufacturer: input.manufacturer,
            model: input.model,
            departmentId: department?.id ?? null,
            locationId: location?.id ?? null,
          },
        });
        return {
          before: JSON.parse(JSON.stringify(before)),
          after: {
            name: input.name,
            manufacturer: input.manufacturer,
            model: input.model,
            department: input.department,
            location: input.location,
          },
        };
      },
    );
  }
  async uploadPhoto(
    user: Principal,
    code: string,
    raw: unknown,
    file: Express.Multer.File,
  ) {
    const input = validated(photoInput, raw);
    const photo = await machinePhoto(file);
    return this.mutate(
      user,
      code,
      input,
      "MACHINE_PHOTO_REPLACE",
      photo.source,
      async (tx, machine) => {
        const before = await tx.machinePhoto.findUnique({
          where: { machineId: machine.id },
          select: photoSelect,
        });
        await tx.machinePhoto.deleteMany({
          where: { machineId: machine.id, orgId: user.orgId },
        });
        const saved = await tx.machinePhoto.create({
          data: {
            ...photo,
            orgId: user.orgId,
            machineId: machine.id,
            uploadedBy: user.userId,
            uploaderName: user.displayName,
          },
          select: photoSelect,
        });
        return JSON.parse(JSON.stringify({ before, after: saved }));
      },
    );
  }
  async removePhoto(user: Principal, code: string, raw: unknown) {
    const input = validated(photoInput, raw);
    return this.mutate(
      user,
      code,
      input,
      "MACHINE_PHOTO_REMOVE",
      null,
      async (tx, machine) => {
        const before = await tx.machinePhoto.findUnique({
          where: { machineId: machine.id },
          select: photoSelect,
        });
        if (!before)
          throw new ConflictException(
            "There is no photo to remove. Refresh the machine.",
          );
        await tx.machinePhoto.delete({ where: { machineId: machine.id } });
        return JSON.parse(JSON.stringify({ before, after: null }));
      },
    );
  }
}
