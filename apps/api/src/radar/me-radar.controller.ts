import { UnifiedPublishingService } from "./unified-publishing.service";
import { UNIFIED_WIRE } from "./unified-contract";
import {
  Controller,
  Delete,
  Get,
  Header,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConsumerAuthService } from "../auth/consumer-auth.service";
import { IdempotencyService } from "../common/idempotency.service";
import { RadarService } from "./radar.service";

@Controller("me/radar")
export class MeRadarController {
  constructor(
    private readonly auth: ConsumerAuthService,
    private readonly radar: RadarService,
    private readonly unified: UnifiedPublishingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get("activations/current")
  @Header("Cache-Control", "no-store")
  async current(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    const unified = await this.unified.status(consumer.userId,consumer.sessionId);
    if(unified) return unified;
    return this.radar.getStatus(consumer.userId, consumer.sessionId);
  }

  @Post("activations")
  @Header("Cache-Control", "no-store")
  async start(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: string;
      };
      radiusBucketKm?: number;
      ttlMinutes?: number;
      consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
    };
    if(request.body && typeof request.body === "object" && "contractVersion" in request.body && request.body.contractVersion === UNIFIED_WIRE) {
      const result=await this.unified.command(consumer.userId,consumer.sessionId,key,"start",request.body);
      reply.status(result.statusCode);return result.body;
    }
    const result = await this.radar.start(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("activations/current/renew")
  @Header("Cache-Control", "no-store")
  async renew(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      activationId: string;
      expectedVersion: number;
      extendMinutes?: number;
      location?: {
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: string;
      };
    };
    if(request.body && typeof request.body === "object" && "contractVersion" in request.body && request.body.contractVersion === UNIFIED_WIRE) {
      const result=await this.unified.command(consumer.userId,consumer.sessionId,key,"renew",request.body);
      reply.status(result.statusCode);return result.body;
    }
    const result = await this.radar.renew(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Patch("activations/current")
  @Header("Cache-Control", "no-store")
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      activationId: string;
      expectedVersion: number;
      location?: {
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: string;
      };
      radiusBucketKm?: number;
    };
    if(request.body && typeof request.body === "object" && "contractVersion" in request.body && request.body.contractVersion === UNIFIED_WIRE) {
      const result=await this.unified.command(consumer.userId,consumer.sessionId,key,"update",request.body);
      reply.status(result.statusCode);return result.body;
    }
    const result = await this.radar.update(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Post("activations/current/heartbeat")
  @Header("Cache-Control", "no-store")
  async heartbeat(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as { activationId: string };
    if(request.body && typeof request.body === "object" && "contractVersion" in request.body && request.body.contractVersion === UNIFIED_WIRE) {
      const result=await this.unified.command(consumer.userId,consumer.sessionId,key,"heartbeat",request.body);
      reply.status(result.statusCode);return result.body;
    }
    const result = await this.radar.heartbeat(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Delete("activations/current")
  @Header("Cache-Control", "no-store")
  async stop(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const activationHeader = request.headers["x-radar-activation-id"];
    const activationId = Array.isArray(activationHeader)
      ? activationHeader[0]
      : activationHeader;
    const result = await this.radar.stop(
      consumer.userId,
      consumer.sessionId,
      key,
      activationId,
    );
    reply.status(result.statusCode);
    return result.statusCode === 204 ? undefined : result.body;
  }

  @Post("activations/current/takeover")
  @Header("Cache-Control", "no-store")
  async takeover(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const consumer = await this.auth.requireCookieMutation(request);
    const key = this.idempotency.requireKey(request.headers["idempotency-key"]);
    const body = (request.body ?? {}) as {
      activationId: string;
      expectedVersion: number;
      confirm: boolean;
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: string;
      };
      radiusBucketKm?: number;
      ttlMinutes?: number;
      consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
    };
    if(request.body && typeof request.body === "object" && "contractVersion" in request.body && request.body.contractVersion === UNIFIED_WIRE) {
      const result=await this.unified.command(consumer.userId,consumer.sessionId,key,"takeover",request.body);
      reply.status(result.statusCode);return result.body;
    }
    const result = await this.radar.takeover(
      consumer.userId,
      consumer.sessionId,
      key,
      body,
    );
    reply.status(result.statusCode);
    return result.body;
  }

  @Get("nearby")
  @Header("Cache-Control", "no-store")
  async nearby(@Req() request: FastifyRequest) {
    const consumer = await this.auth.requireSession(request);
    const activationHeader = request.headers["x-radar-activation-id"];
    const activationId = Array.isArray(activationHeader)
      ? activationHeader[0]
      : activationHeader;
    const query = (request.query ?? {}) as Record<string, unknown>;
    return this.radar.nearby(
      consumer.userId,
      consumer.sessionId,
      activationId,
      query,
    );
  }
}
