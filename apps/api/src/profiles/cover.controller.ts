import { Controller, Get, Header, Param, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { AvatarService } from "./avatar.service";
import { coverForUser } from "./cover-presentation";
import { Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../tokens";

@Controller()
export class CoverController {
  constructor(private readonly auth: ConsumerAuthService, private readonly media: AvatarService,
    @Inject(DATABASE_POOL) private readonly pool: Pool) {}
  @Get("me/cover")
  @Header("Cache-Control", "no-store")
  async getOwn(@Req() request: FastifyRequest) {
    const actor = await this.auth.requireSession(request);
    const row = await this.pool.query<{version: number}>("SELECT version FROM player_social_profiles WHERE user_id=$1", [actor.userId]);
    return { version: row.rows[0]?.version ?? 0, cover: await coverForUser(this.pool, actor.userId) };
  }
  @Get("media/venue-covers/:key")
  async readVenue(@Param("key") key: string, @Res() reply: FastifyReply) {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type("image/png").send(await this.media.readVenueCover(key));
  }
  @Get("media/covers/:key")
  async read(@Req() request: FastifyRequest, @Param("key") key: string, @Res() reply: FastifyReply) {
    reply.header("Cache-Control", "no-store").header("Vary", "Cookie").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    const actor = await this.auth.optionalSession(request);
    return reply.type("image/png").send(await this.media.readCover(key, actor?.userId ?? null));
  }
}
