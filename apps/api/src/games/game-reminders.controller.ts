import { Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameRemindersService } from "./game-reminders.service";

@Controller()
export class GameRemindersController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly reminders: GameRemindersService,
  ) {}

  @Get("me/postgame-reminders")
  @Header("Cache-Control", "no-store")
  async listMine(
    @Req() request: FastifyRequest,
    @Query("limit") limit?: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.reminders.listMine(actor.userId, limit);
  }

  @Post("me/postgame-reminders/:reminderId")
  @Header("Cache-Control", "no-store")
  async later(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reminderId") reminderId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reminders.later(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reminderId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
