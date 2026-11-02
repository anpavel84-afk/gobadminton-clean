import { Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "../auth/problem";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { RoleReputationService } from "./role-reputation.service";

@Controller()
export class RoleReputationController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly reputation: RoleReputationService,
  ) {}

  @Get("role-reputations/:roleHandle")
  @Header("Cache-Control", "no-store")
  async getByHandle(
    @Req() request: FastifyRequest,
    @Param("roleHandle") roleHandle: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("gameId") gameId?: string,
  ) {
    const consumer = await this.auth.optionalSession(request);
    return this.reputation.getByRoleHandle(consumer?.userId ?? null, roleHandle, {
      cursor,
      limit,
      gameId,
    });
  }

  @Get("games/:gameId/role-reputations/:role")
  @Header("Cache-Control", "no-store")
  async getForGame(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Param("role") role: string,
  ) {
    const consumer = await this.auth.optionalSession(request);
    if (role !== "organization" && role !== "training") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    return this.reputation.getForGame(consumer?.userId ?? null, gameId, role);
  }

  @Get("players/:publicPlayerId/role-reputations/:role")
  @Header("Cache-Control", "no-store")
  async getForPlayer(
    @Req() request: FastifyRequest,
    @Param("publicPlayerId") publicPlayerId: string,
    @Param("role") role: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const consumer = await this.auth.optionalSession(request);
    if (role !== "organization" && role !== "training") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const summary = await this.reputation.getForPublicPlayer(
      consumer?.userId ?? null,
      publicPlayerId,
      role,
    );
    if (!summary) return summary;
    if (cursor || limit) {
      return this.reputation.getByRoleHandle(consumer?.userId ?? null, summary.roleHandle, {
        cursor,
        limit,
      });
    }
    return summary;
  }

  @Get("me/role-reviews/eligibility")
  @Header("Cache-Control", "no-store")
  async eligibility(
    @Req() request: FastifyRequest,
    @Query("roleHandle") roleHandle: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.reputation.eligibility(actor.userId, roleHandle);
  }

  @Post("me/role-reviews/consent-preview")
  @Header("Cache-Control", "no-store")
  async consentPreview(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireCookieMutation(request);
    return this.reputation.previewConsent(actor.userId, request.body);
  }

  @Post("me/role-reviews")
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reputation.createReview(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("me/role-reviews")
  @Header("Cache-Control", "no-store")
  async listMine(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireSession(request);
    return this.reputation.listMine(actor.userId);
  }

  @Post("me/role-reviews/:id/commands")
  @Header("Cache-Control", "no-store")
  async ownCommand(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reputation.ownCommand(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      id,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("role-reviews/:reviewHandle/reply-commands")
  @Header("Cache-Control", "no-store")
  async replyCommand(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reviewHandle") reviewHandle: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reputation.replyCommand(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reviewHandle,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("role-reviews/:reviewHandle/reports")
  @Header("Cache-Control", "no-store")
  async report(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reviewHandle") reviewHandle: string,
    @Query("gameId") gameId?: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reputation.report(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reviewHandle,
      request.body,
      gameId,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
