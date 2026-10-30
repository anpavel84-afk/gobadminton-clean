import { Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { PlayInterestsService } from "./play-interests.service";

@Controller()
export class PlayInterestsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly interests: PlayInterestsService,
  ) {}

  @Get("me/play-interest-states")
  @Header("Cache-Control", "no-store")
  async states(@Req() req: FastifyRequest, @Query("publicPlayerId") ids: unknown) {
    const a = await this.auth.requireSession(req);
    return this.interests.states(a.userId, a.sessionId, ids);
  }

  @Post("play-interests")
  @Header("Cache-Control", "no-store")
  async create(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const a = await this.auth.requireCookieMutation(req);
    const result = await this.interests.create(
      a.userId,
      a.sessionId,
      this.idempotency.requireKey(req.headers["idempotency-key"]),
      req.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("play-interests/:interestId/withdraw")
  @Header("Cache-Control", "no-store")
  async withdraw(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("interestId") id: string,
  ) {
    const a = await this.auth.requireCookieMutation(req);
    const result = await this.interests.withdraw(
      a.userId,
      a.sessionId,
      this.idempotency.requireKey(req.headers["idempotency-key"]),
      id,
      req.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
