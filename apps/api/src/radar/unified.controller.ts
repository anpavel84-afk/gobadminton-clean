import { Controller, Post, Header, Req, HttpCode } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { UnifiedPlayersService } from "./unified.service";
@Controller("players/query")
export class UnifiedPlayersController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly players: UnifiedPlayersService,
  ) {}
  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async query(@Req() request: FastifyRequest) {
    const v = await this.auth.requireCookieMutation(request);
    return this.players.query(v.userId, v.sessionId, request.body);
  }
  @Post("map")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async map(@Req() request: FastifyRequest) {
    const v = await this.auth.requireCookieMutation(request);
    return this.players.query(v.userId, v.sessionId, request.body, true);
  }
}
