import { VenueCoverService } from "../venues/venue-cover.service";
import { AdminService } from "./admin.service";
import { Body, Controller, Delete, Put, Get, Header, Headers, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AdminVenuesService } from "../venues/admin-venues.service";
import { parse, reason, uuid } from "./dto";
import { venueCommand, venueCreate, venuePage } from "./venues.dto";
const cursor=z.object({beforeId:uuid.optional()}).strict();
@Controller("admin/venues")
export class AdminVenuesController {
  constructor(private readonly venues:AdminVenuesService, private readonly admin:AdminService, private readonly covers:VenueCoverService) {}
  @Get(":id/cover/access") @Header("Cache-Control","no-store")
  async coverAccess(@Req() r:FastifyRequest,@Param("id") id:string) {
    this.admin.enabled();
    const session=await this.admin.me(r);
    return {...await this.covers.get(r,parse(uuid,id)),csrfToken:session.csrfToken};
  }
  @Get(":id/cover") @Header("Cache-Control","no-store")
  cover(@Req() r:FastifyRequest,@Param("id") id:string) { this.admin.enabled();return this.covers.get(r,parse(uuid,id)); }
  @Put(":id/cover") @Header("Cache-Control","no-store")
  replaceCover(@Req() r:FastifyRequest,@Param("id") id:string,@Headers("idempotency-key") k:string|undefined) {
    this.admin.enabled();
    const version=parse(z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647)),r.headers["x-venue-version"]);
    return this.covers.mutate(r,k,parse(uuid,id),version,{body:r.body,mime:r.headers["content-type"]??""});
  }
  @Delete(":id/cover") @Header("Cache-Control","no-store")
  removeCover(@Req() r:FastifyRequest,@Param("id") id:string,@Headers("idempotency-key") k:string|undefined,@Body() b:unknown) {
    this.admin.enabled();const input=parse(z.object({expectedVersion:z.number().int().positive().max(2147483647)}).strict(),b);
    return this.covers.mutate(r,k,parse(uuid,id),input.expectedVersion);
  }
  @Get() @Header("Cache-Control","no-store")
  list(@Req() r:FastifyRequest,@Query() q:unknown){this.admin.enabled();return this.venues.list(r,parse(venuePage,q));}
  @Post() @Header("Cache-Control","no-store")
  create(@Req() r:FastifyRequest,@Headers("idempotency-key") k:string|undefined,@Body() b:unknown){this.admin.enabled();return this.venues.create(r,k,parse(venueCreate,b));}
  @Get("duplicates") @Header("Cache-Control","no-store")
  duplicates(@Req() r:FastifyRequest,@Query() q:unknown){this.admin.enabled();return this.venues.duplicates(r,parse(cursor,q).beforeId);}
  @Post("duplicates/:id/dismiss") @Header("Cache-Control","no-store")
  dismiss(@Req() r:FastifyRequest,@Headers("idempotency-key") k:string|undefined,@Param("id") id:string,@Body() b:unknown){this.admin.enabled();return this.venues.dismiss(r,k,parse(uuid,id),parse(z.object({expectedVersion:z.number().int().positive(),reasonCode:reason}).strict(),b));}
  @Get(":id/games") @Header("Cache-Control","no-store")
  games(@Req() r:FastifyRequest,@Param("id") id:string,@Query() q:unknown){this.admin.enabled();return this.venues.games(r,parse(uuid,id),parse(cursor,q).beforeId);}
  @Get(":id") @Header("Cache-Control","no-store")
  detail(@Req() r:FastifyRequest,@Param("id") id:string,@Query() q:unknown){this.admin.enabled();return this.venues.detail(r,parse(uuid,id),parse(z.object({beforeVersion:z.coerce.number().int().positive().optional()}).strict(),q).beforeVersion);}
  @Post(":id/commands") @Header("Cache-Control","no-store")
  command(@Req() r:FastifyRequest,@Headers("idempotency-key") k:string|undefined,@Param("id") id:string,@Body() b:unknown){this.admin.enabled();return this.venues.command(r,k,parse(uuid,id),parse(venueCommand,b));}
}
