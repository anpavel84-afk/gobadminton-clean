import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse,uuid } from "./dto";
import { restrictionHistoryQuerySchema,userRestrictionCommandSchema } from "./user-restrictions.dto";
import { AdminUserRestrictionsService } from "./user-restrictions.service";
@Controller("admin/users")
export class AdminUserRestrictionsController {
  constructor(private readonly restrictions: AdminUserRestrictionsService) {}
  @Get(":id/restrictions") @Header("Cache-Control","no-store")
  detail(@Param("id") id:string,@Query() query:unknown,@Req() request:FastifyRequest) {
    this.restrictions.enabled();return this.restrictions.detail(request,parse(uuid,id),parse(restrictionHistoryQuerySchema,query).beforeVersion);
  }
  @Post(":id/restrictions/commands") @HttpCode(200) @Header("Cache-Control","no-store")
  command(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:FastifyRequest) {
    this.restrictions.enabled();return this.restrictions.command(request,parse(uuid,id),key,parse(userRestrictionCommandSchema,body));
  }
}
