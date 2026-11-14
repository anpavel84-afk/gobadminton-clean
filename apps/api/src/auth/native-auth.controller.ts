import { Body, Controller, Header, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { NativeAuthService } from "./native-auth.service";
import { explicitBearer, nativeBody, opaquePattern } from "./native-auth-security";
import { badRequest, forbidden } from "./problem";
import { readCookie } from "./cookies";
import { SESSION_COOKIE } from "./constants";

@Controller("auth/native")
export class NativeAuthController {
  constructor(private readonly auth: NativeAuthService) {}
  private async check(request:FastifyRequest,operation:string,id?:string) {
    await this.auth.budget(request,operation);
    nativeBody(request.body);
    if (id!==undefined && !opaquePattern.test(id)) throw badRequest("INVALID_NATIVE_TRANSACTION","Некорректный идентификатор");
  }
  private device(request:FastifyRequest, allowBearer=false) {
    // Credential endpoints never inherit browser authentication.
    if (readCookie(request,SESSION_COOKIE)) throw forbidden("CREDENTIALS_CONFLICT","Требуется native credential");
    const bearer=explicitBearer(request);
    if (bearer!==null && !allowBearer) throw forbidden("BEARER_NOT_ALLOWED","Используйте credential в теле запроса");
    return bearer;
  }
  @Post("transactions") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async create(@Body() body:unknown,@Req() request:FastifyRequest) { await this.check(request,"create");this.device(request);return this.auth.create(body); }
  @Post("transactions/:id/bind") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async bind(@Param("id") id:string,@Req() request:FastifyRequest,@Res({passthrough:true}) reply:FastifyReply) { await this.check(request,"bind",id);return this.auth.bind(id,request,reply); }
  @Post("transactions/:id/complete") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async complete(@Param("id") id:string,@Req() request:FastifyRequest) { await this.check(request,"complete",id);return this.auth.complete(id,request); }
  @Post("transactions/:id/cancel") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async cancel(@Param("id") id:string,@Req() request:FastifyRequest) { await this.check(request,"cancel",id);return this.auth.cancel(id,request); }
  @Post("exchange") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async exchange(@Body() body:unknown,@Req() request:FastifyRequest) { await this.check(request,"exchange");this.device(request);return this.auth.exchange(body); }
  @Post("refresh") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async refresh(@Body() body:unknown,@Req() request:FastifyRequest) { await this.check(request,"refresh");this.device(request);return this.auth.refresh(body); }
  @Post("logout") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async logout(@Body() body:unknown,@Req() request:FastifyRequest) { await this.check(request,"logout");return this.auth.logout(body,this.device(request,true)); }
}
