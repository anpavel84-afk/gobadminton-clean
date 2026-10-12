import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { SESSION_COOKIE } from "./constants";
import { readCookie, validateMutationOrigin } from "./cookies";
import { IdentityService } from "./identity.service";
import { forbidden, unauthorized } from "./problem";
import { SessionService } from "./session.service";

export type AuthenticatedConsumer = {
  userId: string;
  sessionId: string;
};

@Injectable()
export class ConsumerAuthService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly sessions: SessionService,
    private readonly identities: IdentityService,
  ) {}

  async requireSession(request: FastifyRequest): Promise<AuthenticatedConsumer> {
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (!sessionToken) throw unauthorized();
    const session = await this.sessions.lookupActiveSession(sessionToken);
    if (!session) throw unauthorized();
    const user = await this.identities.getUser(session.userId);
    if (!user || user.status !== "active") {
      throw unauthorized("ACCOUNT_INACTIVE", "Аккаунт недоступен");
    }
    return { userId: session.userId, sessionId: session.id };
  }

  async requireCookieMutation(
    request: FastifyRequest,
  ): Promise<AuthenticatedConsumer> {
    if(request.headers.authorization) throw forbidden("CREDENTIALS_CONFLICT","Для cookie-запроса нельзя передавать bearer credentials");
    if (!validateMutationOrigin(request, this.env.ALLOWED_WEB_ORIGINS)) {
      throw forbidden("ORIGIN_REJECTED", "Origin не разрешён");
    }
    const csrfHeader = request.headers["x-csrf-token"];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (!csrfToken) {
      throw forbidden("CSRF_REQUIRED", "Требуется X-CSRF-Token");
    }
    const consumer = await this.requireSession(request);
    const valid = await this.sessions.verifyCsrf(consumer.sessionId, csrfToken);
    if (!valid) {
      throw forbidden("CSRF_INVALID", "Недействительный CSRF token");
    }
    return consumer;
  }

  /** Optional session for public reads that may elevate for managers. */
  async optionalSession(
    request: FastifyRequest,
  ): Promise<AuthenticatedConsumer | null> {
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (!sessionToken) return null;
    const session = await this.sessions.lookupActiveSession(sessionToken);
    if (!session) return null;
    const user = await this.identities.getUser(session.userId);
    if (!user || user.status !== "active") return null;
    return { userId: session.userId, sessionId: session.id };
  }
}
