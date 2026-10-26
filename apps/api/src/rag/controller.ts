import {
  DocumentChatService,
  chatMessageSchema,
  chatPageSchema,
  turnPageSchema,
} from "./chat";
import {
  DocumentChatListDto,
  DocumentChatDetailDto,
  DocumentChatReceiptDto,
} from "./dto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Query,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "../auth";
import type { Principal } from "../repository";
import { validated } from "../production/service";
import { askSchema, emptySchema } from "./policy";
import { DocumentAiService } from "./service";
import {
  DocumentAiAnswerDto,
  DocumentAiStatusDto,
  DocumentAiRetryDto,
} from "./dto";
@ApiTags("Document assistant")
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines/:code/assistant")
export class DocumentAiController {
  constructor(
    @Inject(DocumentAiService) private readonly service: DocumentAiService,
    @Inject(DocumentChatService) private readonly chat: DocumentChatService,
  ) {}
  @Get("status")
  @ApiOkResponse({ type: DocumentAiStatusDto })
  status(@CurrentUser() user: Principal, @Param("code") code: string) {
    return this.service.status(user, code);
  }
  @Get("chats")
  @ApiOkResponse({ type: DocumentChatListDto })
  chats(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Query() query: unknown,
  ) {
    return this.chat.list(user, code, validated(chatPageSchema, query).before);
  }
  @Get("chats/:id")
  @ApiOkResponse({ type: DocumentChatDetailDto })
  transcript(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return this.chat.detail(
      user,
      code,
      validated(z.string().uuid(), id),
      validated(turnPageSchema, query).before,
    );
  }
  @Post("chat")
  @HttpCode(200)
  @ApiOkResponse({ type: DocumentChatReceiptDto })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "requestId"],
      properties: {
        question: { type: "string", minLength: 1, maxLength: 1000 },
        requestId: { type: "string", format: "uuid" },
        chatId: { type: "string", format: "uuid" },
      },
    },
  })
  message(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.chat.send(user, code, validated(chatMessageSchema, body));
  }
  @Post("ask")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 3, maxLength: 1000 },
      },
    },
  })
  @ApiOkResponse({ type: DocumentAiAnswerDto })
  ask(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.service.ask(user, code, validated(askSchema, body).question);
  }
  @Post("indexes/:id/retry")
  @HttpCode(200)
  @Roles(Role.ADMINISTRATOR, Role.MAINTENANCE_HEAD)
  @ApiOkResponse({ type: DocumentAiRetryDto })
  retry(
    @CurrentUser() user: Principal,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    validated(emptySchema, body);
    return this.service.retry(user, code, validated(z.string().uuid(), id));
  }
}
