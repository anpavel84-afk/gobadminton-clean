import { CommunityError, communityWire, commentsPath, id as communityId } from './venue-community.ts';
import type { Packet as CommunityPacket, Query as CommunityQuery } from './venue-community.ts';
import {
  COMMENT_PHOTO_MAX_BYTES, PHOTO_RIGHTS, isCommentPhotoMime, isPhotoReceipt,
} from './venue-comment-photos.ts';
import type { VenueCommentPhotoReceipt } from './venue-comment-photos.ts';
import { PostgameError, postgameId, cursor as postgameCursor, resultsQuery, historyQuery, wire as postgameWire, parseResults, parseOwnResults, parseReminders, parseAttendanceDispute, parseAttendanceHistory, parsePersonalNote, parseMeReviewsPage, reviewsQuery } from './postgame.ts';
import type { Packet as PostgamePacket, ResultsQuery } from './postgame.ts';
import { interestWire, statesPath, parsePlayInterestReceipt, PlayInterestError } from './play-interests.ts';
import type { PlayInterestPacket } from './play-interests.ts';
import { RadarError, RADAR_WIRE, resultProof } from './radar.ts';
import type { RadarRead, RadarCommand } from './radar.ts';
import { SafetyError, parseSafetyReceipt, safetyWire } from './safety.ts';
import type { SafetyPacket } from './safety.ts';
import { parseContactState, parseContactResult } from './contact.ts';
import type { ContactPacket } from './contact.ts';
import { ProfileError, parseCoverReceipt, parseLookingIntent, parseOwnAvatar, parseOwnProfile, profileWireBody, visibilityWireBody } from './profile.ts';
import type { AvatarReceipt, CoverReceipt, LookingPacket, ProfileMutationPacket, VisibilityPacket } from './profile.ts';
import { lookingDeleteWire, lookingPutWire } from './looking-for-game.ts';
import type { AvatarPacket } from './profile-avatar.ts';
import type { CoverPacket } from './profile-cover.ts';
import { parseCreatorProfile, parsePreferences, parseOwnTrainer } from './game-management.ts';
import type { ManagementPacket } from './game-management.ts';
import {
  parseTrainerProfile, trainerDeactivateWire, trainerUpsertWire,
} from './trainer-profile.ts';
import type { TrainerPacket } from './trainer-profile.ts';
import { MessagesError, messageId, parseMessageMutation, parseInbox, parseCounts, parseConversation, parseChat, parseMembers, parseMessage, parseMessagePage, parseInvitation, parseInvitationPage, parseOwnMessageIdentity, resourcePath, mutationPath } from './messages.ts';
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
  async function interestRequest(path: string, access: string, packet?: PlayInterestPacket) {
    const wire = packet ? interestWire(packet) : null;
    if (wire && wire.path !== path) throw new PlayInterestError('invalid');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method: packet ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${access}`,
          ...(packet ? {'Content-Type':'application/json','Idempotency-Key':packet.key} : {}) },
        ...(wire ? {body:JSON.stringify(wire.body)} : {}),
      });
      if (response.status === 401) throw new NativeAuthError('authority');
      if (!response.ok) {
        let code = '';
        try { const row = await response.json(); if (typeof row?.code === 'string' && /^[A-Z_]{1,80}$/.test(row.code)) code=row.code; } catch { /* No raw response retained. */ }
        throw new PlayInterestError([400,403,404,409,422,429].includes(response.status) && code !== 'COMMAND_IN_PROGRESS' ? 'refused' : 'network',response.status,code);
      }
      return await response.json();
    } catch (error) {
      if(error instanceof NativeAuthError || error instanceof PlayInterestError) throw error;
      throw new PlayInterestError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timeout); }
  }
  async function postgameRequest(path: string, access: string, packet?: PostgamePacket): Promise<unknown> {
    const operation = packet ? postgameWire(packet) : null;
    if (operation && (operation.path !== path || packet?.path !== path || packet.method !== operation.method || !packet.key)) throw new PostgameError('invalid');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method: operation?.method ?? 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${access}`,
          ...(packet ? { 'Content-Type': 'application/json', 'Idempotency-Key': packet.key } : {}) },
        ...(operation ? {body: JSON.stringify(operation.body)} : {}),
      });
      if (response.status === 401) throw new NativeAuthError('authority');
      if (!response.ok) {
        let code = '';
        try { const row = await response.json(); if (typeof row?.code === 'string' && /^[A-Z_]{1,80}$/.test(row.code)) code=row.code; } catch { /* No private response text retained. */ }
        throw new PostgameError(response.status >= 500 || code === 'COMMAND_IN_PROGRESS' ? 'network'
          : [403,404].includes(response.status) ? 'private' : [400,409,422,429].includes(response.status) ? 'business' : 'network',response.status,code);
      }
      if (![200, 201].includes(response.status)) throw new PostgameError('invalid');
      return await response.json();
    } catch(error) {
      if(error instanceof NativeAuthError || error instanceof PostgameError) throw error;
      throw new PostgameError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timer); }
  }
  async function communityRequest(path: string, access: string, packet?: CommunityPacket): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${NATIVE_ORIGIN}/v1${path}`, {
        method: packet?.method ?? 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${access}`,
          ...(packet ? {'Content-Type':'application/json', 'Idempotency-Key':packet.key} : {}) },
        ...(packet ? {body: JSON.stringify(packet.body)} : {}),
      });
      if (response.status === 401) throw new NativeAuthError('authority');
      if (!response.ok) {
        let code = '';
        try { const row = await response.json(); if (typeof row?.code === 'string' && /^[A-Z_]{1,80}$/.test(row.code)) code = row.code; } catch { /* Never retain private error/detail. */ }
        const moderationFailure = ['MODERATION_TEMPORARILY_UNAVAILABLE','MODERATION_POLICY_MISMATCH'].includes(code);
        throw new CommunityError(moderationFailure ? 'refused' : [403,404].includes(response.status) ? 'private'
          : [400,409,422,429].includes(response.status) && code !== 'COMMAND_IN_PROGRESS' ? 'refused' : 'network', response.status, code);
      }
      if (![200,201].includes(response.status)) throw new CommunityError('invalid');
      return await response.json();
    } catch (error) {
      if (error instanceof CommunityError || error instanceof NativeAuthError) throw error;
      throw new CommunityError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally { clearTimeout(timer); }
  }
  return {
    communityOwn: (access: string, venueId: string) => communityRequest(`/venues/${communityId(venueId)}/community-rating/me`, access),
    communityComments: (access: string, query: CommunityQuery) => communityRequest(commentsPath(query), access),
    communityMutation: (access: string, packet: CommunityPacket) => { const wire = communityWire(packet); return communityRequest(wire.path, access, packet); },
    /** Closed RAW BINARY comment-photo upload — image bytes only; never CSRF or cookie auth. */
    uploadCommentPhoto: async (
      access: string,
      input: Readonly<{ venueId: string; key: string; mime: string; bytes: Uint8Array }>,
    ): Promise<VenueCommentPhotoReceipt> => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const venueId = communityId(input.venueId);
        communityId(input.key);
        if (!isCommentPhotoMime(input.mime) || !input.bytes.byteLength || input.bytes.byteLength > COMMENT_PHOTO_MAX_BYTES) {
          throw new CommunityError('invalid');
        }
        const body = new Uint8Array(input.bytes.byteLength);
        body.set(input.bytes);
        const response = await fetcher(`${NATIVE_ORIGIN}/v1/venues/${encodeURIComponent(venueId)}/comment-photos`, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${access}`,
            'Content-Type': input.mime,
            'Idempotency-Key': input.key,
            'X-Photo-Rights': PHOTO_RIGHTS,
          },
          body,
        });
        if (response.status === 401) throw new NativeAuthError('authority');
        if (!response.ok) {
          let code = '';
          try {
            const problem = await response.json();
            if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code;
          } catch { /* No raw text retained. */ }
          throw new CommunityError(
            [403, 404].includes(response.status) ? 'private'
              : code !== 'COMMAND_IN_PROGRESS' && [400, 409, 413, 415, 422, 429].includes(response.status) ? 'refused'
                : 'network',
            response.status,
            code,
          );
        }
        if (response.status !== 201) throw new CommunityError('invalid');
        const raw = await response.json();
        if (!isPhotoReceipt(raw, venueId, 'ready')) throw new CommunityError('invalid');
        return raw;
      } catch (error) {
        if (error instanceof CommunityError || error instanceof NativeAuthError) throw error;
        throw new CommunityError(error instanceof SyntaxError ? 'invalid' : 'network');
      } finally {
        clearTimeout(timeout);
      }
    },
    commentPhotoStatus: async (
      access: string,
      input: Readonly<{ id: string; venueId: string }>,
    ): Promise<VenueCommentPhotoReceipt> => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const photoId = communityId(input.id);
        const venueId = communityId(input.venueId);
        const response = await fetcher(`${NATIVE_ORIGIN}/v1/me/venue-photo-submissions/${encodeURIComponent(photoId)}`, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${access}`,
          },
        });
        if (response.status === 401) throw new NativeAuthError('authority');
        if (!response.ok) {
          let code = '';
          try {
            const problem = await response.json();
            if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code;
          } catch { /* No raw text retained. */ }
          throw new CommunityError(
            [403, 404].includes(response.status) ? 'private'
              : code !== 'COMMAND_IN_PROGRESS' && [400, 409, 422, 429].includes(response.status) ? 'refused'
                : 'network',
            response.status,
            code,
          );
        }
        const raw = await response.json();
        if (!isPhotoReceipt(raw, venueId, 'ready', photoId)) throw new CommunityError('invalid');
        return raw;
      } catch (error) {
        if (error instanceof CommunityError || error instanceof NativeAuthError) throw error;
        throw new CommunityError(error instanceof SyntaxError ? 'invalid' : 'network');
      } finally {
        clearTimeout(timeout);
      }
    },
    withdrawCommentPhoto: async (
      access: string,
      input: Readonly<{ id: string; key: string; venueId: string }>,
    ): Promise<VenueCommentPhotoReceipt> => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const photoId = communityId(input.id);
        const venueId = communityId(input.venueId);
        communityId(input.key);
        const response = await fetcher(`${NATIVE_ORIGIN}/v1/me/venue-photo-submissions/${encodeURIComponent(photoId)}`, {
          method: 'DELETE',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': input.key,
            'X-Photo-Version': '1',
          },
          body: JSON.stringify({ expectedVersion: 1 }),
        });
        if (response.status === 401) throw new NativeAuthError('authority');
        if (!response.ok) {
          let code = '';
          try {
            const problem = await response.json();
            if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code;
          } catch { /* No raw text retained. */ }
          throw new CommunityError(
            [403, 404].includes(response.status) ? 'private'
              : code !== 'COMMAND_IN_PROGRESS' && [400, 409, 422, 429].includes(response.status) ? 'refused'
                : 'network',
            response.status,
            code,
          );
        }
        const raw = await response.json();
        if (!isPhotoReceipt(raw, venueId, 'withdrawn', photoId)) throw new CommunityError('invalid');
        return raw;
      } catch (error) {
        if (error instanceof CommunityError || error instanceof NativeAuthError) throw error;
        throw new CommunityError(error instanceof SyntaxError ? 'invalid' : 'network');
      } finally {
        clearTimeout(timeout);
      }
    },
    postgameOwn: async (access: string, cursor?: string) => parseOwnResults(await postgameRequest(`/me/game-results?limit=20${cursor ? `&cursor=${encodeURIComponent(postgameCursor(cursor))}` : ''}`,access)),
    postgameResults: async (access: string, gameId: string, query?: ResultsQuery) => parseResults(await postgameRequest(`/games/${postgameId(gameId)}/results${resultsQuery(query)}`,access)),
    postgameReminders: async (access: string) => parseReminders(await postgameRequest('/me/postgame-reminders?limit=20',access)),
    postgameDispute: async (access: string, disputeId: string) => parseAttendanceDispute(await postgameRequest(`/attendance-disputes/${postgameId(disputeId)}`,access)),
    postgameHistory: async (access: string, gameId: string, contextId: string, limit?: number) => parseAttendanceHistory(await postgameRequest(`/games/${postgameId(gameId)}/attendance/${postgameId(contextId)}/history${historyQuery(limit)}`,access)),
    postgameNote: async (access: string, gameId: string, contextId: string) => parsePersonalNote(await postgameRequest(`/games/${postgameId(gameId)}/notes/${postgameId(contextId)}`, access)),
    postgameReviews: async (access: string, direction: 'sent' | 'received', cursor?: string) => parseMeReviewsPage(await postgameRequest(`/me/reviews${reviewsQuery({ direction, limit: 20, ...(cursor ? { cursor } : {}) })}`, access)),
    postgameMutation: (access: string, packet: PostgamePacket) => postgameRequest(postgameWire(packet).path,access,packet),
    playInterestStates: (access: string, ids: readonly string[]) => interestRequest(statesPath([...ids]), access),
    playInterestMutation: async (access: string, packet: PlayInterestPacket) => {
      const wire = interestWire(packet);
      return parsePlayInterestReceipt(await interestRequest(wire.path,access,packet),packet.kind);
    },
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
    saveOwnProfile: async (access: string, packet: ProfileMutationPacket) => parseOwnProfile(await request('/me/social-profile', 'PATCH',
      profileWireBody(packet.body), access, packet.key, false, false, false, true)),
    /** Closed looking PUT/DELETE — explicit 60|180 TTL on PUT; empty {} on DELETE; never GPS/consent fields. */
    mutateOwnLooking: async (access: string, packet: LookingPacket) => {
      if (packet.kind === 'lookingPut') {
        return parseLookingIntent(await request('/me/looking-for-game', 'PUT',
          lookingPutWire(packet.body), access, packet.key, false, false, false, true));
      }
      return parseLookingIntent(await request('/me/looking-for-game', 'DELETE',
        lookingDeleteWire(), access, packet.key, false, false, false, true));
    },
    /** Closed visibility PUT — never routed through profileWireBody/PATCH; consent only when ON+present. */
    mutateOwnVisibility: async (access: string, packet: VisibilityPacket) => parseOwnProfile(await request(
      '/me/social-profile/visibility', 'PUT', visibilityWireBody(packet.body), access, packet.key, false, false, false, true)),
    /** Closed RAW BINARY avatar port — PUT/DELETE /me/avatar only; never JSON.stringify binary/multipart/base64. */
    mutateOwnAvatar: async (access: string, packet: AvatarPacket): Promise<AvatarReceipt> => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const replace = packet.action === 'replace';
        if (replace && (!packet.derivative || !packet.derivative.bytes.byteLength)) throw new ProfileError('invalid');
        if (!replace && packet.derivative) throw new ProfileError('invalid');
        // Owned ArrayBuffer-backed bytes for fetch BodyInit; packet wire copy stays immutable for retry.
        let body: Uint8Array<ArrayBuffer> | undefined;
        if (replace) {
          const src = packet.derivative!.bytes;
          body = new Uint8Array(src.byteLength);
          body.set(src);
        }
        const response = await fetcher(`${NATIVE_ORIGIN}/v1/me/avatar`, {
          method: replace ? 'PUT' : 'DELETE',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${access}`,
            'Idempotency-Key': packet.key,
            'X-Profile-Version': String(packet.profileVersion),
            ...(replace ? { 'Content-Type': packet.derivative!.mime } : {}),
          },
          ...(body ? { body } : {}),
        });
        if (!response.ok) {
          let code = 'UNKNOWN';
          try {
            const problem = await response.json();
            if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code;
          } catch { /* No raw text retained. */ }
          throw new ProfileError(
            response.status >= 500 ? 'network' : response.status === 401 ? 'authority'
              : code !== 'COMMAND_IN_PROGRESS' && [400, 403, 404, 409, 413, 415, 422, 429].includes(response.status) ? 'business' : 'network',
            response.status,
            code,
          );
        }
        const raw = await response.json();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProfileError('invalid');
        const row = raw as Record<string, unknown>;
        if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new ProfileError('invalid');
        return { version: row.version as number, avatar: parseOwnAvatar(row.avatar) };
      } catch (error) {
        if (error instanceof ProfileError) throw error;
        throw new ProfileError(error instanceof SyntaxError ? 'invalid' : 'network');
      } finally {
        clearTimeout(timeout);
      }
    },
    /** Closed RAW BINARY cover port — PUT binary / DELETE JSON CAS command; never multipart/base64 image encoding. */
    mutateOwnCover: async (access: string, packet: CoverPacket): Promise<CoverReceipt> => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const replace = packet.action === 'replace';
        if (replace && (!packet.derivative || !packet.derivative.bytes.byteLength)) throw new ProfileError('invalid');
        if (!replace && packet.derivative) throw new ProfileError('invalid');
        let body: Uint8Array<ArrayBuffer> | string | undefined;
        if (replace) {
          const src = packet.derivative!.bytes;
          const bytes = new Uint8Array(src.byteLength);
          bytes.set(src);
          body = bytes;
        } else {
          // Cover DELETE remains a JSON CAS command (coverDeleteVersion); image uploads stay raw binary.
          body = JSON.stringify({ expectedVersion: packet.profileVersion });
        }
        const response = await fetcher(`${NATIVE_ORIGIN}/v1/me/cover`, {
          method: replace ? 'PUT' : 'DELETE',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${access}`,
            'Idempotency-Key': packet.key,
            'X-Profile-Version': String(packet.profileVersion),
            ...(replace
              ? { 'Content-Type': packet.derivative!.mime }
              : { 'Content-Type': 'application/json' }),
          },
          ...(body !== undefined ? { body } : {}),
        });
        if (!response.ok) {
          let code = 'UNKNOWN';
          try {
            const problem = await response.json();
            if (typeof problem?.code === 'string' && /^[A-Z_]{1,80}$/.test(problem.code)) code = problem.code;
          } catch { /* No raw text retained. */ }
          throw new ProfileError(
            response.status >= 500 ? 'network' : response.status === 401 ? 'authority'
              : code !== 'COMMAND_IN_PROGRESS' && [400, 403, 404, 409, 413, 415, 422, 429].includes(response.status) ? 'business' : 'network',
            response.status,
            code,
          );
        }
        return parseCoverReceipt(await response.json());
      } catch (error) {
        if (error instanceof ProfileError) throw error;
        throw new ProfileError(error instanceof SyntaxError ? 'invalid' : 'network');
      } finally {
        clearTimeout(timeout);
      }
    },
    ownCover: async (access: string): Promise<CoverReceipt> =>
      parseCoverReceipt(await request('/me/cover', 'GET', undefined, access, undefined, false, false, false, true)),

    creatorProfile: async (access: string) => parseCreatorProfile(await request('/me/social-profile', 'GET', undefined, access, undefined, true)),
    gamePreferences: async (access: string) => parsePreferences(await request('/me/game-preferences', 'GET', undefined, access, undefined, true)),
    ownTrainer: async (access: string) => parseOwnTrainer(await request('/me/trainer-profile', 'GET', undefined, access, undefined, true)),
    /** Full own TrainerProfile DTO for editor CAS — genuine 404 → null; other failures stay errors. */
    ownTrainerProfile: async (access: string) => {
      try {
        return parseTrainerProfile(await request('/me/trainer-profile', 'GET', undefined, access, undefined, false, false, false, true));
      } catch (error) {
        if (error instanceof ProfileError && error.status === 404) return null;
        throw error;
      }
    },
    mutateOwnTrainer: async (access: string, packet: TrainerPacket) => {
      if (packet.kind === 'upsert') {
        return parseTrainerProfile(await request('/me/trainer-profile', 'PUT',
          trainerUpsertWire(packet.body), access, packet.key, false, false, false, true));
      }
      return parseTrainerProfile(await request('/me/trainer-profile/deactivate', 'POST',
        trainerDeactivateWire(packet.body.expectedVersion), access, packet.key, false, false, false, true));
    },
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
    myInvitations: async (access: string, cursor?: string) => parseInvitationPage(await privateMessage(`/me/invitations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, access)),
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
