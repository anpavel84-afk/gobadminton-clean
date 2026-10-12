import {badRequest} from "../auth/problem";
import { Controller, Header, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { RadarService } from "./radar.service";

@Controller("radar/results")
export class RadarPreviewController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly radar: RadarService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post("preview")
  @Header("Cache-Control", "no-store")
  async preview(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    // Transport key required by foundation cookie-mutation rules; preview is
    // revalidated against current state and does not mint a durable receipt.
    this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { resultRef?: string };
    if(typeof body.resultRef === "string" && body.resultRef.startsWith("u1.") && Object.keys(body).some(k=>k!=="resultRef"))throw badRequest("INVALID_REQUEST","Некорректный запрос preview");
    const result = await this.radar.preview(
      consumer.userId,
      consumer.sessionId,
      body,
    );
    reply.status(200);
    return result;
  }
}
