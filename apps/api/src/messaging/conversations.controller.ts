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
import { MessagingService } from "./messaging.service";

@Controller("conversations")
export class ConversationsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly messaging: MessagingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post("requests")
  @Header("Cache-Control", "no-store")
  async createRequest(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      targetPublicPlayerId?: string;
      text?: string;
      clientMessageId?: string;
      discoveryProof?: string | null;
      gameContextId?: string | null;
    };
    const result = await this.messaging.createRequest(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
    @Query("archived") archivedRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.messaging.listConversations(consumer.userId, {
      cursor,
      limit,
      archived:
        archivedRaw === undefined
          ? undefined
          : archivedRaw === "1" || archivedRaw === "true",
    });
  }

  @Get(":conversationId")
  @Header("Cache-Control", "no-store")
  async getOne(
    @Req() request: FastifyRequest,
    @Param("conversationId") conversationId: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    return this.messaging.getConversation(consumer.userId, conversationId);
  }

  @Post(":conversationId/accept")
  @Header("Cache-Control", "no-store")
  async accept(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("conversationId") conversationId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const expectedVersion = body.expectedVersion;
    if (typeof expectedVersion !== "number") {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const result = await this.messaging.accept(
      consumer.userId,
      consumer.sessionId,
      key,
      conversationId,
      expectedVersion,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post(":conversationId/decline")
  @Header("Cache-Control", "no-store")
  async decline(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("conversationId") conversationId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const expectedVersion = body.expectedVersion;
    if (typeof expectedVersion !== "number") {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const result = await this.messaging.decline(
      consumer.userId,
      consumer.sessionId,
      key,
      conversationId,
      expectedVersion,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get(":conversationId/messages")
  @Header("Cache-Control", "no-store")
  async listMessages(
    @Req() request: FastifyRequest,
    @Param("conversationId") conversationId: string,
    @Query("beforeSeq") beforeSeq?: string,
    @Query("afterSeq") afterSeq?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.messaging.listMessages(consumer.userId, conversationId, {
      beforeSeq,
      afterSeq,
      limit,
    });
  }

  @Post(":conversationId/messages")
  @Header("Cache-Control", "no-store")
  async send(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("conversationId") conversationId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      text?: string;
      clientMessageId?: string;
      kind?: string;
    };
    const result = await this.messaging.sendMessage(
      consumer.userId,
      consumer.sessionId,
      key,
      conversationId,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post(":conversationId/read")
  @Header("Cache-Control", "no-store")
  async markRead(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("conversationId") conversationId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { throughSeq?: string | number };
    if (body.throughSeq === undefined || body.throughSeq === null) {
      throw unprocessable("READ_SEQ_INVALID", "throughSeq обязателен");
    }
    const result = await this.messaging.markRead(
      consumer.userId,
      consumer.sessionId,
      key,
      conversationId,
      body.throughSeq,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post(":conversationId/messages/:messageId/hide")
  @Header("Cache-Control", "no-store")
  async hide(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.messaging.hideMessage(
      consumer.userId,
      consumer.sessionId,
      key,
      conversationId,
      messageId,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
