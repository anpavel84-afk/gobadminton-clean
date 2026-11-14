import type { NativeCredentials, NativeMe, NativeTransactionResponse } from '@gobadminton/contracts/native-auth';

export const NATIVE_CLIENT_ID = 'gobadminton-native-dev';
export const NATIVE_REDIRECT = 'https://dev.gobadminton.ru/auth/native/callback';
export const NATIVE_ORIGIN = 'https://dev.gobadminton.ru';
export const SECURE_AUTH_KEY = 'gobadminton.mobile.auth.v1';
const opaque = /^[A-Za-z0-9_-]{43}$/;
type AuthErrorKind = 'network' | 'unavailable' | 'authority' | 'invalid' | 'storage' | 'expired' | 'stale';
export class NativeAuthError extends Error {
  readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind) {
    super(kind); this.name = 'NativeAuthError'; this.kind = kind;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeAuthError('invalid');
  return value as Record<string, unknown>;
}
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function timestamp(value: unknown): value is string { return string(value) && Number.isFinite(Date.parse(value)); }
/** Unknown optional response fields are tolerated; never retain them as private profile data. */
export function parseNativeMe(value: unknown): NativeMe {
  const row = record(value), session = record(row.session);
  if (!string(row.id) || !string(row.displayName) || !string(row.locale) || !Array.isArray(row.linkedProviders) ||
      !row.linkedProviders.every(string) || !string(session.id) || session.audience !== 'consumer_native' || session.transport !== 'bearer') {
    throw new NativeAuthError('invalid');
  }
  return { id: row.id, displayName: row.displayName, locale: row.locale, linkedProviders: [...row.linkedProviders],
    session: { id: session.id, audience: 'consumer_native', transport: 'bearer' } };
}
export function parseCredentials(value: unknown, now: number): NativeCredentials {
  const row = record(value);
  if (typeof row.accessToken !== 'string' || !opaque.test(row.accessToken) || typeof row.refreshToken !== 'string' ||
      !opaque.test(row.refreshToken) || row.tokenType !== 'Bearer' || row.expiresIn !== 600 || !string(row.sessionId) ||
      !timestamp(row.refreshExpiresAt) || !timestamp(row.refreshAbsoluteExpiresAt) || Date.parse(row.refreshExpiresAt) <= now ||
      Date.parse(row.refreshAbsoluteExpiresAt) < Date.parse(row.refreshExpiresAt)) throw new NativeAuthError('invalid');
  return { accessToken: row.accessToken, refreshToken: row.refreshToken, tokenType: 'Bearer', expiresIn: 600,
    sessionId: row.sessionId, refreshExpiresAt: row.refreshExpiresAt, refreshAbsoluteExpiresAt: row.refreshAbsoluteExpiresAt };
}
/** Only a single canonical game segment is retained; queries, auth inputs and actions never become intent. */
export function canonicalGamePath(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/games\/[^/?#\\]+$/.test(value)) return null;
  try {
    const id = decodeURIComponent(value.slice(7));
    if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return `/games/${encodeURIComponent(id)}` === value ? value : null;
  } catch { return null; }
}
export function gamePath(id: string): string | null { return canonicalGamePath(`/games/${encodeURIComponent(id)}`); }
export function publicGameUrl(id: string): string {
  const path = gamePath(id); if (!path) throw new NativeAuthError('invalid');
  return `${NATIVE_ORIGIN}${path}`;
}
export function parseTransaction(value: unknown, now: number): NativeTransactionResponse {
  const row = record(value);
  if (typeof row.transactionId !== 'string' || !opaque.test(row.transactionId) || !timestamp(row.expiresAt) ||
      Date.parse(row.expiresAt) <= now || Date.parse(row.expiresAt) > now + 600_000 ||
      row.browserStartUrl !== `${NATIVE_ORIGIN}/auth/native?transactionId=${row.transactionId}`) throw new NativeAuthError('invalid');
  return { transactionId: row.transactionId, expiresAt: row.expiresAt, browserStartUrl: row.browserStartUrl };
}
export type PendingLogin = {
  generation: string; clientId: typeof NATIVE_CLIENT_ID; redirectUri: typeof NATIVE_REDIRECT;
  verifier: string; state: string; transactionId: string; expiresAt: number; returnPath: string | null;
};
export type SecureSession = { refreshToken: string; sessionId: string; actorId: string; refreshExpiresAt: string; refreshAbsoluteExpiresAt: string };
export type SecureEnvelope = { version: 1; generation: string; returnPath: string | null; session?: SecureSession; pending?: PendingLogin };
/** A future version is never erased/migrated by this binary. Existing preferences use a separate key. */
export function parseSecureEnvelope(raw: string | null, now: number): SecureEnvelope | null {
  if (raw === null) return null;
  try {
    const row = record(JSON.parse(raw));
    if (row.version !== 1 || typeof row.generation !== 'string' || !opaque.test(row.generation) ||
        !(row.returnPath === null || canonicalGamePath(row.returnPath))) throw new NativeAuthError('storage');
    const envelope: SecureEnvelope = { version: 1, generation: row.generation, returnPath: row.returnPath as string | null };
    if (row.session !== undefined && row.pending !== undefined) throw new NativeAuthError('storage');
    if (row.session !== undefined) {
      const session = record(row.session);
      if (typeof session.refreshToken !== 'string' || !opaque.test(session.refreshToken) || !string(session.sessionId) ||
          !string(session.actorId) || !timestamp(session.refreshExpiresAt) || !timestamp(session.refreshAbsoluteExpiresAt)) throw new NativeAuthError('storage');
      if (Date.parse(session.refreshExpiresAt) > now && Date.parse(session.refreshAbsoluteExpiresAt) > now) {
        envelope.session = { refreshToken: session.refreshToken, sessionId: session.sessionId, actorId: session.actorId,
          refreshExpiresAt: session.refreshExpiresAt, refreshAbsoluteExpiresAt: session.refreshAbsoluteExpiresAt };
      }
    }
    if (row.pending !== undefined) {
      const pending = record(row.pending);
      if (pending.generation !== row.generation || pending.clientId !== NATIVE_CLIENT_ID || pending.redirectUri !== NATIVE_REDIRECT ||
          typeof pending.verifier !== 'string' || !opaque.test(pending.verifier) || typeof pending.state !== 'string' || !opaque.test(pending.state) ||
          typeof pending.transactionId !== 'string' || !opaque.test(pending.transactionId) || typeof pending.expiresAt !== 'number' ||
          pending.expiresAt > now + 600_000 || !(pending.returnPath === null || canonicalGamePath(pending.returnPath)) ||
          pending.returnPath !== envelope.returnPath) throw new NativeAuthError('storage');
      if (pending.expiresAt > now) envelope.pending = pending as PendingLogin;
    }
    return envelope;
  } catch { throw new NativeAuthError('storage'); }
}
/** Strict raw prefix also rejects normalized host/port/path tricks. Do not include raw input in any error. */
export function isNativeCallback(raw: string): boolean {
  return raw === NATIVE_REDIRECT || raw.startsWith(`${NATIVE_REDIRECT}?`);
}
export function parseCallback(raw: string, pending: PendingLogin, now: number, generation: string): string {
  if (pending.generation !== generation || pending.expiresAt <= now) throw new NativeAuthError('expired');
  if (!isNativeCallback(raw) || raw.length > 512 || /[\s\\#]/.test(raw)) throw new NativeAuthError('invalid');
  const url = new URL(raw);
  if (`${url.origin}${url.pathname}` !== NATIVE_REDIRECT || url.username || url.password || url.port || url.hash ||
      url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1 ||
      [...url.searchParams.keys()].some(key => key !== 'code' && key !== 'state')) throw new NativeAuthError('invalid');
  const code = url.searchParams.get('code');
  if (!code || !opaque.test(code) || url.searchParams.get('state') !== pending.state) throw new NativeAuthError('invalid');
  return code;
}
/** Platform crypto provides random bytes and SHA256; this conversion is deterministic and has no Node dependency. */
export function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '', bits = 0, accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; result += alphabet[(accumulator >>> bits) & 63]; }
  }
  if (bits > 0) result += alphabet[(accumulator << (6 - bits)) & 63];
  return result;
}
export type NativeSessionRow = { id: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string };
export function parseSessions(value: unknown): NativeSessionRow[] {
  const row = record(value);
  if (!Array.isArray(row.items)) throw new NativeAuthError('invalid');
  return row.items.map(value => {
    const item = record(value);
    if (!string(item.id) || typeof item.current !== 'boolean' || !timestamp(item.createdAt) ||
        !timestamp(item.lastSeenAt) || !timestamp(item.expiresAt)) throw new NativeAuthError('invalid');
    return { id: item.id, current: item.current, createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, expiresAt: item.expiresAt };
  });
}
export type AuthMethod = { method: string; type: string; available: boolean };
export function parseMethods(value: unknown): AuthMethod[] {
  const row = record(value);
  if (!Array.isArray(row.items)) throw new NativeAuthError('invalid');
  return row.items.map(value => {
    const item = record(value);
    if (!string(item.method) || !string(item.type) || typeof item.available !== 'boolean') throw new NativeAuthError('invalid');
    return { method: item.method, type: item.type, available: item.available };
  });
}
