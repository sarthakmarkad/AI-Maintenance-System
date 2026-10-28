import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
const ids = z
  .array(
    z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
  )
  .max(100)
  .refine((v) => new Set(v).size === v.length, "Choose each machine once.")
  .transform((v) => v.sort());
const name = z.string().trim().min(2).max(120);
export const invitationInput = z
  .object({
    requestId: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    email: z.email().trim().toLowerCase().max(254),
    displayName: name,
    role: z.nativeEnum(Role),
    machineIds: ids,
  })
  .strict();
export const memberInput = z
  .object({
    requestId: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    version: z.number().int().min(1),
    displayName: name,
    role: z.nativeEnum(Role),
    active: z.boolean(),
    machineIds: ids,
    expectedMachineIds: ids,
    reason: z.string().trim().min(3).max(1000),
    replaceAdditionalRoles: z.boolean().default(false),
  })
  .strict();
export const actionInput = z
  .object({
    requestId: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    version: z.number().int().min(1),
  })
  .strict();
export const tokenInput = z
  .object({
    token: z
      .string()
      .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
      .refine((v) => z.string().uuid().safeParse(v.split(".")[0]).success),
  })
  .strict();
export const acceptInput = z
  .object({ invitationId: z.string().uuid() })
  .strict();
export const listInput = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    q: z.string().trim().max(120).default(""),
  })
  .strict();
export class InviteStaffDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ type: [String] }) machineIds!: string[];
}
export class UpdateStaffDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: [String] }) machineIds!: string[];
  @ApiProperty({ type: [String] }) expectedMachineIds!: string[];
  @ApiProperty() reason!: string;
  @ApiProperty() replaceAdditionalRoles!: boolean;
}
export class TeamInvitationTokenDto {
  @ApiProperty() token!: string;
}
export class AcceptTeamInvitationDto {
  @ApiProperty({ format: "uuid" }) invitationId!: string;
}
export class TeamActionDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() version!: number;
}
export class StaffMachineDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
}
export class StaffMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ type: [String], enum: Role }) additionalRoles!: Role[];
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [StaffMachineDto] }) machines!: StaffMachineDto[];
  @ApiProperty() openWorkOrders!: number;
  @ApiProperty() activePlans!: number;
}
export class StaffListDto {
  @ApiProperty({ type: [StaffMemberDto] }) items!: StaffMemberDto[];
  @ApiProperty() page!: number;
  @ApiProperty() total!: number;
}
export class TeamInvitationDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() organization!: string;
  @ApiProperty({ type: [StaffMachineDto] }) machines!: StaffMachineDto[];
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ type: String, nullable: true }) deliveryStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryCode!: string | null;
}
export class TeamInvitationsDto {
  @ApiProperty({ type: [TeamInvitationDto] }) items!: TeamInvitationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() invitationsConfigured!: boolean;
  @ApiProperty() emailConfigured!: boolean;
  @ApiProperty() passwordEmailConfigured!: boolean;
}
export class TeamReceiptDto {
  @ApiProperty() id!: string;
  @ApiProperty({ required: false }) version?: number;
  @ApiProperty() alreadyApplied!: boolean;
  @ApiProperty({ type: String, nullable: true, required: false })
  invitationUrl?: string | null;
  @ApiProperty({ required: false }) deliveryStatus?: string;
}
export class TeamAcceptanceDto {
  @ApiProperty() membershipId!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() alreadyApplied!: boolean;
}
