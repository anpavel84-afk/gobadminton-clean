import { ParticipationError, parseCursorPage, parseAuthenticatedGame, parseManagedGame, parseParticipation } from './participation.ts';
import { NATIVE_CLIENT_ID, NATIVE_ORIGIN, NativeAuthError, parseMethods } from './native-auth-protocol.ts';
import type { NativeExchangeRequest, NativeTransactionRequest } from '@gobadminton/contracts/native-auth';

export function createNativeApi(fetcher: typeof fetch = fetch) {
  // Deliberately closed route surface: never forward caller URLs, cookies, Origin or browser bridge commands.
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, access?: string, key?: string, participation = false): Promise<unknown> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (participation && !response.ok) {
        let code = 'UNKNOWN';
        try {
          const problem = await response.json();
          const candidate = problem?.code;
          if (typeof candidate === 'string' && ['COMMAND_IN_PROGRESS', 'VERSION_CONFLICT', 'GAME_FULL', 'APPLICATION_CLOSED', 'GAME_ALREADY_STARTED', 'GAME_NOT_PUBLISHED', 'EXPECTED_GAME_VERSION_INVALID', 'EXPECTED_VERSION_INVALID', 'PARTICIPATION_NOT_FOUND', 'CAPABILITY_RESTRICTED', 'PARTICIPATION_STATUS_CONFLICT', 'KEY_REUSED'].includes(candidate)) code = candidate;
        } catch { /* Do not expose raw responses. */ }
        throw new ParticipationError(response.status === 401 ? 'authority'
          : [400, 403, 404, 409, 422].includes(response.status) ? 'business' : 'network', response.status, code);
      }
      if (response.status === 401 || response.status === 403) throw new NativeAuthError('authority');
      if (response.status === 404 || response.status === 503) throw new NativeAuthError('unavailable');
      if (!response.ok) throw new NativeAuthError('invalid');
      return await response.json();
    } catch (error) {
      if (error instanceof NativeAuthError || error instanceof ParticipationError) throw error;
      if (participation) throw new ParticipationError(error instanceof SyntaxError ? 'invalid' : 'network');
      // Never forward server errors, response text, fetch URLs or credentials.
      throw new NativeAuthError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timeout); }
  }
  return {
    gameDetail: async (access: string, gameId: string) => parseAuthenticatedGame(await request(`/games/${encodeURIComponent(gameId)}`, 'GET', undefined, access, undefined, true)),
    ownParticipations: async (access: string, cursor?: string) => parseCursorPage(await request(`/me/participations?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, access, undefined, true), parseParticipation),
    managedGames: async (access: string, cursor?: string) => parseCursorPage(await request(`/me/games?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, access, undefined, true), parseManagedGame),
    requestParticipation: async (access: string, gameId: string, body: Readonly<{ expectedGameVersion: number }>, key: string) =>
      parseParticipation(await request(`/games/${encodeURIComponent(gameId)}/participations`, 'POST', body, access, key, true)),
    withdrawParticipation: async (access: string, id: string, body: Readonly<{ expectedVersion: number }>, key: string) =>
      parseParticipation(await request(`/participations/${encodeURIComponent(id)}/withdraw`, 'POST', body, access, key, true)),
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
