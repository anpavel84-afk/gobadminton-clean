import { Controller, Get, Header, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { DiscoveryPreferencesService } from "./discovery-preferences.service";

@Controller("me/discovery-preference")
export class MeDiscoveryPreferenceController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly preferences: DiscoveryPreferencesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  async getOwn(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.preferences.getOwn(consumer.userId);
  }

  @Put()
  @Header("Cache-Control", "private, no-store")
  async putOwn(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    // Anonymous/revoked callers get 401 even when mutation headers are missing.
    await this.auth.requireSession(request);
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.preferences.putOwn(consumer.userId, consumer.sessionId, key, request.body);
    reply.status(result.statusCode);
    return result.body;
  }
}
