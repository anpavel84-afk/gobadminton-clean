import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import { badRequest } from "./problem";

@Controller("me")
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async getMe(@Req() request: FastifyRequest) {
    return this.auth.getMe(request);
  }

  @Get("linked-providers")
  @Header("Cache-Control", "no-store")
  async listLinkedProviders(@Req() request: FastifyRequest) {
    return this.auth.listLinkedProviders(request);
  }

  @Post("linked-providers/:provider/link")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async startLink(
    @Param("provider") provider: string,
    @Query("returnPath") returnPath: string | undefined,
    @Body() body: { returnPath?: string } | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.auth.startLinkProvider(
      request,
      reply,
      provider,
      body?.returnPath ?? returnPath,
    );
  }

  @Delete("linked-providers/:provider")
  @Header("Cache-Control", "no-store")
  async unlinkProvider(
    @Param("provider") provider: string,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.unlinkProvider(request, provider);
  }

  @Get("sessions")
  @Header("Cache-Control", "no-store")
  async listSessions(@Req() request: FastifyRequest) {
    return this.auth.listSessions(request);
  }

  @Post("sessions/revoke-others")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async revokeOtherSessions(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() _body: Record<string, never>,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 128
    ) {
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Требуется Idempotency-Key");
    }
    return this.auth.revokeOtherSessions(request);
  }

  @Delete("sessions/:sessionId")
  @Header("Cache-Control", "no-store")
  async revokeSession(
    @Param("sessionId") sessionId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.revokeSession(request, sessionId);
  }
}
