import { Controller, Get, Header, Patch, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GamePreferencesService, type PatchGamePreferencesInput } from "./game-preferences.service";

@Controller("me/game-preferences")
export class MeGamePreferencesController {
  constructor(private readonly auth: ConsumerAuthService, private readonly preferences: GamePreferencesService, private readonly idempotency: IdempotencyService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  async getOwn(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.preferences.getOwn(consumer.userId);
  }
  @Patch()
  @Header("Cache-Control", "no-store")
  async patchOwn(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.preferences.patchOwn(consumer.userId, consumer.sessionId, key, request.body as PatchGamePreferencesInput);
    reply.status(result.statusCode);
    return result.body;
  }
}
