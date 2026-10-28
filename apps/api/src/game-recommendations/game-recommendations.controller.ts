import { Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameRecommendationsService } from "./game-recommendations.service";
import type { Action } from "./game-recommendations.policy";
@Controller()
export class GameRecommendationsController {
  constructor(private readonly auth:ConsumerAuthService,private readonly idempotency:IdempotencyService,
    private readonly recommendations:GameRecommendationsService) {}
  @Post("games/:gameId/recommendations") @Header("Cache-Control","no-store")
  async send(@Req() req:FastifyRequest,@Res({passthrough:true}) reply:FastifyReply,@Param("gameId") id:string) {
    const a=await this.auth.requireCookieMutation(req);
    const result=await this.recommendations.send(a.userId,a.sessionId,
      this.idempotency.requireKey(req.headers["idempotency-key"]),id,req.body);
    reply.status(result.statusCode);return result.body;
  }
  @Get("me/game-recommendations") @Header("Cache-Control","no-store")
  async list(@Req() req:FastifyRequest,@Query() query:unknown) {
    const a=await this.auth.requireSession(req);
    return this.recommendations.list(a.userId,a.sessionId,query);
  }
  private async decision(req:FastifyRequest,reply:FastifyReply,id:string,action:Action) {
    const a=await this.auth.requireCookieMutation(req);
    const result=await this.recommendations.decide(a.userId,a.sessionId,
      this.idempotency.requireKey(req.headers["idempotency-key"]),id,action,req.body);
    reply.status(result.statusCode);return result.body;
  }
  @Post("me/game-recommendations/:id/hide") @Header("Cache-Control","no-store")
  hide(@Req() req:FastifyRequest,@Res({passthrough:true}) reply:FastifyReply,@Param("id") id:string) {
    return this.decision(req,reply,id,"hide");
  }
  @Post("me/game-recommendations/:id/withdraw") @Header("Cache-Control","no-store")
  withdraw(@Req() req:FastifyRequest,@Res({passthrough:true}) reply:FastifyReply,@Param("id") id:string) {
    return this.decision(req,reply,id,"withdraw");
  }
}
