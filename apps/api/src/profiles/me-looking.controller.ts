import { Controller, Delete, Header, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import {
  ProfilesService,
  type LookingPutInput,
} from "./profiles.service";

@Controller("me/looking-for-game")
export class MeLookingController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly profiles: ProfilesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Put()
  @Header("Cache-Control", "no-store")
  async putLooking(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as LookingPutInput;
    const result = await this.profiles.putLooking(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Delete()
  @Header("Cache-Control", "no-store")
  async deleteLooking(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.profiles.deleteLooking(
      consumer.userId,
      consumer.sessionId,
      key,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
