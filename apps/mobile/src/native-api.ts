import { parseCreatorProfile, parsePreferences, parseOwnTrainer } from './game-management.ts';
import type { ManagementPacket } from './game-management.ts';
import { MessagesError, messageId, parseMessageMutation, parseInbox, parseCounts, parseConversation, parseChat, parseMembers, parseMessage, parseMessagePage, parseInvitation, parseOwnMessageIdentity, resourcePath, mutationPath } from './messages.ts';
import type { InboxFilter, MessageResource, MessageAction, MessageBody } from './messages.ts';
import { PlayersError, parsePlayer, parsePlayerPage, playerQuery } from './players.ts';
import type { PlayerFilters } from './players.ts';
import { ParticipationError, parseCursorPage, parseAuthenticatedGame, parseManagedGame, parseParticipation } from './participation.ts';
import { NATIVE_CLIENT_ID, NATIVE_ORIGIN, NativeAuthError, parseMethods } from './native-auth-protocol.ts';
import type { NativeExchangeRequest, NativeTransactionRequest } from '@gobadminton/contracts/native-auth';

export function createNativeApi(fetcher: typeof fetch = fetch) {
  // Deliberately closed route surface: never forward caller URLs, cookies, Origin or browser bridge commands.
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, access?: string, key?: string, participation = false, players = false, messages = false): Promise<unknown> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (messages && !response.ok) {
        let code = 'UNKNOWN';
        try { const problem = await response.json(); if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code; } catch { /* no response text retained */ }
        throw new MessagesError([401,403,404].includes(response.status) ? 'private'
          : [400,409,422,429].includes(response.status) && code !== 'COMMAND_IN_PROGRESS' ? 'business' : 'network', response.status, code);
      }
      if (participation && !response.ok) {
        let code = 'UNKNOWN';
        try {
          const problem = await response.json();
          const candidate = problem?.code;
          if (typeof candidate === 'string' && ['FORM_INVALID', 'TRAINER_PROFILE_INACTIVE', 'GAME_PREFERENCES_VERSION_CONFLICT', 'COMMAND_IN_PROGRESS', 'VERSION_CONFLICT', 'GAME_FULL', 'APPLICATION_CLOSED', 'GAME_ALREADY_STARTED', 'GAME_NOT_PUBLISHED', 'EXPECTED_GAME_VERSION_INVALID', 'EXPECTED_VERSION_INVALID', 'PARTICIPATION_NOT_FOUND', 'CAPABILITY_RESTRICTED', 'PARTICIPATION_STATUS_CONFLICT', 'KEY_REUSED'].includes(candidate)) code = candidate;
        } catch { /* Do not expose raw responses. */ }
        throw new ParticipationError(response.status === 401 ? 'authority'
          : [400, 403, 404, 409, 422].includes(response.status) ? 'business' : 'network', response.status, code);
      }
      if (response.status === 401 || response.status === 403) throw new NativeAuthError('authority');
      if (players && !response.ok) throw new PlayersError(response.status === 404 ? 'unavailable' : 'server', response.status);
      if (response.status === 404 || response.status === 503) throw new NativeAuthError('unavailable');
      if (!response.ok) throw new NativeAuthError('invalid');
      return await response.json();
    } catch (error) {
      if (error instanceof NativeAuthError || error instanceof ParticipationError || error instanceof PlayersError || error instanceof MessagesError) throw error;
      if (messages) throw new MessagesError(error instanceof SyntaxError ? 'invalid' : 'network');
      if (participation) throw new ParticipationError(error instanceof SyntaxError ? 'invalid' : 'network');
      // Never forward server errors, response text, fetch URLs or credentials.
      throw new NativeAuthError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timeout); }
  }
  const privateMessage = (path: string, access: string, body?: MessageBody, key?: string) => request(path, body === undefined ? 'GET' : 'POST', body, access, key, false, false, true);
  return {
    creatorProfile: async (access: string) => parseCreatorProfile(await request('/me/social-profile', 'GET', undefined, access, undefined, true)),
    gamePreferences: async (access: string) => parsePreferences(await request('/me/game-preferences', 'GET', undefined, access, undefined, true)),
    ownTrainer: async (access: string) => parseOwnTrainer(await request('/me/trainer-profile', 'GET', undefined, access, undefined, true)),
    gameParticipants: async (access: string, id: string, cursor?: string) => parseCursorPage(await request(`/games/${encodeURIComponent(id)}/participations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, access, undefined, true), parseParticipation),
    managementMutation: async (access: string, packet: ManagementPacket) => {
      const path = packet.kind === 'create' ? '/games' : packet.kind === 'publish' ? `/games/${encodeURIComponent(packet.gameId)}/publish`
        : `/participations/${encodeURIComponent(packet.participationId)}/${packet.kind}`;
      const value = await request(path, 'POST', packet.body, access, packet.key, true);
      return packet.kind === 'create' || packet.kind === 'publish' ? parseAuthenticatedGame(value) : parseParticipation(value);
    },
    inbox: async (access: string, filter: InboxFilter, cursor?: string) => parseInbox(await privateMessage(`/me/inbox?limit=50&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, access)),
    inboxCounts: async (access: string) => parseCounts(await privateMessage('/me/inbox/counts', access)),
    messageIdentity: async (access: string) => parseOwnMessageIdentity(await privateMessage('/me/social-profile', access)),
    conversation: async (access: string, id: string) => parseConversation(await privateMessage(resourcePath({ kind: 'direct', id }), access)),
    gameChat: async (access: string, id: string) => parseChat(await privateMessage(resourcePath({ kind: 'game', id }), access)),
    chatMembers: async (access: string, id: string) => parseMembers(await privateMessage(`/games/${messageId(id)}/chat/members`, access)),
    invitation: async (access: string, id: string) => parseInvitation(await privateMessage(resourcePath({ kind: 'invitation', id }), access)),
    messageHistory: async (access: string, r: MessageResource, before?: string, after?: string) => {
      if (r.kind === 'invitation') throw new MessagesError('invalid');
      return parseMessagePage(await privateMessage(`${resourcePath(r)}/messages?limit=50${before ? `&beforeSeq=${encodeURIComponent(before)}` : ''}${after ? `&afterSeq=${encodeURIComponent(after)}` : ''}`, access), parseMessage);
    },
    messageMutation: async (access: string, r: MessageResource, action: MessageAction, body: MessageBody, key: string) => parseMessageMutation(r,action,await privateMessage(mutationPath(r, action), access, body, key)),
    players: async (access: string, filters: PlayerFilters, cursor?: string) => parsePlayerPage(await request(`/players?${playerQuery(filters, cursor)}`, 'GET', undefined, access, undefined, false, true)),
    player: async (access: string, id: string) => parsePlayer(await request(`/players/${encodeURIComponent(id)}`, 'GET', undefined, access, undefined, false, true)),
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
