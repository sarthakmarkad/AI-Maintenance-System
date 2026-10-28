import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { z } from "zod";
import { AttachmentUploadLimit } from "../attachments/controller";
import { MAX_MACHINE_PHOTO_BYTES } from "./photo";
import {
  Body,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Res,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiProduces,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import { type Principal } from "../repository";
import { ErrorDto, MachineDto } from "../dto";
import { validated } from "../production/service";
import { MachinesService } from "./service";
import {
  MachineAccessReceiptDto,
  MachineAccessRosterDto,
  RegisterMachineDto,
  UpdateMachineAccessDto,
  machineCode,
  MachineDetailsDto,
  UpdateMachineDetailsDto,
  ChangeMachinePhotoDto,
  MachineLifecycleDto,
} from "./dto";
@ApiTags("Machines")
@ApiBearerAuth()
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMINISTRATOR)
@Controller("machines")
export class MachineRegistrationController {
  constructor(
    @Inject(MachinesService) private readonly service: MachinesService,
  ) {}
  @Post()
  @ApiBody({ type: RegisterMachineDto })
  @ApiCreatedResponse({ type: MachineDto })
  register(@CurrentUser() user: Principal, @Body() body: unknown) {
    return this.service.register(user, body);
  }
  @Get(":code/access")
  @ApiOkResponse({ type: MachineAccessRosterDto })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "after", required: false, type: String })
  @ApiQuery({ name: "q", required: false, type: String })
  roster(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.service.roster(user, validated(machineCode, code), query);
  }
  @Put(":code/access")
  @ApiBody({ type: UpdateMachineAccessDto })
  @ApiOkResponse({ type: MachineAccessReceiptDto })
  access(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.access(user, validated(machineCode, code), body);
  }
  @Get(":code/details")
  @Roles(...Object.values(Role))
  @ApiOkResponse({ type: MachineDetailsDto })
  details(@CurrentUser() user: Principal, @Param("code") code: string) {
    return this.service.details(user, validated(machineCode, code));
  }
  @Put(":code/details")
  @ApiBody({ type: UpdateMachineDetailsDto })
  @ApiOkResponse({ type: MachineAccessReceiptDto })
  updateDetails(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.updateDetails(user, validated(machineCode, code), body);
  }
  @Post(":code/lifecycle")
  @ApiBody({ type: MachineLifecycleDto })
  @ApiCreatedResponse({ type: MachineAccessReceiptDto })
  lifecycle(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.lifecycle(user, validated(machineCode, code), body);
  }
  @Post(":code/photo")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "requestId", "version"],
      properties: {
        file: { type: "string", format: "binary" },
        requestId: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
      },
    },
  })
  @ApiCreatedResponse({ type: MachineAccessReceiptDto })
  @UseInterceptors(
    AttachmentUploadLimit,
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        files: 1,
        fileSize: MAX_MACHINE_PHOTO_BYTES,
        fields: 2,
        parts: 3,
        fieldSize: 100,
      },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException("Choose a JPEG, PNG or WebP photo.");
    return this.service.uploadPhoto(
      user,
      validated(machineCode, code),
      body,
      file,
    );
  }
  @Post(":code/photo/remove")
  @ApiBody({ type: ChangeMachinePhotoDto })
  @ApiCreatedResponse({ type: MachineAccessReceiptDto })
  removePhoto(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.removePhoto(user, validated(machineCode, code), body);
  }
  @Get(":code/photo/:id")
  @Roles(...Object.values(Role))
  @ApiProduces("image/webp")
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async photo(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const photo = await this.service.photo(
      user,
      validated(machineCode, code),
      validated(z.string().uuid(), id),
    );
    response.setHeader("Content-Type", "image/webp");
    response.setHeader(
      "Content-Disposition",
      'inline; filename="machine-photo.webp"',
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'",
    );
    response.setHeader("Content-Length", photo.byteSize);
    response.end(Buffer.from(photo.content));
  }
}
