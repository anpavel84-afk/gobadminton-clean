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
import { badRequest } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { InboxService } from "./inbox.service";

@Controller("me/inbox")
export class InboxController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly inbox: InboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
    @Query("filter") filter?: string,
  ) {
    const consumer = await this.auth.requireSession(request);
    const limit = parseStrictLimit(limitRaw);
    return this.inbox.list(consumer.userId, { cursor, limit, filter });
  }

  @Get("counts")
  @Header("Cache-Control", "no-store")
  async counts(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.inbox.counts(consumer.userId);
  }

  @Post("items/:kind/:id/read")
  @Header("Cache-Control", "no-store")
  async markRead(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { throughSeq?: string | number };
    const result = await this.inbox.markRead(
      consumer.userId,
      consumer.sessionId,
      key,
      kind,
      id,
      body.throughSeq,
    );
    reply.status(result.statusCode);
    return result.body;
  }
}

/** Reject trailing junk / non-integer strings (e.g. limit=1junk → 400). */
function parseStrictLimit(limitRaw?: string): number | undefined {
  if (limitRaw === undefined || limitRaw === "") {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(limitRaw)) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  const limit = Number(limitRaw);
  if (!Number.isSafeInteger(limit)) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  return limit;
}
