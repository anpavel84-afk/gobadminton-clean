import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse, uuid } from "./dto";
import {
  attendanceDisputeIntakeSchema,
  attendanceDisputeResolveSchema,
} from "./attendance-disputes.dto";
import { AdminAttendanceDisputesService } from "./attendance-disputes.service";

@Controller("admin")
export class AdminAttendanceDisputesController {
  constructor(private readonly disputes: AdminAttendanceDisputesService) {}

  @Post("cases/attendance-dispute-intake")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  intake(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    this.disputes.enabled();
    return this.disputes.intake(request, key, parse(attendanceDisputeIntakeSchema, body));
  }

  @Get("cases/:caseId/attendance-disputes/:disputeId")
  @Header("Cache-Control", "no-store")
  read(
    @Param("caseId") caseId: string,
    @Param("disputeId") disputeId: string,
    @Req() request: FastifyRequest,
  ) {
    this.disputes.enabled();
    return this.disputes.read(request, parse(uuid, caseId), parse(uuid, disputeId));
  }

  @Post("cases/:caseId/attendance-disputes/:disputeId")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  resolve(
    @Param("caseId") caseId: string,
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    this.disputes.enabled();
    return this.disputes.resolve(
      request,
      parse(uuid, caseId),
      parse(uuid, disputeId),
      key,
      parse(attendanceDisputeResolveSchema, body),
    );
  }
}
