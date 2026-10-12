import { Controller, Get, Header, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { GamesService } from "./games.service";

@Controller("me/games")
export class MeGamesController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly games: GamesService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async listMyManagedGames(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.games.listMineManaged(consumer.userId, { cursor, limit });
  }
}
