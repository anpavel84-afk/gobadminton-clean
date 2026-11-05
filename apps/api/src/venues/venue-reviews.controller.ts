import { Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { VenueReviewsService } from "./venue-reviews.service";

@Controller()
export class VenueReviewsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly reviews: VenueReviewsService,
  ) {}

  @Get("venues/:venueId/experience-reviews")
  @Header("Cache-Control", "no-store")
  async listPublic(
    @Param("venueId") venueId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.reviews.listPublic(venueId, { cursor, limit });
  }

  @Get("me/venue-reviews/eligibility")
  @Header("Cache-Control", "no-store")
  async eligibility(@Req() request: FastifyRequest, @Query("venueId") venueId: string) {
    const actor = await this.auth.requireSession(request);
    return this.reviews.eligibility(actor.userId, venueId);
  }

  @Post("me/venue-reviews/consent-preview")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async consentPreview(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireCookieMutation(request);
    return this.reviews.previewConsent(actor.userId, request.body);
  }

  @Post("me/venue-reviews")
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reviews.createReview(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("me/venue-reviews")
  @Header("Cache-Control", "no-store")
  async listMine(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireSession(request);
    return this.reviews.listMine(actor.userId);
  }

  @Post("me/venue-reviews/:id/commands")
  @Header("Cache-Control", "no-store")
  async ownCommand(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reviews.ownCommand(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      id,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("venue-reviews/:reviewHandle/reports")
  @Header("Cache-Control", "no-store")
  async report(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reviewHandle") reviewHandle: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.reviews.report(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      reviewHandle,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
