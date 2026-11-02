import { Controller, Get, Header, Param, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameCourtBookingService } from "./game-court-booking.service";

@Controller()
export class GameCourtBookingController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly booking: GameCourtBookingService,
  ) {}

  @Get("games/:gameId/court-booking")
  @Header("Cache-Control", "no-store")
  async get(@Req() request: FastifyRequest, @Param("gameId") gameId: string) {
    const actor = await this.auth.requireSession(request);
    return this.booking.get(gameId, actor.userId);
  }

  @Put("games/:gameId/court-booking")
  @Header("Cache-Control", "no-store")
  async put(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.booking.put(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
