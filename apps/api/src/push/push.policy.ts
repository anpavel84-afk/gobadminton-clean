import { createHash } from "node:crypto";
import { badRequest, unprocessable } from "../auth/problem";

/** Hard cap on concurrent active device subscriptions per account. */
export const WEB_PUSH_MAX_DEVICES = 5;

/** Bounded endpoint URL length (browser PushSubscription.endpoint). */
export const WEB_PUSH_ENDPOINT_MAX = 2048;

/** p256dh / auth key material as URL-safe base64 (bounded). */
export const WEB_PUSH_KEY_MAX = 256;

/**
 * Known Web Push service hosts (Apple / FCM / Mozilla).
 * Arbitrary HTTPS is rejected even when the URL parses — SSRF / private IP fence.
 */
export const WEB_PUSH_ALLOWED_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
]);

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1|\[::1\])/i;

export type ValidatedPushEndpoint = {
  endpoint: string;
  host: string;
  endpointHash: string;
};

export function hashPushEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

export function accountFence(pepper: string, userId: string): string {
  return createHash("sha256")
    .update(`gobadminton-web-push-fence:${pepper}:${userId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (WEB_PUSH_ALLOWED_HOSTS.has(host)) return true;
  // Apple regional push hosts: web.push.apple.com and *.push.apple.com
  if (host === "push.apple.com" || host.endsWith(".push.apple.com")) return true;
  // FCM regional: *.fcm.googleapis.com
  if (host.endsWith(".fcm.googleapis.com")) return true;
  return false;
}

/** Validate endpoint URL: https only, allowlisted hosts, no userinfo, default/443 port, no private IP. */
export function validatePushEndpoint(raw: unknown): ValidatedPushEndpoint {
  if (typeof raw !== "string" || raw.length < 16 || raw.length > WEB_PUSH_ENDPOINT_MAX) {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный адрес подписки");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный адрес подписки");
  }
  if (url.protocol !== "https:") {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Подписка должна использовать HTTPS");
  }
  if (url.username || url.password) {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный адрес подписки");
  }
  if (url.port && url.port !== "443") {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный порт подписки");
  }
  const host = url.hostname.toLowerCase();
  if (!host || PRIVATE_HOST.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный адрес подписки");
  }
  if (!isAllowedHost(host)) {
    throw unprocessable("PUSH_ENDPOINT_HOST_DENIED", "Провайдер push не поддерживается");
  }
  // Path must be present and not obviously SSRF-like (no @ reconstituted).
  if (!url.pathname || url.pathname.length < 2 || url.pathname.includes("@")) {
    throw unprocessable("PUSH_ENDPOINT_INVALID", "Некорректный путь подписки");
  }
  const endpoint = url.toString();
  return { endpoint, host, endpointHash: hashPushEndpoint(endpoint) };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function validatePushKeys(input: {
  p256dh?: unknown;
  auth?: unknown;
}): { p256dh: string; auth: string } {
  const p256dh = input.p256dh;
  const auth = input.auth;
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length < 16 ||
    p256dh.length > WEB_PUSH_KEY_MAX ||
    auth.length < 8 ||
    auth.length > WEB_PUSH_KEY_MAX ||
    !B64URL.test(p256dh) ||
    !B64URL.test(auth)
  ) {
    throw unprocessable("PUSH_KEYS_INVALID", "Некорректные ключи подписки");
  }
  return { p256dh, auth };
}

export function assertSafeSameOriginPath(
  path: string,
  kind: "dm_message" | "game_chat_message",
): string {
  if (!path.startsWith("/") || path.includes("://") || path.includes("\\") || path.includes("#")) {
    throw badRequest("PUSH_PATH_INVALID", "Некорректный путь уведомления");
  }
  if (kind === "dm_message") {
    if (!/^\/messages\?conversation=[0-9a-f-]{36}$/i.test(path)) {
      return "/messages";
    }
    return path;
  }
  if (!/^\/messages\?game=[0-9a-f-]{36}$/i.test(path)) {
    return "/messages";
  }
  return path;
}

export const PUSH_COPY = {
  dm_message: "Новое сообщение",
  game_chat_message: "Новое сообщение в чате игры",
} as const;
