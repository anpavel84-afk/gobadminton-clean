import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { projectCommentAvatar } from "../profiles/public-avatar-projection";
import { CommentsService } from "./comments.service";

@Controller()
export class CommentsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly comments: CommentsService,
  ) {}

  @Get("games/:gameId/comments")
  @Header("Cache-Control", "no-store")
  async listGame(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("order") order?: string,
    @Query("parentCommentId") parentCommentId?: string,
  ) {
    const viewer = await this.auth.optionalSession(request);
    return this.comments.list("game", gameId, viewer?.userId ?? null, {
      cursor,
      limit,
      order,
      parentCommentId,
    });
  }

  @Post("games/:gameId/comments")
  @Header("Cache-Control", "no-store")
  async createGame(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.comments.create(
      "game",
      gameId,
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return projectCommentAvatar(result.body);
  }

  @Get("venues/:venueId/comments")
  @Header("Cache-Control", "no-store")
  async listVenue(
    @Req() request: FastifyRequest,
    @Param("venueId") venueId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("order") order?: string,
    @Query("parentCommentId") parentCommentId?: string,
  ) {
    const viewer = await this.auth.optionalSession(request);
    return this.comments.list("venue", venueId, viewer?.userId ?? null, {
      cursor,
      limit,
      order,
      parentCommentId,
    });
  }

  @Post("venues/:venueId/comments")
  @Header("Cache-Control", "no-store")
  async createVenue(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("venueId") venueId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.comments.create(
      "venue",
      venueId,
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return projectCommentAvatar(result.body);
  }

  @Put("comments/:commentId")
  @Header("Cache-Control", "no-store")
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("commentId") commentId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.comments.update(
      commentId,
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return projectCommentAvatar(result.body);
  }

  @Delete("comments/:commentId")
  @Header("Cache-Control", "no-store")
  async remove(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("commentId") commentId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.comments.remove(
      commentId,
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return projectCommentAvatar(result.body);
  }
}
