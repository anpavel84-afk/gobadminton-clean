import { Controller, Get, Header, Param, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameOutcomesService } from "./game-outcomes.service";

@Controller()
export class GameOutcomesController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly outcomes: GameOutcomesService,
  ) {}

  @Get("games/:gameId/results")
  @Header("Cache-Control", "no-store")
  async getResults(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Query("revisionsLimit") revisionsLimit?: string,
    @Query("revisionsCursor") revisionsCursor?: string,
    @Query("rosterLimit") rosterLimit?: string,
    @Query("rosterCursor") rosterCursor?: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.outcomes.getResults(gameId, actor.userId, {
      revisionsLimit,
      revisionsCursor,
      rosterLimit,
      rosterCursor,
    });
  }

  @Put("games/:gameId/outcome")
  @Header("Cache-Control", "no-store")
  async putOutcome(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.outcomes.putOutcome(
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
