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
import { parseMapQuery } from "./games-map.query";
import { GamesService, type CreateGameInput } from "./games.service";

@Controller("games")
export class GamesController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly games: GamesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async listGames(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
    @Query("cityId") cityId?: string,
    @Query("startsFrom") startsFrom?: string,
    @Query("startsBefore") startsBefore?: string,
    @Query("levelScaleId") levelScaleId?: string,
    @Query("levelId") levelId?: string,
    @Query("activityKind") activityKind?: string,
    @Query("temporalScope") temporalScope?: string,
    @Query("venueId") venueId?: string,
  ) {
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    const consumer = await this.auth.optionalSession(request);
    return this.games.listPublished({
      cursor,
      limit,
      cityId,
      startsFrom,
      startsBefore,
      levelScaleId,
      levelId,
      activityKind,
      temporalScope,
      venueId,
    }, consumer?.userId ?? null);
  }

  @Get("map")
  async mapGames(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Set before validation so public error responses are also no-store.
    reply.header("Cache-Control", "no-store");
    const filter = parseMapQuery(request.raw.url ?? request.url);
    const abort = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) abort.abort(); };
    request.raw.once("aborted", onClose);
    reply.raw.once("close", onClose);
    try {
      return await this.games.mapPublished(filter, abort.signal);
    } finally {
      request.raw.removeListener("aborted", onClose);
      reply.raw.removeListener("close", onClose);
    }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  async createGame(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as CreateGameInput;
    const result = await this.games.createDraft(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get(":gameId")
  @Header("Cache-Control", "no-store")
  async getGame(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
  ) {
    const consumer = await this.auth.optionalSession(request);
    return this.games.getGame(gameId, consumer?.userId ?? null);
  }

  @Post(":gameId/publish")
  @Header("Cache-Control", "no-store")
  async publishGame(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { expectedVersion?: number };
    const result = await this.games.publish(
      consumer.userId,
      consumer.sessionId,
      gameId,
      key,
      body.expectedVersion as number,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post(":gameId/cancel")
  @Header("Cache-Control", "no-store")
  async cancelGame(
    @Param("gameId") gameId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      expectedVersion?: number;
      reason?: string;
    };
    const result = await this.games.cancel(
      consumer.userId,
      consumer.sessionId,
      gameId,
      key,
      body.expectedVersion as number,
      body.reason ?? "",
    );
    reply.status(result.statusCode);
    return result.body;
  }
}
