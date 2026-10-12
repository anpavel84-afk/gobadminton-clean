import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env";
import { AUTH_BINDING_COOKIE, SESSION_COOKIE } from "./constants";

type CookieWritable = {
  setCookie: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => unknown;
  clearCookie: (name: string, options: Record<string, unknown>) => unknown;
};

export function readCookie(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string> })
    .cookies;
  const value = cookies?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hostCookieOptions(env: AppEnv, maxAgeSeconds: number) {
  return {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    // __Host- cookies MUST omit Domain.
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  env: AppEnv,
  token: string,
): void {
  (reply as unknown as CookieWritable).setCookie(
    SESSION_COOKIE,
    token,
    hostCookieOptions(env, env.SESSION_TTL_SECONDS),
  );
}

export function clearSessionCookie(reply: FastifyReply, env: AppEnv): void {
  (reply as unknown as CookieWritable).clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  });
}

export function setAuthBindingCookie(
  reply: FastifyReply,
  env: AppEnv,
  bindingSecret: string,
  maxAgeSeconds: number,
): void {
  (reply as unknown as CookieWritable).setCookie(
    AUTH_BINDING_COOKIE,
    bindingSecret,
    hostCookieOptions(env, maxAgeSeconds),
  );
}

export function clearAuthBindingCookie(reply: FastifyReply, env: AppEnv): void {
  (reply as unknown as CookieWritable).clearCookie(AUTH_BINDING_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  });
}

export function validateMutationOrigin(
  request: FastifyRequest,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    return allowedOrigins.includes(origin);
  }
  // Non-browser clients may omit Origin; cookie mutations still require CSRF.
  // Reject missing Origin for cookie-auth mutations to reduce CSRF surface.
  return false;
}
