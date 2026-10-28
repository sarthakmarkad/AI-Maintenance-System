import { MachineDto } from "../dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
export const machineCode = z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,31}$/);
export const lifecycleInput = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().min(1).max(2147483646),
    archived: z.boolean(),
    reason: z.string().trim().min(3).max(4000),
  })
  .strict();
export class MachineLifecycleDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() archived!: boolean;
  @ApiProperty() reason!: string;
}
const optionalName = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v ?? null);
export const registrationInput = z
  .object({
    requestId: z.string().uuid(),
    code: machineCode.refine(
      (c) => c !== "WH-B",
      "WH-B remains reference-only.",
    ),
    name: z.string().trim().min(2).max(160),
    manufacturer: optionalName(160),
    model: optionalName(160),
    department: optionalName(120),
    location: optionalName(160),
  })
  .strict();
export const accessInput = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().min(1).max(2147483646),
    changes: z
      .array(
        z
          .object({ membershipId: z.string().uuid(), granted: z.boolean() })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (v) => new Set(v.map((c) => c.membershipId)).size === v.length,
        "Choose each person once.",
      ),
  })
  .strict();
export const rosterQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export class RegisterMachineDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ example: "COMP-01" }) code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) manufacturer?:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) model?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) department?:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) location?:
    | string
    | null;
}
export class MachineAccessChangeDto {
  @ApiProperty({ format: "uuid" }) membershipId!: string;
  @ApiProperty() granted!: boolean;
}
export class UpdateMachineAccessDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [MachineAccessChangeDto] })
  changes!: MachineAccessChangeDto[];
}
export class MachineAccessPersonDto {
  @ApiProperty({ format: "uuid" }) membershipId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ enum: Role, isArray: true }) roles!: Role[];
  @ApiProperty() granted!: boolean;
}
export class MachineAccessRosterDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: [MachineAccessPersonDto] })
  items!: MachineAccessPersonDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class MachineAccessReceiptDto {
  @ApiProperty() version!: number;
  @ApiProperty() alreadySaved!: boolean;
}

export const detailsInput = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().min(1).max(2147483646),
    name: z.string().trim().min(2).max(160),
    manufacturer: z.string().trim().min(1).max(160).nullable(),
    model: z.string().trim().min(1).max(160).nullable(),
    department: z.string().trim().min(1).max(120).nullable(),
    location: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();
export const photoInput = z
  .object({
    requestId: z.string().uuid(),
    version: z.coerce.number().int().min(1).max(2147483646),
  })
  .strict();
export class UpdateMachineDetailsDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) manufacturer!: string | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: String, nullable: true }) department!: string | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
}
export class MachinePhotoSourceDto {
  @ApiProperty() filename!: string;
  @ApiProperty() mediaType!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
}
export class MachinePhotoDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() sha256!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty() uploadedBy!: string;
  @ApiProperty() uploaderName!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: MachinePhotoSourceDto }) source!: MachinePhotoSourceDto;
}

export class MachineDetailsDto {
  @ApiProperty({ type: MachineDto }) machine!: MachineDto;
  @ApiProperty({ type: MachinePhotoDto, nullable: true })
  photo!: MachinePhotoDto | null;
  @ApiProperty() canManage!: boolean;
}
export class ChangeMachinePhotoDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}
