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
import { AdminService } from "./admin.service";
import {
  commandSchema,
  emptyBodySchema,
  optionsSchema,
  parse,
  verifySchema,
} from "./dto";
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Post("auth/:provider/start")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(
    @Param("provider") provider: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.admin.enabled();
    parse(emptyBodySchema, body);
    return this.admin.start(provider, request, reply);
  }
  @Get("auth/:provider/callback")
  @Header("Cache-Control", "no-store")
  callback(
    @Param("provider") provider: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.admin.callback(provider, query, request, reply);
  }
  @Post("auth/webauthn/options")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  options(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.admin.enabled();
    return this.admin.options(parse(optionsSchema, body), request);
  }
  @Post("auth/webauthn/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verify(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.admin.enabled();
    return this.admin.verify(parse(verifySchema, body), request, reply);
  }
  @Get("auth/me")
  @Header("Cache-Control", "no-store")
  me(@Req() request: FastifyRequest) {
    return this.admin.me(request);
  }
  @Post("auth/logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  logout(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.admin.enabled();
    parse(emptyBodySchema, body);
    return this.admin.logout(request, reply, key);
  }
  @Get("principals")
  @Header("Cache-Control", "no-store")
  principals(@Req() request: FastifyRequest) {
    return this.admin.principals(request);
  }
  @Post("identity/commands")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  command(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    this.admin.enabled();
    return this.admin.command(parse(commandSchema, body), key, request);
  }
  @Get("audit/security")
  @Header("Cache-Control", "no-store")
  audit(@Req() request: FastifyRequest) {
    return this.admin.audit(request);
  }
}
