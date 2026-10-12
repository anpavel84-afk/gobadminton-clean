import {
  Controller,
  Get,
  Header,
  Patch,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import {
  ProfilesService,
  type PatchSocialProfileInput,
  type VisibilityInput,
} from "./profiles.service";

@Controller("me/social-profile")
export class MeSocialProfileController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly profiles: ProfilesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async getOwn(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.profiles.getOwn(consumer.userId);
  }

  @Patch()
  @Header("Cache-Control", "no-store")
  async patchOwn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as PatchSocialProfileInput;
    const result = await this.profiles.patchOwn(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Put("visibility")
  @Header("Cache-Control", "no-store")
  async setVisibility(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as VisibilityInput;
    const result = await this.profiles.setVisibility(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
