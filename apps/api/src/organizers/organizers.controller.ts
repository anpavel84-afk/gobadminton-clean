import {
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { OrganizersService } from "./organizers.service";

@Controller("organizers")
export class OrganizersController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly organizers: OrganizersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      displayName?: string;
      publicContact?: string;
    };
    const result = await this.organizers.createPersonal(
      consumer.userId,
      consumer.sessionId,
      key,
      {
        displayName: body.displayName ?? "",
        publicContact: body.publicContact ?? "",
      },
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("mine")
  @Header("Cache-Control", "no-store")
  async listMine(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    return this.organizers.listMine(consumer.userId);
  }
}
