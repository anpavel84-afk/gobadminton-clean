import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { badRequest, forbidden, unauthorized } from "./problem";
import { readCookie } from "./cookies";
import { SESSION_COOKIE } from "./constants";

export type NativeClient = { clientId: string; redirectUris: string[] };
export function parseNativeClients(raw: string): NativeClient[] {
  if (raw.length > 16384) throw new Error("Native registry too large");
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 16) throw new Error("Invalid native registry");
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid native client");
    const client = item as Record<string, unknown>;
    if (Object.keys(client).some(key => !["clientId", "redirectUris"].includes(key)) ||
        typeof client.clientId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(client.clientId) || ids.has(client.clientId) ||
        !Array.isArray(client.redirectUris) || !client.redirectUris.length || client.redirectUris.length > 8) throw new Error("Invalid native client");
    ids.add(client.clientId);
    const redirectUris = client.redirectUris.map((uri: unknown) => {
      if (typeof uri !== "string" || uri.length > 512 || /[\\\s]/.test(uri)) throw new Error("Invalid native redirect");
      const url = new URL(uri);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== uri ||
          url.port || url.hostname === "localhost" || /^\[|^[0-9.]+$/.test(url.hostname)) throw new Error("Invalid native redirect");
      return uri;
    });
    if (new Set(redirectUris).size !== redirectUris.length) throw new Error("Duplicate native redirect");
    return { clientId: client.clientId, redirectUris };
  });
}
export function nativeString(body: Record<string, unknown>, key: string, pattern: RegExp, max = 512): string {
  const value = body[key];
  if (typeof value !== "string" || value.length > max || !pattern.test(value)) throw badRequest("INVALID_NATIVE_REQUEST", "Некорректный запрос входа");
  return value;
}
export function nativeBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 4096) throw badRequest("INVALID_NATIVE_REQUEST", "Некорректный запрос входа");
  return value as Record<string, unknown>;
}
export function s256(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }
export const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
export function explicitBearer(request: FastifyRequest): string | null {
  const raw = request.raw?.rawHeaders ?? [];
  const count = raw.filter((header, index) => index % 2 === 0 && header.toLowerCase() === "authorization").length;
  const header = request.headers.authorization;
  if (count > 1) throw unauthorized("INVALID_AUTHORIZATION");
  if (header === undefined) return null;
  if (readCookie(request, SESSION_COOKIE)) throw forbidden("CREDENTIALS_CONFLICT", "Нельзя смешивать cookie и bearer");
  if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw unauthorized("INVALID_AUTHORIZATION");
  return header.slice(7);
}
