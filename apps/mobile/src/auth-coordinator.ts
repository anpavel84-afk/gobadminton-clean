import type { Packet as CommunityPacket, Query as CommunityQuery } from './venue-community.ts';
import { PostgameCoordinator } from './postgame-coordinator.ts';
import { PostgameError } from './postgame.ts';
import type { RadarCommand, RadarRead } from './radar.ts';
import type { PlayInterestPacket } from './play-interests.ts';
import { SafetyCoordinator } from './safety-coordinator.ts';
import { SafetyError } from './safety.ts';
import { ContactCoordinator } from './contact-coordinator.ts';
import { ProfileCoordinator, ProfileError } from './profile.ts';
import { ProfileAvatarCoordinator } from './profile-avatar.ts';
import { ProfileCoverCoordinator } from './profile-cover.ts';
import { GameManagementCoordinator } from './game-management.ts';
import { TrainerProfileCoordinator } from './trainer-profile.ts';
import { GameContactPreferenceCoordinator } from './game-contact-preference.ts';
import { GameCourtBookingCoordinator } from './game-court-booking.ts';
import { InvitationAuthoringCoordinator } from './invitation-authoring.ts';
import { MessagesCoordinator } from './messages-coordinator.ts';
import { MessagesError } from './messages.ts';
import { PlayersCoordinator, PlayersError } from './players.ts';
import { publicApi, PublicApiError } from './public-api.ts';
import { ParticipationCoordinator, ParticipationError, sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { NativeMe } from '@gobadminton/contracts/native-auth';
import type { NativeApi } from './native-api.ts';
import { NATIVE_CLIENT_ID, NATIVE_REDIRECT, SECURE_AUTH_KEY, NativeAuthError, canonicalReturnPath,
  parseCallback, parseCredentials, parseNativeMe, parsePublicRoleLocalGoal, parseSecureEnvelope, parseSessions,
  parseTransaction, publicRoleGoalPath } from './native-auth-protocol.ts';
import type { PendingLogin, PublicRoleLocalGoal, SecureEnvelope, SecureSession, NativeSessionRow } from './native-auth-protocol.ts';

export type AuthSnapshot = {
  status: 'hydrating' | 'guest' | 'signing-in' | 'authenticated' | 'unverifiable';
  me: NativeMe | null; sessions: NativeSessionRow[]; returnPath: string | null;
  notice: 'unavailable' | 'signin' | 'storage' | 'network' | 'cancelled' | 'remote-unconfirmed' | null;
};
type Store = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
export type AuthDependencies = { api: NativeApi; store: Store; random: () => string; challenge: (verifier: string) => Promise<string>; now?: () => number };
/** Sole owner of credentials, pending login and private caches. UI never receives bearer/refresh/verifier. */
export class AuthCoordinator {
  private readonly deps: AuthDependencies;
  private readonly now: () => number;
  private epoch = 0;
  private envelope: SecureEnvelope | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private boot: Promise<void> | null = null;
  private rotation: Promise<void> | null = null;
  private exchange: { pending: PendingLogin; code: string; work: Promise<string | null>; goal: PublicRoleLocalGoal | null } | null = null;
  private validation: Promise<void> | null = null;
  private writable = true;
  private starting: Promise<{ url: string; generation: string } | null> | null = null;
  private snapshot: AuthSnapshot = { status: 'hydrating', me: null, sessions: [], returnPath: null, notice: null };
  readonly players = new PlayersCoordinator();
  readonly participation: ParticipationCoordinator;
  readonly messages: MessagesCoordinator;
  readonly gameManagement: GameManagementCoordinator;
  readonly profile: ProfileCoordinator;
  readonly avatar: ProfileAvatarCoordinator;
  readonly cover: ProfileCoverCoordinator;
  readonly trainer: TrainerProfileCoordinator;
  readonly gameContactPreference: GameContactPreferenceCoordinator;
  readonly gameCourtBooking: GameCourtBookingCoordinator;
  readonly invitationAuthoring: InvitationAuthoringCoordinator;
  readonly contact: ContactCoordinator;
  readonly safety: SafetyCoordinator;
  readonly postgame: PostgameCoordinator;
  constructor(deps: AuthDependencies) {
    this.deps = deps; this.now = deps.now ?? Date.now;
    this.postgame = new PostgameCoordinator({
      own: (actor,cursor) => this.participationRead(access => deps.api.postgameOwn(access,cursor),actor),
      reminders: actor => this.participationRead(access => deps.api.postgameReminders(access),actor),
      invitations: (actor,cursor) => this.participationRead(access => deps.api.myInvitations(access,cursor),actor),
      results: (actor,id,query) => this.participationRead(access => deps.api.postgameResults(access,id,query),actor),
      dispute: (actor,disputeId) => this.participationRead(access => deps.api.postgameDispute(access,disputeId),actor),
      history: (actor,gameId,contextId,limit) => this.participationRead(access => deps.api.postgameHistory(access,gameId,contextId,limit),actor),
      note: (actor,gameId,contextId) => this.participationRead(access => deps.api.postgameNote(access,gameId,contextId),actor),
      reviews: (actor,direction,cursor) => this.participationRead(access => deps.api.postgameReviews(access,direction,cursor),actor),
      publicEligibility: (actor, roleHandle) => this.participationRead(access => deps.api.publicRoleEligibility(access, roleHandle), actor),
      publicConsentPreview: (actor, body) => this.participationRead(access => deps.api.publicRoleConsentPreview(access, body), actor),
      publicOwnReviews: actor => this.participationRead(access => deps.api.publicRoleOwn(access), actor),
      publicRoleByHandle: (actor, roleHandle, query, expected) => this.participationRead(
        access => deps.api.publicRoleByHandle(access, roleHandle, query, expected),
        actor,
      ),
      // Credential-omit public origin reads — resumed cold goals only; never bearer opt-in.
      publicGameRoleOrigin: (gameId, role) => publicApi.gameRoleReputation(gameId, role),
      publicPlayerRoleOrigin: (publicPlayerId, role, query) => publicApi.playerRoleReputation(publicPlayerId, role, query),
      venueExperienceEligibility: (actor, venueId) => this.participationRead(
        access => deps.api.venueExperienceEligibility(access, venueId),
        actor,
      ),
      venueExperienceOwnList: actor => this.participationRead(
        access => deps.api.venueExperienceOwnList(access),
        actor,
      ),
      venueExperienceOwnDetail: (actor, id) => this.participationRead(
        access => deps.api.venueExperienceOwnDetail(access, id),
        actor,
      ),
      venueExperienceConsentPreview: (actor, body) => this.participationRead(
        access => deps.api.venueExperienceConsentPreview(access, body),
        actor,
      ),
      send: (packet, authority) => {
        // Local permit before token await; recheck age + fresh venue authority after refresh/retire.
        const permit = this.postgame.dispatchPermit(packet);
        return this.participationRead(access => {
          if (!this.postgame.mayDispatchRetention(packet, permit)) {
            throw new PostgameError(
              'network',
              503,
              this.postgame.retentionExpiredFor(packet)
                ? 'POSTGAME_RETENTION_EXPIRED'
                : 'POSTGAME_DISPATCH_STALE',
            );
          }
          return deps.api.postgameMutation(access, packet);
        }, authority);
      },
    },deps.random);
    this.contact = new ContactCoordinator({
      preview: context => this.participationRead(access => { if (!context.valid()) throw new MessagesError('private'); return deps.api.radarRead(access, { kind: 'preview', resultRef: context.resultRef, target: context.target }, deps.random()); }, context.actor),
      state: (target, actor) => this.participationRead(access => deps.api.contactState(access, target), actor),
      player: (target, actor) => this.participationRead(access => deps.api.player(access, target), actor),
      conversation: (id, actor) => this.participationRead(access => deps.api.conversation(access, id), actor),
      send: (packet, actor) => {
        const permit = this.contact.safetyPermit();
        return this.participationRead(access => {
          if (!this.contact.mayDispatchSafety(packet.body.targetPublicPlayerId, permit)) throw new MessagesError('network');
          return deps.api.createContact(access, packet);
        }, actor);
      },
    }, deps.random);
    this.avatar = new ProfileAvatarCoordinator({
      mutate: (packet, authority) => this.participationRead(access => deps.api.mutateOwnAvatar(access, packet), authority),
      reconcile: authority => this.participationRead(access => deps.api.ownProfile(access), authority),
    }, deps.random, {
      isTextBusy: () => !!this.profile.getSnapshot().command || this.cover.blocksEdits() || this.trainer.blocksMutations(),
      currentProfile: () => this.profile.getSnapshot().profile,
      applyReceipt: receipt => this.profile.applyAvatarReceipt(receipt),
      rebaseProfile: fresh => this.profile.rebaseFromAuthoritative(fresh),
    });
    this.cover = new ProfileCoverCoordinator({
      mutate: (packet, authority) => this.participationRead(access => deps.api.mutateOwnCover(access, packet), authority),
      reconcile: authority => this.participationRead(access => deps.api.ownCover(access), authority),
    }, deps.random, {
      isTextBusy: () => !!this.profile.getSnapshot().command || this.avatar.blocksEdits() || this.trainer.blocksMutations(),
      currentProfile: () => this.profile.getSnapshot().profile,
      applyReceipt: receipt => this.profile.applyCoverReceipt(receipt),
      accessToken: () => this.access?.token ?? null,
    });
    this.profile = new ProfileCoordinator({
      read: () => this.participationRead(access => deps.api.ownProfile(access)),
      cities: () => publicApi.cities(),
      send: (packet, authority) => this.participationRead(access => deps.api.saveOwnProfile(access, packet), authority),
      looking: (packet, authority) => this.participationRead(access => deps.api.mutateOwnLooking(access, packet), authority),
      visibility: (packet, authority) => this.participationRead(access => deps.api.mutateOwnVisibility(access, packet), authority),
    }, deps.random, () => this.avatar.blocksEdits() || this.cover.blocksEdits() || this.trainer.blocksMutations());
    this.trainer = new TrainerProfileCoordinator({
      read: () => this.participationRead(access => deps.api.ownTrainerProfile(access)),
      send: (packet, authority) => this.participationRead(access => deps.api.mutateOwnTrainer(access, packet), authority),
      refreshSocial: authority => this.participationRead(access => deps.api.ownProfile(access), authority),
    }, deps.random, {
      isPeerBusy: () => !!this.profile.getSnapshot().command || this.avatar.blocksEdits() || this.cover.blocksEdits(),
      accountDisplayName: () => this.snapshot.me?.displayName
        ?? this.profile.getSnapshot().profile?.displayName
        ?? '',
      applySocial: fresh => { this.profile.rebaseFromAuthoritative(fresh); },
      invalidateGameTrainer: () => { void this.gameManagement.refreshOwnTrainerContext(); },
    });
    // Own game-contact preference: GET already admitted; PATCH uses closed mutateGamePreferences port only.
    // Never pushes into an in-flight creation form — next ordinary loadContext GET remains authoritative.
    this.gameContactPreference = new GameContactPreferenceCoordinator({
      read: () => this.participationRead(access => deps.api.gamePreferences(access)),
      send: (packet, authority) => this.participationRead(access => deps.api.mutateGamePreferences(access, packet), authority),
    }, deps.random);
    // Organizer-declared court arrangement: GET/PUT principal opt-in; eligibility before private GET.
    this.gameCourtBooking = new GameCourtBookingCoordinator({
      detailParts: gameId => {
        const detail = this.participation.getSnapshot().details[gameId];
        // null = not ready yet (no speculative GET); error falls through to managed lookup.
        if (!detail || detail.status === 'loading') return null;
        if (detail.status === 'error') return [];
        return detail.parts;
      },
      managed: cursor => this.participationRead(access => deps.api.managedGames(access, cursor)),
      read: gameId => this.participationRead(access => deps.api.gameCourtBooking(access, gameId)),
      send: (packet, authority, permit) => this.participationRead(access => {
        if (!permit()) throw new ParticipationError('stale');
        return deps.api.mutateGameCourtBooking(access, packet);
      }, authority),
    }, deps.random);
    // avatar ↔ cover ↔ trainer busy fences are closed over `this` and resolve after fields exist.
    this.messages = new MessagesCoordinator({
      inbox: (filter,cursor) => this.participationRead(access => deps.api.inbox(access,filter,cursor)),
      counts: () => this.participationRead(access => deps.api.inboxCounts(access)),
      identity: () => this.participationRead(access => deps.api.messageIdentity(access)),
      direct: id => this.participationRead(access => deps.api.conversation(access,id)),
      game: id => this.participationRead(access => deps.api.gameChat(access,id)),
      members: id => this.participationRead(access => deps.api.chatMembers(access,id)),
      invitation: id => this.participationRead(access => deps.api.invitation(access,id)),
      history: (r,before,after) => this.participationRead(access => deps.api.messageHistory(access,r,before,after)),
      // Current managed-game projection for manager revoke eligibility — same /me/games port as chooser.
      managed: cursor => this.participationRead(access => deps.api.managedGames(access, cursor)),
      send: packet => {
        // Capture dispatch attempt + view + foreground lifecycle before token await; revoke rechecks after refresh.
        const permit = this.messages.safetyPermit(packet);
        const viewGeneration = this.messages.getSnapshot().viewGeneration;
        const foregroundGeneration = this.messages.foregroundLifecycle();
        return this.participationRead(access => {
          if (packet.action === 'revoke') {
            if (!this.messages.mayDispatchRevoke(packet, permit, viewGeneration, foregroundGeneration)) throw new MessagesError('stale');
          } else if (!this.messages.mayDispatchSafety(packet, permit)) {
            throw new MessagesError('network');
          }
          return deps.api.messageMutation(access,packet.resource,packet.action,packet.body,packet.key);
        },packet.actor);
      },
    },deps.random);
    // DM peer invitation create: managed list + fresh game GET + POST create; Messages safety fence for held peers.
    // Final actor/session + surface/peer/safety permit runs after token await, immediately before createInvitation.
    this.invitationAuthoring = new InvitationAuthoringCoordinator({
      managed: cursor => this.participationRead(access => deps.api.managedGames(access, cursor)),
      game: id => this.participationRead(access => deps.api.gameDetail(access, id)),
      send: (packet, authority, permit) => this.participationRead(access => {
        if (!permit()) throw new ParticipationError('stale');
        return deps.api.createInvitation(access, packet);
      }, authority),
      isPeerHeld: peerId => this.messages.isPeerSafetyHeld(peerId),
    }, deps.random, this.now);
    this.safety = new SafetyCoordinator({
      send: (packet, authority) => this.participationRead(access => deps.api.safetyMutation(access, packet), authority),
      verified: (peer, blocked, context) => {
        this.contact.setPeerSafety(peer, blocked);
        this.messages.setPeerSafety(peer, blocked, context.conversationId);
        this.players.rereadSafety(peer);
      },
      reread: (context, authority) => {
        if (!this.matchesActor(authority)) return;
        // Replay receipts are history only. Existing reads establish current
        // authorized views without inventing either a block or an unblock.
        if (this.contact.getSnapshot().target === context.peerId) void this.contact.openComposer(context.peerId);
        if (!this.matchesActor(authority)) return;
        this.messages.rereadPeerSafety(context.peerId, context.conversationId);
        if (this.matchesActor(authority)) this.players.rereadSafety(context.peerId);
      },
    }, deps.random);
    this.gameManagement = new GameManagementCoordinator({
      profile: () => this.participationRead(access => deps.api.creatorProfile(access)),
      preferences: () => this.participationRead(access => deps.api.gamePreferences(access)),
      trainer: () => this.participationRead(access => deps.api.ownTrainer(access)),
      venues: (cityId,cursor) => publicApi.venues(cityId,cursor),
      managed: cursor => this.participationRead(access => deps.api.managedGames(access,cursor)),
      game: id => this.participationRead(access => deps.api.gameDetail(access,id)),
      participants: (id,cursor) => this.participationRead(access => deps.api.gameParticipants(access,id,cursor)),
      send: async packet => {
        const result = await this.participationRead(access => deps.api.managementMutation(access,packet),packet.actor);
        if (packet.kind !== 'create') {
          // Reconcile existing My Games rows after a known receipt, preserving its independent packets.
          void this.participation.loadManaged();
          void this.participation.loadGame(packet.gameId);
        }
        return result;
      },
    },deps.random,this.now);
    this.participation = new ParticipationCoordinator({
      own: cursor => this.participationRead(access => deps.api.ownParticipations(access, cursor)),
      managed: cursor => this.participationRead(access => deps.api.managedGames(access, cursor)),
      send: packet => this.participationRead(access => packet.kind === 'request'
        ? deps.api.requestParticipation(access, packet.gameId, packet.body, packet.key)
        : deps.api.withdrawParticipation(access, packet.participationId, packet.body, packet.key), packet.actor),
    }, deps.random, undefined, id => this.participationRead(access => deps.api.gameDetail(access, id)));
    // One hub reload after an acknowledged invitation receipt; never auto-accept or settle on list read.
    // loadInvitations invalidates/queues a fresh root GET across any in-flight initial or load-more.
    this.messages.invitationSettled = () => {
      void this.postgame.loadInvitations();
      void this.participation.loadOwn();
    };
  }
  /** Thin closed Radar ports. Existing token/session fences still own authentication. */
  radarRead = (operation: RadarRead, actor: Actor) => this.participationRead(access => this.deps.api.radarRead(access, operation, this.deps.random()), actor);
  radarCommand = (packet: RadarCommand, permit: () => boolean) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.radarCommand(access, packet);
  }, packet.actor);
  /** Closed play-interest ports share the existing private token and actor fences. */
  playInterestStates = (ids: readonly string[], actor: Actor) => {
    const capturedIds = Object.freeze([...ids]);
    const capturedActor = Object.freeze({...actor});
    return this.participationRead(access => this.deps.api.playInterestStates(access, capturedIds), capturedActor);
  };
  playInterestMutation = (packet: PlayInterestPacket, permit: () => boolean) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.playInterestMutation(access, packet);
  }, packet.actor);
  /** Closed venue-only ports use the same actor/session/generation gate as participation. */
  communityOwn = (venueId: string, actor: Actor) => this.participationRead(access => this.deps.api.communityOwn(access, venueId), actor);
  communityComments = (query: CommunityQuery, actor: Actor) => this.participationRead(access => this.deps.api.communityComments(access, query), actor);
  communityMutation = (packet: CommunityPacket, permit: () => boolean) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.communityMutation(access, packet);
  }, packet.actor);
  /** Bearer stays inside the coordinator — same closed wrapper as avatar binary ports. */
  uploadCommentPhoto = (
    input: Readonly<{ venueId: string; key: string; mime: string; bytes: Uint8Array }>,
    actor: Actor,
    permit: () => boolean,
  ) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.uploadCommentPhoto(access, input);
  }, actor);
  commentPhotoStatus = (
    input: Readonly<{ id: string; venueId: string }>,
    actor: Actor,
    permit: () => boolean,
  ) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.commentPhotoStatus(access, input);
  }, actor);
  withdrawCommentPhoto = (
    input: Readonly<{ id: string; key: string; venueId: string }>,
    actor: Actor,
    permit: () => boolean,
  ) => this.participationRead(access => {
    if (!permit()) throw new ParticipationError('stale');
    return this.deps.api.withdrawCommentPhoto(access, input);
  }, actor);
  /** Closed authenticated operations only; never returns access credentials to UI. No mutation retry. */
  private async participationRead<T>(operation: (access: string) => Promise<T>, actor = this.participation.getSnapshot().actor): Promise<T> {
    const epoch = this.epoch;
    if (!actor || !this.matchesActor(actor)) throw new ParticipationError('stale');
    try {
      const token = await this.token(epoch); this.check(epoch);
      if (!this.matchesActor(actor)) throw new ParticipationError('stale');
      const result = await operation(token); this.check(epoch);
      if (!this.matchesActor(actor)) throw new ParticipationError('stale');
      return result;
    } catch (error) {
      if (epoch !== this.epoch) throw new ParticipationError('stale');
      if ((error instanceof SafetyError && error.kind === 'authority') || (error instanceof ProfileError && error.kind === 'authority') || (error instanceof MessagesError && error.status === 401) || (error instanceof ParticipationError && error.kind === 'authority') ||
          (error instanceof NativeAuthError && ['authority', 'expired'].includes(error.kind))) await this.fail(epoch, new NativeAuthError('authority'));
      throw error;
    }
  }
  private matchesActor(actor: Actor) {
    return actor.generation === this.epoch && sameActor(actor, this.participation.getSnapshot().actor);
  }
  getSnapshot = (): AuthSnapshot => this.snapshot;
  refreshDelay = () => Math.max(1, (this.access?.expiresAt ?? this.now()) - this.now() + 1);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private show(patch: Partial<AuthSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (this.snapshot.status === 'authenticated' && this.snapshot.me) {
      this.participation.setActor({ actorId: this.snapshot.me.id, sessionId: this.snapshot.me.session.id, generation: this.epoch });
    } else if (this.snapshot.status !== 'hydrating') {
      // A transient unverifiable identity must also fence callbacks if this session is later validated again.
      if (this.participation.getSnapshot().actor?.generation === this.epoch) this.epoch++;
      this.participation.setActor(null);
    }
    const actor = this.participation.getSnapshot().actor;
    if (this.snapshot.status !== 'hydrating') {
      this.messages.setActor(actor); this.gameManagement.setActor(actor); this.profile.setActor(actor);
      this.avatar.setActor(actor); this.cover.setActor(actor); this.trainer.setActor(actor);
      this.gameContactPreference.setActor(actor); this.gameCourtBooking.setActor(actor);
      this.invitationAuthoring.setActor(actor); this.contact.setActor(actor);
    }
    this.safety.setActor(this.snapshot.status === 'authenticated' ? actor : null);
    this.postgame.setActor(this.snapshot.status === 'authenticated' ? actor : null);
    if (this.snapshot.status === 'authenticated' && actor) {
      this.players.setScope(`native:${actor.actorId}:${actor.sessionId}:${actor.generation}`, {
        list: (filters, cursor) => this.participationRead(access => this.deps.api.players(access, filters, cursor), actor),
        detail: id => this.participationRead(access => this.deps.api.player(access, id), actor),
      });
    } else if (this.snapshot.status === 'guest' && (this.snapshot.notice === null || this.snapshot.notice === 'cancelled')) {
      const publicRead = async <T>(work: Promise<T>): Promise<T> => {
        try { return await work; } catch (error) {
          if (error instanceof PublicApiError) throw new PlayersError(error.kind, error.status);
          throw error;
        }
      };
      this.players.setScope('guest', { list: (filters, cursor) => publicRead(publicApi.players(filters, cursor)), detail: id => publicRead(publicApi.player(id)) });
    } else this.players.setScope(null, null);
    this.listeners.forEach(listener => listener());
  }
  private check(epoch: number) { if (epoch !== this.epoch) throw new NativeAuthError('stale'); }
  private empty(returnPath = this.snapshot.returnPath): SecureEnvelope {
    return { version: 1, generation: this.deps.random(), returnPath };
  }
  /** Serialize secure writes; a logout clear is queued after any already dispatched old write. */
  private persist(value: SecureEnvelope, epoch: number): Promise<void> {
    const work = this.writes.catch(() => {}).then(async () => {
      this.check(epoch);
      if (!this.writable) throw new NativeAuthError('storage');
      try { await this.deps.store.setItem(SECURE_AUTH_KEY, JSON.stringify(value)); }
      catch { throw new NativeAuthError('storage'); }
      this.check(epoch);
    });
    this.writes = work; return work;
  }
  hydrate = (): Promise<void> => {
    if (this.boot) return this.boot;
    const epoch = this.epoch;
    this.boot = (async () => {
      try {
        const raw = await this.deps.store.getItem(SECURE_AUTH_KEY); this.check(epoch);
        this.envelope = parseSecureEnvelope(raw, this.now()) ?? this.empty(null);
        this.show({ returnPath: this.envelope.returnPath });
        // Cold parse drops expired pending/unclaimed from memory only — persist that retirement
        // through the existing writer so warm/cold agree. Future/corrupt envelopes stay untouched.
        if (raw !== null) await this.persistExpiredAuthDrops(raw, epoch);
        if (this.envelope.session) await this.refresh();
        else this.show({ status: this.envelope.pending ? 'signing-in' : 'guest', notice: null });
      } catch (error) {
        if (epoch !== this.epoch) return;
        // Unknown/corrupt future storage is preserved byte-for-byte; do not silently migrate it.
        this.writable = false; this.access = null; this.envelope = null;
        this.show({ status: 'unverifiable', me: null, sessions: [], notice: error instanceof NativeAuthError && error.kind !== 'storage' ? 'signin' : 'storage' });
      }
    })();
    return this.boot;
  };
  /** When parse dropped an expired pending/goal, rewrite the cleaned envelope (same returnPath). */
  private async persistExpiredAuthDrops(raw: string, epoch: number): Promise<void> {
    if (!this.envelope || !this.writable) return;
    let mustPersist = false;
    try {
      const row = JSON.parse(raw) as Record<string, unknown>;
      if (row.version !== 1) return;
      const clock = this.now();
      const pending = row.pending && typeof row.pending === 'object' ? row.pending as Record<string, unknown> : null;
      const unclaimed = row.unclaimedPublicRoleGoal && typeof row.unclaimedPublicRoleGoal === 'object'
        ? row.unclaimedPublicRoleGoal as Record<string, unknown> : null;
      const droppedPending = !!(pending && typeof pending.expiresAt === 'number' && pending.expiresAt <= clock
        && !this.envelope.pending);
      const droppedUnclaimed = !!(unclaimed && typeof unclaimed.expiresAt === 'number' && unclaimed.expiresAt <= clock
        && !this.envelope.unclaimedPublicRoleGoal);
      if (!droppedPending && !droppedUnclaimed) return;
      mustPersist = true;
    } catch {
      // Inspect failure: leave original bytes; future/corrupt envelopes stay byte-preserved.
      return;
    }
    // Cleanup write failure must fail-closed (not guest+notice=null with expired goal still durable).
    if (!mustPersist) return;
    await this.persist(this.envelope, epoch); this.check(epoch);
  }
  /** Warm expiry: retire matching pending+goal durably; keep safe guest returnPath. */
  private async retireExpiredPendingLogin(epoch: number): Promise<void> {
    if (epoch !== this.epoch) return;
    const pending = this.envelope?.pending;
    if (!pending || pending.expiresAt > this.now()) return;
    const next = ++this.epoch;
    this.clearWarmPublicGoals();
    this.exchange = null;
    const envelope = this.empty(this.envelope!.returnPath);
    this.envelope = envelope;
    this.show({ status: 'guest', me: null, sessions: [], returnPath: envelope.returnPath, notice: 'signin' });
    try { await this.persist(envelope, next); }
    catch { if (next === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); } }
  }
  private clearWarmPublicGoals() {
    this.postgame.clearPendingPublicGoals();
  }
  private async fail(epoch: number, error: unknown) {
    if (epoch !== this.epoch) return;
    this.epoch++; const next = this.epoch;
    this.access = null; this.rotation = null; this.exchange = null; this.validation = null;
    this.clearWarmPublicGoals();
    this.envelope = this.empty();
    const kind = error instanceof NativeAuthError ? error.kind : 'network';
    this.show({ status: kind === 'network' ? 'unverifiable' : 'guest', me: null, sessions: [],
      notice: kind === 'storage' ? 'storage' : kind === 'unavailable' ? 'unavailable' : kind === 'network' ? 'network' : 'signin' });
    try { await this.persist(this.envelope, next); }
    catch { if (next === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); } }
  }
  private async accept(
    raw: unknown,
    epoch: number,
    previous?: SecureSession,
    admittedGoal?: PublicRoleLocalGoal | null,
    goalExpiresAt?: number,
  ) {
    this.check(epoch);
    const receivedAt = this.now();
    const credentials = parseCredentials(raw, receivedAt);
    if (previous && credentials.sessionId !== previous.sessionId) throw new NativeAuthError('authority');
    // Access is still private to this work until verified identity and durable rotated refresh commit.
    const me = parseNativeMe(await this.deps.api.me(credentials.accessToken)); this.check(epoch);
    if (me.session.id !== credentials.sessionId || (previous && me.id !== previous.actorId)) throw new NativeAuthError('authority');
    const envelope: SecureEnvelope = { ...this.envelope!, session: {
      refreshToken: credentials.refreshToken, sessionId: credentials.sessionId, actorId: me.id,
      refreshExpiresAt: credentials.refreshExpiresAt, refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt,
    } };
    delete envelope.pending;
    // Refresh keeps a still-matching unclaimed goal; login exchange may admit one bound to this session.
    if (previous) {
      const prior = this.envelope?.unclaimedPublicRoleGoal;
      if (prior && prior.actorId === me.id && prior.sessionId === credentials.sessionId
          && prior.generation === envelope.generation && prior.expiresAt > this.now()) {
        envelope.unclaimedPublicRoleGoal = prior;
      } else {
        delete envelope.unclaimedPublicRoleGoal;
      }
    } else if (admittedGoal && typeof goalExpiresAt === 'number' && goalExpiresAt > this.now()
        && publicRoleGoalPath(admittedGoal) === envelope.returnPath) {
      envelope.unclaimedPublicRoleGoal = {
        ...admittedGoal,
        generation: envelope.generation,
        expiresAt: goalExpiresAt,
        actorId: me.id,
        sessionId: credentials.sessionId,
      };
    } else {
      delete envelope.unclaimedPublicRoleGoal;
    }
    await this.persist(envelope, epoch); this.check(epoch);
    this.envelope = envelope;
    const expiresAt = receivedAt + credentials.expiresIn * 1000 - 30_000;
    if (expiresAt <= this.now()) throw new NativeAuthError('expired');
    this.access = { token: credentials.accessToken, expiresAt };
    this.show({ status: 'authenticated', me, sessions: [], notice: null });
  }
  refresh = (): Promise<void> => {
    if (this.rotation) return this.rotation;
    const epoch = this.epoch, session = this.envelope?.session;
    if (!session) return Promise.resolve();
    const work = (async () => {
      try {
        this.access = null;
        this.show({ status: 'hydrating', me: null, sessions: [] });
        const consumed: SecureEnvelope = { ...this.envelope! }; delete consumed.session;
        this.envelope = consumed;
        await this.persist(consumed, epoch); this.check(epoch);
        if (Date.parse(session.refreshExpiresAt) <= this.now() || Date.parse(session.refreshAbsoluteExpiresAt) <= this.now()) throw new NativeAuthError('expired');
        const raw = await this.deps.api.refresh(session.refreshToken); this.check(epoch);
        await this.accept(raw, epoch, session);
      } catch (error) { await this.fail(epoch, error); }
    })();
    this.rotation = work;
    void work.finally(() => { if (this.rotation === work) this.rotation = null; });
    return work;
  };
  beginLogin = (
    returnPath?: string | null,
    goal?: PublicRoleLocalGoal | null,
  ): Promise<{ url: string; generation: string } | null> => {
    if (this.starting) return this.starting;
    const work = this.startLogin(returnPath, goal); this.starting = work;
    void work.finally(() => { if (this.starting === work) this.starting = null; });
    return work;
  };
  private async startLogin(
    returnPath?: string | null,
    goal?: PublicRoleLocalGoal | null,
  ): Promise<{ url: string; generation: string } | null> {
    await this.hydrate();
    if (!this.writable) return null;
    // Account switch is explicit and fences all old requests before creating the new pending login.
    const before = this.epoch;
    await this.logout(false, false);
    if (this.epoch !== before + 1 || !this.writable) return null;
    const epoch = this.epoch;
    // Generic / replacement login must never adopt a previous warm selection.
    this.clearWarmPublicGoals();
    const pathHint = canonicalReturnPath(returnPath);
    const goalPath = goal ? publicRoleGoalPath(goal) : null;
    const admitted = goal && goalPath ? parsePublicRoleLocalGoal(goal, pathHint ?? goalPath) : null;
    // Goal path wins when admitted; mismatched optional returnPath drops the goal (path-only login).
    const intent = (admitted && (!pathHint || pathHint === publicRoleGoalPath(admitted))
      ? publicRoleGoalPath(admitted) : null) ?? pathHint ?? this.snapshot.returnPath;
    const closedGoal = admitted && publicRoleGoalPath(admitted) === intent ? admitted : null;
    this.envelope = this.empty(intent);
    this.show({ status: 'signing-in', me: null, sessions: [], returnPath: intent, notice: null });
    try {
      const verifier = this.deps.random(), state = this.deps.random();
      const challenge = await this.deps.challenge(verifier); this.check(epoch);
      // Retain intent even if methods or default-off native endpoint is unavailable.
      await this.persist(this.envelope, epoch); this.check(epoch);
      const methods = await this.deps.api.methods(); this.check(epoch);
      if (!methods.some(method => method.available)) throw new NativeAuthError('unavailable');
      const transaction = parseTransaction(await this.deps.api.transaction({ clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
        codeChallenge: challenge, codeChallengeMethod: 'S256', state, ...(intent ? { returnPath: intent } : {}) }), this.now());
      this.check(epoch);
      const pending: PendingLogin = { generation: this.envelope.generation, clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
        verifier, state, transactionId: transaction.transactionId, expiresAt: Date.parse(transaction.expiresAt), returnPath: intent,
        ...(closedGoal ? { goal: closedGoal } : {}) };
      const envelope = { ...this.envelope, pending };
      await this.persist(envelope, epoch); this.check(epoch); this.envelope = envelope;
      return { url: transaction.browserStartUrl, generation: pending.generation };
    } catch (error) { await this.fail(epoch, error); return null; }
  };
  callback = async (raw: string): Promise<string | null> => {
    await this.hydrate();
    const active = this.exchange;
    if (active) {
      try {
        if (parseCallback(raw, active.pending, this.now(), this.envelope!.generation) === active.code) return await active.work;
      } catch { /* Ignore an unrelated delivery without interrupting the legitimate exchange. */ }
      return null;
    }
    const pending = this.envelope?.pending, epoch = this.epoch;
    if (!pending) return null;
    let code: string;
    try { code = parseCallback(raw, pending, this.now(), this.envelope!.generation); }
    catch {
      if (pending.expiresAt <= this.now()) await this.retireExpiredPendingLogin(epoch);
      else this.show({ notice: this.snapshot.notice });
      return null;
    }
    // Synchronous memory consumption fences duplicate WebBrowser + Linking delivery before the first await.
    const admittedGoal = pending.goal ?? null;
    const consumed = { ...this.envelope! }; delete consumed.pending; this.envelope = consumed;
    const work = (async () => {
      try {
        await this.persist(consumed, epoch); this.check(epoch);
        const rawCredentials = await this.deps.api.exchange({ clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT, code, verifier: pending.verifier });
        this.check(epoch); await this.accept(rawCredentials, epoch, undefined, admittedGoal, pending.expiresAt);
        return pending.returnPath ?? '/profile';
      } catch (error) { await this.fail(epoch, error); return null; }
    })();
    this.exchange = { pending, code, work, goal: admittedGoal };
    try { return await work; }
    finally { if (this.exchange?.work === work) this.exchange = null; }
  };
  cancelLogin = async (generation?: string) => {
    await this.hydrate();
    const pending = this.envelope?.pending;
    const exchange = this.exchange;
    // Matching cancel must fence in-flight exchange after pending was consumed; obsolete
    // generation cannot erase a newer pending or a different in-flight exchange.
    if (generation) {
      if (pending) {
        if (generation !== this.envelope!.generation) return;
      } else if (exchange) {
        if (generation !== exchange.pending.generation) return;
      } else return;
    } else if (!pending && !exchange) return;
    const epoch = ++this.epoch;
    this.clearWarmPublicGoals();
    this.exchange = null;
    const envelope = this.empty(); this.envelope = envelope;
    this.show({ status: 'guest', me: null, sessions: [], notice: 'cancelled' });
    try { await this.persist(envelope, epoch); } catch (error) { await this.fail(epoch, error); }
  };
  /**
   * Durable at-most-once claim of an unclaimed public-role goal for the current actor/session.
   * Synchronous reservation before any await; failed clear write never opens a sheet.
   */
  claimPublicRoleGoal = async (): Promise<PublicRoleLocalGoal | null> => {
    await this.hydrate();
    const epoch = this.epoch;
    const envelope = this.envelope;
    const unclaimed = envelope?.unclaimedPublicRoleGoal;
    const session = envelope?.session;
    const me = this.snapshot.me;
    if (!envelope || !unclaimed || !session || this.snapshot.status !== 'authenticated' || !me) return null;
    if (unclaimed.actorId !== session.actorId || unclaimed.sessionId !== session.sessionId
        || unclaimed.actorId !== me.id || unclaimed.sessionId !== me.session.id
        || unclaimed.generation !== envelope.generation) {
      return null;
    }
    // Reserve synchronously — sharing one promise that delivers the same goal is not at-most-once.
    if (this.envelope !== envelope || this.envelope.unclaimedPublicRoleGoal !== unclaimed) return null;
    const reserved: SecureEnvelope = { ...envelope };
    delete reserved.unclaimedPublicRoleGoal;
    this.envelope = reserved;
    const closed = parsePublicRoleLocalGoal({
      mode: unclaimed.mode, role: unclaimed.role, roleHandle: unclaimed.roleHandle, origin: unclaimed.origin,
    }, envelope.returnPath);
    const deadline = unclaimed.expiresAt;
    const persistReserved = async () => {
      await this.persist(reserved, epoch); this.check(epoch);
    };
    if (!closed || deadline <= this.now()) {
      try { await persistReserved(); }
      catch { if (epoch === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); } }
      return null;
    }
    try { await persistReserved(); }
    catch {
      if (epoch === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); }
      return null;
    }
    // Recheck epoch / actor / original deadline after durable clearing before handoff.
    if (epoch !== this.epoch || this.snapshot.status !== 'authenticated' || !this.snapshot.me) return null;
    if (this.snapshot.me.id !== unclaimed.actorId || this.snapshot.me.session.id !== unclaimed.sessionId) return null;
    if (deadline <= this.now()) return null;
    return closed;
  };
  private async token(epoch: number): Promise<string> {
    if (this.rotation) await this.rotation;
    else if (!this.access || this.access.expiresAt <= this.now()) await this.refresh();
    this.check(epoch);
    if (!this.access || this.access.expiresAt <= this.now()) throw new NativeAuthError('authority');
    return this.access.token;
  }
  validate = (): Promise<void> => {
    if (this.validation) return this.validation;
    const epoch = this.epoch;
    const work = (async () => {
      await this.hydrate();
      // Foreground warm expiry: retire expired pending/goal without a background timer.
      if (this.envelope?.pending && this.envelope.pending.expiresAt <= this.now()) {
        await this.retireExpiredPendingLogin(this.epoch);
        return;
      }
      if (!this.envelope?.session) return;
      try {
        const access = await this.token(epoch);
        const me = parseNativeMe(await this.deps.api.me(access)); this.check(epoch);
        if (me.id !== this.envelope?.session?.actorId || me.session.id !== this.envelope?.session?.sessionId) throw new NativeAuthError('authority');
        this.show({ status: 'authenticated', me, notice: null });
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error instanceof NativeAuthError && error.kind === 'network') this.show({ status: 'unverifiable', me: null, sessions: [], notice: 'network' });
        else await this.fail(epoch, error);
      }
    })();
    this.validation = work;
    void work.finally(() => { if (this.validation === work) this.validation = null; });
    return work;
  };
  loadSessions = async () => {
    const epoch = this.epoch;
    try {
      const access = await this.token(epoch), rows = parseSessions(await this.deps.api.sessions(access)); this.check(epoch);
      if (!this.envelope?.session) throw new NativeAuthError('authority');
      this.show({ sessions: rows, notice: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof NativeAuthError && error.kind === 'authority') await this.fail(epoch, error);
      else this.show({ sessions: [], notice: 'network' });
    }
  };
  revokeSession = async (id: string | null) => {
    const epoch = this.epoch;
    const current = id !== null && id === this.envelope?.session?.sessionId;
    try {
      const access = await this.token(epoch), key = this.deps.random(); this.check(epoch);
      // No mutation replay, even on ambiguous response; caller can reread actual owned sessions.
      if (id === null) await this.deps.api.revokeOthers(access, key);
      else await this.deps.api.revoke(access, id, key);
      this.check(epoch);
      if (current) await this.logout(false); else await this.loadSessions();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (current || (error instanceof NativeAuthError && error.kind === 'authority')) await this.fail(epoch, error);
      else this.show({ sessions: [], notice: 'remote-unconfirmed' });
    }
  };
  logout = async (report = true, forgetCreation = true) => {
    const refresh = this.envelope?.session?.refreshToken, access = this.access?.token;
    const epoch = ++this.epoch;
    this.rotation = null; this.exchange = null; this.validation = null; this.access = null;
    if (!forgetCreation) this.clearWarmPublicGoals();
    const envelope = this.empty(); this.envelope = envelope;
    if (forgetCreation) this.gameManagement.forgetCreation();
    if (forgetCreation) this.profile.forget();
    if (forgetCreation) this.avatar.forget();
    if (forgetCreation) this.cover.forget();
    if (forgetCreation) this.trainer.forget();
    if (forgetCreation) this.gameContactPreference.forget();
    if (forgetCreation) this.gameCourtBooking.forget();
    if (forgetCreation) this.invitationAuthoring.forget();
    if (forgetCreation) this.contact.forget();
    if (forgetCreation) this.safety.forget();
    if (forgetCreation) this.postgame.forget();
    this.show({ status: 'guest', me: null, sessions: [], notice: null });
    // Queue the local clear immediately. Remote revocation is bounded by the API timeout and never persisted/retried.
    const clear = this.persist(envelope, epoch).catch(() => {
      if (epoch === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); }
    });
    const revoke = refresh || access ? this.deps.api.logout(refresh, access).catch(() => {
      if (report && epoch === this.epoch) this.show({ notice: 'remote-unconfirmed' });
    }) : Promise.resolve();
    await clear;
    // Account-switch caller can continue after local clear; snapshot credentials remain private to this one bounded revoke.
    void revoke;
  };
}
