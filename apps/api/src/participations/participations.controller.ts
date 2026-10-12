import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { ParticipationsService } from "./participations.service";

@Controller()
export class ParticipationsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly participations: ParticipationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("games/:gameId/participations")
  @Header("Cache-Control", "no-store")
  async listGameParticipations(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.participations.listForGame(consumer.userId, gameId, {
      cursor,
      limit,
    });
  }

  @Post("games/:gameId/participations")
  @Header("Cache-Control", "no-store")
  async requestParticipation(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      expectedGameVersion?: number;
      sourceCode?: string;
    };
    const result = await this.participations.request(
      consumer.userId,
      consumer.sessionId,
      gameId,
      key,
      body.expectedGameVersion as number,
      body.sourceCode,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("me/participations")
  @Header("Cache-Control", "no-store")
  async listMyParticipations(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.participations.listMine(consumer.userId, { cursor, limit });
  }

  @Post("participations/:participationId/confirm")
  @Header("Cache-Control", "no-store")
  async confirmParticipation(
    @Param("participationId") participationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.participations.confirm(
      consumer.userId,
      consumer.sessionId,
      participationId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("participations/:participationId/reject")
  @Header("Cache-Control", "no-store")
  async rejectParticipation(
    @Param("participationId") participationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      expectedVersion?: number;
      reason?: string;
    };
    const result = await this.participations.reject(
      consumer.userId,
      consumer.sessionId,
      participationId,
      key,
      body.expectedVersion as number,
      body.reason ?? "",
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("participations/:participationId/withdraw")
  @Header("Cache-Control", "no-store")
  async withdrawParticipation(
    @Param("participationId") participationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.participations.withdraw(
      consumer.userId,
      consumer.sessionId,
      participationId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("participations/:participationId/remove")
  @Header("Cache-Control", "no-store")
  async removeParticipation(
    @Param("participationId") participationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      expectedVersion?: number;
      reason?: string;
    };
    const result = await this.participations.remove(
      consumer.userId,
      consumer.sessionId,
      participationId,
      key,
      body.expectedVersion as number,
      body.reason ?? "",
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
