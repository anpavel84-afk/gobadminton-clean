import { Controller, Get, Header, Post, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import {
  TrainersService,
  type UpsertTrainerProfileInput,
} from "./trainers.service";

@Controller("me/trainer-profile")
export class TrainersController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly trainers: TrainersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async getOwn(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.trainers.getOwn(consumer.userId);
  }

  @Put()
  @Header("Cache-Control", "no-store")
  async upsertOwn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as UpsertTrainerProfileInput;
    const result = await this.trainers.upsertOwn(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("deactivate")
  @Header("Cache-Control", "no-store")
  async deactivateOwn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.trainers.deactivateOwn(
      consumer.userId,
      consumer.sessionId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
