import { RadarError, RADAR_WIRE, resultProof } from './radar.ts';
import type { RadarRead, RadarCommand } from './radar.ts';
import { SafetyError, parseSafetyReceipt, safetyWire } from './safety.ts';
import type { SafetyPacket } from './safety.ts';
import { parseContactState, parseContactResult } from './contact.ts';
import type { ContactPacket } from './contact.ts';
import { ProfileError, parseOwnProfile } from './profile.ts';
import type { ProfilePacket } from './profile.ts';
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
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT', body?: unknown, access?: string, key?: string, participation = false, players = false, messages = false, profile = false, safety = false, radarActivation?: string): Promise<unknown> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(radarActivation ? { 'X-Radar-Activation-Id': radarActivation } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (safety && !response.ok) {
        let code = 'UNKNOWN';
        try { const problem = await response.json(); if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code; } catch { /* No private response text retained. */ }
        throw new SafetyError(response.status === 401 ? 'authority' : response.status < 500 && [400,403,404,409,422,429].includes(response.status) && code !== 'COMMAND_IN_PROGRESS' ? 'business' : 'network', response.status, code);
      }
      if (profile && !response.ok) {
        let code = 'UNKNOWN';
        try { const problem = await response.json(); if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code; } catch { /* No raw text retained. */ }
        const moderationStatus: Record<string, number> = { PUBLIC_TEXT_CONTENT_REJECTED: 422, MODERATION_TEMPORARILY_UNAVAILABLE: 503, MODERATION_POLICY_MISMATCH: 503, MODERATION_RATE_LIMITED: 429 };
        throw new ProfileError(response.status >= 500 ? 'network' : response.status === 401 ? 'authority'
          : code !== 'COMMAND_IN_PROGRESS' && (moderationStatus[code] === response.status || [400,403,404,409,422,429].includes(response.status)) ? 'business' : 'network', response.status, code);
      }
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
      return response.status === 204 ? undefined : await response.json();
    } catch (error) {
      if (error instanceof SafetyError || error instanceof NativeAuthError || error instanceof ParticipationError || error instanceof PlayersError || error instanceof MessagesError || error instanceof ProfileError) throw error;
      if (safety) throw new SafetyError(error instanceof SyntaxError ? 'invalid' : 'network');
      if (profile) throw new ProfileError(error instanceof SyntaxError ? 'invalid' : 'network');
      if (messages) throw new MessagesError(error instanceof SyntaxError ? 'invalid' : 'network');
      if (participation) throw new ParticipationError(error instanceof SyntaxError ? 'invalid' : 'network');
      // Never forward server errors, response text, fetch URLs or credentials.
      throw new NativeAuthError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timeout); }
  }
  const privateMessage = (path: string, access: string, body?: MessageBody, key?: string) => request(path, body === undefined ? 'GET' : 'POST', body, access, key, false, false, true);
  const radarRequest = async (path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', access: string, body?: unknown, key?: string, activationId?: string) => {
    try { return await request(path, method, body, access, key, false, false, true, false, false, activationId); }
    catch (error) {
      if (error instanceof MessagesError && error.status === 401) throw new NativeAuthError('authority');
      if (error instanceof MessagesError) throw new RadarError(error.status >= 400 && error.status < 500 && error.code !== 'COMMAND_IN_PROGRESS' ? 'business' : error.kind === 'invalid' ? 'invalid' : 'network', error.status, error.code);
      throw error;
    }
  };
  return {
    radarRead: async (access: string, operation: RadarRead, previewKey: string) => {
      if (operation.kind === 'config') return radarRequest('/radar/config', 'GET', access);
      if (operation.kind === 'status') return radarRequest('/me/radar/activations/current', 'GET', access);
      if (operation.kind !== 'preview' && operation.kind !== 'map' && operation.kind !== 'query') throw new RadarError('invalid');
      if (operation.kind === 'preview') return radarRequest('/radar/results/preview', 'POST', access, { resultRef: resultProof(operation.resultRef) }, previewKey);
      const input = operation.body;
      if (input.contractVersion !== RADAR_WIRE) throw new RadarError('invalid');
      if (operation.kind === 'map') return radarRequest('/players/query/map', 'POST', access, { contractVersion: RADAR_WIRE, queryRef: operation.body.queryRef, limit: 100,
        ...(operation.body.mapCursor ? { mapCursor: operation.body.mapCursor } : {}) });
      const b = operation.body;
      const body = 'queryRef' in b ? { contractVersion: RADAR_WIRE, queryRef: b.queryRef, cursor: b.cursor, limit: 50 }
        : { contractVersion: RADAR_WIRE, filters: { cityId: b.filters.cityId, name: b.filters.name, areaKey: b.filters.areaKey, looking: b.filters.looking, trainer: b.filters.trainer },
          origin: b.origin.kind === 'current_activation' ? { kind: b.origin.kind, activationId: b.origin.activationId } : b.origin.kind === 'none' ? { kind: 'none' } : (() => { throw new RadarError('invalid'); })(), limit: 50 };
      return radarRequest('/players/query', 'POST', access, body);
    },
    radarCommand: async (access: string, packet: RadarCommand) => {
      const current = '/me/radar/activations/current';
      if (packet.kind === 'stop') return radarRequest(current, 'DELETE', access, undefined, packet.key, packet.activationId);
      const b = packet.body;
      if (b.contractVersion !== RADAR_WIRE) throw new RadarError('invalid');
      const common = { contractVersion: RADAR_WIRE, consentPolicyVersion: b.consentPolicyVersion };
      const fix = (location: {latitude:number;longitude:number;accuracyMeters:number;capturedAt:string}) => ({ latitude: location.latitude, longitude: location.longitude, accuracyMeters: location.accuracyMeters, capturedAt: location.capturedAt });
      let body: unknown;
      if (packet.kind === 'start' || packet.kind === 'takeover') {
        const start = packet.body;
        body = { ...common, consent: { disclosureId: start.consent.disclosureId, disclosureHash: start.consent.disclosureHash, accepted: start.consent.accepted }, location: fix(start.location),
          ...(start.ttlMinutes !== undefined ? { ttlMinutes: start.ttlMinutes } : {}), ...(start.radiusBucketKm !== undefined ? { radiusBucketKm: start.radiusBucketKm } : {}),
          ...(packet.kind === 'takeover' ? { activationId: packet.body.activationId, expectedVersion: packet.body.expectedVersion, confirm: packet.body.confirm } : {}) };
      } else if (packet.kind === 'heartbeat') body = { ...common, activationId: packet.body.activationId };
      else body = { ...common, activationId: packet.body.activationId, expectedVersion: packet.body.expectedVersion,
        ...(packet.body.location ? { location: fix(packet.body.location) } : {}), ...(packet.body.radiusBucketKm !== undefined ? { radiusBucketKm: packet.body.radiusBucketKm } : {}),
        ...(packet.kind === 'renew' && packet.body.extendMinutes !== undefined ? { extendMinutes: packet.body.extendMinutes } : {}) };
      return radarRequest(packet.kind === 'start' ? '/me/radar/activations' : packet.kind === 'update' ? current : `${current}/${packet.kind}`, packet.kind === 'update' ? 'PATCH' : 'POST', access, body, packet.key);
    },
    safetyMutation: async (access: string, packet: SafetyPacket) => {
      const wire = safetyWire(packet);
      return parseSafetyReceipt(packet, await request(wire.path, wire.method, wire.body, access, packet.key, false, false, false, false, true));
    },
    contactState: async (access: string, target: string) => parseContactState(await privateMessage(`/me/contact-state?targetPublicPlayerId=${encodeURIComponent(messageId(target))}`, access), target),
    createContact: async (access: string, packet: ContactPacket) => parseContactResult(await request('/conversations/requests', 'POST', {
      targetPublicPlayerId: packet.body.targetPublicPlayerId, text: packet.body.text, clientMessageId: packet.body.clientMessageId,
      ...(packet.kind === 'radar' ? (() => {
        if (!packet.context.valid() || packet.context.target !== packet.body.targetPublicPlayerId || packet.context.resultRef !== packet.body.discoveryProof || packet.actor.actorId !== packet.context.actor.actorId || packet.actor.sessionId !== packet.context.actor.sessionId) throw new MessagesError('private');
        return { discoveryProof: resultProof(packet.body.discoveryProof) };
      })() : {}),
    }, access, packet.key, false, false, true), packet.body.targetPublicPlayerId),
    ownProfile: async (access: string) => parseOwnProfile(await request('/me/social-profile', 'GET', undefined, access, undefined, false, false, false, true)),
    saveOwnProfile: async (access: string, packet: ProfilePacket) => parseOwnProfile(await request('/me/social-profile', 'PATCH', {
      expectedVersion: packet.body.expectedVersion, displayName: packet.body.displayName, cityId: packet.body.cityId,
    }, access, packet.key, false, false, false, true)),
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
