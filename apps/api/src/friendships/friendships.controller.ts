import { Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { FriendshipsService } from "./friendships.service";

@Controller()
export class FriendshipsController {
  constructor(private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly friends: FriendshipsService) {}
  @Get("me/social-capabilities") @Header("Cache-Control", "no-store")
  async capabilities(@Req() req: FastifyRequest) {
    const a = await this.auth.requireSession(req);
    return this.friends.capabilities(a.userId,a.sessionId);
  }
  @Get("me/friendships") @Header("Cache-Control", "no-store")
  async list(@Req() req: FastifyRequest, @Query() query: unknown) {
    const a = await this.auth.requireSession(req);
    return this.friends.list(a.userId,a.sessionId,query);
  }
  @Get("me/friendship-states") @Header("Cache-Control", "no-store")
  async states(@Req() req: FastifyRequest, @Query("publicPlayerId") ids: unknown) {
    const a = await this.auth.requireSession(req);
    return this.friends.states(a.userId,a.sessionId,ids);
  }
  @Get("friendships/:friendshipId") @Header("Cache-Control", "no-store")
  async get(@Req() req: FastifyRequest, @Param("friendshipId") id: string) {
    const a = await this.auth.requireSession(req);
    return this.friends.get(a.userId,a.sessionId,id);
  }
  @Post("friend-requests") @Header("Cache-Control", "no-store")
  async create(@Req() req: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply) {
    const a = await this.auth.requireCookieMutation(req);
    const result = await this.friends.create(a.userId,a.sessionId,this.idempotency.requireKey(req.headers["idempotency-key"]),req.body);
    reply.status(result.statusCode); return result.body;
  }
  private async decision(req: FastifyRequest, reply: FastifyReply, id: string, action: "accept"|"decline"|"cancel"|"remove") {
    const a = await this.auth.requireCookieMutation(req);
    const result = await this.friends.decide(a.userId,a.sessionId,this.idempotency.requireKey(req.headers["idempotency-key"]),id,action,req.body);
    reply.status(result.statusCode); return result.body;
  }
  @Post("friend-requests/:requestId/accept") @Header("Cache-Control", "no-store")
  accept(@Req() req: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply, @Param("requestId") id: string) { return this.decision(req,reply,id,"accept"); }
  @Post("friend-requests/:requestId/decline") @Header("Cache-Control", "no-store")
  decline(@Req() req: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply, @Param("requestId") id: string) { return this.decision(req,reply,id,"decline"); }
  @Post("friend-requests/:requestId/cancel") @Header("Cache-Control", "no-store")
  cancel(@Req() req: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply, @Param("requestId") id: string) { return this.decision(req,reply,id,"cancel"); }
  @Post("friendships/:friendshipId/remove") @Header("Cache-Control", "no-store")
  remove(@Req() req: FastifyRequest, @Res({passthrough:true}) reply: FastifyReply, @Param("friendshipId") id: string) { return this.decision(req,reply,id,"remove"); }
}
