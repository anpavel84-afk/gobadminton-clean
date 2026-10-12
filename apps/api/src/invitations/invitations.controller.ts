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
import { InvitationsService } from "./invitations.service";

@Controller()
export class InvitationsController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly invitations: InvitationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post("games/:gameId/invitations")
  @Header("Cache-Control", "no-store")
  async create(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      inviteePublicPlayerId?: string;
      expectedGameVersion?: number;
      discoveryProof?: string | null;
    };
    const result = await this.invitations.create(
      consumer.userId,
      consumer.sessionId,
      gameId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("games/:gameId/invitations")
  @Header("Cache-Control", "no-store")
  async listForGame(
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
    return this.invitations.listForGame(consumer.userId, gameId, {
      cursor,
      limit,
    });
  }

  @Get("me/invitations")
  @Header("Cache-Control", "no-store")
  async listMine(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.invitations.listMine(consumer.userId, { cursor, limit });
  }

  @Get("invitations/:invitationId")
  @Header("Cache-Control", "no-store")
  async getOne(
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
  ) {
    const consumer = await this.auth.requireSession(request);
    return this.invitations.getOne(consumer.userId, invitationId);
  }

  @Post("invitations/:invitationId/accept")
  @Header("Cache-Control", "no-store")
  async accept(
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      expectedVersion?: number;
      expectedGameVersion?: number;
    };
    const result = await this.invitations.accept(
      consumer.userId,
      consumer.sessionId,
      invitationId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("invitations/:invitationId/decline")
  @Header("Cache-Control", "no-store")
  async decline(
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.invitations.decline(
      consumer.userId,
      consumer.sessionId,
      invitationId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("invitations/:invitationId/revoke")
  @Header("Cache-Control", "no-store")
  async revoke(
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.invitations.revoke(
      consumer.userId,
      consumer.sessionId,
      invitationId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
