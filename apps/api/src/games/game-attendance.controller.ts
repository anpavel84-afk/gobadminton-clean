import { Controller, Get, Header, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { GameAttendanceService } from "./game-attendance.service";

@Controller()
export class GameAttendanceController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly idempotency: IdempotencyService,
    private readonly attendance: GameAttendanceService,
  ) {}

  @Get("me/game-results")
  @Header("Cache-Control", "no-store")
  async listMine(
    @Req() request: FastifyRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.attendance.listMeGameResults(actor.userId, { limit, cursor });
  }

  @Put("games/:gameId/attendance/:contextId")
  @Header("Cache-Control", "no-store")
  async putAttendance(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.putAttendance(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      contextId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("games/:gameId/attendance/bulk-present")
  @Header("Cache-Control", "no-store")
  async bulkPresent(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.bulkPresent(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("games/:gameId/attendance/:contextId/acknowledgements")
  @Header("Cache-Control", "no-store")
  async acknowledge(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.acknowledge(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      contextId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("games/:gameId/attendance/:contextId/disputes")
  @Header("Cache-Control", "no-store")
  async dispute(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.dispute(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      gameId,
      contextId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("games/:gameId/attendance/:contextId/history")
  @Header("Cache-Control", "no-store")
  async history(
    @Req() request: FastifyRequest,
    @Param("gameId") gameId: string,
    @Param("contextId") contextId: string,
    @Query("limit") limit?: string,
  ) {
    const actor = await this.auth.requireSession(request);
    return this.attendance.listAttendanceHistory(gameId, contextId, actor.userId, { limit });
  }

  @Get("attendance-disputes/:disputeId")
  @Header("Cache-Control", "no-store")
  async getDispute(@Req() request: FastifyRequest, @Param("disputeId") disputeId: string) {
    const actor = await this.auth.requireSession(request);
    return this.attendance.getDispute(disputeId, actor.userId);
  }

  @Post("attendance-disputes/:disputeId/withdraw")
  @Header("Cache-Control", "no-store")
  async withdraw(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("disputeId") disputeId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.withdrawDispute(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      disputeId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("attendance-disputes/:disputeId/responses")
  @Header("Cache-Control", "no-store")
  async respond(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("disputeId") disputeId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.respondDispute(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      disputeId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("attendance-disputes/:disputeId/help")
  @Header("Cache-Control", "no-store")
  async help(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("disputeId") disputeId: string,
  ) {
    const actor = await this.auth.requireCookieMutation(request);
    const result = await this.attendance.requestDisputeHelp(
      actor.userId,
      actor.sessionId,
      this.idempotency.requireKey(request.headers["idempotency-key"]),
      disputeId,
      request.body,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
