import { Controller, Get, Header, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { ProfilesService } from "./profiles.service";

@Controller("players")
export class PlayersController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
    @Query("cityId") cityId?: string,
    @Query("areaKey") areaKey?: string,
    @Query("name") name?: string,
    @Query("looking") lookingRaw?: string,
    @Query("trainer") trainerRaw?: string,
  ) {
    const consumer = await this.auth.optionalSession(request);
    const limit =
      limitRaw === undefined || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    return this.profiles.listDirectory(consumer?.userId ?? null, {
      cursor,
      limit,
      cityId,
      areaKey,
      name,
      looking:
        lookingRaw === undefined
          ? undefined
          : lookingRaw === "1" || lookingRaw === "true",
      trainer:
        trainerRaw === undefined
          ? undefined
          : trainerRaw === "1" || trainerRaw === "true",
    });
  }

  @Get(":publicPlayerId")
  @Header("Cache-Control", "no-store")
  async getOne(
    @Req() request: FastifyRequest,
    @Param("publicPlayerId") publicPlayerId: string,
  ) {
    const consumer = await this.auth.optionalSession(request);
    return this.profiles.getDirectoryPlayer(
      consumer?.userId ?? null,
      publicPlayerId,
    );
  }
}
