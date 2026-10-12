import { IdempotencyService } from "../common/idempotency.service";
import { Controller, Get, Header, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { GeographicRadarService } from "./geographic.service";

@Controller("radar")
export class GeographicRadarController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly radar: GeographicRadarService,
    private readonly idempotency: IdempotencyService,
  ) {}
  @Get("config")
  @Header("Cache-Control", "no-store")
  async config(@Req() request: FastifyRequest) {
    const viewer = await this.auth.requireSession(request);
    return this.radar.config(viewer.userId, viewer.sessionId);
  }
  @Post("results/query")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async query(@Req() request: FastifyRequest) {
    const viewer = await this.auth.requireCookieMutation(request);
    // Compatibility transport key only; no geo result is stored in a receipt.
    this.idempotency.requireKey(request.headers["idempotency-key"]);
    return this.radar.query(viewer.userId, viewer.sessionId, request.body);
  }
}
