import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthMethodService } from "./auth-method.service";
import { ConsumerAuthService } from "./consumer-auth.service";
import { EmailAuthService } from "./email-auth.service";
@Controller()
export class EmailAuthController {
    constructor(private readonly email: EmailAuthService, private readonly methods: AuthMethodService, private readonly consumer: ConsumerAuthService) { }
    @Get("auth/methods")
    @Header("Cache-Control", "no-store")
    discover() { return this.email.methods(); }
    @Get("me/auth-methods")
    @Header("Cache-Control", "no-store")
    async inventory(
    @Req()
    request: FastifyRequest) { return this.methods.inventory((await this.consumer.requireSession(request)).userId); }
    @Post("auth/email/challenges")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    issue(
    @Req()
    request: FastifyRequest,
    @Res({ passthrough: true })
    reply: FastifyReply,
    @Body()
    body: {
        email?: unknown;
        returnPath?: string;
    }) { return this.email.issue(request, reply, "login_signup", body); }
    @Get("auth/email/challenges/:id")
    @Header("Cache-Control", "no-store")
    status(
    @Req()
    request: FastifyRequest,
    @Param("id")
    id: string) { return this.email.status(request, "login_signup", id); }
    @Post("auth/email/challenges/:id/resend")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    resend(
    @Req()
    request: FastifyRequest,
    @Param("id")
    id: string) { return this.email.resend(request, "login_signup", id); }
    @Post("auth/email/challenges/:id/verify")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    verify(
    @Req()
    request: FastifyRequest,
    @Res({ passthrough: true })
    reply: FastifyReply,
    @Param("id")
    id: string,
    @Body()
    body: {
        code?: unknown;
    }) { return this.email.verify(request, reply, "login_signup", id, body); }
    @Post("me/auth-methods/email/link/challenges")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    link(
    @Req()
    request: FastifyRequest,
    @Res({ passthrough: true })
    reply: FastifyReply,
    @Body()
    body: {
        email?: unknown;
    }) { return this.email.issue(request, reply, "link", body); }
    @Get("me/auth-methods/email/link/challenges/:id")
    @Header("Cache-Control", "no-store")
    linkStatus(
    @Req()
    request: FastifyRequest,
    @Param("id")
    id: string) { return this.email.status(request, "link", id); }
    @Post("me/auth-methods/email/link/challenges/:id/resend")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    linkResend(
    @Req()
    request: FastifyRequest,
    @Param("id")
    id: string) { return this.email.resend(request, "link", id); }
    @Post("me/auth-methods/email/link/challenges/:id/verify")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    linkVerify(
    @Req()
    request: FastifyRequest,
    @Res({ passthrough: true })
    reply: FastifyReply,
    @Param("id")
    id: string,
    @Body()
    body: {
        code?: unknown;
    }) { return this.email.verify(request, reply, "link", id, body); }
    @Delete("me/auth-methods/email")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    unlinkEmail(@Req() request: FastifyRequest) { return this.email.unlink(request); }
    @Post("me/auth-methods/email/change/current/challenges")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    issueCurrent(@Req() request: FastifyRequest, @Res({passthrough: true}) reply: FastifyReply,
        @Body() body: {email?: unknown; proofChallengeId?: string}) { return this.email.issue(request, reply, "change_current", body); }
    @Get("me/auth-methods/email/change/current/challenges/:id")
    @Header("Cache-Control", "no-store")
    statusCurrent(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.status(request, "change_current", id); }
    @Post("me/auth-methods/email/change/current/challenges/:id/resend")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    resendCurrent(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.resend(request, "change_current", id); }
    @Post("me/auth-methods/email/change/current/challenges/:id/verify")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    verifyCurrent(@Req() request: FastifyRequest, @Res({passthrough: true}) reply: FastifyReply,
        @Param("id") id: string, @Body() body: {code?: unknown}) { return this.email.verify(request, reply, "change_current", id, body); }
    @Post("me/auth-methods/email/change/challenges")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    issueChange(@Req() request: FastifyRequest, @Res({passthrough: true}) reply: FastifyReply,
        @Body() body: {email?: unknown; proofChallengeId?: string}) { return this.email.issue(request, reply, "change", body); }
    @Get("me/auth-methods/email/change/challenges/:id")
    @Header("Cache-Control", "no-store")
    statusChange(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.status(request, "change", id); }
    @Post("me/auth-methods/email/change/challenges/:id/resend")
    @HttpCode(202)
    @Header("Cache-Control", "no-store")
    resendChange(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.resend(request, "change", id); }
    @Post("me/auth-methods/email/change/challenges/:id/verify")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    verifyChange(@Req() request: FastifyRequest, @Res({passthrough: true}) reply: FastifyReply,
        @Param("id") id: string, @Body() body: {code?: unknown}) { return this.email.verify(request, reply, "change", id, body); }
    // Browser GET does not reliably send Origin. JSON POST status preserves exact Origin.
    @Post("auth/email/challenges/:id/status")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    browserStatusLogin(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.browserStatus(request, "login_signup", id); }
    // Browser GET does not reliably send Origin. JSON POST status preserves exact Origin.
    @Post("me/auth-methods/email/link/challenges/:id/status")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    browserStatusLink(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.browserStatus(request, "link", id); }
    // Browser GET does not reliably send Origin. JSON POST status preserves exact Origin.
    @Post("me/auth-methods/email/change/current/challenges/:id/status")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    browserStatusCurrent(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.browserStatus(request, "change_current", id); }
    // Browser GET does not reliably send Origin. JSON POST status preserves exact Origin.
    @Post("me/auth-methods/email/change/challenges/:id/status")
    @HttpCode(200)
    @Header("Cache-Control", "no-store")
    browserStatusChange(@Req() request: FastifyRequest, @Param("id") id: string) { return this.email.browserStatus(request, "change", id); }
}
