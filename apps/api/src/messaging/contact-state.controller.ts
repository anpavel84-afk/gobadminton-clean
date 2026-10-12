import { Controller, Get, Header, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { MessagingService } from "./messaging.service";

@Controller("me/contact-state")
export class ContactStateController {
  constructor(private readonly auth: ConsumerAuthService, private readonly messaging: MessagingService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async get(@Req() request: FastifyRequest, @Query("targetPublicPlayerId") target?: string) {
    const actor = await this.auth.requireSession(request);
    return this.messaging.getContactState(actor.userId, target);
  }
}
