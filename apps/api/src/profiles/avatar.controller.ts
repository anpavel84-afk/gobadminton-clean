import { Controller, Delete, Get, Header, Param, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { AvatarService } from "./avatar.service";
import { deriveAvatarWebp, resolveMediaImageResponse } from "./media-image-response";

@Controller()
export class AvatarController {
  constructor(private readonly auth: ConsumerAuthService, private readonly avatars: AvatarService, private readonly idempotency: IdempotencyService) {}
  @Put("me/avatar")
  @Header("Cache-Control", "no-store")
  async replace(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    return this.avatars.mutate(actor, key, request.headers["x-profile-version"], { body: request.body, mime: request.headers["content-type"] ?? "" });
  }
  @Delete("me/avatar")
  @Header("Cache-Control", "no-store")
  async remove(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    return this.avatars.mutate(actor, key, request.headers["x-profile-version"]);
  }
  @Get("media/avatars/:key")
  async read(@Req() request: FastifyRequest, @Param("key") key: string, @Res() reply: FastifyReply) {
    reply.header("Cache-Control", "no-store").header("Vary", "Accept").header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; sandbox");
    // Authorization/read first; negotiation never masks unavailable avatars.
    const original = await this.avatars.read(key);
    const response = await resolveMediaImageResponse(original, request.headers.accept, deriveAvatarWebp);
    return reply.type(response.contentType).send(response.body);
  }
}
