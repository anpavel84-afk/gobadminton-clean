import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse,uuid } from "./dto";
import { gameDetailQuerySchema,gameListQuerySchema,gameModerationCommandSchema } from "./game-moderation.dto";
import { AdminGameModerationService } from "./game-moderation.service";
@Controller("admin/games")
export class AdminGameModerationController {
  constructor(private readonly moderation:AdminGameModerationService) {}
  @Get() @Header("Cache-Control","no-store")
  list(@Query() query:unknown,@Req() request:FastifyRequest) {
    this.moderation.enabled();return this.moderation.list(request,parse(gameListQuerySchema,query));
  }
  @Get(":id") @Header("Cache-Control","no-store")
  detail(@Param("id") id:string,@Query() query:unknown,@Req() request:FastifyRequest) {
    this.moderation.enabled();return this.moderation.detail(request,parse(uuid,id),parse(gameDetailQuerySchema,query).historyCursor);
  }
  @Post(":id/moderation/commands") @HttpCode(200) @Header("Cache-Control","no-store")
  command(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:FastifyRequest) {
    this.moderation.enabled();return this.moderation.command(request,parse(uuid,id),key,parse(gameModerationCommandSchema,body));
  }
}
