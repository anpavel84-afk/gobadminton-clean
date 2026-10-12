import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse,uuid } from "./dto";
import { caseCreateSchema,caseCommandSchema,casePageSchema,caseHistorySchema,reportPageSchema } from "./cases.dto";
import { AdminCasesService } from "./cases.service";
@Controller("admin")
export class AdminCasesController {
 constructor(private readonly cases:AdminCasesService) {}
 @Get("reports") @Header("Cache-Control","no-store")
 reports(@Query() query:unknown,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.reports(request,parse(reportPageSchema,query));}
 @Get("cases") @Header("Cache-Control","no-store")
 list(@Query() query:unknown,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.list(request,parse(casePageSchema,query));}
 @Post("cases") @HttpCode(200) @Header("Cache-Control","no-store")
 create(@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.create(request,key,parse(caseCreateSchema,body));}
 @Get("cases/:id") @Header("Cache-Control","no-store")
 detail(@Param("id") id:string,@Query() query:unknown,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.detail(request,parse(uuid,id),parse(caseHistorySchema,query).beforeVersion);}
 @Post("cases/:id/commands") @HttpCode(200) @Header("Cache-Control","no-store")
 command(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.command(request,parse(uuid,id),key,parse(caseCommandSchema,body));}
 @Get("cases/:id/evidence") @Header("Cache-Control","no-store")
 evidenceList(@Param("id") id:string,@Query() query:unknown,@Req() request:FastifyRequest){this.cases.enabled();return this.cases.evidenceList(request,parse(uuid,id),parse(casePageSchema,query));}
 @Get("cases/:id/evidence/:evidenceId") @Header("Cache-Control","no-store")
 evidenceRead(@Param("id") id:string,@Param("evidenceId") evidenceId:string,@Query() query:unknown,@Req() request:FastifyRequest){this.cases.enabled();parse(caseHistorySchema.pick({}),query);return this.cases.evidenceRead(request,parse(uuid,id),parse(uuid,evidenceId));}
}
