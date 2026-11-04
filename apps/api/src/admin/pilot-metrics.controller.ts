import { Controller, Get, Header, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse } from "./dto";
import {
  pilotMetricsQueryInputSchema,
  resolvePilotMetricsQuery,
} from "./pilot-metrics.query";
import { PilotMetricsService } from "./pilot-metrics.service";

@Controller("admin/pilot-metrics")
export class PilotMetricsController {
  constructor(private readonly pilot: PilotMetricsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  summary(@Query() query: unknown, @Req() request: FastifyRequest) {
    this.pilot.enabled();
    return this.pilot.summary(
      request,
      resolvePilotMetricsQuery(parse(pilotMetricsQueryInputSchema, query)),
    );
  }
}
