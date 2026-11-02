import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse, uuid } from "./dto";
import {
  roleReputationIntakeSchema,
  roleReputationPendingPageSchema,
} from "./role-reputation.dto";
import { AdminRoleReputationService } from "./role-reputation.service";

@Controller("admin")
export class AdminRoleReputationController {
  constructor(private readonly reputation: AdminRoleReputationService) {}

  @Get("role-reputation/pending-intakes")
  @Header("Cache-Control", "no-store")
  listPending(@Query() query: unknown, @Req() request: FastifyRequest) {
    this.reputation.enabled();
    return this.reputation.listPending(request, parse(roleReputationPendingPageSchema, query));
  }

  @Post("cases/role-reputation-intake")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  intake(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    this.reputation.enabled();
    return this.reputation.intake(request, key, parse(roleReputationIntakeSchema, body));
  }

  @Get("cases/:id/role-review-source")
  @Header("Cache-Control", "no-store")
  source(@Param("id") id: string, @Req() request: FastifyRequest) {
    this.reputation.enabled();
    return this.reputation.readSource(request, parse(uuid, id));
  }
}
