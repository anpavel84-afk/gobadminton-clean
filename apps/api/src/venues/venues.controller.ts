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
import { VenuesService } from "./venues.service";

@Controller()
export class VenuesController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly venues: VenuesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("cities")
  async listCities() {
    return this.venues.listCities();
  }

  @Get("venues")
  async searchVenues(
    @Query("cityId") cityId?: string,
    @Query("q") q?: string,
    @Query("lat") latRaw?: string,
    @Query("lng") lngRaw?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const lat =
      latRaw === undefined || latRaw === "" ? undefined : Number(latRaw);
    const lng =
      lngRaw === undefined || lngRaw === "" ? undefined : Number(lngRaw);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.venues.searchCatalog({
      cityId: cityId ?? "",
      q,
      lat,
      lng,
      limit,
      cursor,
    });
  }

  @Post("venues")
  @Header("Cache-Control", "no-store")
  async create(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.venues.create(
      consumer.userId,
      consumer.sessionId,
      key,
      readVenueBody(request.body),
    );
    return writeMutation(reply, result);
  }

  @Post("venue-proposals")
  @Header("Cache-Control", "no-store")
  async propose(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const result = await this.venues.propose(
      consumer.userId,
      consumer.sessionId,
      key,
      readVenueBody(request.body),
    );
    return writeMutation(reply, result);
  }

  @Post("venue-proposals/confirm-distinct")
  @Header("Cache-Control", "no-store")
  async confirmDistinct(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = readVenueBody(request.body);
    const confirmationToken =
      typeof (request.body as { confirmationToken?: unknown } | null)?.confirmationToken ===
      "string"
        ? (request.body as { confirmationToken: string }).confirmationToken
        : "";
    const result = await this.venues.confirmDistinct(
      consumer.userId,
      consumer.sessionId,
      key,
      { ...body, confirmationToken },
    );
    return writeMutation(reply, result);
  }

  @Get("venues/:venueId")
  async getVenue(@Param("venueId") venueId: string) {
    return this.venues.getById(venueId);
  }
}

function readVenueBody(raw: unknown): {
  cityId: string;
  name: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  identityDiscriminator?: string;
  confirmDistinctToken?: string;
} {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    cityId: typeof body.cityId === "string" ? body.cityId : "",
    name: typeof body.name === "string" ? body.name : "",
    address: typeof body.address === "string" ? body.address : "",
    timezone: typeof body.timezone === "string" ? body.timezone : "",
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    identityDiscriminator:
      typeof body.identityDiscriminator === "string"
        ? body.identityDiscriminator
        : undefined,
    confirmDistinctToken:
      typeof body.confirmDistinctToken === "string"
        ? body.confirmDistinctToken
        : typeof body.confirmationToken === "string"
          ? body.confirmationToken
          : undefined,
  };
}

function writeMutation(
  reply: FastifyReply,
  result: { statusCode: number; body: unknown },
): unknown {
  reply.status(result.statusCode);
  if (result.statusCode === 409) {
    reply.header("content-type", "application/problem+json; charset=utf-8");
  }
  return result.body;
}
