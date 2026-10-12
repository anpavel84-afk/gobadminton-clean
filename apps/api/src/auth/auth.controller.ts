import {
  Body,
  Controller,
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

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get("providers")
  @Header("Cache-Control", "no-store")
  listProviders() {
    return this.auth.listProviders();
  }

  @Get(":provider/start")
  @Header("Cache-Control", "no-store")
  async start(
    @Param("provider") provider: string,
    @Query("returnPath") returnPath: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.auth.startBrowserAuth(provider, returnPath, reply);
  }

  @Get(":provider/callback")
  @Header("Cache-Control", "no-store")
  async callback(
    @Param("provider") provider: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { redirectTo } = await this.auth.handleBrowserCallback(
      provider,
      query,
      request,
      reply,
    );
    return reply.status(302).redirect(redirectTo);
  }

  @Post("logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
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
    await this.auth.logout(request, reply);
  }
}
