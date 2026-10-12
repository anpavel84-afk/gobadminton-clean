import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { unprocessable } from "../auth/problem";
import { GameChatService } from "./game-chat.service";

@Controller("games/:gameId/chat")
export class GameChatController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly chat: GameChatService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async getChat(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    return this.chat.getOrEnsureChat(consumer.userId, gameId);
  }

  @Get("messages")
  @Header("Cache-Control", "no-store")
  async listMessages(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Query("beforeSeq") beforeSeq?: string,
    @Query("afterSeq") afterSeq?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.chat.listMessages(consumer.userId, gameId, {
      beforeSeq,
      afterSeq,
      limit,
    });
  }

  @Post("messages")
  @Header("Cache-Control", "no-store")
  async send(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      text?: string;
      clientMessageId?: string;
      kind?: string;
    };
    const result = await this.chat.sendMessage(
      consumer.userId,
      consumer.sessionId,
      key,
      gameId,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("read")
  @Header("Cache-Control", "no-store")
  async markRead(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { throughSeq?: string | number };
    if (body.throughSeq === undefined || body.throughSeq === null) {
      throw unprocessable("READ_SEQ_INVALID", "throughSeq обязателен");
    }
    const result = await this.chat.markRead(
      consumer.userId,
      consumer.sessionId,
      key,
      gameId,
      body.throughSeq,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("members")
  @Header("Cache-Control", "no-store")
  async listMembers(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    return this.chat.listMembers(consumer.userId, gameId);
  }
}
