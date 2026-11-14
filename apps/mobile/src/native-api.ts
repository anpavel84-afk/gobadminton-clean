import { NATIVE_CLIENT_ID, NATIVE_ORIGIN, NativeAuthError, parseMethods } from './native-auth-protocol.ts';
import type { NativeExchangeRequest, NativeTransactionRequest } from '@gobadminton/contracts/native-auth';

export function createNativeApi(fetcher: typeof fetch = fetch) {
  // Deliberately closed route surface: never forward caller URLs, cookies, Origin or browser bridge commands.
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, access?: string, key?: string): Promise<unknown> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 || response.status === 403) throw new NativeAuthError('authority');
      if (response.status === 404 || response.status === 503) throw new NativeAuthError('unavailable');
      if (!response.ok) throw new NativeAuthError('invalid');
      return await response.json();
    } catch (error) {
      if (error instanceof NativeAuthError) throw error;
      // Never forward server errors, response text, fetch URLs or credentials.
      throw new NativeAuthError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timeout); }
  }
  return {
    methods: async () => parseMethods(await request('/auth/methods', 'GET')),
    transaction: (body: NativeTransactionRequest) => request('/auth/native/transactions', 'POST', body),
    exchange: (body: NativeExchangeRequest) => request('/auth/native/exchange', 'POST', body),
    refresh: (refreshToken: string) => request('/auth/native/refresh', 'POST', { clientId: NATIVE_CLIENT_ID, refreshToken }),
    logout: (refreshToken?: string, access?: string) => request('/auth/native/logout', 'POST', { clientId: NATIVE_CLIENT_ID, ...(refreshToken ? { refreshToken } : {}) }, access),
    me: (access: string) => request('/me', 'GET', undefined, access),
    sessions: (access: string) => request('/me/sessions', 'GET', undefined, access),
    revoke: (access: string, id: string, key: string) => request(`/me/sessions/${encodeURIComponent(id)}`, 'DELETE', undefined, access, key),
    revokeOthers: (access: string, key: string) => request('/me/sessions/revoke-others', 'POST', {}, access, key),
  };
}
export type NativeApi = ReturnType<typeof createNativeApi>;
