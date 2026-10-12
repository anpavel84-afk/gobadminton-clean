import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { AuthTransactionService } from "./auth-transaction.service";
import {
  AUTH_BINDING_COOKIE,
  isProviderKey,
  PROVIDER_KEYS,
  SESSION_COOKIE,
  type ProviderKey,
} from "./constants";
import { ConsumerAuthService } from "./consumer-auth.service";
import {
  clearAuthBindingCookie,
  clearSessionCookie,
  readCookie,
  setAuthBindingCookie,
  setSessionCookie,
  validateMutationOrigin,
} from "./cookies";
import { randomToken } from "./crypto";
import { IdentityService } from "./identity.service";
import {
  badRequest,
  conflict,
  forbidden,
  unauthorized,
} from "./problem";
import { ProviderRegistry } from "./providers/registry";
import {
  buildAuthErrorRedirect,
  buildWebRedirect,
  normalizeReturnPath,
} from "./return-path";
import { SessionService } from "./session.service";

function nonemptyQueryValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function problemCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "getResponse" in error &&
    typeof (error as { getResponse: () => unknown }).getResponse === "function"
  ) {
    const body = (error as { getResponse: () => unknown }).getResponse();
    if (body && typeof body === "object" && "code" in body) {
      const code = (body as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
  }
  return "AUTH_FAILED";
}

function providerLabel(key: ProviderKey): string {
  return key === "vk" ? "VK" : "Яндекс";
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly providers: ProviderRegistry,
    private readonly transactions: AuthTransactionService,
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    private readonly consumerAuth: ConsumerAuthService,
  ) {}

  listProviders(): { providers: Array<"vk" | "yandex"> } {
    return { providers: this.providers.listKeys() };
  }

  async startBrowserAuth(
    providerKey: string,
    returnPathRaw: string | undefined,
    reply: FastifyReply,
  ): Promise<{ authorizationUrl: string }> {
    if (!isProviderKey(providerKey)) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }
    const returnPath = normalizeReturnPath(returnPathRaw);
    if (!returnPath) {
      throw badRequest("UNSAFE_RETURN_PATH", "Недопустимый returnPath");
    }

    const adapter = this.providers.getConfiguredOrThrow(providerKey);
    const redirectUri =
      providerKey === "vk"
        ? this.env.VK_REDIRECT_URI
        : this.env.YANDEX_REDIRECT_URI;
    if (!redirectUri) {
      throw badRequest("PROVIDER_MISCONFIGURED", "Redirect URI не настроен");
    }

    const bindingSecret = randomToken(24);
    const { state, codeChallenge } = await this.transactions.create({
      providerKey,
      redirectUri,
      returnPath,
      bindingSecret,
      purpose: "login",
    });

    setAuthBindingCookie(
      reply,
      this.env,
      bindingSecret,
      this.env.AUTH_TRANSACTION_TTL_SECONDS,
    );

    return adapter.startAuthorization({
      state,
      codeChallenge,
      redirectUri,
    });
  }

  async handleBrowserCallback(
    providerKey: string,
    query: Record<string, string | undefined>,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ redirectTo: string }> {
    if (!isProviderKey(providerKey)) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }

    const bindingSecret = readCookie(request, AUTH_BINDING_COOKIE);
    const fallbackReturn = normalizeReturnPath("/")!;

    if (query.error) {
      clearAuthBindingCookie(reply, this.env);
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          fallbackReturn,
          "PROVIDER_CANCELLED",
        ),
      };
    }

    if (!query.code || !query.state || !bindingSecret) {
      clearAuthBindingCookie(reply, this.env);
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          fallbackReturn,
          "INVALID_CALLBACK",
        ),
      };
    }

    let transaction;
    try {
      transaction = await this.transactions.consume({
        state: query.state,
        providerKey,
        bindingSecret,
      });
    } catch (error) {
      clearAuthBindingCookie(reply, this.env);
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          fallbackReturn,
          problemCode(error),
        ),
      };
    }

    if (transaction.purpose === "link") {
      return this.completeLinkCallback(
        providerKey,
        query,
        request,
        reply,
        transaction,
      );
    }

    try {
      const adapter = this.providers.getConfiguredOrThrow(providerKey);
      const deviceId = nonemptyQueryValue(query.device_id);
      if (providerKey === "vk" && !deviceId) {
        clearAuthBindingCookie(reply, this.env);
        return {
          redirectTo: buildAuthErrorRedirect(
            this.env.PUBLIC_WEB_ORIGIN,
            transaction.returnPath,
            "AUTH_FAILED",
          ),
        };
      }
      const tokens = await adapter.exchangeCode({
        code: query.code,
        codeVerifier: transaction.pkceVerifier,
        redirectUri: transaction.redirectUri,
        state: query.state,
        ...(deviceId ? { deviceId } : {}),
      });
      const identity = await adapter.fetchVerifiedIdentity(tokens);

      const user = await this.identities.resolveOrCreateUser(identity);
      if (user.status !== "active") {
        clearAuthBindingCookie(reply, this.env);
        return {
          redirectTo: buildAuthErrorRedirect(
            this.env.PUBLIC_WEB_ORIGIN,
            transaction.returnPath,
            "ACCOUNT_DISABLED",
          ),
        };
      }

      const issued = await this.sessions.createConsumerSession(user.id);
      setSessionCookie(reply, this.env, issued.sessionToken);
      clearAuthBindingCookie(reply, this.env);
      return {
        redirectTo: buildWebRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
        ),
      };
    } catch {
      clearAuthBindingCookie(reply, this.env);
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
          "AUTH_FAILED",
        ),
      };
    }
  }

  private async completeLinkCallback(
    providerKey: ProviderKey,
    query: Record<string, string | undefined>,
    request: FastifyRequest,
    reply: FastifyReply,
    transaction: Awaited<ReturnType<AuthTransactionService["consume"]>>,
  ): Promise<{ redirectTo: string }> {
    clearAuthBindingCookie(reply, this.env);

    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (!sessionToken || !transaction.boundUserId || !transaction.boundSessionId) {
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
          "LINK_SESSION_REQUIRED",
        ),
      };
    }

    const session = await this.sessions.lookupActiveSession(sessionToken);
    if (
      !session ||
      session.id !== transaction.boundSessionId ||
      session.userId !== transaction.boundUserId
    ) {
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
          "LINK_SESSION_MISMATCH",
        ),
      };
    }

    try {
      const adapter = this.providers.getConfiguredOrThrow(providerKey);
      const deviceId = nonemptyQueryValue(query.device_id);
      if (providerKey === "vk" && !deviceId) {
        return {
          redirectTo: buildAuthErrorRedirect(
            this.env.PUBLIC_WEB_ORIGIN,
            transaction.returnPath,
            "AUTH_FAILED",
          ),
        };
      }
      const tokens = await adapter.exchangeCode({
        code: query.code!,
        codeVerifier: transaction.pkceVerifier,
        redirectUri: transaction.redirectUri,
        state: query.state,
        ...(deviceId ? { deviceId } : {}),
      });
      const identity = await adapter.fetchVerifiedIdentity(tokens);
      await this.identities.linkIdentityToUser(transaction.boundUserId, identity, transaction.boundSessionId);
      return {
        redirectTo: buildWebRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
        ),
      };
    } catch (error) {
      return {
        redirectTo: buildAuthErrorRedirect(
          this.env.PUBLIC_WEB_ORIGIN,
          transaction.returnPath,
          problemCode(error),
        ),
      };
    }
  }

  private async requireSession(request: FastifyRequest) {
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (!sessionToken) throw unauthorized();
    const session = await this.sessions.lookupActiveSession(sessionToken);
    if (!session) throw unauthorized();
    return { session, sessionToken };
  }

  async getMe(request: FastifyRequest) {
    const { session } = await this.requireSession(request);
    const user = await this.identities.getUser(session.userId);
    if (!user || user.status !== "active") throw unauthorized();
    const linkedProviders = await this.identities.listLinkedProviders(user.id);
    const csrfToken = await this.sessions.readCsrfToken(session.id);
    if (!csrfToken) throw unauthorized();

    return {
      id: user.id,
      displayName: user.displayName,
      locale: user.locale,
      linkedProviders,
      csrfToken,
    };
  }

  async listLinkedProviders(request: FastifyRequest) {
    const consumer = await this.consumerAuth.requireSession(request);
    const linked = await this.identities.listLinkedProviderDetails(consumer.userId);
    const linkedMap = new Map(
      linked.map((row) => [row.providerKey, row.linkedAt] as const),
    );

    const items = PROVIDER_KEYS.map((provider) => {
      const linkedAt = linkedMap.get(provider);
      if (linkedAt) {
        return {
          provider,
          label: providerLabel(provider),
          status: "connected" as const,
          linkedAt: linkedAt.toISOString(),
        };
      }
      const adapter = this.providers.get(provider);
      return {
        provider,
        label: providerLabel(provider),
        status: adapter.configured
          ? ("available" as const)
          : ("unavailable" as const),
      };
    });

    return { items };
  }

  async startLinkProvider(
    request: FastifyRequest,
    reply: FastifyReply,
    providerKey: string,
    returnPathRaw: string | undefined,
  ): Promise<{ authorizationUrl: string }> {
    if (!isProviderKey(providerKey)) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }
    const consumer = await this.consumerAuth.requireCookieMutation(request);
    const returnPath = normalizeReturnPath(
      returnPathRaw ?? "/profile/settings/login-methods",
    );
    if (!returnPath) {
      throw badRequest("UNSAFE_RETURN_PATH", "Недопустимый returnPath");
    }

    const already = await this.identities.listLinkedProviders(consumer.userId);
    if (already.includes(providerKey)) {
      throw conflict(
        "PROVIDER_ALREADY_LINKED",
        "Этот способ входа уже подключён к аккаунту",
      );
    }

    const adapter = this.providers.getConfiguredOrThrow(providerKey);
    const redirectUri =
      providerKey === "vk"
        ? this.env.VK_REDIRECT_URI
        : this.env.YANDEX_REDIRECT_URI;
    if (!redirectUri) {
      throw badRequest("PROVIDER_MISCONFIGURED", "Redirect URI не настроен");
    }

    const bindingSecret = randomToken(24);
    const { state, codeChallenge } = await this.transactions.create({
      providerKey,
      redirectUri,
      returnPath,
      bindingSecret,
      purpose: "link",
      boundUserId: consumer.userId,
      boundSessionId: consumer.sessionId,
    });

    setAuthBindingCookie(
      reply,
      this.env,
      bindingSecret,
      this.env.AUTH_TRANSACTION_TTL_SECONDS,
    );

    return adapter.startAuthorization({
      state,
      codeChallenge,
      redirectUri,
    });
  }

  async unlinkProvider(request: FastifyRequest, providerKey: string) {
    if (!isProviderKey(providerKey)) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }
    const consumer = await this.consumerAuth.requireCookieMutation(request);
    await this.identities.unlinkProvider(consumer.userId, providerKey, consumer.sessionId);
    return this.listLinkedProviders(request);
  }

  async listSessions(request: FastifyRequest) {
    const consumer = await this.consumerAuth.requireSession(request);
    const sessions = await this.sessions.listActiveSessionsForUser(
      consumer.userId,
    );
    return {
      items: sessions.map((session) => ({
        id: session.id,
        current: session.id === consumer.sessionId,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
    };
  }

  async revokeSession(request: FastifyRequest, sessionId: string) {
    const consumer = await this.consumerAuth.requireCookieMutation(request);
    await this.sessions.revokeOwnedSession({
      userId: consumer.userId,
      sessionId,
      currentSessionId: consumer.sessionId,
    });
    return this.listSessions(request);
  }

  async revokeOtherSessions(request: FastifyRequest) {
    const consumer = await this.consumerAuth.requireCookieMutation(request);
    const result = await this.sessions.revokeOtherSessions({
      userId: consumer.userId,
      currentSessionId: consumer.sessionId,
    });
    const sessions = await this.listSessions(request);
    return { ...sessions, revokedCount: result.revokedCount };
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }> {
    if (!validateMutationOrigin(request, this.env.ALLOWED_WEB_ORIGINS)) {
      throw forbidden("ORIGIN_REJECTED", "Origin не разрешён");
    }
    const csrfHeader = request.headers["x-csrf-token"];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (!csrfToken) {
      throw forbidden("CSRF_REQUIRED", "Требуется X-CSRF-Token");
    }

    const { session } = await this.requireSession(request);
    const valid = await this.sessions.verifyCsrf(session.id, csrfToken);
    if (!valid) {
      throw forbidden("CSRF_INVALID", "Недействительный CSRF token");
    }
    await this.sessions.revokeSession(session.id);
    clearSessionCookie(reply, this.env);
    return { ok: true };
  }
}
