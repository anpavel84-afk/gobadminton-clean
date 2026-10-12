import { Controller, Header, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { SafetyService, type CreateReportInput } from "./safety.service";

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly safety: SafetyService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as CreateReportInput;
    const result = await this.safety.createReport(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
