import {
  Controller,
  Delete,
  Header,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { SafetyService } from "./safety.service";

@Controller("me/blocks")
export class BlocksController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly safety: SafetyService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Put(":publicPlayerId")
  @Header("Cache-Control", "no-store")
  async block(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("publicPlayerId") publicPlayerId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.safety.block(
      consumer.userId,
      consumer.sessionId,
      key,
      publicPlayerId,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Delete(":publicPlayerId")
  @Header("Cache-Control", "no-store")
  async unblock(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("publicPlayerId") publicPlayerId: string,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.safety.unblock(
      consumer.userId,
      consumer.sessionId,
      key,
      publicPlayerId,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
