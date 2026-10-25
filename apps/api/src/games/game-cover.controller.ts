import { Controller, Delete, Get, Header, Param, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { coverDeleteVersion } from "../profiles/cover-command";
import { GameCoverService } from "./game-cover.service";
@Controller()
export class GameCoverController {
  constructor(private readonly auth:ConsumerAuthService,private readonly covers:GameCoverService,private readonly idempotency:IdempotencyService){}
  @Get("games/:gameId/cover")
  @Header("Cache-Control","no-store")
  async get(@Req() r:FastifyRequest,@Param("gameId") id:string){return this.covers.get(id,await this.auth.requireSession(r));}
  @Put("games/:gameId/cover")
  @Header("Cache-Control","no-store")
  async put(@Req() r:FastifyRequest,@Param("gameId") id:string){
    return this.covers.mutate(await this.auth.requireCookieMutation(r),this.idempotency.requireKey(r.headers["idempotency-key"]),id,r.headers["x-game-version"],{body:r.body,mime:r.headers["content-type"]??""});
  }
  @Delete("games/:gameId/cover")
  @Header("Cache-Control","no-store")
  async remove(@Req() r:FastifyRequest,@Param("gameId") id:string){
    return this.covers.mutate(await this.auth.requireCookieMutation(r),this.idempotency.requireKey(r.headers["idempotency-key"]),id,coverDeleteVersion(r.body,r.headers["x-game-version"]));
  }
  @Get("media/game-covers/:key")
  async read(@Req() r:FastifyRequest,@Param("key") key:string,@Res() reply:FastifyReply){
    reply.header("Cache-Control","no-store").header("Vary","Cookie").header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","default-src 'none'; sandbox");
    return reply.type("image/png").send(await this.covers.read(key,(await this.auth.optionalSession(r))?.userId??null));
  }
}
