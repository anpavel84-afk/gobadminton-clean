import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../auth/problem";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import type { PushPreferenceBody, PushRegisterBody } from "./push.dto";
import { PushService } from "./push.service";

/** DELETE /me/push/subscriptions/{id} requires exact JSON command {confirm:true}. */
function requirePushUnsubscribeConfirm(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest(
      "INVALID_PUSH_UNSUBSCRIBE_COMMAND",
      "Требуется подтверждение отписки",
    );
  }
  const command = body as Record<string, unknown>;
  if (Object.keys(command).length !== 1 || command.confirm !== true) {
    throw badRequest(
      "INVALID_PUSH_UNSUBSCRIBE_COMMAND",
      "Требуется подтверждение отписки",
    );
  }
}

@Controller()
export class PushController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly push: PushService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("me/push")
  @Header("Cache-Control", "no-store")
  async state(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.push.getState(consumer.userId, consumer.sessionId);
  }

  @Put("me/push/preference")
  @Header("Cache-Control", "no-store")
  async setPreference(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as PushPreferenceBody;
    const result = await this.push.setPreference(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("me/push/subscriptions")
  @Header("Cache-Control", "no-store")
  async register(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as PushRegisterBody;
    const result = await this.push.registerDevice(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Delete("me/push/subscriptions/:subscriptionId")
  @Header("Cache-Control", "no-store")
  async unsubscribe(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    requirePushUnsubscribeConfirm(request.body);
    const result = await this.push.unsubscribeDevice(
      consumer.userId,
      consumer.sessionId,
      key,
      subscriptionId,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("me/push/subscriptions/current/unsubscribe")
  @Header("Cache-Control", "no-store")
  async unsubscribeCurrent(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { endpoint?: unknown };
    const result = await this.push.unsubscribeCurrentDevice(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
