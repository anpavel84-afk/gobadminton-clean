import { Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameFeedbackService } from "./game-feedback.service";

@Controller()
export class GameFeedbackController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly feedback: GameFeedbackService,
  ) {}

  @Post("games/:gameId/reviews")
  @Header("Cache-Control", "no-store")
  async createReview(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.feedback.createReview(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Patch("reviews/:reviewId")
  @Header("Cache-Control", "no-store")
  async patchReview(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reviewId") reviewId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.feedback.patchReview(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reviewId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Put("reviews/:reviewId/reply")
  @Header("Cache-Control", "no-store")
  async putReply(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reviewId") reviewId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.feedback.putReply(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reviewId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("me/reviews")
  @Header("Cache-Control", "no-store")
  async listMine(
    @Req() request: FastifyRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("direction") direction?: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.feedback.listMeReviews(actor.userId, { limit, cursor, direction });
  }

  @Put("games/:gameId/notes/:contextId")
  @Header("Cache-Control", "no-store")
  async putNote(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.feedback.putNote(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      contextId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Delete("games/:gameId/notes/:contextId")
  @Header("Cache-Control", "no-store")
  async deleteNote(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.feedback.deleteNote(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      contextId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("games/:gameId/notes/:contextId")
  @Header("Cache-Control", "no-store")
  async getNote(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.feedback.getOwnNote(actor.userId, gameId, contextId);
  }
}
