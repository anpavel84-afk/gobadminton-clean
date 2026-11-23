import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { GameInvitation } from './messages.ts';
import { MessagesError } from './messages.ts';
import { PostgameError, postgameId, wire, validateReceipt, mayAcknowledge, mayAcknowledgeCurrent, needsAttention, noteText } from './postgame.ts';
import type { Intent, Packet, Results, OwnResults, Reminders, ResultsQuery, OwnResult, AttendanceDispute, AttendanceHistoryPage, PersonalNote } from './postgame.ts';
import {
  mergeReviewPages,
  roleDiscrepancyContextsEqual,
  roleDiscrepancyContextFromResults,
  roleDiscrepancyDecisionFromError,
  type MeReviewsPage, type PeerRating, type PeerTag, type PrivateReview, type ReviewReportReason,
  type RoleDiscrepancyContext,
  type RoleDiscrepancyDecision,
} from './postgame-feedback.ts';
import {
  applyOwnPublicAckToItem,
  buildPublicCreateBody,
  buildPublicReplyBody,
  buildPublicReportBody,
  buildPublicWithdrawBody,
  consentPreviewBody,
  draftEditorKey,
  eligibleBases,
  emptyPublicRoleDraft,
  isPublicRolePacketKind,
  mayPaintOwnPublicReceipt,
  mayPaintPublicReplyReceipt,
  mayPaintPublicReportReceipt,
  mayWithdrawOwnPublic,
  mergeActorAwareReaderItem,
  mergeOwnPublicReviewItem,
  parseConsentPreview,
  parseOwnEligibility,
  parseOwnPublicRoleReviewsPage,
  parsePublicRoleMutationReceipt,
  parsePublicRoleReplyReceipt,
  parsePublicRoleReportReceipt,
  pickPreferredGameId,
  publicReadGenerationKey,
  publicRoleBusinessNotice,
  publicRoleReplyBusinessNotice,
  publicRoleReportBusinessNotice,
  publicRoleReviewText,
  replyConsentPreviewBody,
  retireOwnPublicReviewText,
  samePublicReaderOrigin,
  type OwnEligibility,
  type OwnPublicRoleReview,
  type OwnPublicRoleReviewsPage,
  type PublicRoleAuthorTarget,
  type PublicRoleDraft,
  type PublicRoleMutationReceipt,
  type PublicRoleReaderOrigin,
  type PublicRoleReaderTarget,
  type PublicRoleReplyDraft,
  type PublicRoleReplyReceipt,
  type PublicRoleReportDraft,
  type PublicRoleReportReceipt,
} from './public-role-reviews.ts';
import {
  parseActorAwareRoleReputationSummary,
  parseRoleReputationSummary,
  type ActorAwareRoleReputationSummary,
  type ActorAwarePublicRoleReviewItem,
  type RoleKind,
} from './role-reputation.ts';
import {
  buildVenueExperienceCreateBody,
  emptyVenueExperienceDraft,
  exactGameMaySubmitBasis,
  isVenueExperiencePacketKind,
  parseOwnVenueEligibility,
  parseVenueConsentPreview,
  postgameIdempotencyReplayBlocked,
  venueExperienceText,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
  type OwnVenueEligibility,
  type VenueExperienceDraft,
  type VenueReviewMutationReceipt,
  type VenueReviewTopic,
} from './venue-reviews.ts';
import { isVenueId } from './venues.ts';
type PublicMutationBind = {
  surfaceGen: number;
  actorId: string;
  sessionId: string;
  roleHandle: string;
  role: string;
  gameId: string;
  editor: string;
  kind: 'public-role-create' | 'public-role-command' | 'public-role-reply' | 'public-role-report';
  reviewId?: string;
  reviewHandle?: string;
  /** Captured at reply/report dispatch — replacement origin cannot inherit ACK/notice authority. */
  origin?: PublicRoleReaderOrigin;
};
export type Source<T> = { status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'; data?: T };
export type Filter = 'all' | 'manage' | 'participate' | 'invites';
export type InvitationPage = { items: GameInvitation[]; nextCursor: string | null };
export type DisputeSelection = { gameId: string; contextId: string; disputeId: string };
export type DisputeDraft = {
  createExplanation?: string;
  respondExplanation?: string;
  correctionEnabled?: boolean;
  correctionValue?: 'present' | 'absent' | 'unknown';
  correctionLate?: boolean;
  correctionReason?: string;
  helpExplanation?: string;
  withdrawReason?: string;
};
/** Actor-bound private note form drafts — wiped on logout / different actor. */
export type NoteDraft = {
  selectedContextId?: string;
  createText?: string;
  editText?: string;
  /** Explicit create-form mutation (incl. deliberate empty); distinct from pristine empty prefill. */
  createDirty?: boolean;
};
export type OwnNoteRef = { gameId: string; contextId: string };
/** Actor-bound private feedback drafts — wiped on logout / different actor; fields separated by kind. */
export type FeedbackDraft = {
  mode?: 'peer' | 'organization' | 'training' | 'received' | 'sent';
  subjectContextId?: string;
  peerRating?: PeerRating;
  /** Peer comment only — never shared into organization/training drafts. */
  comment?: string;
  tags?: PeerTag[];
  /** Organization score 1–5; null/undefined means «Без оценки». */
  organizationScore?: number | null;
  organizationComment?: string;
  organizationDiscrepancy?: string;
  trainingComment?: string;
  trainingDiscrepancy?: string;
  /**
   * Server FEEDBACK_DISCREPANCY_* bound to kind + attendance/outcome context.
   * Cleared on mode switch / successful ACK / authoritative context change; drafts stay.
   */
  discrepancyDecision?: RoleDiscrepancyDecision | null;
  replyText?: Record<string, string>;
  reportReviewId?: string;
  reportReason?: ReviewReportReason;
  reportDetail?: string;
  /** Explicit consent for exact frozen review.version — reset when revision changes. */
  reportConsent?: boolean;
  reportConsentVersion?: number;
};
export type ReviewDirection = 'sent' | 'received';
type Command = {
  packet: Packet;
  status: 'sending' | 'unknown';
  /** Attendance/outcome fingerprint at owned-packet send — never on the API wire. */
  roleDiscrepancyContext?: RoleDiscrepancyContext;
  /** Original first-dispatch clock for journal 24h idempotency fence — never on the API wire. */
  firstDispatchedAt?: number;
};
type OwnAck = { gameId: string; contextId: string; version: number };
function applyOwnAck(row: OwnResult, ack: OwnAck): OwnResult {
  if (row.gameId !== ack.gameId || row.contextId !== ack.contextId || row.attendance.version !== ack.version) return row;
  // The validated receipt proves ACK, but carries neither a notice timestamp nor
  // current hub rights. Retain those rights and remove only its pending notice.
  return {...row,attendance:{...row.attendance,acknowledgedVersion:ack.version},
    notice:row.notice?.attendanceVersion === ack.version && !row.notice.acknowledgedAt ? null : row.notice};
}
function noteKey(gameId: string, contextId: string) { return `${gameId}:${contextId}`; }
type Snapshot = {
  actor: Actor | null; filter: Filter; own: Source<OwnResults>; reminders: Source<Reminders>; invitations: Source<InvitationPage>;
  games: Record<string,Source<Results>>; disputes: Record<string,Source<AttendanceDispute>>; histories: Record<string,Source<AttendanceHistoryPage>>;
  /** Direct own-note GET projections — independent of denied results/roster. */
  notes: Record<string,Source<PersonalNote>>;
  /** Exact actor-bound owned contexts remembered this session (no cold discovery). */
  knownNoteRefs: Record<string,OwnNoteRef>;
  /** Own directional private review history — independent of denied results/roster. */
  reviewHistory: Record<ReviewDirection, Source<MeReviewsPage>>;
  /** Latest typed review by id from history/results/receipts — monotonic merge authority. */
  reviewsById: Record<string, PrivateReview>;
  selection: DisputeSelection | null; drafts: Record<string,DisputeDraft>; noteDrafts: Record<string,NoteDraft>;
  feedbackDrafts: Record<string, FeedbackDraft>;
  review: Intent | null; command: Command | null; notice: string | null;
  /** Public role-review author/reader surface — separate from private CommandReview. */
  publicSurface: null | {
    mode: 'composer' | 'history' | 'reader';
    target: PublicRoleAuthorTarget | null;
    reader: PublicRoleReaderTarget | null;
    gen: number;
    /**
     * Resumed cold-auth author only: keep the original game across eligibility reloads.
     * Never silent-fallback to another basis when the frozen game disappears.
     */
    resumeFrozenGameId?: string;
  };
  publicEligibility: Source<OwnEligibility>;
  publicOwn: Source<OwnPublicRoleReviewsPage>;
  publicReader: Source<ActorAwareRoleReputationSummary>;
  /** Append-only next-page in flight — root page stays ready with prior rows. */
  publicReaderLoadingMore: boolean;
  /** Transient next-page failure — prior rows stay; retry uses the same nextCursor. */
  publicReaderMoreError: boolean;
  publicDraft: PublicRoleDraft | null;
  publicReplyDrafts: Record<string, PublicRoleReplyDraft>;
  publicReportDraft: PublicRoleReportDraft | null;
  publicConsentHash: string | null;
  publicReceipt: PublicRoleMutationReceipt | null;
  /**
   * Painted reply ACK bound to owning reviewHandle + original packet expectedReviewRevision —
   * never freezes other rows or a newer published review revision.
   */
  publicReplyReceipt: (PublicRoleReplyReceipt & {
    reviewHandle: string;
    expectedReviewRevision: number;
  }) | null;
  /**
   * Painted report ACK bound to owning reviewHandle + original packet expectedRevision —
   * never freezes other rows or a newer published review revision (server dedupes per revision).
   */
  publicReportReceipt: (PublicRoleReportReceipt & {
    reviewHandle: string;
    expectedRevision: number;
  }) | null;
  publicNotice: string | null;
  /** Guest auth return: bounded role/game only; never consent/text. */
  pendingPublicAuthor: PublicRoleAuthorTarget | null;
  /** Guest auth return: bounded reader role/origin only; never consent/text/autowrite. */
  pendingPublicReader: PublicRoleReaderTarget | null;
  /** Exact-game venue eligibility probe target (composer may be closed). */
  venueProbe: null | { gameId: string; venueId: string };
  /** Exact-game venue experience composer — no venue picker / broad CTA. */
  venueExperience: null | { gameId: string; venueId: string; gen: number };
  venueEligibility: Source<OwnVenueEligibility>;
  venueDraft: VenueExperienceDraft | null;
  venueConsentHash: string | null;
  venueReceipt: VenueReviewMutationReceipt | null;
  venueNotice: string | null;
};
type Port = {
  own: (actor: Actor, cursor?: string) => Promise<OwnResults>;
  reminders: (actor: Actor) => Promise<Reminders>;
  invitations: (actor: Actor, cursor?: string) => Promise<InvitationPage>;
  results: (actor: Actor, game: string, query?: ResultsQuery) => Promise<Results>;
  /** Closed dispute detail/history ports; absent neighbors keep prior PG-1 surfaces compiling. */
  dispute?: (actor: Actor, disputeId: string) => Promise<AttendanceDispute>;
  history?: (actor: Actor, gameId: string, contextId: string, limit?: number) => Promise<AttendanceHistoryPage>;
  /** Direct own personal note GET — exists independently of results access. */
  note?: (actor: Actor, gameId: string, contextId: string) => Promise<PersonalNote>;
  /** Own directional private reviews — exists independently of results access. */
  reviews?: (actor: Actor, direction: ReviewDirection, cursor?: string) => Promise<MeReviewsPage>;
  /** Raw JSON — always re-parsed by coordinator (mocks may return wire bodies). */
  publicEligibility?: (actor: Actor, roleHandle: string) => Promise<unknown>;
  publicConsentPreview?: (
    actor: Actor,
    body: ReturnType<typeof consentPreviewBody> | ReturnType<typeof replyConsentPreviewBody>,
  ) => Promise<unknown>;
  publicOwnReviews?: (actor: Actor) => Promise<unknown>;
  publicRoleByHandle?: (
    actor: Actor,
    roleHandle: string,
    query: { gameId?: string; cursor?: string; limit?: number },
    expected?: { roleHandle?: string; role?: ActorAwareRoleReputationSummary['role'] },
  ) => Promise<unknown>;
  /**
   * Optional credential-omit public game→role projection (gameSurfaceOpen).
   * Missing port fail-closes resumed author/game-reader only; normal signed-in opens stay intact.
   */
  publicGameRoleOrigin?: (gameId: string, role: RoleKind) => Promise<unknown>;
  /**
   * Optional credential-omit public player→role projection.
   * Missing port fail-closes resumed profile-reader only.
   */
  publicPlayerRoleOrigin?: (
    publicPlayerId: string,
    role: RoleKind,
    query?: { cursor?: string; limit?: number },
  ) => Promise<unknown>;
  venueExperienceEligibility?: (actor: Actor, venueId: string) => Promise<unknown>;
  venueExperienceConsentPreview?: (
    actor: Actor,
    body: { venueId: string; text: string; topics: VenueReviewTopic[] },
  ) => Promise<unknown>;
  send: (packet: Packet, authority: Actor) => Promise<unknown>;
};
const empty = (actor: Actor | null): Snapshot => ({
  actor, filter: 'all', own: {status:'idle'}, reminders: {status:'idle'}, invitations: {status:'idle'},
  games: {}, disputes: {}, histories: {}, notes: {}, knownNoteRefs: {},
  reviewHistory: { received: { status: 'idle' }, sent: { status: 'idle' } },
  reviewsById: {},
  selection: null, drafts: {}, noteDrafts: {}, feedbackDrafts: {},
  review:null, command:null, notice:null,
  publicSurface: null, publicEligibility: { status: 'idle' }, publicOwn: { status: 'idle' },
  publicReader: { status: 'idle' },
  publicReaderLoadingMore: false, publicReaderMoreError: false,
  publicDraft: null, publicReplyDrafts: {}, publicReportDraft: null,
  publicConsentHash: null, publicReceipt: null, publicReplyReceipt: null, publicReportReceipt: null,
  publicNotice: null,
  pendingPublicAuthor: null,
  pendingPublicReader: null,
  venueProbe: null,
  venueExperience: null,
  venueEligibility: { status: 'idle' },
  venueDraft: null,
  venueConsentHash: null,
  venueReceipt: null,
  venueNotice: null,
});
const unknownNotice = 'Результат действия пока неизвестен. Проверьте исходное действие перед новым изменением.';
function draftKey(gameId: string, contextId: string, disputeId?: string | null) {
  return `${gameId}:${contextId}:${disputeId ?? 'create'}`;
}
function freezeIntent(intent: Intent): Intent {
  // Clone before freezing: caller editing a form cannot change the pending wire body.
  let copy: Intent;
  switch (intent.kind) {
    case 'bulk': copy={...intent,body:{...intent.body,items:intent.body.items.map(item=>({...item}))}}; break;
    case 'outcome': copy={...intent,body:{...intent.body}}; break;
    case 'attendance': copy={...intent,body:{...intent.body}}; break;
    case 'ack': copy={...intent,body:{...intent.body}}; break;
    case 'dispute': copy={...intent,body:{...intent.body}}; break;
    case 'withdraw': copy={...intent,body:{...intent.body}}; break;
    case 'respond': copy={...intent,body:{...intent.body,...(intent.body.correction ? {correction:{...intent.body.correction}} : {})}}; break;
    case 'help': copy={...intent,body:{...intent.body}}; break;
    case 'later': copy={...intent,body:{...intent.body}}; break;
    case 'note-upsert': copy={...intent,body:{...intent.body}}; break;
    case 'note-delete': copy={...intent,body:{...intent.body}}; break;
    case 'peer-create': copy={...intent,body:{...intent.body,...(intent.body.tags ? {tags:[...intent.body.tags]} : {})}}; break;
    case 'organization-create': copy={...intent,body:{...intent.body}}; break;
    case 'training-create': copy={...intent,body:{...intent.body}}; break;
    case 'peer-reply': copy={...intent,body:{...intent.body}}; break;
    case 'peer-report': copy={...intent,body:{...intent.body}}; break;
    case 'public-role-create': copy={...intent,body:{...intent.body,expectedBasisVersions:{...intent.body.expectedBasisVersions},topics:[...intent.body.topics]}}; break;
    case 'public-role-command': {
      if (intent.body.action === 'withdraw') copy={...intent,body:{...intent.body}};
      else if (intent.body.action === 'appeal') copy={...intent,body:{...intent.body}};
      else copy={...intent,body:{...intent.body,expectedBasisVersions:{...intent.body.expectedBasisVersions},topics:[...intent.body.topics]}};
      break;
    }
    case 'public-role-reply': copy={...intent,body:{...intent.body}}; break;
    case 'public-role-report': copy={...intent,body:{...intent.body}}; break;
    case 'venue-experience-create': copy={...intent,body:{...intent.body,expectedBasisVersions:{...intent.body.expectedBasisVersions},topics:[...intent.body.topics]}}; break;
  }
  if (copy.kind === 'bulk') { copy.body.items.forEach(Object.freeze); Object.freeze(copy.body.items); }
  if (copy.kind === 'respond' && copy.body.correction) Object.freeze(copy.body.correction);
  if (copy.kind === 'peer-create' && copy.body.tags) Object.freeze(copy.body.tags);
  if (copy.kind === 'public-role-create') {
    Object.freeze(copy.body.expectedBasisVersions); Object.freeze(copy.body.topics);
  }
  if (copy.kind === 'public-role-command' && (copy.body.action === 'submit_revision' || copy.body.action === 'resubmit')) {
    Object.freeze(copy.body.expectedBasisVersions); Object.freeze(copy.body.topics);
  }
  if (copy.kind === 'venue-experience-create') {
    Object.freeze(copy.body.expectedBasisVersions); Object.freeze(copy.body.topics);
  }
  Object.freeze(copy.body); return Object.freeze(copy);
}
export class PostgameCoordinator {
  private snapshot = empty(null);
  private listeners = new Set<() => void>();
  private quarantine: {
    actorId: string;
    snapshot: Snapshot;
    /** Original dispatch ownership — never rebuilt from a replacement surface after reopen.
     * Legitimately null when there was no original dispatch, or after close/invalidation. */
    publicMutationBind: PublicMutationBind | null;
  } | null = null;
  private serial = 0;
  private reads = new Map<string,number>();
  private seenOwn = new Set<string>();
  private seenInvites = new Set<string>();
  // Evidence belongs only to the currently pending own GET. Later GETs establish
  // current truth themselves; a historical receipt must not override them.
  private ownReadAcks: OwnAck[] = [];
  private resultCursors = new Map<string,Set<string>>();
  private inFlight: Packet | null = null;
  /** Coalesce one fresh root invitations GET after ACK while an initial/load-more is in flight. */
  private invitationsBusy = false;
  private invitationsFollowup = false;
  /** Generation that owns busy/followup; stale finally must not clear a newer actor/read. */
  private invitationsBusyGen = 0;
  /** Confirmed delete / definitive known-note 404 watermarks — block late GET/results resurrection. */
  private noteTombs = new Map<string, number>();
  /** Last applied read generation per note key — fences late results vs newer direct GET. */
  private noteAppliedGen = new Map<string, number>();
  /** Monotonic version floor per note key — survives loading/error so transient Source cannot forget newer. */
  private noteVersionFloor = new Map<string, number>();
  /** After confirmed upsert: only typed direct GET may reestablish ready rights (not historical myNotes). */
  private noteAwaitingTyped = new Set<string>();
  /** Seen nextCursor values per review direction — reject ABA/replay cursors. */
  private reviewCursors = new Map<ReviewDirection, Set<string>>();
  /** Version floor per review id — stale receipts cannot regress. */
  private reviewVersionFloor = new Map<string, number>();
  /** Reply version floor per review id. */
  private replyVersionFloor = new Map<string, number>();
  /** Last applied read generation per review id — fences deferred results vs history. */
  private reviewAppliedGen = new Map<string, number>();
  /** After reply/create ACK: only typed history GET may reestablish write rights. */
  private reviewAwaitingTyped = new Set<string>();
  /** Ids whose current floor was established by typed history — results cannot same-version regress. */
  private reviewHistoryOwned = new Set<string>();
  /** Hard-denied own-history directions — results/receipts must not resurrect private projection. */
  private reviewDirectionDenied = new Set<ReviewDirection>();
  /** Per-direction coalesce: one fresh root history GET after mutation while a GET is in flight. */
  private reviewsBusy: Record<ReviewDirection, boolean> = { sent: false, received: false };
  private reviewsFollowup: Record<ReviewDirection, boolean> = { sent: false, received: false };
  /** Generation that owns busy/followup per direction; stale finally must not clear a newer actor/read. */
  private reviewsBusyGen: Record<ReviewDirection, number> = { sent: 0, received: 0 };
  /** Public eligibility/own/preview generation fences — late responses cannot overwrite changed selection/consent. */
  private publicEligibilityGen = 0;
  private publicOwnGen = 0;
  private publicPreviewGen = 0;
  /** Surface open/close/target generation — late create/withdraw receipts cannot paint the wrong sheet. */
  private publicSurfaceGen = 0;
  /** Captured at public mutate dispatch; journal still settles once even when UI gen no longer matches. */
  private publicReaderGen = 0;
  private publicMutationBind: PublicMutationBind | null = null;
  /** Per-review monotonic version floor — stale GET cannot regress after newer ACK/GET. */
  private publicOwnVersionFloor = new Map<string, number>();
  /** After withdraw ACK: only typed own GET may reestablish non-terminal projection. */
  private publicOwnAwaitingTyped = new Set<string>();
  /** Hard-denied own public history — late ACK must not resurrect author private text. */
  private publicOwnDenied = false;
  /** Per-reviewHandle reply aggregate floor — stale ACK cannot paint over newer typed GET. */
  private publicReaderReplyFloor = new Map<string, number>();
  /** Exact-game venue experience eligibility/preview/surface generation fences. */
  private venueEligibilityGen = 0;
  private venuePreviewGen = 0;
  private venueSurfaceGen = 0;
  /**
   * Single global fresh-write preparation reservation (eligibility/preview await).
   * Prevents competing fresh POSTs; finally must not clear a newer reservation.
   * Never a second journal — dispatch still owns UNKNOWN/inFlight.
   */
  private writePrepare: null | {
    gen: number;
    actorId: string;
    sessionId: string;
    origin: 'venue-experience' | 'public-role' | 'private';
    surfaceGen: number;
    editor: string;
  } = null;
  private writePrepareGen = 0;
  private port: Required<Port>;
  private random: () => string;
  constructor(port: Port, random: () => string) {
    // Keep the caller's port object identity so tests can replace lanes in place.
    if (!port.dispute) port.dispute = async () => { throw new PostgameError('private', 404); };
    if (!port.history) port.history = async () => ({ items: [] });
    if (!port.note) port.note = async () => { throw new PostgameError('private', 404); };
    if (!port.reviews) port.reviews = async () => ({ items: [], nextCursor: null });
    if (!port.publicEligibility) port.publicEligibility = async () => { throw new PostgameError('private', 404); };
    if (!port.publicConsentPreview) port.publicConsentPreview = async () => { throw new PostgameError('private', 404); };
    if (!port.publicOwnReviews) port.publicOwnReviews = async () => ({ items: [] });
    if (!port.publicRoleByHandle) port.publicRoleByHandle = async () => { throw new PostgameError('private', 404); };
    if (!port.venueExperienceEligibility) port.venueExperienceEligibility = async () => { throw new PostgameError('private', 404); };
    if (!port.venueExperienceConsentPreview) port.venueExperienceConsentPreview = async () => { throw new PostgameError('private', 404); };
    this.port = port as Required<Port>;
    this.random = random;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => {this.listeners.delete(fn);}; };
  private show(patch: Partial<Snapshot>) { this.snapshot={...this.snapshot,...patch}; this.listeners.forEach(fn=>fn()); }
  setActor(actor: Actor | null) {
    if (sameActor(actor,this.snapshot.actor) || !actor && !this.snapshot.actor) return;
    if (this.snapshot.actor) {
      this.quarantine = {
        actorId: this.snapshot.actor.actorId,
        snapshot: this.snapshot,
        publicMutationBind: this.publicMutationBind,
      };
    }
    const parked = actor && this.quarantine?.actorId === actor.actorId ? this.quarantine : null;
    const saved = parked?.snapshot ?? null;
    const savedBind = parked?.publicMutationBind ?? null;
    if (actor && this.quarantine?.actorId !== actor.actorId) this.inFlight=null;
    this.writePrepare = null;
    if (actor) this.quarantine=null;
    this.reads.clear(); this.seenOwn.clear(); this.seenInvites.clear(); this.ownReadAcks=[]; this.resultCursors.clear(); this.serial++;
    this.invitationsBusy=false; this.invitationsFollowup=false; this.invitationsBusyGen++;
    this.noteTombs.clear(); this.noteAppliedGen.clear(); this.noteVersionFloor.clear(); this.noteAwaitingTyped.clear();
    this.reviewCursors.clear(); this.reviewVersionFloor.clear(); this.replyVersionFloor.clear();
    this.reviewAppliedGen.clear(); this.reviewAwaitingTyped.clear(); this.reviewHistoryOwned.clear();
    this.reviewDirectionDenied.clear();
    this.reviewsBusy={sent:false,received:false}; this.reviewsFollowup={sent:false,received:false};
    this.reviewsBusyGen={sent:this.reviewsBusyGen.sent+1,received:this.reviewsBusyGen.received+1};
    this.publicEligibilityGen++; this.publicOwnGen++; this.publicPreviewGen++; this.publicSurfaceGen++;
    this.publicReaderGen++; this.publicMutationBind=null; this.publicOwnDenied=false;
    this.venueEligibilityGen++; this.venuePreviewGen++; this.venueSurfaceGen++;
    // Same-account reauth: keep actor-scoped version/awaiting fences so a deferred own GET
    // cannot let an older ACK repaint over a floor already established this session.
    // AuthCoordinator.refresh() hydrates via setActor(null) while quarantine retains UNKNOWN —
    // park floors across that transient null; restore only when the matching account returns.
    // Different actor still drops fences; write authority reestablishes via fresh GET only.
    // Explicit forget() clears floors separately. Null alone must not wipe a parked floor.
    if (actor && !saved) {
      this.publicOwnVersionFloor.clear();
      this.publicOwnAwaitingTyped.clear();
      this.publicReaderReplyFloor.clear();
    }
    const pendingPublic = this.snapshot.pendingPublicAuthor;
    const pendingReader = this.snapshot.pendingPublicReader;
    this.snapshot=empty(actor ? Object.freeze({...actor}) : null);
    // Reads must reestablish authority. Only the original packet is restored, never sent on login.
    // Same-account reauth restores explicit review/UNKNOWN and compatible drafts, without autowrite.
    // Known own-note refs restore for in-session recovery only — never auto-write / cold discovery.
    // Feedback drafts restore without auto-send; history must recheck authority via fresh GET.
    // Pending public author/reader targets survive guest→auth for bounded role/origin only (no consent/text).
    if (saved) this.show({
      filter:saved.filter,
      command:saved.command ? {
        packet:saved.command.packet,
        status:'unknown' as const,
        ...(saved.command.roleDiscrepancyContext
          ? { roleDiscrepancyContext: saved.command.roleDiscrepancyContext }
          : {}),
        ...(saved.command.firstDispatchedAt !== undefined
          ? { firstDispatchedAt: saved.command.firstDispatchedAt }
          : {}),
      } : null,
      notice:saved.command ? unknownNotice : null,
      review:saved.review,
      drafts:saved.drafts,
      noteDrafts:saved.noteDrafts,
      feedbackDrafts:saved.feedbackDrafts,
      knownNoteRefs:saved.knownNoteRefs,
      selection:saved.selection,
      // Same-account reauth: restore public surface/draft without consent or autosend.
      // Rebind surface gen to the bumped counter so captured withdraw callbacks cannot cross reauth.
      publicSurface: saved.publicSurface
        ? {
          ...saved.publicSurface,
          gen: this.publicSurfaceGen,
          reader: saved.publicSurface.reader ? { ...saved.publicSurface.reader, origin: { ...saved.publicSurface.reader.origin } } : null,
          target: saved.publicSurface.target ? { ...saved.publicSurface.target } : null,
        }
        : null,
      publicDraft: saved.publicDraft
        ? { ...saved.publicDraft, consent: false }
        : null,
      // Reply drafts restore without consent; never inherit across different account.
      publicReplyDrafts: Object.fromEntries(
        Object.entries(saved.publicReplyDrafts ?? {}).map(([k, d]) => [k, { text: d.text, consent: false }]),
      ),
      publicReportDraft: saved.publicReportDraft
        ? { ...saved.publicReportDraft }
        : null,
      publicConsentHash: null,
      publicReceipt: saved.publicReceipt,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      publicReader: { status: 'idle' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicNotice: saved.command && isPublicRolePacketKind(saved.command.packet.kind)
        ? unknownNotice
        : saved.publicNotice,
      pendingPublicAuthor: pendingPublic ?? saved.pendingPublicAuthor,
      pendingPublicReader: pendingReader ?? (saved.pendingPublicReader
        ? {
          ...saved.pendingPublicReader,
          origin: { ...saved.pendingPublicReader.origin },
        }
        : null),
      // Same-account reauth: restore exact-game venue sheet without consent/autosend.
      venueProbe: saved.venueProbe ? { ...saved.venueProbe } : null,
      venueExperience: saved.venueExperience
        ? { ...saved.venueExperience, gen: ++this.venueSurfaceGen }
        : null,
      venueDraft: saved.venueDraft
        ? { ...saved.venueDraft, topics: [...saved.venueDraft.topics], consent: false }
        : null,
      venueConsentHash: null,
      venueReceipt: saved.venueReceipt,
      venueEligibility: { status: 'idle' },
      venueNotice: saved.command && isVenueExperiencePacketKind(saved.command.packet.kind)
        ? unknownNotice
        : saved.venueNotice,
    });
    else this.show({
      pendingPublicAuthor: pendingPublic,
      pendingPublicReader: pendingReader
        ? { ...pendingReader, origin: { ...pendingReader.origin } }
        : null,
    });
    // Same-actor reauth: restore original dispatch bind only — never invent ACK authority from a replacement surface.
    // Rebind session + surfaceGen only when the originally owned surface was still current at quarantine.
    if (actor && saved?.command && isPublicRolePacketKind(saved.command.packet.kind) && savedBind
      && savedBind.kind === saved.command.packet.kind
      && savedBind.actorId === actor.actorId
      && savedBind.actorId === saved.command.packet.actor.actorId) {
      const packet = saved.command.packet;
      const handleOk = (
        (packet.kind === 'public-role-reply' || packet.kind === 'public-role-report')
          ? savedBind.reviewHandle === packet.reviewHandle
          : packet.kind === 'public-role-command'
            ? savedBind.reviewId === packet.reviewId
            : true
      );
      if (handleOk) {
        const ownedStillCurrent = !!saved.publicSurface
          && savedBind.surfaceGen === saved.publicSurface.gen
          && this.publicMutationSurfaceMatches(saved.publicSurface, savedBind);
        this.publicMutationBind = {
          ...savedBind,
          origin: savedBind.origin
            ? (savedBind.origin.kind === 'game'
              ? { kind: 'game', gameId: savedBind.origin.gameId }
              : { kind: 'profile', publicPlayerId: savedBind.origin.publicPlayerId })
            : undefined,
          sessionId: actor.sessionId,
          surfaceGen: ownedStillCurrent ? this.publicSurfaceGen : savedBind.surfaceGen,
        };
      }
    }
    // Re-read eligibility/own history/reader after same-account reauth — never autosend.
    if (actor && saved?.publicSurface?.mode === 'composer') void this.loadPublicEligibility();
    if (actor && saved?.publicSurface?.mode === 'history') void this.loadOwnPublicReviews();
    if (actor && saved?.publicSurface?.mode === 'reader') void this.loadPublicReader();
    if (actor && (saved?.venueExperience || saved?.venueProbe)) void this.loadVenueEligibility();
  }
  forget = () => { this.quarantine=null; this.inFlight=null; this.writePrepare=null; this.reads.clear(); this.seenOwn.clear(); this.seenInvites.clear(); this.ownReadAcks=[]; this.resultCursors.clear(); this.serial++; this.invitationsBusy=false; this.invitationsFollowup=false; this.invitationsBusyGen++; this.noteTombs.clear(); this.noteAppliedGen.clear(); this.noteVersionFloor.clear(); this.noteAwaitingTyped.clear(); this.reviewCursors.clear(); this.reviewVersionFloor.clear(); this.replyVersionFloor.clear(); this.reviewAppliedGen.clear(); this.reviewAwaitingTyped.clear(); this.reviewHistoryOwned.clear(); this.reviewDirectionDenied.clear(); this.reviewsBusy={sent:false,received:false}; this.reviewsFollowup={sent:false,received:false}; this.reviewsBusyGen={sent:this.reviewsBusyGen.sent+1,received:this.reviewsBusyGen.received+1}; this.publicEligibilityGen++; this.publicOwnGen++; this.publicPreviewGen++; this.publicSurfaceGen++; this.publicReaderGen++; this.publicMutationBind=null; this.publicOwnVersionFloor.clear(); this.publicOwnAwaitingTyped.clear(); this.publicOwnDenied=false; this.publicReaderReplyFloor.clear(); this.venueEligibilityGen++; this.venuePreviewGen++; this.venueSurfaceGen++; this.snapshot=empty(null); this.show({}); };
  /** Local permit captured before AuthCoordinator token await — never on the API wire. */
  dispatchPermit = (packet: Packet) => {
    const cmd = this.snapshot.command;
    return {
      key: packet.key,
      actorId: packet.actor.actorId,
      sessionId: packet.actor.sessionId,
      firstDispatchedAt: cmd?.packet.key === packet.key ? cmd.firstDispatchedAt : undefined,
    };
  };
  /** Post-token journal ownership/age fence; failure keeps UNKNOWN (no business clear / new key). */
  mayDispatchRetention = (
    packet: Packet,
    permit: { key: string; actorId: string; sessionId: string; firstDispatchedAt?: number },
  ): boolean => {
    if (permit.key !== packet.key || permit.actorId !== packet.actor.actorId) return false;
    if (this.inFlight?.key !== packet.key) return false;
    const cmd = this.snapshot.command;
    if (!cmd || cmd.packet.key !== packet.key) return false;
    if (postgameIdempotencyReplayBlocked(cmd.firstDispatchedAt ?? permit.firstDispatchedAt)) return false;
    return true;
  };
  retentionExpiredFor = (packet: Packet): boolean => {
    const cmd = this.snapshot.command;
    if (!cmd || cmd.packet.key !== packet.key) return false;
    return postgameIdempotencyReplayBlocked(cmd.firstDispatchedAt);
  };
  private writeBusy = () => !!(this.snapshot.command || this.inFlight || this.writePrepare);
  private beginWritePrepare(args: {
    actorId: string; sessionId: string; origin: 'venue-experience' | 'public-role' | 'private';
    surfaceGen: number; editor: string;
  }): number | null {
    if (this.snapshot.command || this.inFlight || this.writePrepare) return null;
    const gen = ++this.writePrepareGen;
    this.writePrepare = { gen, ...args };
    return gen;
  }
  private releaseWritePrepare(gen: number) {
    if (this.writePrepare?.gen === gen) this.writePrepare = null;
  }
  private writePrepareOwns(gen: number, editor?: string): boolean {
    const prep = this.writePrepare;
    if (!prep || prep.gen !== gen) return false;
    const actor = this.snapshot.actor;
    if (!actor || prep.actorId !== actor.actorId || prep.sessionId !== actor.sessionId) return false;
    if (editor !== undefined && prep.editor !== editor) return false;
    return true;
  }
  private venueDraftEditorKey(draft: VenueExperienceDraft, consentHash: string | null): string {
    return [draft.audience, draft.text, draft.topics.join(','), draft.consent ? '1' : '0', consentHash ?? ''].join('\u0001');
  }
  filter = (filter: Filter) => { if (this.snapshot.actor && ['all','manage','participate','invites'].includes(filter)) this.show({filter}); };
  private start(key: string) { const n=++this.serial; this.reads.set(key,n); const actor=this.snapshot.actor; return {actor,valid:()=>!!actor && sameActor(actor,this.snapshot.actor) && this.reads.get(key)===n}; }
  private failure<T>(error: unknown, prior: Source<T>): Source<T> {
    const denied=error instanceof PostgameError && error.kind === 'private';
    return {status:denied ? 'unavailable' : 'error',...(denied ? {} : {data:prior.data})};
  }
  private clearIncompatibleDrafts(gameId: string, results?: Results) {
    const attendance = results?.attendance;
    const rows = [...(attendance?.roster ?? []),...(attendance?.myAttendance ? [attendance.myAttendance] : [])];
    const drafts = {...this.snapshot.drafts};
    let changed = false;
    for (const key of Object.keys(drafts)) {
      if (!key.startsWith(`${gameId}:`)) continue;
      const parts = key.split(':');
      const contextId = parts[1];
      const disputePart = parts.slice(2).join(':');
      const row = rows.find(r => r.contextId === contextId);
      // Roster pagination absence is not definitive removal — keep compatible later-page drafts.
      if (!row) continue;
      if (disputePart !== 'create' && row.dispute?.id !== disputePart && !this.snapshot.disputes[disputePart]?.data) {
        delete drafts[key]; changed = true;
      }
    }
    if (changed) this.show({drafts});
  }
  /** Authoritative attendance/outcome change retires obsolete REQUIRED/UNEXPECTED; draft texts stay. */
  private retireStaleDiscrepancyDecision(gameId: string, results: Results) {
    const draft = this.snapshot.feedbackDrafts[gameId];
    const decision = draft?.discrepancyDecision;
    if (!decision) return;
    const current = roleDiscrepancyContextFromResults(results);
    if (roleDiscrepancyContextsEqual(decision.context, current)) return;
    this.show({
      feedbackDrafts: {
        ...this.snapshot.feedbackDrafts,
        [gameId]: { ...draft, discrepancyDecision: null },
      },
    });
  }
  /**
   * Prefill/refresh only pristine selection — createDirty tracks explicit mutations
   * (incl. deliberate empty) independently of createText truthiness. Used for every
   * accepted current projection (direct GET and results.myNotes), never discarded/stale.
   */
  private refreshPristineSelectedPrefill(gameId: string, contextId: string, text: string, noteDrafts: Record<string, NoteDraft>) {
    const createDraft = noteDrafts[gameId];
    if (createDraft?.selectedContextId === contextId && !createDraft.createDirty) {
      return { ...noteDrafts, [gameId]: { ...createDraft, createText: text } };
    }
    return noteDrafts;
  }
  /** Monotonic note projection: never regress version; same-version rights may refresh under newer gens; tombs block resurrection. */
  private rememberOwnedNotes(notes: PersonalNote[], gen: number, fromDirect = false) {
    const known = {...this.snapshot.knownNoteRefs};
    const sources = {...this.snapshot.notes};
    let noteDrafts = this.snapshot.noteDrafts;
    let changed = false;
    let draftsChanged = false;
    for (const note of notes) {
      const key = noteKey(note.gameId, note.contextId);
      if (this.noteTombs.has(key)) continue;
      // Post-upsert: results/myNotes must not regrant ready rights before typed GET.
      if (!fromDirect && this.noteAwaitingTyped.has(key)) continue;
      const floor = this.noteVersionFloor.get(key) ?? 0;
      const applied = this.noteAppliedGen.get(key) ?? 0;
      // Floor survives loading/error — do not rely on ready Source.data alone.
      if (note.version < floor) continue;
      if (note.version === floor && gen < applied) continue;
      this.noteVersionFloor.set(key, note.version);
      this.noteAppliedGen.set(key, gen);
      if (fromDirect) this.noteAwaitingTyped.delete(key);
      known[key] = { gameId: note.gameId, contextId: note.contextId };
      sources[key] = { status: 'ready', data: note };
      changed = true;
      // After version/gen/tomb/current authority — results and direct GET share this path.
      const nextDrafts = this.refreshPristineSelectedPrefill(note.gameId, note.contextId, note.text, noteDrafts);
      if (nextDrafts !== noteDrafts) { noteDrafts = nextDrafts; draftsChanged = true; }
    }
    if (changed) this.show({ knownNoteRefs: known, notes: sources, ...(draftsChanged ? { noteDrafts } : {}) });
  }
  /** Clear scoped create/edit drafts for a confirmed-absent owned context; unrelated selections stay. */
  private clearAbsentContextDrafts(gameId: string, contextId: string) {
    const key = noteKey(gameId, contextId);
    const noteDrafts = {...this.snapshot.noteDrafts}; delete noteDrafts[key];
    const createDraft = noteDrafts[gameId];
    if (createDraft?.selectedContextId === contextId) {
      // Confirmed absence of the selected context must clear its create-form text (prefill from loadNote),
      // not retain private content in the reachable NotesSection TextInput. Unrelated contexts stay intact.
      noteDrafts[gameId] = { selectedContextId: undefined, createText: '', editText: createDraft.editText };
    }
    return noteDrafts;
  }
  private tombstoneOwnedNote(gameId: string, contextId: string, version: number) {
    const key = noteKey(gameId, contextId);
    const prior = this.noteTombs.get(key) ?? 0;
    this.noteTombs.set(key, Math.max(prior, version));
    // Invalidate in-flight direct GETs so late replies cannot reinstall private text.
    this.reads.set(`note:${key}`, ++this.serial);
    this.noteAppliedGen.delete(key);
    this.noteVersionFloor.delete(key);
    this.noteAwaitingTyped.delete(key);
    const known = {...this.snapshot.knownNoteRefs}; delete known[key];
    // Keep definitive unavailable so stale feedback.myNotes cannot render/resurrect the row.
    const notes = {...this.snapshot.notes, [key]: { status: 'unavailable' as const }};
    this.show({ knownNoteRefs: known, notes, noteDrafts: this.clearAbsentContextDrafts(gameId, contextId) });
  }
  private shadowKnownNoteAbsence(gameId: string, contextId: string) {
    const key = noteKey(gameId, contextId);
    const priorVersion = Math.max(
      this.noteVersionFloor.get(key) ?? 0,
      this.snapshot.notes[key]?.data?.version ?? 0,
      this.noteTombs.get(key) ?? 0,
    );
    this.noteTombs.set(key, Math.max(this.noteTombs.get(key) ?? 0, priorVersion));
    this.noteAppliedGen.delete(key);
    this.noteVersionFloor.delete(key);
    this.noteAwaitingTyped.delete(key);
    const known = {...this.snapshot.knownNoteRefs}; delete known[key];
    // Same selected-context draft privacy cleanup as DELETE ACK — current known GET404 must not leave
    // private prefill in NotesSection TextInput; unrelated selected context B drafts stay intact.
    this.show({ knownNoteRefs: known, noteDrafts: this.clearAbsentContextDrafts(gameId, contextId) });
  }
  loadOwn = async (more = false) => {
    if (this.snapshot.own.status === 'loading') return;
    const old=this.snapshot.own, cursor=more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const {actor,valid}=this.start('own'); if (!actor) return;
    this.ownReadAcks=[];
    this.show({own:{...old,status:'loading'}});
    try {
      const page=await this.port.own(actor,cursor ?? undefined); if (!valid()) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.seenOwn.has(page.nextCursor))) throw new PostgameError('invalid');
      if (!more) this.seenOwn.clear(); if (page.nextCursor) this.seenOwn.add(page.nextCursor);
      const rows=new Map<string,OwnResult>();
      for (const item of [...(more ? this.snapshot.own.data?.items ?? [] : []),...page.items]) {
        const fresh=this.ownReadAcks.reduce(applyOwnAck,item);
        const key=`${fresh.gameId}:${fresh.contextId}`, prior=rows.get(key);
        // Historical notice rows carry CURRENT attendance. Keep only a matching pending
        // notice; fresh ACK/version/rights always win, including across page boundaries.
        if (prior?.notice && needsAttention(prior) && fresh.attendance.acknowledgedVersion !== fresh.attendance.version &&
            prior.notice.attendanceVersion === fresh.attendance.version &&
            (fresh.notice === null || needsAttention(fresh) && Date.parse(prior.notice.createdAt) >= Date.parse(fresh.notice.createdAt))) {
          rows.set(key,{...fresh,notice:prior.notice});
        } else rows.set(key,fresh);
      }
      const items=[...rows.values()];
      this.show({own:{status:'ready',data:{items,nextCursor:page.nextCursor}}});
    } catch(error) { if (valid()) this.show({own:this.failure(error,this.snapshot.own)}); }
    finally { if (valid()) this.ownReadAcks=[]; }
  };
  loadReminders = async () => {
    const {actor,valid}=this.start('reminders'); if (!actor) return; const old=this.snapshot.reminders;
    this.show({reminders:{...old,status:'loading'}});
    try { const data=await this.port.reminders(actor); if(valid()) this.show({reminders:{status:'ready',data}}); }
    catch(error) { if(valid()) this.show({reminders:this.failure(error,old)}); }
  };
  /** Own invitations list — independent lane; never settles Messages invitation writes. */
  loadInvitations = async (more = false) => {
    // ACK/callback refresh during in-flight initial or load-more: invalidate the stale
    // page and coalesce exactly one fresh authoritative root GET. Never apply list
    // reads to unknown Messages packets; cursor/retry/dedupe stay on the fresh read.
    // Busy (not status) gates re-entry so a queued followup can start after invalidation
    // while UI status is still loading.
    if (this.invitationsBusy) {
      if (!more) {
        this.invitationsFollowup = true;
        this.reads.set('invitations', ++this.serial);
      }
      return;
    }
    const old=this.snapshot.invitations, cursor=more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const {actor,valid}=this.start('invitations'); if (!actor) return;
    const busyGen=++this.invitationsBusyGen;
    this.invitationsBusy=true;
    this.show({invitations:{...old,status:'loading'}});
    try {
      const page=await this.port.invitations(actor,cursor ?? undefined); if (!valid()) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.seenInvites.has(page.nextCursor))) throw new PostgameError('invalid');
      if (!more) this.seenInvites.clear(); if (page.nextCursor) this.seenInvites.add(page.nextCursor);
      const rows=new Map<string,GameInvitation>();
      for (const item of [...(more ? this.snapshot.invitations.data?.items ?? [] : []),...page.items]) rows.set(item.id,item);
      this.show({invitations:{status:'ready',data:{items:[...rows.values()],nextCursor:page.nextCursor}}});
    } catch(error) {
      if (!valid()) return;
      const mapped = error instanceof MessagesError
        ? new PostgameError(error.kind === 'private' ? 'private' : error.kind === 'invalid' ? 'invalid' : 'network', error.status, error.code)
        : error;
      this.show({invitations:this.failure(mapped,this.snapshot.invitations)});
    } finally {
      // Only the generation that set busy may clear it or consume a queued refresh.
      if (this.invitationsBusyGen === busyGen) {
        this.invitationsBusy=false;
        if (this.invitationsFollowup) {
          this.invitationsFollowup=false;
          if (actor && sameActor(actor,this.snapshot.actor)) void this.loadInvitations(false);
        }
      }
    }
  };
  loadResults = async (gameId: string, query: ResultsQuery = {}, append?: 'roster' | 'revisions') => {
    try { postgameId(gameId); } catch { return; }
    const old: Source<Results>=this.snapshot.games[gameId] ?? {status:'idle'};
    if (!append && (query.rosterCursor || query.revisionsCursor) || append === 'roster' && query.revisionsCursor || append === 'revisions' && query.rosterCursor) return;
    // Pagination is only from a cursor already received for this actor/game.
    if (append === 'roster' && (!old.data?.attendance?.rosterNextCursor || query.rosterCursor !== old.data.attendance.rosterNextCursor) ||
        append === 'revisions' && (!old.data?.revisionsNextCursor || query.revisionsCursor !== old.data.revisionsNextCursor)) return;
    const {actor,valid}=this.start(`game:${gameId}`); if (!actor) return;
    const resultsGen = this.reads.get(`game:${gameId}`) ?? 0;
    const selection=this.snapshot.selection?.gameId === gameId ? this.snapshot.selection : this.snapshot.selection;
    const put=(source: Source<Results>)=>this.show({games:{...this.snapshot.games,[gameId]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.results(actor,gameId,query); if(!valid()) return;
      if(data.gameId !== gameId) throw new PostgameError('invalid');
      for (const kind of ['roster','revisions'] as const) {
        const key=`${gameId}:${kind}`;
        const exposed=kind === 'roster' ? data.attendance?.roster : data.revisions;
        if (!exposed) { this.resultCursors.delete(key); continue; }
        if (append && append !== kind) continue;
        const seen=append ? this.resultCursors.get(key) ?? new Set<string>() : new Set<string>();
        const next=kind === 'roster' ? data.attendance?.rosterNextCursor : data.revisionsNextCursor;
        if(next && seen.has(next)) throw new PostgameError('invalid');
        if(next) seen.add(next); this.resultCursors.set(key,seen);
      }
      if(append === 'roster' && data.attendance?.roster && old.data?.attendance) {
        if(data.attendance.rosterNextCursor && data.attendance.rosterNextCursor === query.rosterCursor) throw new PostgameError('invalid');
        data.attendance.roster=[...new Map([...(old.data.attendance.roster ?? []),...(data.attendance.roster ?? [])].map(r=>[r.contextId,r])).values()];
      }
      if(append === 'revisions' && data.revisions) {
        if(data.revisionsNextCursor && data.revisionsNextCursor === query.revisionsCursor) throw new PostgameError('invalid');
        data.revisions=[...new Map([...(old.data?.revisions ?? []),...(data.revisions ?? [])].map(r=>[r.version,r])).values()];
      }
      if (append === 'roster' && old.data?.revisions && data.revisions) {
        data.revisions=[...new Map([...old.data.revisions,...data.revisions].map(r=>[r.version,r])).values()];
        data.revisionsNextCursor=old.data.revisionsNextCursor;
      }
      if (append === 'revisions' && old.data?.attendance?.roster && data.attendance?.roster) {
        data.attendance.roster=[...new Map([...old.data.attendance.roster,...data.attendance.roster].map(r=>[r.contextId,r])).values()];
        data.attendance.rosterNextCursor=old.data.attendance.rosterNextCursor;
      }
      // A GET never acknowledges or settles a pending command. Roster pagination keeps selection.
      put({status:'ready',data});
      this.clearIncompatibleDrafts(gameId, data);
      this.retireStaleDiscrepancyDecision(gameId, data);
      if (data.feedback?.installed && data.feedback.myNotes.length) this.rememberOwnedNotes(data.feedback.myNotes, resultsGen);
      if (data.feedback?.gameReviews?.length) this.rememberReviews(data.feedback.gameReviews, resultsGen, 'results');
      if (selection?.gameId === gameId) {
        const rows=[...(data.attendance?.roster ?? []),...(data.attendance?.myAttendance ? [data.attendance.myAttendance] : [])];
        const still=rows.some(r=>r.contextId === selection.contextId && r.dispute?.id === selection.disputeId);
        if (!still && !this.snapshot.disputes[selection.disputeId]?.data) this.show({selection:null});
      }
    } catch(error) {
      // Denied results must not wipe actor-bound known own-note refs or direct note sources.
      if(valid()) put(this.failure(error,old));
    }
  };
  /** Direct own-note GET for a known/selected context — independent of results/roster denial. */
  loadNote = async (gameId: string, contextId: string) => {
    try { postgameId(gameId); postgameId(contextId); } catch { return; }
    const key = noteKey(gameId, contextId);
    const old = this.snapshot.notes[key] ?? { status: 'idle' };
    const { actor, valid } = this.start(`note:${key}`); if (!actor) return;
    const noteGen = this.reads.get(`note:${key}`) ?? 0;
    const put = (source: Source<PersonalNote>) => this.show({ notes: { ...this.snapshot.notes, [key]: source } });
    // Only confirmed delete / known-owned definitive 404 (noteTombs) fence through select/refresh.
    // Fresh never-owned GET404 is provisional create authority — next direct GET must go loading
    // (block create0) until the read confirms absence again, errors, or finds the note.
    const tombFenced = this.noteTombs.has(key);
    if (!tombFenced) put({ ...old, status: 'loading' });
    try {
      const data = await this.port.note(actor, gameId, contextId); if (!valid()) return;
      if (data.gameId !== gameId || data.contextId !== contextId) throw new PostgameError('invalid');
      if (this.noteTombs.has(key)) {
        put({ status: 'unavailable' });
        return;
      }
      // Monotonic apply first — never put ready before floor/gen comparison (reverse race).
      // Pristine selected prefill runs inside rememberOwnedNotes for accepted current only.
      this.rememberOwnedNotes([data], noteGen, true);
      const cur = this.snapshot.notes[key];
      if (cur?.status === 'ready' && this.noteAppliedGen.get(key) === noteGen) {
        return;
      }
      // Stale/rejected reply: reinstate retained newer ready projection if still loading.
      if (cur?.status === 'loading') {
        const retained = cur.data ?? old.data;
        if (retained) put({ status: 'ready', data: retained });
      }
    } catch (error) {
      if (!valid()) return;
      // Stale negative fence: newer results/direct already accepted after this GET started.
      // Late older private404 must not tombstone that projection; late network must not downgrade ready rights.
      const applied = this.noteAppliedGen.get(key) ?? 0;
      if (noteGen < applied) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      const current = this.snapshot.notes[key] ?? old;
      const known = !!this.snapshot.knownNoteRefs[key] || this.noteTombs.has(key) || !!current.data || !!old.data;
      if (denied && known) {
        // Definitive private 404 of a known/tombstoned own note: shadow stale myNotes; never turn into create.
        this.shadowKnownNoteAbsence(gameId, contextId);
        put({ status: 'unavailable' });
        return;
      }
      // Tombstone display fence persists through read error — no stale myNotes resurrection.
      if (this.noteTombs.has(key)) {
        put({ status: 'unavailable' });
        return;
      }
      // Transient errors keep retained text via current/prior data but do not grant write authority (see currentNote).
      // Fresh never-owned private 404 → unavailable (create eligible); network → error (create blocked).
      put(this.failure(error, current.data || old.data ? current : old));
    }
  };
  setNoteDraft = (gameId: string, contextId: string | null, patch: NoteDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); if (contextId) postgameId(contextId); } catch { return; }
    // Create-form drafts key by gameId; per-note edit drafts by gameId:contextId.
    const key = contextId ? noteKey(gameId, contextId) : gameId;
    const prior = this.snapshot.noteDrafts[key] ?? {};
    // Switching selected participant must not carry create text into another context.
    // Bounded myNotes absence is not authority — always direct-GET the chosen context before create/edit.
    if (patch.selectedContextId !== undefined && patch.selectedContextId !== prior.selectedContextId) {
      const hasText = patch.createText !== undefined;
      this.show({
        noteDrafts: {
          ...this.snapshot.noteDrafts,
          [key]: {
            selectedContextId: patch.selectedContextId,
            createText: hasText ? patch.createText : '',
            editText: prior.editText,
            ...(hasText ? { createDirty: true } : {}),
          },
        },
      });
      if (patch.selectedContextId) void this.loadNote(gameId, patch.selectedContextId);
      return;
    }
    const next: NoteDraft = { ...prior, ...patch };
    // Explicit createText patch (including '') marks dirty; selection-only init stays pristine.
    if (patch.createText !== undefined) next.createDirty = true;
    this.show({ noteDrafts: { ...this.snapshot.noteDrafts, [key]: next } });
  };
  loadDispute = async (disputeId: string) => {
    try { postgameId(disputeId); } catch { return; }
    const old = this.snapshot.disputes[disputeId] ?? {status:'idle'};
    const {actor,valid}=this.start(`dispute:${disputeId}`); if (!actor) return;
    const put=(source: Source<AttendanceDispute>)=>this.show({disputes:{...this.snapshot.disputes,[disputeId]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.dispute(actor,disputeId); if(!valid()) return;
      if (data.id !== disputeId) throw new PostgameError('invalid');
      put({status:'ready',data});
      const selection=this.snapshot.selection;
      if (selection?.disputeId === disputeId && (selection.gameId !== data.gameId || selection.contextId !== data.contextId)) {
        this.show({selection:{gameId:data.gameId,contextId:data.contextId,disputeId}});
      }
    } catch(error) { if(valid()) put(this.failure(error,old)); }
  };
  loadHistory = async (gameId: string, contextId: string, limit?: number) => {
    try { postgameId(gameId); postgameId(contextId); } catch { return; }
    const key=`${gameId}:${contextId}`;
    const old=this.snapshot.histories[key] ?? {status:'idle'};
    const {actor,valid}=this.start(`history:${key}`); if (!actor) return;
    const put=(source: Source<AttendanceHistoryPage>)=>this.show({histories:{...this.snapshot.histories,[key]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.history(actor,gameId,contextId,limit); if(!valid()) return;
      put({status:'ready',data});
    } catch(error) { if(valid()) put(this.failure(error,old)); }
  };
  selectDispute = (selection: DisputeSelection | null) => {
    if (!this.snapshot.actor) return;
    if (!selection) { this.show({selection:null}); return; }
    try { postgameId(selection.gameId); postgameId(selection.contextId); postgameId(selection.disputeId); } catch { return; }
    const prior=this.snapshot.selection;
    // Wrong row retires private form contents that belong to another participant.
    if (prior && (prior.gameId !== selection.gameId || prior.contextId !== selection.contextId || prior.disputeId !== selection.disputeId)) {
      const stale=draftKey(prior.gameId, prior.contextId, prior.disputeId);
      const drafts={...this.snapshot.drafts}; delete drafts[stale];
      this.show({selection,drafts});
    } else this.show({selection});
    void this.loadDispute(selection.disputeId);
  };
  setDraft = (gameId: string, contextId: string, disputeId: string | null | undefined, patch: DisputeDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); postgameId(contextId); if (disputeId) postgameId(disputeId); } catch { return; }
    const key=draftKey(gameId,contextId,disputeId);
    const prior=this.snapshot.drafts[key] ?? {};
    this.show({drafts:{...this.snapshot.drafts,[key]:{...prior,...patch}}});
  };
  setFeedbackDraft = (gameId: string, patch: FeedbackDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); } catch { return; }
    const prior = this.snapshot.feedbackDrafts[gameId] ?? {};
    const next: FeedbackDraft = { ...prior, ...patch };
    if (patch.replyText) next.replyText = { ...(prior.replyText ?? {}), ...patch.replyText };
    // Mode switch clears bound discrepancy decision; kind-separated draft fields stay intact.
    if (patch.mode !== undefined && patch.mode !== prior.mode) next.discrepancyDecision = null;
    // Opening/changing report target resets consent; keep known version from the open patch.
    if (patch.reportReviewId !== undefined && patch.reportReviewId !== prior.reportReviewId) {
      next.reportConsent = false;
      if (patch.reportConsentVersion === undefined) next.reportConsentVersion = undefined;
    }
    // Revision change without an explicit consent field resets true consent (preserve detail).
    // Explicit current-version grant in the same patch must take one press.
    if (patch.reportConsentVersion !== undefined && prior.reportConsentVersion !== undefined
      && patch.reportConsentVersion !== prior.reportConsentVersion
      && patch.reportConsent === undefined) {
      next.reportConsent = false;
    }
    this.show({ feedbackDrafts: { ...this.snapshot.feedbackDrafts, [gameId]: next } });
  };
  /** Reset report consent when typed revision advances; preserve detail draft. */
  private resetReportConsentForRevision(row: PrivateReview) {
    const drafts = { ...this.snapshot.feedbackDrafts };
    let changed = false;
    for (const [gameId, draft] of Object.entries(drafts)) {
      if (draft.reportReviewId !== row.id) continue;
      if (!draft.reportConsent && draft.reportConsentVersion === row.version) continue;
      if (draft.reportConsentVersion === row.version && draft.reportConsent) continue;
      drafts[gameId] = { ...draft, reportConsent: false };
      changed = true;
    }
    if (changed) this.show({ feedbackDrafts: drafts });
  }
  /**
   * Raise a strictly newer independent reply onto the kept current parent.
   * Never adopts stale parent comment/rights/direction/game/consent/read-gen from the projection.
   * Receipt still settles ACK-safe (strip writes, await typed); history clears awaiting and marks owned.
   * Results leave parent authority/consent/ownership fences unchanged aside from the reply floor.
   * replyOnly (older-gen discard): raise reply floor only — no ACK settle, awaiting clear, or history ownership.
   */
  private applyNewerReplyOntoKeptParent(
    byId: Record<string, PrivateReview>,
    row: PrivateReview,
    prior: PrivateReview,
    replyVer: number,
    replyFloor: number,
    source: 'results' | 'history' | 'receipt',
    replyOnly = false,
  ): boolean {
    if (!row.reply || replyVer <= replyFloor) return false;
    let next: PrivateReview = { ...prior, reply: row.reply };
    if (!replyOnly && source === 'receipt') {
      next = {
        ...next,
        allowedActions: {
          canEdit: false,
          canReply: false,
          canReport: next.allowedActions.canReport,
        },
      };
      this.reviewAwaitingTyped.add(row.id);
      this.reviewHistoryOwned.delete(row.id);
    }
    if (!replyOnly && source === 'history') {
      this.reviewAwaitingTyped.delete(row.id);
      this.reviewHistoryOwned.add(row.id);
    }
    byId[row.id] = next;
    this.replyVersionFloor.set(row.id, replyVer);
    return true;
  }
  /**
   * Monotonic typed review store — version + read-gen authority.
   * Only typed history restores private projection after hard deny; results/receipts cannot
   * resurrect while denied or (results) while awaiting typed GET. Receipt ACK is display-only
   * until typed history refresh. Reply revision is independently monotonic across review edits.
   */
  private rememberReviews(rows: PrivateReview[], gen: number, source: 'results' | 'history' | 'receipt') {
    const byId = { ...this.snapshot.reviewsById };
    let changed = false;
    const revisionAdvances: PrivateReview[] = [];
    for (const row of rows) {
      // Hard-denied direction: settle packet elsewhere; only successful typed history may restore.
      if (source !== 'history' && this.reviewDirectionDenied.has(row.direction)) continue;
      if (source === 'results' && this.reviewAwaitingTyped.has(row.id)) continue;
      const floor = this.reviewVersionFloor.get(row.id) ?? 0;
      const prior = byId[row.id];
      const replyFloor = this.replyVersionFloor.get(row.id) ?? 0;
      const replyVer = row.reply?.version ?? 0;
      const applied = this.reviewAppliedGen.get(row.id) ?? 0;
      const staleRead = gen < applied;
      // Older-gen reply-only: raise reply without parent authority / awaiting changes.
      // Receipt ACK still settles display-only + await typed even on discard.
      const replyOnly = staleRead && source !== 'receipt';
      // Before every parent-discard branch: strictly newer reply is an independent dimension.
      if (row.version < floor) {
        // Older parent must not regress content/permissions/read-gen/consent.
        // Any legitimate typed read (history/receipt/Results) may still raise reply onto kept parent.
        if (prior && this.applyNewerReplyOntoKeptParent(byId, row, prior, replyVer, replyFloor, source, replyOnly)) {
          changed = true;
        }
        continue;
      }
      // Typed history owns the current floor — later results cannot same-version regress rights/text.
      // Strictly newer independent reply may still raise onto the kept parent (reply-only).
      if (source === 'results' && this.reviewHistoryOwned.has(row.id) && row.version <= floor) {
        if (prior && this.applyNewerReplyOntoKeptParent(byId, row, prior, replyVer, replyFloor, source, replyOnly)) {
          changed = true;
        }
        continue;
      }
      if (row.version === floor && staleRead) {
        if (prior && this.applyNewerReplyOntoKeptParent(byId, row, prior, replyVer, replyFloor, source, replyOnly)) {
          changed = true;
        }
        continue;
      }
      let next: PrivateReview = row;
      // Reply revisions are independent of parent review version — keep highest accepted reply.
      if (prior && replyVer < replyFloor) {
        next = { ...row, reply: prior.reply };
      }
      if (source === 'receipt') {
        // Historical ACK settles the packet only — strip write grants until typed history.
        next = {
          ...next,
          allowedActions: {
            canEdit: false,
            canReply: false,
            canReport: next.allowedActions.canReport,
          },
        };
        this.reviewAwaitingTyped.add(row.id);
        this.reviewHistoryOwned.delete(row.id);
      }
      if (source === 'history') {
        this.reviewAwaitingTyped.delete(row.id);
        this.reviewHistoryOwned.add(row.id);
      }
      if (source === 'results' && row.version > floor) this.reviewHistoryOwned.delete(row.id);
      byId[row.id] = next;
      this.reviewVersionFloor.set(row.id, Math.max(floor, row.version));
      this.replyVersionFloor.set(row.id, Math.max(replyFloor, next.reply?.version ?? 0));
      this.reviewAppliedGen.set(row.id, gen);
      if (prior && prior.version !== next.version) revisionAdvances.push(next);
      changed = true;
    }
    if (changed) this.show({ reviewsById: byId });
    for (const row of revisionAdvances) this.resetReportConsentForRevision(row);
  }
  /** Hard-denied own-history: retire private projection/permissions for that direction. */
  private retireReviewDirection(direction: ReviewDirection) {
    this.reviewDirectionDenied.add(direction);
    const byId = { ...this.snapshot.reviewsById };
    const retired = new Set<string>();
    let changed = false;
    for (const [id, row] of Object.entries(byId)) {
      if (row.direction !== direction) continue;
      delete byId[id];
      retired.add(id);
      this.reviewVersionFloor.delete(id);
      this.replyVersionFloor.delete(id);
      this.reviewAppliedGen.delete(id);
      this.reviewAwaitingTyped.delete(id);
      this.reviewHistoryOwned.delete(id);
      changed = true;
    }
    const drafts = { ...this.snapshot.feedbackDrafts };
    let draftsChanged = false;
    for (const [gameId, draft] of Object.entries(drafts)) {
      if (!draft.reportReviewId || !retired.has(draft.reportReviewId)) continue;
      drafts[gameId] = {
        ...draft,
        reportReviewId: undefined,
        reportConsent: false,
        reportConsentVersion: undefined,
      };
      draftsChanged = true;
    }
    if (changed || draftsChanged) {
      this.show({
        reviewsById: byId,
        ...(draftsChanged ? { feedbackDrafts: drafts } : {}),
      });
    }
  }
  /**
   * Write authority: actor/session-bound typed ready history (or idle+ready results bootstrap).
   * Pending/error/unavailable and post-ACK awaiting typed never grant new reply/report.
   */
  private currentReviewForWrite(reviewId: string): PrivateReview | null {
    if (this.reviewAwaitingTyped.has(reviewId)) return null;
    const review = this.snapshot.reviewsById[reviewId] ?? null;
    if (!review) return null;
    if (this.reviewDirectionDenied.has(review.direction)) return null;
    const history = this.snapshot.reviewHistory[review.direction];
    if (history.status === 'loading' || history.status === 'error' || history.status === 'unavailable') {
      return null;
    }
    if (history.status === 'ready') return review;
    // Idle: only a ready results projection may bootstrap before the first history GET settles.
    const results = this.snapshot.games[review.gameId];
    if (results?.status === 'ready' && results.data?.feedback?.gameReviews?.some(r => r.id === reviewId)) {
      return review;
    }
    return null;
  }
  /** Own directional history — independent of denied results; honest cursor/empty/error. */
  loadReviews = async (direction: ReviewDirection, more = false) => {
    if (direction !== 'sent' && direction !== 'received') return;
    // Mutation refresh during in-flight initial/load-more: invalidate the stale page and
    // coalesce exactly one fresh authoritative root GET. Busy (not status) gates re-entry
    // so a queued followup can start after invalidation while UI status is still loading.
    // Queued work is read-only — never autosend writes.
    if (this.reviewsBusy[direction]) {
      if (!more) {
        this.reviewsFollowup[direction] = true;
        this.reads.set(`reviews:${direction}`, ++this.serial);
      }
      return;
    }
    const old = this.snapshot.reviewHistory[direction];
    const cursor = more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const { actor, valid } = this.start(`reviews:${direction}`);
    if (!actor) return;
    const busyGen = ++this.reviewsBusyGen[direction];
    this.reviewsBusy[direction] = true;
    const historyGen = this.reads.get(`reviews:${direction}`) ?? 0;
    const put = (source: Source<MeReviewsPage>) => this.show({
      reviewHistory: { ...this.snapshot.reviewHistory, [direction]: source },
    });
    put({ ...old, status: 'loading' });
    try {
      const page = await this.port.reviews(actor, direction, cursor ?? undefined);
      if (!valid()) return;
      const seen = more ? this.reviewCursors.get(direction) ?? new Set<string>() : new Set<string>();
      if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor))) throw new PostgameError('invalid');
      if (page.nextCursor) seen.add(page.nextCursor);
      this.reviewCursors.set(direction, seen);
      const priorItems = more ? old.data?.items ?? [] : [];
      // Retain nextCursor honestly even when page has non-peer rows.
      const merged = mergeReviewPages(priorItems, page.items, direction);
      this.reviewDirectionDenied.delete(direction);
      this.rememberReviews(page.items, historyGen, 'history');
      // Prefer store projection so UI/history page stay coherent with monotonic rights.
      const projected = merged.map(row => this.snapshot.reviewsById[row.id] ?? row);
      put({ status: 'ready', data: { items: projected, nextCursor: page.nextCursor } });
    } catch (error) {
      if (!valid()) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      put(this.failure(error, old));
      if (denied) this.retireReviewDirection(direction);
    } finally {
      if (this.reviewsBusyGen[direction] === busyGen) {
        this.reviewsBusy[direction] = false;
        if (this.reviewsFollowup[direction]) {
          this.reviewsFollowup[direction] = false;
          if (actor && sameActor(actor, this.snapshot.actor)) void this.loadReviews(direction, false);
        }
      }
    }
  };
  private currentNote(gameId: string, contextId: string): PersonalNote | null {
    const key = noteKey(gameId, contextId);
    if (this.noteTombs.has(key)) return null;
    const direct = this.snapshot.notes[key];
    // Definitive unavailable shadows stale feedback.myNotes — never resurrect create/edit from the list.
    if (direct?.status === 'unavailable') return null;
    // Only ready typed authority grants review/confirm — retained loading/error data is display-only.
    if (direct?.status === 'ready' && direct.data && direct.data.gameId === gameId && direct.data.contextId === contextId) {
      return direct.data;
    }
    // Transient loading/error: no write authority (blocks historical myNotes fallback after PUT+GET failure too).
    if (direct?.status === 'loading' || direct?.status === 'error') {
      return null;
    }
    const feedback = this.snapshot.games[gameId]?.data?.feedback;
    return feedback?.myNotes.find(n => n.contextId === contextId && n.gameId === gameId) ?? null;
  }
  /** Drop warm guest author/reader targets — cancel/expiry/replacement login must not inherit them. */
  clearPendingPublicGoals = () => {
    if (!this.snapshot.pendingPublicAuthor && !this.snapshot.pendingPublicReader) return;
    this.show({ pendingPublicAuthor: null, pendingPublicReader: null });
  };
  /** Guest: remember bounded role/game only; consent/text never retained across auth. */
  rememberPendingPublicAuthor = (target: PublicRoleAuthorTarget) => {
    this.show({
      pendingPublicAuthor: Object.freeze({ ...target }),
      pendingPublicReader: null,
    });
  };
  consumePendingPublicAuthor = (): PublicRoleAuthorTarget | null => {
    const pending = this.snapshot.pendingPublicAuthor;
    if (!pending) return null;
    this.show({ pendingPublicAuthor: null });
    return pending;
  };
  /**
   * Root host: consume pending once under a live actor and open composer with empty draft
   * (consent false / text empty). No autosend. Logout / missing actor / empty pending are no-ops.
   */
  resumePendingPublicAuthor = (): boolean => {
    if (!this.snapshot.actor) return false;
    const pending = this.consumePendingPublicAuthor();
    if (!pending) return false;
    this.openPublicComposer(pending);
    return true;
  };
  /** Guest: remember bounded reader role/origin only; consent/text never retained across auth. */
  rememberPendingPublicReader = (target: PublicRoleReaderTarget) => {
    this.show({
      pendingPublicAuthor: null,
      pendingPublicReader: Object.freeze({
        ...target,
        origin: Object.freeze({ ...target.origin }),
      }),
    });
  };
  consumePendingPublicReader = (): PublicRoleReaderTarget | null => {
    const pending = this.snapshot.pendingPublicReader;
    if (!pending) return null;
    this.show({ pendingPublicReader: null });
    return pending;
  };
  /**
   * Root host: consume pending reader once under a live actor and open current target
   * with fresh typed rights. No autosend. Cancelled guest auth keeps pending until resume/forget.
   */
  resumePendingPublicReader = (): boolean => {
    if (!this.snapshot.actor) return false;
    const pending = this.consumePendingPublicReader();
    if (!pending) return false;
    this.openPublicReader(pending);
    return true;
  };
  openPublicComposer = (target: PublicRoleAuthorTarget, opts?: { resumeFrozen?: boolean }) => {
    if (!this.snapshot.actor) return;
    const draft = emptyPublicRoleDraft(target.gameId);
    this.publicEligibilityGen++; this.publicPreviewGen++; this.publicSurfaceGen++; this.publicReaderGen++;
    this.show({
      publicSurface: {
        mode: 'composer',
        target: Object.freeze({ ...target }),
        reader: null,
        gen: this.publicSurfaceGen,
        ...(opts?.resumeFrozen ? { resumeFrozenGameId: target.gameId } : {}),
      },
      publicEligibility: { status: 'idle' },
      publicReader: { status: 'idle' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicDraft: draft,
      publicReplyDrafts: {},
      publicReportDraft: null,
      publicConsentHash: null,
      publicReceipt: null,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      publicNotice: null,
    });
    void this.loadPublicEligibility();
  };
  /**
   * Cold-auth resumed author goal: credential-omit public game/role projection + exact eligibility
   * before opening. Handle-wide eligibility alone cannot authorize; missing origin port fail-closes.
   */
  openResumedPublicComposer = async (
    target: PublicRoleAuthorTarget,
    opts?: { isLive?: () => boolean },
  ): Promise<boolean> => {
    const actor = this.snapshot.actor;
    if (!actor) return false;
    const originPort = this.port.publicGameRoleOrigin;
    if (!originPort) return false;
    const live = () => (!opts?.isLive || opts.isLive())
      && !!this.snapshot.actor && sameActor(actor, this.snapshot.actor)
      && !this.snapshot.publicSurface;
    if (!live()) return false;
    const eligibilityGen = ++this.publicEligibilityGen;
    const surfaceGen = this.publicSurfaceGen;
    try {
      const origin = parseRoleReputationSummary(
        await originPort(target.gameId, target.role),
        { role: target.role },
      );
      if (eligibilityGen !== this.publicEligibilityGen || surfaceGen !== this.publicSurfaceGen || !live()) return false;
      if (origin.roleHandle !== target.roleHandle.toLowerCase() || origin.role !== target.role) return false;
      if (origin.availability !== 'available') return false;
      const data = parseOwnEligibility(await this.port.publicEligibility(actor, target.roleHandle), target.roleHandle);
      if (eligibilityGen !== this.publicEligibilityGen || surfaceGen !== this.publicSurfaceGen || !live()) return false;
      if (data.role !== target.role) return false;
      if (!eligibleBases(data).some(basis => basis.gameId === target.gameId)) return false;
      if (!live()) return false;
      this.openPublicComposer(target, { resumeFrozen: true });
      return true;
    } catch {
      return false;
    }
  };
  /**
   * Cold-auth resumed reader: resolve current public game/profile role→handle before by-handle read.
   * Denial, replaced origin, or role/handle mismatch suppresses the sheet (no fallback origin).
   */
  openResumedPublicReader = async (
    target: PublicRoleReaderTarget,
    opts?: { isLive?: () => boolean },
  ): Promise<boolean> => {
    const actor = this.snapshot.actor;
    if (!actor) return false;
    const live = () => (!opts?.isLive || opts.isLive())
      && !!this.snapshot.actor && sameActor(actor, this.snapshot.actor)
      && !this.snapshot.publicSurface;
    if (!live()) return false;
    const readerGen = ++this.publicReaderGen;
    const surfaceGen = this.publicSurfaceGen;
    try {
      if (target.origin.kind === 'game') {
        const originPort = this.port.publicGameRoleOrigin;
        if (!originPort) return false;
        const origin = parseRoleReputationSummary(
          await originPort(target.origin.gameId, target.role),
          { role: target.role },
        );
        if (readerGen !== this.publicReaderGen || surfaceGen !== this.publicSurfaceGen || !live()) return false;
        if (origin.roleHandle !== target.roleHandle.toLowerCase() || origin.role !== target.role) return false;
        if (origin.availability !== 'available') return false;
      } else {
        const originPort = this.port.publicPlayerRoleOrigin;
        if (!originPort) return false;
        const origin = parseRoleReputationSummary(
          await originPort(target.origin.publicPlayerId, target.role),
          { role: target.role },
        );
        if (readerGen !== this.publicReaderGen || surfaceGen !== this.publicSurfaceGen || !live()) return false;
        if (origin.roleHandle !== target.roleHandle.toLowerCase() || origin.role !== target.role) return false;
        if (origin.availability !== 'available') return false;
      }
      const page = await this.port.publicRoleByHandle!(
        actor,
        target.roleHandle,
        this.readerQuery(target),
        { roleHandle: target.roleHandle, role: target.role },
      );
      const parsed = parseActorAwareRoleReputationSummary(page, {
        roleHandle: target.roleHandle,
        role: target.role,
      });
      if (readerGen !== this.publicReaderGen || surfaceGen !== this.publicSurfaceGen || !live()) return false;
      if (parsed.roleHandle !== target.roleHandle || parsed.role !== target.role) return false;
      if (!live()) return false;
      this.openPublicReader(target);
      return true;
    } catch {
      return false;
    }
  };
  openOwnPublicHistory = () => {
    if (!this.snapshot.actor) return;
    // Bump eligibility gen so a delayed resumed author open cannot overwrite this surface.
    this.publicEligibilityGen++; this.publicOwnGen++; this.publicSurfaceGen++; this.publicReaderGen++;
    this.show({
      publicSurface: { mode: 'history', target: null, reader: null, gen: this.publicSurfaceGen },
      publicOwn: { status: 'idle' },
      publicReader: { status: 'idle' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicReplyDrafts: {},
      publicReportDraft: null,
      publicReceipt: null,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      publicNotice: null,
    });
    void this.loadOwnPublicReviews();
  };
  /** Actor-aware public role reviews sheet — game or profile origin; no anonymous fallback. */
  openPublicReader = (target: PublicRoleReaderTarget) => {
    if (!this.snapshot.actor) return;
    // Bump eligibility gen so a delayed resumed author open cannot overwrite this surface.
    this.publicEligibilityGen++; this.publicReaderGen++; this.publicPreviewGen++; this.publicSurfaceGen++;
    this.publicReaderReplyFloor.clear();
    this.show({
      publicSurface: {
        mode: 'reader',
        target: null,
        reader: Object.freeze({
          ...target,
          origin: Object.freeze({ ...target.origin }),
        }),
        gen: this.publicSurfaceGen,
      },
      publicReader: { status: 'idle' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicReplyDrafts: {},
      publicReportDraft: null,
      publicConsentHash: null,
      publicReceipt: null,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      publicNotice: null,
    });
    void this.loadPublicReader();
  };
  closePublicSurface = () => {
    this.publicEligibilityGen++; this.publicOwnGen++; this.publicPreviewGen++; this.publicSurfaceGen++;
    this.publicReaderGen++;
    this.publicReaderReplyFloor.clear();
    this.show({
      publicSurface: null,
      publicEligibility: { status: 'idle' },
      publicOwn: { status: 'idle' },
      publicReader: { status: 'idle' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicDraft: null,
      publicReplyDrafts: {},
      publicReportDraft: null,
      publicConsentHash: null,
      publicReceipt: null,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      publicNotice: null,
    });
  };
  private readerQuery(reader: PublicRoleReaderTarget, extra: { cursor?: string; limit?: number } = {}) {
    return {
      ...(reader.origin.kind === 'game' ? { gameId: reader.origin.gameId } : {}),
      ...extra,
    };
  }
  private readerGameBind(reader: PublicRoleReaderTarget): string {
    return reader.origin.kind === 'game' ? reader.origin.gameId : 'public-role-profile';
  }
  private currentReaderItem(reviewHandle: string): ActorAwarePublicRoleReviewItem | null {
    const surface = this.snapshot.publicSurface;
    if (!surface || surface.mode !== 'reader' || !surface.reader) return null;
    if (this.snapshot.publicReader.status !== 'ready' || !this.snapshot.publicReader.data) return null;
    return this.snapshot.publicReader.data.items.find(i => i.reviewHandle === reviewHandle) ?? null;
  }
  loadPublicReader = async (opts?: { cursor?: string | null; append?: boolean; preserveNotice?: boolean }) => {
    const actor = this.snapshot.actor;
    const surface = this.snapshot.publicSurface;
    const reader = surface?.mode === 'reader' ? surface.reader : null;
    if (!actor || !reader) return;
    const preserveNotice = opts?.preserveNotice === true;
    const priorNotice = this.snapshot.publicNotice;
    const append = opts?.append === true;
    const cursor = opts?.cursor ?? null;
    if (append) {
      const prior = this.snapshot.publicReader;
      if (prior.status !== 'ready' || !prior.data?.nextCursor) return;
      if (!cursor || cursor !== prior.data.nextCursor) return;
      if (this.snapshot.publicReaderLoadingMore) return;
    }
    const gen = ++this.publicReaderGen;
    const surfaceGen = this.publicSurfaceGen;
    if (append) {
      this.show({
        publicReaderLoadingMore: true,
        publicReaderMoreError: false,
        ...(preserveNotice ? {} : { publicNotice: null }),
      });
    } else {
      this.show({
        publicReader: { status: 'loading', data: this.snapshot.publicReader.data },
        publicReaderLoadingMore: false,
        publicReaderMoreError: false,
        ...(preserveNotice ? {} : { publicNotice: null }),
      });
    }
    try {
      const page = await this.port.publicRoleByHandle(
        actor,
        reader.roleHandle,
        this.readerQuery(reader, {
          ...(cursor ? { cursor } : {}),
          limit: 20,
        }),
        { roleHandle: reader.roleHandle, role: reader.role },
      );
      const parsed = parseActorAwareRoleReputationSummary(page, {
        roleHandle: reader.roleHandle,
        role: reader.role,
      });
      if (gen !== this.publicReaderGen || surfaceGen !== this.publicSurfaceGen) return;
      if (!sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.publicSurface?.mode !== 'reader' || this.snapshot.publicSurface.reader?.roleHandle !== reader.roleHandle) {
        return;
      }
      if (parsed.roleHandle !== reader.roleHandle || parsed.role !== reader.role) {
        if (!append) this.publicPreviewGen++;
        this.show({
          publicReader: append ? this.snapshot.publicReader : { status: 'error' },
          publicReaderLoadingMore: false,
          publicReaderMoreError: append,
          publicNotice: preserveNotice && priorNotice ? priorNotice : 'Не удалось загрузить отзывы.',
          // Root mismatch loses read authority — retire consent/hash; keep draft text.
          ...(!append ? {
            publicReplyDrafts: Object.fromEntries(
              Object.entries(this.snapshot.publicReplyDrafts).map(([k, d]) => [k, { text: d.text, consent: false }]),
            ),
            publicConsentHash: null,
          } : {}),
        });
        return;
      }
      if (parsed.availability !== 'available') {
        this.publicPreviewGen++;
        this.show({
          publicReader: { status: 'unavailable', data: parsed },
          publicReaderLoadingMore: false,
          publicReaderMoreError: false,
          publicNotice: preserveNotice ? priorNotice : null,
          publicReplyDrafts: Object.fromEntries(
            Object.entries(this.snapshot.publicReplyDrafts).map(([k, d]) => [k, { text: d.text, consent: false }]),
          ),
          publicReportDraft: null,
          publicConsentHash: null,
        });
        return;
      }
      const prior = this.snapshot.publicReader.data;
      const items = append && prior
        ? (() => {
          const byHandle = new Map(prior.items.map(i => [i.reviewHandle, i] as const));
          const order = prior.items.map(i => i.reviewHandle);
          for (const item of parsed.items) {
            const existing = byHandle.get(item.reviewHandle);
            if (existing) {
              byHandle.set(item.reviewHandle, mergeActorAwareReaderItem(existing, item));
            } else {
              byHandle.set(item.reviewHandle, item);
              order.push(item.reviewHandle);
            }
          }
          return order.map(h => byHandle.get(h)!);
        })()
        : parsed.items;
      // Raise typed floors before consent retirement / receipt paint fences.
      for (const item of items) {
        const tipVer = item.subjectOwnReply?.version ?? 0;
        const nextFloor = Math.max(
          this.publicReaderReplyFloor.get(item.reviewHandle) ?? 0,
          item.replyAggregateVersion,
          tipVer,
        );
        this.publicReaderReplyFloor.set(item.reviewHandle, nextFloor);
      }
      const priorByHandle = new Map((prior?.items ?? []).map(i => [i.reviewHandle, i] as const));
      const replyDrafts = { ...this.snapshot.publicReplyDrafts };
      let retireConsentAuthority = false;
      for (const [handle, draft] of Object.entries(replyDrafts)) {
        const nextItem = items.find(i => i.reviewHandle === handle);
        const oldItem = priorByHandle.get(handle);
        // Missing oldItem = prior read was non-authoritative (error/unavailable) — cannot keep consent.
        const versionMoved = !!nextItem && (
          !oldItem
          || oldItem.publishedRevision !== nextItem.publishedRevision
          || oldItem.replyAggregateVersion !== nextItem.replyAggregateVersion
          || (oldItem.subjectOwnReply?.version ?? null) !== (nextItem.subjectOwnReply?.version ?? null)
        );
        const lostWrite = !nextItem?.allowedActions.canReply;
        if ((versionMoved || lostWrite) && (draft.consent || this.snapshot.publicConsentHash)) {
          replyDrafts[handle] = { text: draft.text, consent: false };
          retireConsentAuthority = true;
        }
      }
      if (retireConsentAuthority) this.publicPreviewGen++;
      const paintedReply = this.snapshot.publicReplyReceipt;
      // Retire when handle leaves the page, published revision moves (even if aggregate unchanged),
      // or typed reply aggregate/tip advances past the painted ACK.
      const retireReplyReceipt = !!paintedReply && (
        !items.some(i => i.reviewHandle === paintedReply.reviewHandle)
        || items.some(item =>
          item.reviewHandle === paintedReply.reviewHandle
          && (item.publishedRevision !== paintedReply.expectedReviewRevision
            || item.replyAggregateVersion > paintedReply.version
            || (item.subjectOwnReply?.version ?? 0) > paintedReply.version),
        )
      );
      const paintedReport = this.snapshot.publicReportReceipt;
      // Report receipt bound to original expectedRevision — newer published revision retires block.
      const retireReportReceipt = !!paintedReport && (
        !items.some(i => i.reviewHandle === paintedReport.reviewHandle)
        || items.some(item =>
          item.reviewHandle === paintedReport.reviewHandle
          && item.publishedRevision !== paintedReport.expectedRevision,
        )
      );
      const keepReplyNotice = preserveNotice && priorNotice === 'Ответ принят.';
      // Open report editor follows live row permission/revision — not an already-dispatched journal.
      const openReport = this.snapshot.publicReportDraft;
      const retireOpenReport = !!openReport && (() => {
        const liveRow = items.find(i => i.reviewHandle === openReport.reviewHandle);
        return !liveRow
          || !liveRow.allowedActions.canReport
          || liveRow.publishedRevision !== openReport.publishedRevision;
      })();
      // Page authority must not regress: later ACK cannot repaint over newer typed GET.
      this.show({
        publicReader: {
          status: 'ready',
          data: {
            ...parsed,
            items,
            nextCursor: parsed.nextCursor,
          },
        },
        publicReaderLoadingMore: false,
        publicReaderMoreError: false,
        publicNotice: preserveNotice ? priorNotice : null,
        ...(retireConsentAuthority ? {
          publicReplyDrafts: replyDrafts,
          publicConsentHash: null,
        } : {}),
        ...(retireReplyReceipt ? { publicReplyReceipt: null } : {}),
        ...(retireOpenReport ? { publicReportDraft: null } : {}),
        ...(retireReportReceipt ? { publicReportReceipt: null } : {}),
        ...(keepReplyNotice && retireReplyReceipt ? { publicNotice: priorNotice } : {}),
      });
    } catch (error) {
      if (gen !== this.publicReaderGen || surfaceGen !== this.publicSurfaceGen) return;
      if (!sameActor(actor, this.snapshot.actor)) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      const auth = error instanceof PostgameError && error.status === 401;
      if (denied || auth) this.publicPreviewGen++;
      if (denied || auth) {
        this.show({
          publicReader: { status: 'unavailable' },
          publicReaderLoadingMore: false,
          publicReaderMoreError: false,
          publicNotice: preserveNotice && priorNotice
            ? priorNotice
            : (auth ? 'Войдите снова, чтобы ответить или пожаловаться.' : 'Не удалось загрузить отзывы.'),
          publicReplyDrafts: Object.fromEntries(
            Object.entries(this.snapshot.publicReplyDrafts).map(([k, d]) => [k, { text: d.text, consent: false }]),
          ),
          publicReportDraft: null,
          publicConsentHash: null,
        });
        return;
      }
      if (append) {
        // Transient next-page failure: keep prior rows/ready authority and the failed cursor.
        this.show({
          publicReaderLoadingMore: false,
          publicReaderMoreError: true,
          publicNotice: preserveNotice && priorNotice ? priorNotice : 'Не удалось загрузить отзывы.',
        });
        return;
      }
      // Root read authority lost — retire consent/hash and in-flight preview; keep draft text.
      this.publicPreviewGen++;
      this.show({
        publicReader: { status: 'error' },
        publicReaderLoadingMore: false,
        publicReaderMoreError: false,
        publicNotice: preserveNotice && priorNotice ? priorNotice : 'Не удалось загрузить отзывы.',
        publicReplyDrafts: Object.fromEntries(
          Object.entries(this.snapshot.publicReplyDrafts).map(([k, d]) => [k, { text: d.text, consent: false }]),
        ),
        publicConsentHash: null,
      });
    }
  };
  patchPublicReplyDraft = (reviewHandle: string, patch: Partial<PublicRoleReplyDraft>) => {
    const surface = this.snapshot.publicSurface;
    if (!surface || surface.mode !== 'reader') return;
    // Owned-target receipt only blocks that row — other drafts stay editable.
    if (this.snapshot.publicReplyReceipt?.reviewHandle === reviewHandle) return;
    const item = this.currentReaderItem(reviewHandle);
    if (!item?.allowedActions.canReply) return;
    const prior = this.snapshot.publicReplyDrafts[reviewHandle] ?? { text: '', consent: false };
    const next = { ...prior, ...patch };
    if (patch.text !== undefined) next.consent = false;
    if (patch.text !== undefined) this.publicPreviewGen++;
    this.show({
      publicReplyDrafts: { ...this.snapshot.publicReplyDrafts, [reviewHandle]: next },
      ...(patch.text !== undefined ? { publicConsentHash: null } : {}),
    });
  };
  beginPublicReport = (
    item: ActorAwarePublicRoleReviewItem,
    expectedActor?: Actor | null,
    expectedSurfaceGen?: number,
  ) => {
    const actor = this.snapshot.actor;
    if (expectedActor !== undefined) {
      if (!actor || !expectedActor || !sameActor(expectedActor, actor)) return;
    }
    const surface = this.snapshot.publicSurface;
    if (!surface || surface.mode !== 'reader') return;
    if (expectedSurfaceGen !== undefined
      && (expectedSurfaceGen !== this.publicSurfaceGen || surface.gen !== expectedSurfaceGen)) {
      return;
    }
    const reportReceipt = this.snapshot.publicReportReceipt;
    // Same-revision receipt dedupes; a newer published revision may open a fresh report.
    if (reportReceipt?.reviewHandle === item.reviewHandle
      && reportReceipt.expectedRevision === item.publishedRevision) return;
    const live = this.currentReaderItem(item.reviewHandle);
    if (!live?.allowedActions.canReport) return;
    if (live.publishedRevision !== item.publishedRevision) return;
    if (reportReceipt?.reviewHandle === live.reviewHandle
      && reportReceipt.expectedRevision === live.publishedRevision) return;
    const open = this.snapshot.publicReportDraft;
    // Same-row repress keeps reason/explanation the user already edited.
    if (open
      && open.reviewHandle === live.reviewHandle
      && open.publishedRevision === live.publishedRevision) {
      this.show({ publicNotice: null });
      return;
    }
    this.show({
      publicReportDraft: {
        reviewHandle: live.reviewHandle,
        publishedRevision: live.publishedRevision,
        reasonCode: 'harassment',
        explanation: '',
      },
      publicNotice: null,
    });
  };
  patchPublicReportDraft = (patch: Partial<Pick<PublicRoleReportDraft, 'reasonCode' | 'explanation'>>) => {
    const draft = this.snapshot.publicReportDraft;
    if (!draft) return;
    const reportReceipt = this.snapshot.publicReportReceipt;
    if (reportReceipt?.reviewHandle === draft.reviewHandle
      && reportReceipt.expectedRevision === draft.publishedRevision) return;
    const live = this.currentReaderItem(draft.reviewHandle);
    if (!live?.allowedActions.canReport || live.publishedRevision !== draft.publishedRevision) return;
    this.show({ publicReportDraft: { ...draft, ...patch } });
  };
  cancelPublicReport = () => {
    // Dispatched report may still reach the server — do not present Cancel as erasure.
    const cmd = this.snapshot.command;
    if (cmd?.packet.kind === 'public-role-report') return;
    this.show({ publicReportDraft: null });
  };
  submitPublicReply = async (
    reviewHandle: string,
    expectedActor?: Actor | null,
    expectedSurfaceGen?: number,
  ) => {
    const actor = this.snapshot.actor;
    if (expectedActor !== undefined) {
      if (!actor || !expectedActor || !sameActor(expectedActor, actor)) return;
    }
    const surface = this.snapshot.publicSurface;
    const reader = surface?.mode === 'reader' ? surface.reader : null;
    if (expectedSurfaceGen !== undefined) {
      if (!surface || expectedSurfaceGen !== this.publicSurfaceGen || surface.gen !== expectedSurfaceGen) return;
    }
    const draft = this.snapshot.publicReplyDrafts[reviewHandle];
    const item = this.currentReaderItem(reviewHandle);
    if (!actor || !reader || !draft || !item) return;
    const ownedReceipt = this.snapshot.publicReplyReceipt?.reviewHandle === reviewHandle;
    if (this.snapshot.command || this.inFlight || ownedReceipt) {
      const cmd = this.snapshot.command;
      if (cmd?.status === 'unknown' && cmd.packet.kind === 'public-role-reply'
        && cmd.packet.actor.actorId === actor.actorId
        && cmd.packet.reviewHandle === reviewHandle) {
        this.show({ publicNotice: 'Ответ мог быть принят. Не отправляйте повторно.' });
      }
      return;
    }
    if (!item.allowedActions.canReply) {
      this.show({ publicNotice: 'Ответ сейчас недоступен. Обновите список отзывов.' });
      return;
    }
    if (!draft.consent) {
      this.show({ publicNotice: 'Отметьте согласие с публичной публикацией ответа.' });
      return;
    }
    let text: string;
    try { text = publicRoleReviewText(draft.text); } catch {
      this.show({ publicNotice: 'Проверьте текст ответа.' });
      return;
    }
    const editor = `reply:${reviewHandle}:${item.replyAggregateVersion}:${item.publishedRevision}:${text}`;
    const previewGen = ++this.publicPreviewGen;
    const surfaceGen = this.publicSurfaceGen;
    const readerGen = this.publicReaderGen;
    try {
      const previewBody = replyConsentPreviewBody({ reviewHandle, text });
      const preview = parseConsentPreview(await this.port.publicConsentPreview(actor, previewBody));
      if (previewGen !== this.publicPreviewGen || surfaceGen !== this.publicSurfaceGen || readerGen !== this.publicReaderGen) return;
      if (!sameActor(actor, this.snapshot.actor)) return;
      const liveSurface = this.snapshot.publicSurface;
      const liveReader = liveSurface?.mode === 'reader' ? liveSurface.reader : null;
      const liveItem = this.currentReaderItem(reviewHandle);
      const liveDraft = this.snapshot.publicReplyDrafts[reviewHandle];
      if (!liveReader || !liveItem || !liveDraft?.consent
        || liveReader.roleHandle !== reader.roleHandle
        || liveReader.role !== reader.role
        || !liveItem.allowedActions.canReply
        || liveItem.replyAggregateVersion !== item.replyAggregateVersion
        || liveItem.publishedRevision !== item.publishedRevision
        || liveItem.subjectOwnReply?.version !== item.subjectOwnReply?.version) {
        this.show({ publicNotice: 'Проверьте выбранные данные и обновите отзывы.' });
        return;
      }
      try {
        if (publicRoleReviewText(liveDraft.text) !== text) {
          this.show({ publicNotice: 'Текст изменился. Заново подтвердите согласие с текущей версией.' });
          return;
        }
      } catch {
        this.show({ publicNotice: 'Проверьте текст ответа.' });
        return;
      }
      this.show({ publicConsentHash: preview.consentProjectionHash });
      const body = buildPublicReplyBody({
        expectedVersion: liveItem.replyAggregateVersion,
        expectedReviewRevision: liveItem.publishedRevision,
        text,
        consentProjectionHash: preview.consentProjectionHash,
      });
      const intent: Intent = {
        kind: 'public-role-reply',
        gameId: this.readerGameBind(liveReader),
        reviewHandle: liveItem.reviewHandle,
        body,
      };
      await this.submitPublicRole(intent, {
        surfaceGen, editor, roleHandle: liveReader.roleHandle, role: liveReader.role,
        gameId: this.readerGameBind(liveReader), reviewHandle: liveItem.reviewHandle,
        origin: liveReader.origin,
      });
    } catch (error) {
      if (previewGen !== this.publicPreviewGen || surfaceGen !== this.publicSurfaceGen || !sameActor(actor, this.snapshot.actor)) return;
      // Same private-port hard denial as mutation: cannot leave typed write authority after confirmed access loss.
      if (this.isHardAuthorizationDenial(error)) {
        this.retireOwnedPublicReaderAuthority(error);
        return;
      }
      const business = error instanceof PostgameError && error.kind === 'business';
      this.show({
        publicConsentHash: null,
        publicNotice: business
          ? publicRoleReplyBusinessNotice(error instanceof PostgameError ? error.code : undefined)
          : 'Не удалось подготовить согласие.',
      });
    }
  };
  submitPublicReport = async (
    expectedActor?: Actor | null,
    expectedSurfaceGen?: number,
  ) => {
    const actor = this.snapshot.actor;
    if (expectedActor !== undefined) {
      if (!actor || !expectedActor || !sameActor(expectedActor, actor)) return;
    }
    const surface = this.snapshot.publicSurface;
    const reader = surface?.mode === 'reader' ? surface.reader : null;
    if (expectedSurfaceGen !== undefined) {
      if (!surface || expectedSurfaceGen !== this.publicSurfaceGen || surface.gen !== expectedSurfaceGen) return;
    }
    const draft = this.snapshot.publicReportDraft;
    if (!actor || !reader || !draft) return;
    const paintedReport = this.snapshot.publicReportReceipt;
    const ownedReceipt = paintedReport?.reviewHandle === draft.reviewHandle
      && paintedReport.expectedRevision === draft.publishedRevision;
    if (this.snapshot.command || this.inFlight || ownedReceipt) {
      const cmd = this.snapshot.command;
      if (cmd?.status === 'unknown' && cmd.packet.kind === 'public-role-report'
        && cmd.packet.actor.actorId === actor.actorId
        && cmd.packet.reviewHandle === draft.reviewHandle) {
        this.show({ publicNotice: 'Жалоба могла быть принята. Не отправляйте повторно с тем же ключом.' });
      }
      return;
    }
    const item = this.currentReaderItem(draft.reviewHandle);
    if (!item?.allowedActions.canReport || item.publishedRevision !== draft.publishedRevision) {
      this.show({ publicNotice: 'Жалоба сейчас недоступна. Обновите список отзывов.' });
      return;
    }
    let body;
    try {
      body = buildPublicReportBody({
        expectedRevision: item.publishedRevision,
        reasonCode: draft.reasonCode,
        explanation: draft.explanation.trim() || undefined,
      });
    } catch {
      this.show({ publicNotice: 'Проверьте причину и пояснение.' });
      return;
    }
    const surfaceGen = this.publicSurfaceGen;
    const editor = `report:${item.reviewHandle}:${item.publishedRevision}`;
    const intent: Intent = {
      kind: 'public-role-report',
      gameId: this.readerGameBind(reader),
      reviewHandle: item.reviewHandle,
      body,
      gameQuery: reader.origin.kind === 'game' ? reader.origin.gameId : null,
    };
    await this.submitPublicRole(intent, {
      surfaceGen, editor, roleHandle: reader.roleHandle, role: reader.role,
      gameId: this.readerGameBind(reader), reviewHandle: item.reviewHandle,
      origin: reader.origin,
    });
  };
  patchPublicDraft = (patch: Partial<PublicRoleDraft>) => {
    const surface = this.snapshot.publicSurface;
    const prior = this.snapshot.publicDraft;
    if (!surface || surface.mode !== 'composer' || !prior || this.snapshot.publicReceipt) return;
    const next: PublicRoleDraft = { ...prior, ...patch };
    if (patch.text !== undefined) next.textDirty = true;
    // Consent resets on text/topics/audience/game/role/subject/session (session via setActor).
    const consentSensitive =
      patch.text !== undefined || patch.topics !== undefined || patch.audience !== undefined
      || patch.gameId !== undefined;
    if (consentSensitive) {
      next.consent = false;
      this.publicPreviewGen++;
      this.show({ publicDraft: next, publicConsentHash: null, publicNotice: null });
      return;
    }
    this.show({ publicDraft: next });
  };
  /**
   * Retire in-flight consent preview / hash when eligibility authority is reread or lost.
   * Preserves dirty text/topics/game intent; does not autosend or rebase.
   */
  private retirePublicConsentAuthority(patch: Partial<Snapshot> = {}) {
    this.publicPreviewGen++;
    const draft = patch.publicDraft !== undefined ? patch.publicDraft : this.snapshot.publicDraft;
    this.show({
      ...patch,
      publicDraft: draft ? { ...draft, consent: false } : draft ?? null,
      publicConsentHash: null,
    });
  }
  /** Port private or HTTP 401/403/404 — hard authorization denial (not ordinary business 409/422). */
  private isHardAuthorizationDenial(error: unknown): boolean {
    return error instanceof PostgameError
      && (error.kind === 'private'
        || error.status === 401
        || error.status === 403
        || error.status === 404);
  }
  private hardAuthorizationPublicNotice(error: unknown): string {
    return error instanceof PostgameError && error.status === 401
      ? 'Войдите снова, чтобы ответить или пожаловаться.'
      : 'Не удалось загрузить отзывы.';
  }
  /**
   * Hard auth denial on reply/report (or matching consent-preview): retire only the currently
   * owned reader private projection/write authority. Caller keeps UNKNOWN journal separately.
   * Bumps reader gen so a late pending GET cannot resurrect denied private page/permissions.
   */
  private retireOwnedPublicReaderAuthority(error: unknown, patch: Partial<Snapshot> = {}) {
    this.publicPreviewGen++;
    this.publicReaderGen++;
    this.show({
      publicReader: { status: 'unavailable' },
      publicReaderLoadingMore: false,
      publicReaderMoreError: false,
      publicNotice: this.hardAuthorizationPublicNotice(error),
      publicReplyDrafts: Object.fromEntries(
        Object.entries(this.snapshot.publicReplyDrafts).map(([k, d]) => [k, { text: d.text, consent: false }]),
      ),
      publicReportDraft: null,
      publicConsentHash: null,
      publicReplyReceipt: null,
      publicReportReceipt: null,
      ...patch,
    });
  }
  /**
   * @param opts.preserveNotice Keep actionable business rejection (e.g. after 422 reread/reconsent).
   * Manual refresh omits this and may clear a stale notice on success.
   */
  loadPublicEligibility = async (opts?: { preserveNotice?: boolean }) => {
    const actor = this.snapshot.actor;
    const target = this.snapshot.publicSurface?.mode === 'composer' ? this.snapshot.publicSurface.target : null;
    if (!actor || !target) return;
    const preserveNotice = opts?.preserveNotice === true;
    const priorNotice = this.snapshot.publicNotice;
    const gen = ++this.publicEligibilityGen;
    const preferred = this.snapshot.publicDraft?.gameId || target.gameId;
    // Authoritative reread retires outstanding preview/consent immediately — failure must not
    // leave a deferred preview able to create on a captured basis.
    this.retirePublicConsentAuthority({
      publicEligibility: { status: 'loading', data: this.snapshot.publicEligibility.data },
    });
    try {
      const data = parseOwnEligibility(await this.port.publicEligibility(actor, target.roleHandle), target.roleHandle);
      if (gen !== this.publicEligibilityGen || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.publicSurface?.target?.roleHandle !== target.roleHandle) return;
      if (data.role !== target.role) {
        this.retirePublicConsentAuthority({
          publicEligibility: { status: 'error' },
          publicNotice: preserveNotice && priorNotice
            ? priorNotice
            : 'Роль не совпала с карточкой. Обновите отзывы.',
        });
        return;
      }
      const frozen = this.snapshot.publicSurface?.mode === 'composer'
        ? this.snapshot.publicSurface.resumeFrozenGameId
        : undefined;
      if (frozen) {
        // Resumed cold author: never silent-fallback to another eligible game.
        if (!eligibleBases(data).some(b => b.gameId === frozen)) {
          const kept = this.snapshot.publicDraft ?? emptyPublicRoleDraft(frozen);
          this.retirePublicConsentAuthority({
            publicEligibility: { status: 'unavailable' },
            publicDraft: { ...kept, gameId: frozen, consent: false },
            publicNotice: preserveNotice && priorNotice
              ? priorNotice
              : 'Нет подтверждённой встречи для публичного отзыва по этой роли.',
          });
          return;
        }
        const draft = this.snapshot.publicDraft ?? emptyPublicRoleDraft(frozen);
        this.retirePublicConsentAuthority({
          publicEligibility: { status: 'ready', data },
          publicDraft: { ...draft, gameId: frozen, consent: false },
          publicNotice: preserveNotice ? priorNotice : null,
        });
        return;
      }
      const gameId = pickPreferredGameId(data, preferred);
      const draft = this.snapshot.publicDraft ?? emptyPublicRoleDraft(gameId);
      const nextDraft: PublicRoleDraft = {
        ...draft,
        gameId: draft.textDirty || draft.audience !== 'personal' || draft.topics.length
          ? (eligibleBases(data).some(b => b.gameId === draft.gameId) ? draft.gameId : gameId)
          : gameId,
        consent: false,
      };
      const empty = !eligibleBases(data).length;
      this.retirePublicConsentAuthority({
        publicEligibility: { status: 'ready', data },
        publicDraft: nextDraft,
        publicNotice: empty
          ? (preserveNotice && priorNotice
            ? priorNotice
            : 'Нет подтверждённой встречи для публичного отзыва по этой роли.')
          : (preserveNotice ? priorNotice : null),
      });
    } catch (error) {
      if (gen !== this.publicEligibilityGen || !sameActor(actor, this.snapshot.actor)) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      const auth = error instanceof PostgameError && error.status === 401;
      this.retirePublicConsentAuthority({
        publicEligibility: denied || auth ? { status: 'unavailable' } : { status: 'error' },
        publicNotice: preserveNotice && priorNotice
          ? priorNotice
          : (auth ? 'Войдите снова, чтобы продолжить.' : 'Не удалось загрузить список встреч.'),
      });
    }
  };
  /**
   * @param opts.preserveNotice Keep actionable withdraw/command business rejection through its
   * owning follow-up own-list GET (mirrors create eligibility preserveNotice). Manual refresh omits this.
   */
  loadOwnPublicReviews = async (opts?: { preserveNotice?: boolean }) => {
    const actor = this.snapshot.actor;
    if (!actor) return;
    const preserveNotice = opts?.preserveNotice === true;
    const priorNotice = this.snapshot.publicNotice;
    const gen = ++this.publicOwnGen;
    this.show({ publicOwn: { status: 'loading', data: this.snapshot.publicOwn.data } });
    try {
      const page = parseOwnPublicRoleReviewsPage(await this.port.publicOwnReviews(actor));
      if (gen !== this.publicOwnGen || !sameActor(actor, this.snapshot.actor)) return;
      this.publicOwnDenied = false;
      const priorById = new Map((this.snapshot.publicOwn.data?.items ?? []).map(item => [item.id, item]));
      const merged: OwnPublicRoleReview[] = [];
      for (const incoming of page.items) {
        const floor = this.publicOwnVersionFloor.get(incoming.id) ?? 0;
        const prior = priorById.get(incoming.id);
        const next = mergeOwnPublicReviewItem(prior, incoming, floor);
        if (!next) {
          if (prior && (prior.version >= floor)) merged.push(retireOwnPublicReviewText(prior));
          continue;
        }
        this.publicOwnVersionFloor.set(next.id, Math.max(floor, next.version));
        this.publicOwnAwaitingTyped.delete(next.id);
        merged.push(next);
      }
      // Keep terminal local rows missing from a partial/stale page while awaiting typed catch-up.
      for (const [id, prior] of priorById) {
        if (merged.some(item => item.id === id)) continue;
        if (this.publicOwnAwaitingTyped.has(id) && (prior.status === 'withdrawn' || prior.status === 'removed')) {
          merged.push(retireOwnPublicReviewText(prior));
        }
      }
      // Newer typed GET retires stale receipt + matching confirmation (no resurrection).
      // Current withdraw/command confirmation survives ordinary/stale/same-version list refresh;
      // owning follow-up after business rejection keeps that notice; unrelated manual refresh clears.
      const painted = this.snapshot.publicReceipt;
      const retireReceipt = !!painted && merged.some(
        item => item.id === painted.id && item.version > painted.version,
      );
      const keepConfirm = !retireReceipt && !!painted && (
        (painted.status === 'withdrawn' && priorNotice === 'Отзыв отозван.')
        || (painted.status !== 'withdrawn' && priorNotice === 'Команда принята.')
      );
      const keepNotice = keepConfirm || (preserveNotice && !!priorNotice);
      this.show({
        publicOwn: { status: 'ready', data: { items: merged } },
        publicNotice: keepNotice ? priorNotice : null,
        ...(retireReceipt ? { publicReceipt: null } : {}),
      });
    } catch (error) {
      if (gen !== this.publicOwnGen || !sameActor(actor, this.snapshot.actor)) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      const auth = error instanceof PostgameError && error.status === 401;
      if (denied || (error instanceof PostgameError && (error.status === 403 || error.status === 404))) {
        this.publicOwnDenied = true;
        this.publicOwnAwaitingTyped.clear();
      }
      this.show({
        publicOwn: denied || auth ? { status: 'unavailable' } : { status: 'error' },
        publicNotice: preserveNotice && priorNotice
          ? priorNotice
          : (auth ? 'Войдите, чтобы увидеть свои отзывы о ролях.' : 'Не удалось загрузить.'),
      });
    }
  };
  /**
   * Public create: consent-preview then mutate via the single command journal.
   * Never autosends on login/session refresh; UNKNOWN repeats only original key/body.
   */
  submitPublicCreate = async () => {
    const actor = this.snapshot.actor;
    const surface = this.snapshot.publicSurface;
    const draft = this.snapshot.publicDraft;
    const eligibility = this.snapshot.publicEligibility.status === 'ready'
      ? this.snapshot.publicEligibility.data ?? null
      : null;
    if (!actor || !surface || surface.mode !== 'composer' || !surface.target || !draft || !eligibility) return;
    if (this.snapshot.command || this.inFlight || this.writePrepare || this.snapshot.publicReceipt) {
      const cmd = this.snapshot.command;
      if (cmd?.status === 'unknown' && cmd.packet.kind === 'public-role-create'
        && cmd.packet.actor.actorId === actor.actorId) {
        this.show({ publicNotice: 'Отзыв мог быть принят. Проверьте «Мои публичные отзывы о ролях».' });
      }
      return;
    }
    if (draft.audience !== 'public') {
      this.show({ publicNotice: 'Личное сообщение организатору/тренеру остаётся в приватной обратной связи игры. Здесь публикуется только публичный отзыв о роли.' });
      return;
    }
    if (!draft.consent) {
      this.show({ publicNotice: 'Отметьте согласие с публичной публикацией.' });
      return;
    }
    const basis = eligibleBases(eligibility).find(b => b.gameId === draft.gameId);
    if (!basis) {
      this.show({ publicNotice: 'Выберите свою подтверждённую встречу из списка допуска.' });
      return;
    }
    let text: string;
    try { text = publicRoleReviewText(draft.text); } catch {
      this.show({ publicNotice: 'Проверьте текст отзыва.' });
      return;
    }
    const editor = draftEditorKey(draft, surface.target.roleHandle, surface.target.role);
    const previewGen = ++this.publicPreviewGen;
    const surfaceGen = this.publicSurfaceGen;
    const previewKey = publicReadGenerationKey({
      actorId: actor.actorId, sessionId: actor.sessionId,
      roleHandle: surface.target.roleHandle, role: surface.target.role,
      gameId: draft.gameId, editor,
    });
    try {
      const body = consentPreviewBody({
        role: surface.target.role,
        subjectRoleHandle: surface.target.roleHandle,
        text,
        topics: draft.topics,
      });
      const preview = parseConsentPreview(await this.port.publicConsentPreview(actor, body));
      if (previewGen !== this.publicPreviewGen || surfaceGen !== this.publicSurfaceGen || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.publicSurface?.target?.roleHandle !== surface.target.roleHandle) return;
      if (draftEditorKey(this.snapshot.publicDraft ?? draft, surface.target.roleHandle, surface.target.role) !== editor) return;
      void previewKey;
      // Recheck CURRENT ready eligibility/target/basis versions/consent — never create on
      // retired authority or silently rebase the captured packet onto a newer basis.
      const liveSurface = this.snapshot.publicSurface;
      const liveDraft = this.snapshot.publicDraft;
      const liveElig = this.snapshot.publicEligibility.status === 'ready'
        ? this.snapshot.publicEligibility.data ?? null
        : null;
      const liveTarget = liveSurface?.mode === 'composer' ? liveSurface.target : null;
      const liveBasis = liveElig && liveDraft
        ? eligibleBases(liveElig).find(b => b.gameId === liveDraft.gameId)
        : undefined;
      if (!liveDraft?.consent || !liveElig || !liveTarget || !liveBasis
        || liveTarget.roleHandle !== surface.target.roleHandle
        || liveTarget.role !== surface.target.role
        || liveBasis.gameId !== basis.gameId
        || liveBasis.role !== basis.role
        || liveBasis.proofVersion !== basis.proofVersion
        || liveBasis.outcomeVersion !== basis.outcomeVersion
        || liveBasis.attendanceVersion !== basis.attendanceVersion) {
        this.retirePublicConsentAuthority({
          publicNotice: 'Проверьте выбранные данные и обновите допуск.',
        });
        return;
      }
      this.show({ publicConsentHash: preview.consentProjectionHash });
      const createBody = buildPublicCreateBody({
        basis: liveBasis, role: liveTarget.role, text, topics: liveDraft.topics,
        consentProjectionHash: preview.consentProjectionHash,
      });
      const intent: Intent = {
        kind: 'public-role-create',
        gameId: liveBasis.gameId,
        roleHandle: liveTarget.roleHandle,
        body: createBody,
      };
      await this.submitPublicRole(intent, {
        surfaceGen, editor, roleHandle: liveTarget.roleHandle, role: liveTarget.role, gameId: liveBasis.gameId,
      });
    } catch (error) {
      if (previewGen !== this.publicPreviewGen || surfaceGen !== this.publicSurfaceGen || !sameActor(actor, this.snapshot.actor)) return;
      const business = error instanceof PostgameError && error.kind === 'business';
      this.show({
        publicConsentHash: null,
        publicNotice: business
          ? publicRoleBusinessNotice(error instanceof PostgameError ? error.code : undefined, 'preview')
          : 'Не удалось подготовить согласие.',
      });
    }
  };
  /**
   * Withdraw from the CURRENT history surface + ready typed row.
   * UI must pass the rendered actor/session and surface gen captured at press —
   * never rebind a retired row onto a rotated account or closed/replaced surface.
   */
  withdrawOwnPublic = async (
    item: OwnPublicRoleReview,
    expectedActor: Actor | null,
    expectedSurfaceGen: number,
  ) => {
    const actor = this.snapshot.actor;
    if (!actor || !expectedActor || !sameActor(expectedActor, actor)) return;
    if (this.snapshot.command || this.inFlight || this.writePrepare) return;
    if (this.publicOwnDenied) return;
    const surface = this.snapshot.publicSurface;
    if (!surface || surface.mode !== 'history') return;
    if (expectedSurfaceGen !== this.publicSurfaceGen || surface.gen !== expectedSurfaceGen) return;
    if (this.snapshot.publicOwn.status !== 'ready') return;
    const live = this.snapshot.publicOwn.data?.items.find(row => row.id === item.id);
    if (!live) return;
    if (live.version !== item.version || live.role !== item.role || live.roleHandle !== item.roleHandle) return;
    if (!mayWithdrawOwnPublic(live)) return;
    try {
      const body = buildPublicWithdrawBody(live);
      const intent: Intent = {
        kind: 'public-role-command',
        gameId: 'public-role-own',
        reviewId: live.id,
        body,
      };
      await this.submitPublicRole(intent, {
        surfaceGen: expectedSurfaceGen,
        editor: `withdraw:${live.id}:${live.version}`,
        roleHandle: live.roleHandle || 'own',
        role: live.role,
        gameId: 'public-role-own',
        reviewId: live.id,
      });
    } catch {
      this.show({ publicNotice: 'Не удалось отозвать. Обновите список.' });
    }
  };
  /** Direct mutate — public sheet owns confirm; never sets private review/CommandReview. */
  submitPublicRole = async (
    intent: Extract<Intent, {
      kind: 'public-role-create' | 'public-role-command' | 'public-role-reply' | 'public-role-report';
    }>,
    bind?: {
      surfaceGen: number; editor: string; roleHandle: string; role: string; gameId: string;
      reviewId?: string; reviewHandle?: string; origin?: PublicRoleReaderOrigin;
    },
  ) => {
    const actor = this.snapshot.actor;
    if (!actor || this.snapshot.command || this.inFlight || this.writePrepare) return;
    try {
      const transport = wire(intent);
      const packet: Packet = Object.freeze({
        ...freezeIntent(intent),
        method: transport.method,
        path: transport.path,
        actor: Object.freeze({ ...actor }),
        key: this.random(),
      }) as Packet;
      const origin = bind?.origin
        ?? ((intent.kind === 'public-role-reply' || intent.kind === 'public-role-report')
          && this.snapshot.publicSurface?.mode === 'reader'
          && this.snapshot.publicSurface.reader
          ? this.snapshot.publicSurface.reader.origin
          : undefined);
      this.publicMutationBind = {
        surfaceGen: bind?.surfaceGen ?? this.publicSurfaceGen,
        actorId: actor.actorId,
        sessionId: actor.sessionId,
        roleHandle: bind?.roleHandle ?? (intent.kind === 'public-role-create' ? intent.roleHandle : 'own'),
        role: bind?.role ?? '',
        gameId: bind?.gameId ?? intent.gameId,
        editor: bind?.editor ?? '',
        kind: intent.kind,
        ...(bind?.reviewId ? { reviewId: bind.reviewId } : intent.kind === 'public-role-command' ? { reviewId: intent.reviewId } : {}),
        ...(bind?.reviewHandle
          ? { reviewHandle: bind.reviewHandle }
          : (intent.kind === 'public-role-reply' || intent.kind === 'public-role-report')
            ? { reviewHandle: intent.reviewHandle }
            : {}),
        ...(origin
          ? {
            origin: origin.kind === 'game'
              ? { kind: 'game' as const, gameId: origin.gameId }
              : { kind: 'profile' as const, publicPlayerId: origin.publicPlayerId },
          }
          : {}),
      };
      await this.dispatch(packet, actor, false);
    } catch {
      this.publicMutationBind = null;
      this.show({ publicNotice: 'Проверьте выбранные данные и обновите допуск.' });
    }
  };
  /** Whether the live surface still matches the original dispatch ownership (gen checked separately). */
  private publicMutationSurfaceMatches(
    surface: NonNullable<Snapshot['publicSurface']>,
    bind: PublicMutationBind,
  ): boolean {
    if (bind.kind === 'public-role-create') {
      return surface.mode === 'composer' && !!surface.target
        && surface.target.roleHandle === bind.roleHandle
        && surface.target.role === bind.role;
    }
    if (bind.kind === 'public-role-command') {
      return surface.mode === 'history';
    }
    if (bind.kind === 'public-role-reply' || bind.kind === 'public-role-report') {
      if (surface.mode !== 'reader' || !surface.reader) return false;
      if (surface.reader.roleHandle !== bind.roleHandle || surface.reader.role !== bind.role) return false;
      if (bind.origin && !samePublicReaderOrigin(surface.reader.origin, bind.origin)) return false;
      return true;
    }
    return false;
  }
  private publicMutationUiCurrent(packet: Packet): boolean {
    const bind = this.publicMutationBind;
    const actor = this.snapshot.actor;
    if (!bind || !actor || bind.kind !== packet.kind) return false;
    // Original packet actorId must match; session may rotate on same-actor reauth.
    if (bind.actorId !== packet.actor.actorId || bind.actorId !== actor.actorId) return false;
    if (bind.sessionId !== actor.sessionId) return false;
    if (bind.surfaceGen !== this.publicSurfaceGen) return false;
    const surface = this.snapshot.publicSurface;
    if (!surface || surface.gen !== bind.surfaceGen) return false;
    if (!this.publicMutationSurfaceMatches(surface, bind)) return false;
    if (packet.kind === 'public-role-create') {
      if (surface.mode !== 'composer' || !surface.target) return false;
      if (packet.roleHandle !== surface.target.roleHandle || packet.body.role !== surface.target.role) return false;
      const draft = this.snapshot.publicDraft;
      if (!draft || draft.audience !== 'public' || draft.gameId !== packet.body.gameId) return false;
      try {
        if (publicRoleReviewText(draft.text) !== packet.body.text) return false;
      } catch {
        return false;
      }
      if (draft.topics.length !== packet.body.topics.length) return false;
      if (draft.topics.some((topic, index) => topic !== packet.body.topics[index])) return false;
      return true;
    }
    if (packet.kind === 'public-role-reply' || packet.kind === 'public-role-report') {
      if (packet.reviewHandle !== bind.reviewHandle) return false;
      return true;
    }
    return true;
  }
  reconcilePublic = async () => {
    const { actor, command } = this.snapshot;
    if (!actor || !command || command.status !== 'unknown' || this.inFlight) return;
    if (!isPublicRolePacketKind(command.packet.kind)) return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    if (postgameIdempotencyReplayBlocked(command.firstDispatchedAt)) {
      this.show({
        command: {
          packet: command.packet,
          status: 'unknown',
          ...(command.firstDispatchedAt !== undefined
            ? { firstDispatchedAt: command.firstDispatchedAt }
            : {}),
        },
        publicNotice: POSTGAME_RETENTION_EXPIRED_NOTICE,
      });
      return;
    }
    await this.dispatch(command.packet, actor, true);
  };
  /** Probe exact current-game venue eligibility without opening the composer. */
  probeVenueEligibility = (gameId: string, venueId: string) => {
    const actor = this.snapshot.actor;
    if (!actor || !isVenueId(venueId)) return;
    try { postgameId(gameId); } catch { return; }
    const normalized = venueId.toLowerCase();
    const prior = this.snapshot.venueProbe;
    if (prior?.gameId === gameId && prior.venueId === normalized
      && this.snapshot.venueEligibility.status === 'loading') {
      return;
    }
    this.show({
      venueProbe: { gameId, venueId: normalized },
      venueEligibility: { status: 'loading' },
      ...(this.snapshot.venueExperience ? {} : { venueNotice: null }),
    });
    void this.loadVenueEligibility();
  };
  /** Exact current-game venue experience — hide when eligibility is not may_submit for this game. */
  openVenueExperience = (gameId: string, venueId: string) => {
    const actor = this.snapshot.actor;
    if (!actor || !isVenueId(venueId)) return;
    try { postgameId(gameId); } catch { return; }
    const normalized = venueId.toLowerCase();
    const cmd = this.snapshot.command;
    const pendingSame = !!cmd && isVenueExperiencePacketKind(cmd.packet.kind)
      && cmd.packet.actor.actorId === actor.actorId
      && cmd.packet.gameId === gameId
      && cmd.packet.venueId === normalized;
    // Competing journal / prepare blocks fresh open; same-origin UNKNOWN/sending may reopen read-only.
    if ((this.snapshot.command || this.inFlight || this.writePrepare) && !pendingSame) return;
    const gen = ++this.venueSurfaceGen;
    this.venuePreviewGen++;
    if (pendingSame && cmd) {
      const body = cmd.packet.body;
      this.show({
        venueProbe: { gameId, venueId: normalized },
        venueExperience: { gameId, venueId: normalized, gen },
        venueDraft: {
          audience: body.audience,
          text: body.text,
          topics: [...body.topics],
          consent: false,
        },
        venueConsentHash: null,
        venueReceipt: null,
        venueNotice: null,
        venueEligibility: { status: 'loading' },
      });
      void this.loadVenueEligibility();
      return;
    }
    this.show({
      venueProbe: { gameId, venueId: normalized },
      venueExperience: { gameId, venueId: normalized, gen },
      venueDraft: emptyVenueExperienceDraft(),
      venueConsentHash: null,
      venueReceipt: null,
      venueNotice: null,
      venueEligibility: { status: 'loading' },
    });
    void this.loadVenueEligibility();
  };
  /** Hide composer during sending/UNKNOWN without dropping immutable journal or rotating key/age. */
  closeVenueExperience = () => {
    const priorSurfaceGen = this.snapshot.venueExperience?.gen;
    this.venueSurfaceGen++;
    this.venuePreviewGen++;
    // Invalidate venue prepare owned by the surface we just hid — never clear a newer reservation.
    if (this.writePrepare?.origin === 'venue-experience'
      && priorSurfaceGen !== undefined
      && this.writePrepare.surfaceGen === priorSurfaceGen
      && this.writePrepare.gen === this.writePrepareGen) {
      this.writePrepare = null;
    }
    this.show({
      venueExperience: null,
      venueDraft: null,
      venueConsentHash: null,
      venueReceipt: null,
      venueNotice: null,
    });
  };
  /**
   * @param opts.preserveNotice Keep actionable venue business rejection through its automatic
   * follow-up eligibility GET (mirrors public create eligibility preserveNotice). Manual refresh omits this.
   */
  loadVenueEligibility = async (opts?: { preserveNotice?: boolean }) => {
    const actor = this.snapshot.actor;
    const probe = this.snapshot.venueProbe;
    const surface = this.snapshot.venueExperience;
    const target = surface ?? (probe ? { ...probe, gen: 0 } : null);
    if (!actor || !target) return;
    const preserveNotice = opts?.preserveNotice === true;
    const priorNotice = this.snapshot.venueNotice;
    const request = ++this.venueEligibilityGen;
    const venueId = target.venueId;
    const gameId = target.gameId;
    const surfaceGen = surface?.gen;
    this.show({ venueEligibility: { status: 'loading' } });
    try {
      const raw = await this.port.venueExperienceEligibility(actor, venueId);
      if (request !== this.venueEligibilityGen || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.venueProbe?.venueId !== venueId || this.snapshot.venueProbe?.gameId !== gameId) return;
      if (surfaceGen !== undefined && this.snapshot.venueExperience?.gen !== surfaceGen) return;
      const data = parseOwnVenueEligibility(raw);
      // Successful automatic reread must not erase conclusive business / newer user notice or touch draft.
      const liveNotice = this.snapshot.venueNotice;
      this.show({
        venueEligibility: { status: 'ready', data },
        venueNotice: preserveNotice ? (liveNotice ?? priorNotice) : null,
      });
    } catch (error) {
      if (request !== this.venueEligibilityGen || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.venueProbe?.venueId !== venueId || this.snapshot.venueProbe?.gameId !== gameId) return;
      if (surfaceGen !== undefined && this.snapshot.venueExperience?.gen !== surfaceGen) return;
      const denied = error instanceof PostgameError && (error.kind === 'private' || error.status === 401);
      const liveNotice = this.snapshot.venueNotice;
      this.show({
        venueEligibility: { status: denied ? 'unavailable' : 'error' },
        venueNotice: preserveNotice
          ? (liveNotice ?? priorNotice)
          : (denied ? 'Войдите, чтобы поделиться опытом площадки.' : 'Не удалось проверить допуск по этой игре.'),
      });
    }
  };
  patchVenueDraft = (patch: Partial<VenueExperienceDraft>) => {
    const surface = this.snapshot.venueExperience;
    const draft = this.snapshot.venueDraft;
    if (!surface || !draft || this.snapshot.command || this.inFlight || this.snapshot.venueReceipt) return;
    const next: VenueExperienceDraft = {
      audience: patch.audience ?? draft.audience,
      text: patch.text ?? draft.text,
      topics: patch.topics ? [...patch.topics] : [...draft.topics],
      consent: patch.consent ?? draft.consent,
    };
    const cleared = next.audience !== draft.audience
      || next.text !== draft.text
      || next.topics.join(',') !== draft.topics.join(',')
      || (patch.consent === false);
    if (cleared) {
      this.venuePreviewGen++;
      next.consent = patch.consent === true ? true : false;
      this.show({ venueDraft: next, venueConsentHash: null });
      return;
    }
    this.show({ venueDraft: next });
  };
  ensureVenueConsentPreview = async (): Promise<string | null> => {
    const actor = this.snapshot.actor;
    const surface = this.snapshot.venueExperience;
    const draft = this.snapshot.venueDraft;
    if (!actor || !surface || !draft || draft.audience !== 'public_venue') return null;
    if (this.snapshot.command || this.inFlight || this.snapshot.venueReceipt) return null;
    let text: string;
    try { text = venueExperienceText(draft.text); } catch {
      this.show({ venueNotice: 'Проверьте текст отзыва.' });
      return null;
    }
    const previewGen = ++this.venuePreviewGen;
    const surfaceGen = surface.gen;
    try {
      const preview = parseVenueConsentPreview(await this.port.venueExperienceConsentPreview(actor, {
        venueId: surface.venueId,
        text,
        topics: draft.topics,
      }));
      if (previewGen !== this.venuePreviewGen || surfaceGen !== this.snapshot.venueExperience?.gen) return null;
      if (!sameActor(actor, this.snapshot.actor)) return null;
      this.show({
        venueConsentHash: preview.consentProjectionHash,
        venueDraft: { ...draft, consent: true },
        venueNotice: null,
      });
      return preview.consentProjectionHash;
    } catch {
      if (previewGen !== this.venuePreviewGen || surfaceGen !== this.snapshot.venueExperience?.gen) return null;
      this.show({ venueConsentHash: null, venueNotice: 'Не удалось подготовить публичный просмотр.' });
      return null;
    }
  };
  /**
   * Venue create via the single command journal. UNKNOWN keeps the original key/body;
   * after 24h first-dispatch age never late-POST — inspect status on web profile until native own-history exists.
   */
  submitVenueExperience = async () => {
    const actor = this.snapshot.actor;
    const surface = this.snapshot.venueExperience;
    const draft = this.snapshot.venueDraft;
    if (!actor || !surface || !draft) return;
    if (this.snapshot.command || this.inFlight || this.writePrepare || this.snapshot.venueReceipt) {
      const cmd = this.snapshot.command;
      if (cmd?.status === 'unknown' && isVenueExperiencePacketKind(cmd.packet.kind)
        && cmd.packet.actor.actorId === actor.actorId) {
        await this.reconcileVenueExperience();
      }
      return;
    }
    const eligibility = this.snapshot.venueEligibility.status === 'ready'
      ? this.snapshot.venueEligibility.data ?? null
      : null;
    const basis = exactGameMaySubmitBasis(eligibility, surface.gameId);
    if (!basis) {
      this.show({ venueNotice: 'Сейчас нельзя оставить отзыв по этой игре.' });
      return;
    }
    if (draft.audience === 'public_venue' && (!draft.consent || !this.snapshot.venueConsentHash)) {
      this.show({ venueNotice: 'Отметьте согласие с публичной публикацией.' });
      return;
    }
    let text: string;
    try { text = venueExperienceText(draft.text); } catch {
      this.show({ venueNotice: 'Проверьте текст отзыва.' });
      return;
    }
    const surfaceGen = surface.gen;
    const capturedAudience = draft.audience;
    const capturedTopics = [...draft.topics];
    const capturedConsent = draft.consent;
    const capturedHash = this.snapshot.venueConsentHash;
    const editor = this.venueDraftEditorKey(draft, capturedHash);
    const prepareGen = this.beginWritePrepare({
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      origin: 'venue-experience',
      surfaceGen,
      editor,
    });
    if (prepareGen === null) return;
    // Recheck current exact-game authority immediately before fresh dispatch.
    try {
      const fresh = parseOwnVenueEligibility(
        await this.port.venueExperienceEligibility(actor, surface.venueId),
      );
      if (!this.writePrepareOwns(prepareGen) || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.venueExperience?.gen !== surfaceGen) return;
      if (this.snapshot.command || this.inFlight) return;
      const liveDraft = this.snapshot.venueDraft;
      const liveEditor = liveDraft
        ? this.venueDraftEditorKey(liveDraft, this.snapshot.venueConsentHash)
        : null;
      // Stale captured draft/consent/audience/topics must not POST over newer input.
      if (!liveDraft || liveEditor !== editor
        || liveDraft.audience !== capturedAudience
        || liveDraft.text !== draft.text
        || liveDraft.topics.join(',') !== capturedTopics.join(',')
        || liveDraft.consent !== capturedConsent
        || this.snapshot.venueConsentHash !== capturedHash) {
        this.venuePreviewGen++;
        this.show({
          venueConsentHash: null,
          venueDraft: liveDraft ? { ...liveDraft, consent: false } : null,
          venueNotice: 'Черновик изменился. Проверьте текст и согласие перед новой отправкой.',
        });
        return;
      }
      this.show({ venueEligibility: { status: 'ready', data: fresh } });
      const liveBasis = exactGameMaySubmitBasis(fresh, surface.gameId);
      if (!liveBasis
        || liveBasis.outcomeVersion !== basis.outcomeVersion
        || liveBasis.attendanceVersion !== basis.attendanceVersion) {
        this.venuePreviewGen++;
        this.show({
          venueConsentHash: null,
          venueDraft: { ...liveDraft, consent: false },
          venueNotice: 'Данные игры изменились. Проверьте обновлённый допуск перед новой отправкой.',
        });
        return;
      }
      if (!this.writePrepareOwns(prepareGen, editor) || this.snapshot.command || this.inFlight) return;
      const body = buildVenueExperienceCreateBody({
        venueId: surface.venueId,
        basis: liveBasis,
        audience: liveDraft.audience,
        text,
        topics: liveDraft.topics,
        ...(liveDraft.audience === 'public_venue' && this.snapshot.venueConsentHash
          ? { consentProjectionHash: this.snapshot.venueConsentHash }
          : {}),
      });
      const intent: Intent = {
        kind: 'venue-experience-create',
        gameId: liveBasis.gameId,
        venueId: surface.venueId,
        body,
      };
      const transport = wire(intent);
      const packet: Packet = Object.freeze({
        ...freezeIntent(intent),
        method: transport.method,
        path: transport.path,
        actor: Object.freeze({ ...actor }),
        key: this.random(),
      }) as Packet;
      await this.dispatch(packet, actor, false);
    } catch (error) {
      if (!this.writePrepareOwns(prepareGen) || !sameActor(actor, this.snapshot.actor)) return;
      if (this.snapshot.venueExperience?.gen !== surfaceGen) return;
      const business = error instanceof PostgameError && error.kind === 'business';
      this.show({
        venueNotice: business
          ? 'Отправка недоступна для этой игры. Текст сохранён.'
          : 'Не удалось проверить допуск. Текст сохранён.',
      });
    } finally {
      this.releaseWritePrepare(prepareGen);
    }
  };
  reconcileVenueExperience = async () => {
    const { actor, command } = this.snapshot;
    if (!actor || !command || command.status !== 'unknown' || this.inFlight) return;
    if (!isVenueExperiencePacketKind(command.packet.kind)) return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    if (postgameIdempotencyReplayBlocked(command.firstDispatchedAt)) {
      this.show({
        command: {
          packet: command.packet,
          status: 'unknown',
          ...(command.firstDispatchedAt !== undefined
            ? { firstDispatchedAt: command.firstDispatchedAt }
            : {}),
        },
        venueNotice: POSTGAME_RETENTION_EXPIRED_NOTICE,
      });
      return;
    }
    await this.dispatch(command.packet, actor, true);
  };
  private allowed(intent: Intent) {
    if (intent.kind === 'public-role-create' || intent.kind === 'public-role-command'
      || intent.kind === 'public-role-reply' || intent.kind === 'public-role-report'
      || intent.kind === 'venue-experience-create') {
      // Public/venue mutations use dedicated submit paths — never private CommandReview.allowed.
      return false;
    }
    if (intent.kind === 'peer-create') {
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreatePeer) return false;
      if (intent.body.kind !== 'peer' || intent.body.experienceAssertion !== 'i_experienced_this_game') return false;
      return feedback.capabilities.peerSubjects.some(s => s.contextId === intent.body.subjectContextId);
    }
    if (intent.kind === 'organization-create') {
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreateOrganization) return false;
      if (intent.body.kind !== 'organization' || intent.body.experienceAssertion !== 'i_experienced_this_game') return false;
      if (intent.body.organizationScore === undefined && intent.body.comment === undefined) return false;
      return true;
    }
    if (intent.kind === 'training-create') {
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreateTraining) return false;
      if (intent.body.kind !== 'training' || intent.body.experienceAssertion !== 'i_experienced_this_game') return false;
      return !!intent.body.comment;
    }
    if (intent.kind === 'peer-reply') {
      const review = this.currentReviewForWrite(intent.reviewId);
      if (!review || review.id !== intent.reviewId || review.gameId !== intent.gameId) return false;
      if (review.direction !== 'received' || !review.allowedActions.canReply) return false;
      const results = this.snapshot.games[intent.gameId];
      // When results are ready, fresh writesEnabled gates ordinary reply; history canReply alone is not enough against known writes-off.
      if (results?.status === 'ready') {
        const feedback = results.data?.feedback;
        if (!feedback?.installed || !feedback.writesEnabled) return false;
      }
      const replyVer = review.reply?.version ?? 0;
      return replyVer === intent.body.expectedVersion;
    }
    if (intent.kind === 'peer-report') {
      const review = this.currentReviewForWrite(intent.reviewId);
      if (!review || review.id !== intent.reviewId || review.gameId !== intent.gameId) return false;
      // Exact-revision Support report remains received peer only — no org/training by analogy.
      if (review.kind !== 'peer' || review.direction !== 'received' || !review.allowedActions.canReport) return false;
      // Report is independent of writesEnabled / create experience.
      if (review.version !== intent.body.expectedVersion) return false;
      if (intent.body.gameId !== intent.gameId || intent.body.shareReviewWithSupport !== true) return false;
      const draft = this.snapshot.feedbackDrafts[intent.gameId];
      if (!draft?.reportConsent || draft.reportReviewId !== intent.reviewId) return false;
      // Exact frozen revision consent — undefined version is not an escape.
      if (draft.reportConsentVersion !== review.version) return false;
      return true;
    }
    if (intent.kind === 'note-upsert' || intent.kind === 'note-delete') {
      if (intent.kind === 'note-upsert') {
        try { noteText(intent.body.text); } catch { return false; }
      }
      const key = noteKey(intent.gameId, intent.contextId);
      const note = this.currentNote(intent.gameId, intent.contextId);
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (intent.kind === 'note-delete') {
        return !!note && note.version === intent.body.expectedVersion && note.allowedActions.canDelete
          && (feedback ? feedback.installed && feedback.writesEnabled : true);
      }
      // First create: requires definitive selected direct GET absence — bounded list gap is not authority.
      if (intent.body.expectedVersion === 0) {
        if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreateNote) return false;
        if (this.noteTombs.has(key) || this.snapshot.knownNoteRefs[key]) return false;
        const selected = this.snapshot.notes[key];
        if (selected?.status !== 'unavailable') return false;
        if (note) return false;
        const subjects = feedback.capabilities.peerSubjects;
        const roster = results?.data?.attendance?.roster ?? [];
        const allowedContext = subjects.some(s => s.contextId === intent.contextId)
          || roster.some(r => r.contextId === intent.contextId);
        return allowedContext;
      }
      // Edit: own note rights from authoritative current projection — independent of create form / roster after revoke.
      return !!note && note.version === intent.body.expectedVersion && note.allowedActions.canEdit
        && (feedback ? feedback.installed && feedback.writesEnabled : true);
    }
    if(intent.kind === 'later') { const source=this.snapshot.reminders.data, item=source?.items.find(r=>r.id === intent.reminderId); return this.snapshot.reminders.status === 'ready' && !!source?.writesEnabled && !!item && item.gameId === intent.gameId && item.version === intent.body.expectedVersion && item.allowedActions.canLater; }
    if (intent.kind === 'withdraw' || intent.kind === 'respond' || intent.kind === 'help') {
      const detail=this.snapshot.disputes[intent.disputeId];
      if (detail?.status !== 'ready' || !detail.data || detail.data.id !== intent.disputeId || detail.data.version !== intent.body.expectedVersion) return false;
      const results=this.snapshot.games[detail.data.gameId];
      if (results?.status !== 'ready' || !results.data?.attendance?.installed || !results.data.attendance.writesEnabled) return false;
      if (intent.kind === 'withdraw') return detail.data.allowedActions.canWithdraw;
      if (intent.kind === 'respond') return detail.data.allowedActions.canRespond;
      return detail.data.allowedActions.canRequestHelp;
    }
    const result=this.snapshot.games[intent.gameId]; if(result?.status !== 'ready' || !result.data) return false;
    const r=result.data;
    if(intent.kind === 'outcome') return r.allowedActions.canRecordOutcome && r.outcome.version === intent.body.expectedVersion;
    const attendance=r.attendance; if(!attendance?.installed || !attendance.writesEnabled) return false;
    const rows=[...(attendance.roster ?? []),...(attendance.myAttendance ? [attendance.myAttendance] : [])];
    if(intent.kind === 'bulk') return attendance.allowedActions.canBulkPresent && intent.body.items.every(item=>rows.some(row=>row.contextId === item.contextId && row.version === item.expectedVersion && row.allowedActions.canSetAttendance && row.value === 'unknown' && row.dispute?.status !== 'open'));
    if (intent.kind === 'dispute') {
      const row=rows.find(row=>row.contextId === intent.contextId);
      return !!row && row.allowedActions.canDispute && row.version === intent.body.attendanceVersion && row.dispute?.status !== 'open';
    }
    const row=rows.find(row=>row.contextId === intent.contextId); if(!row) return false;
    if (intent.kind === 'ack') {
      const resolving = intent.body.resolvingDisputeId !== undefined && intent.body.expectedDisputeVersion !== undefined;
      if (resolving) {
        const detail=this.snapshot.disputes[intent.body.resolvingDisputeId!];
        return !!detail && detail.status === 'ready' && !!detail.data && detail.data.id === intent.body.resolvingDisputeId
          && detail.data.contextId === intent.contextId && detail.data.gameId === intent.gameId
          && detail.data.version === intent.body.expectedDisputeVersion
          && detail.data.currentAssertion.version === intent.body.attendanceVersion
          && mayAcknowledgeCurrent(detail.data)
          && row.contextId === attendance.myAttendance?.contextId;
      }
      // Ordinary ACK remains blocked while an open dispute is on the row.
      return mayAcknowledge(row) && row.contextId === attendance.myAttendance?.contextId && row.version === intent.body.attendanceVersion;
    }
    // Open dispute blocks ordinary attendance edits; respond/ack rights come from selected dispute detail.
    if (row.dispute?.status === 'open') return false;
    return row.allowedActions.canSetAttendance && row.version === intent.body.expectedVersion;
  }
  review = (intent: Intent) => {
    if(!this.snapshot.actor || this.writeBusy()) return;
    try { wire(intent); if(!this.allowed(intent)) throw new PostgameError('invalid'); this.show({review:freezeIntent(intent),notice:null}); }
    catch { this.show({notice:'Проверьте выбранные данные и обновите итоги игры.'}); }
  };
  cancelReview = () => this.show({review:null});
  confirm = async () => {
    const {actor,review}=this.snapshot; if(!actor || !review || this.writeBusy()) return;
    if (!this.allowed(review)) { this.show({review:null,notice:'Данные изменились. Обновите итоги и проверьте выбранное действие.'}); return; }
    const transport=wire(review);
    const packet: Packet=Object.freeze({...review,method:transport.method,path:transport.path,actor:Object.freeze({...actor}),key:this.random()});
    await this.dispatch(packet,actor,false);
  };
  reconcile = async (gameId: string) => {
    const {actor,command}=this.snapshot; if(!actor || !command || command.status !== 'unknown' || this.inFlight || command.packet.gameId !== gameId || command.packet.actor.actorId !== actor.actorId) return;
    if (postgameIdempotencyReplayBlocked(command.firstDispatchedAt)) {
      this.show({
        command: {
          packet: command.packet,
          status: 'unknown',
          ...(command.roleDiscrepancyContext
            ? { roleDiscrepancyContext: command.roleDiscrepancyContext }
            : {}),
          ...(command.firstDispatchedAt !== undefined
            ? { firstDispatchedAt: command.firstDispatchedAt }
            : {}),
        },
        notice: POSTGAME_RETENTION_EXPIRED_NOTICE,
      });
      return;
    }
    await this.dispatch(command.packet,actor,true);
  };
  private retentionExpiredHold(
    packet: Packet,
    firstDispatchedAt: number | undefined,
    roleDiscrepancyContext?: RoleDiscrepancyContext,
  ) {
    const command = {
      packet,
      status: 'unknown' as const,
      ...(roleDiscrepancyContext ? { roleDiscrepancyContext } : {}),
      ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
    };
    if (isPublicRolePacketKind(packet.kind)) {
      this.show({ command, notice: null, publicNotice: POSTGAME_RETENTION_EXPIRED_NOTICE });
      return;
    }
    if (isVenueExperiencePacketKind(packet.kind)) {
      this.show({ command, notice: null, venueNotice: POSTGAME_RETENTION_EXPIRED_NOTICE });
      return;
    }
    this.show({ command, notice: POSTGAME_RETENTION_EXPIRED_NOTICE });
  }
  private async dispatch(packet: Packet, authority: Actor, reconciling: boolean) {
    // Capture role discrepancy fingerprint before send; UNKNOWN retry keeps the original binding.
    const priorCommand = this.snapshot.command;
    const roleDiscrepancyContext =
      (packet.kind === 'organization-create' || packet.kind === 'training-create')
        ? (reconciling && priorCommand?.packet === packet && priorCommand.roleDiscrepancyContext
          ? priorCommand.roleDiscrepancyContext
          : roleDiscrepancyContextFromResults(this.snapshot.games[packet.gameId]?.data))
        : undefined;
    // First actual dispatch stamps age once; reconcile never invents or rotates the clock.
    const firstDispatchedAt = reconciling
      ? (priorCommand?.packet === packet ? priorCommand.firstDispatchedAt : undefined)
      : Date.now();
    if (reconciling && postgameIdempotencyReplayBlocked(firstDispatchedAt)) {
      this.retentionExpiredHold(packet, firstDispatchedAt, roleDiscrepancyContext);
      return;
    }
    this.inFlight=packet;
    this.show({
      command: {
        packet,
        status: 'sending',
        ...(roleDiscrepancyContext ? { roleDiscrepancyContext } : {}),
        ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
      },
      review: null,
      notice: null,
      ...(isVenueExperiencePacketKind(packet.kind) ? { venueNotice: null } : {}),
    });
    // Actor object identity also fences a switch away and back to identical
    // credentials. Explicit reconcile captures the new authority separately.
    const valid=()=>authority === this.snapshot.actor && this.snapshot.command?.packet === packet;
    try {
      let raw: unknown;
      try {
        raw = await this.port.send(packet, authority);
      } catch (sendError) {
        if (sendError instanceof PostgameError && sendError.code === 'POSTGAME_RETENTION_EXPIRED') {
          if (valid()) this.retentionExpiredHold(packet, firstDispatchedAt, roleDiscrepancyContext);
          return;
        }
        throw sendError;
      }
      const receipt=validateReceipt(raw,packet);
      if(!valid()) return;
      let own=this.snapshot.own;
      if (packet.kind === 'ack' && 'acknowledgedVersion' in receipt) {
        const ack: OwnAck={gameId:packet.gameId,contextId:receipt.contextId,version:receipt.version};
        if (own.status === 'loading') this.ownReadAcks.push(ack);
        if (own.data) own={...own,data:{...own.data,items:own.data.items.map(row=>applyOwnAck(row,ack))}};
      }
      const disputes={...this.snapshot.disputes};
      if ((packet.kind === 'dispute' || packet.kind === 'withdraw' || packet.kind === 'respond' || packet.kind === 'help') && 'id' in receipt && 'history' in receipt) {
        disputes[receipt.id]={status:'ready',data:receipt};
      }
      if (packet.kind === 'note-upsert' && 'text' in receipt && 'allowedActions' in receipt) {
        // Historical ACK settles the original packet only — do not repaint receipt as current or unlock writes.
        const noteKeyId = noteKey(packet.gameId, packet.contextId);
        this.reads.set(`note:${noteKeyId}`, ++this.serial);
        // Per-context tombstone (e.g. owned GET404 after UNKNOWN PUT + external delete): settle without
        // replacing unavailable with loading, restoring known refs/private text/version/rights, or create.
        // Historical ACK is never current projection; follow-up loadNote stays tomb-fenced.
        if (!this.noteTombs.has(noteKeyId)) {
          this.noteAwaitingTyped.add(noteKeyId);
          // Raise floor from receipt version so older myNotes cannot win before typed GET; receipt stays non-current.
          if (typeof receipt.version === 'number') {
            this.noteVersionFloor.set(noteKeyId, Math.max(this.noteVersionFloor.get(noteKeyId) ?? 0, receipt.version));
          }
          const known = { ...this.snapshot.knownNoteRefs, [noteKeyId]: { gameId: packet.gameId, contextId: packet.contextId } };
          // Retain accepted newer projection as display-only under loading — do not drop data and fall
          // back to stale bounded myNotes while follow-up GET is pending/error. Writes stay typed-ready only.
          const priorNote = this.snapshot.notes[noteKeyId];
          const notes = {
            ...this.snapshot.notes,
            [noteKeyId]: {
              status: 'loading' as const,
              ...(priorNote?.data ? { data: priorNote.data } : {}),
            },
          };
          const createKey = packet.gameId;
          const editKey = noteKeyId;
          const noteDrafts = { ...this.snapshot.noteDrafts };
          if (noteDrafts[createKey]?.selectedContextId === packet.contextId) {
            noteDrafts[createKey] = { selectedContextId: '', createText: '' };
          }
          if (noteDrafts[editKey]) delete noteDrafts[editKey];
          this.show({ knownNoteRefs: known, notes, noteDrafts });
        }
      }
      if (packet.kind === 'note-delete' && 'deleted' in receipt && receipt.deleted) {
        this.tombstoneOwnedNote(packet.gameId, packet.contextId, receipt.version);
      }
      if (packet.kind === 'peer-create' && 'peerRating' in receipt && 'direction' in receipt) {
        // ACK display-only until typed sent history refresh reestablishes rights.
        this.rememberReviews([receipt], ++this.serial, 'receipt');
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = {
          ...prior,
          peerRating: undefined,
          comment: '',
          tags: [],
          subjectContextId: prior.subjectContextId,
        };
        this.show({ feedbackDrafts: drafts });
      }
      if (packet.kind === 'venue-experience-create' && 'reviewHandle' in receipt && 'publicVisible' in receipt) {
        const venueReceipt = receipt as VenueReviewMutationReceipt;
        const paint = !!this.snapshot.venueExperience
          && this.snapshot.venueExperience.gameId === packet.gameId
          && this.snapshot.venueExperience.venueId === packet.venueId;
        this.show({
          command: null,
          ...(paint ? {
            venueReceipt,
            venueConsentHash: null,
            venueNotice: packet.body.audience === 'self_draft'
              ? 'Сохранено только вам. Эти изменения видите только вы.'
              : 'Новая публичная версия отправлена и ожидает проверки. Более ранняя опубликованная версия может оставаться видимой.',
          } : {}),
        });
      }
      if (packet.kind === 'public-role-create' && 'receiptToken' in receipt) {
        const publicReceipt = parsePublicRoleMutationReceipt(receipt);
        const paint = this.publicMutationUiCurrent(packet);
        this.publicMutationBind = null;
        // Journal settles once; only the matching surface/editor generation may render the receipt.
        this.show({
          command: null,
          ...(paint ? {
            publicReceipt,
            publicConsentHash: null,
            publicNotice: publicReceipt.pendingIntakeStatus === 'waiting_intake'
              ? 'Отзыв отправлен. Ожидает разбора'
              : 'Отзыв принят.',
          } : {}),
        });
        // Pending create is not publication — do not refresh anonymous public projection or private results.
        return;
      }
      if (packet.kind === 'public-role-command' && 'receiptToken' in receipt) {
        const publicReceipt = parsePublicRoleMutationReceipt(receipt);
        const paint = this.publicMutationUiCurrent(packet);
        const reviewId = packet.kind === 'public-role-command' ? packet.reviewId : publicReceipt.id;
        this.publicMutationBind = null;
        // Raise floor from receipt; receipt never grants writes — retire text while awaiting typed GET.
        // Monotonic ACK: settle packet/floor without replacing a newer typed projection with an older receipt.
        const floorBefore = this.publicOwnVersionFloor.get(reviewId) ?? 0;
        const priorItems = this.snapshot.publicOwn.data?.items ?? [];
        const priorTyped = priorItems.find(item => item.id === reviewId);
        this.publicOwnVersionFloor.set(
          reviewId,
          Math.max(floorBefore, publicReceipt.version),
        );
        if (!this.publicOwnDenied) {
          this.publicOwnAwaitingTyped.add(reviewId);
          const floor = this.publicOwnVersionFloor.get(reviewId) ?? 0;
          const items = priorItems.map(item => {
            if (item.id !== reviewId) return item;
            return applyOwnPublicAckToItem(item, publicReceipt, floor);
          });
          if (this.snapshot.publicOwn.status === 'ready' || priorItems.length) {
            this.show({ publicOwn: { status: 'ready', data: { items } } });
          }
        }
        // Historical ACK settles the journal; do not present its status when newer typed row/floor already won.
        const paintReceipt = paint && mayPaintOwnPublicReceipt(publicReceipt, priorTyped, floorBefore);
        this.show({
          command: null,
          ...(paintReceipt ? {
            publicReceipt,
            publicNotice: publicReceipt.status === 'withdrawn'
              ? 'Отзыв отозван.'
              : 'Команда принята.',
          } : {}),
        });
        if (!this.publicOwnDenied) void this.loadOwnPublicReviews();
        return;
      }
      if (packet.kind === 'public-role-reply' && 'receiptToken' in receipt && 'version' in receipt) {
        const replyReceipt = parsePublicRoleReplyReceipt(receipt);
        const paintUi = this.publicMutationUiCurrent(packet);
        this.publicMutationBind = null;
        const floorBefore = this.publicReaderReplyFloor.get(packet.reviewHandle) ?? 0;
        const typed = this.currentReaderItem(packet.reviewHandle) ?? undefined;
        const expectedReviewRevision = packet.body.expectedReviewRevision;
        const paint = paintUi && mayPaintPublicReplyReceipt(
          replyReceipt,
          typed,
          floorBefore,
          expectedReviewRevision,
        );
        this.publicReaderReplyFloor.set(
          packet.reviewHandle,
          Math.max(floorBefore, replyReceipt.version),
        );
        // ACK is intake acknowledgement only — never insert public reply text from ACK.
        // Late older ACK still settles the journal but must not paint over newer typed aggregate
        // or a newer published revision, and must not erase that revision's draft/consent/context.
        const drafts = { ...this.snapshot.publicReplyDrafts };
        if (paint) delete drafts[packet.reviewHandle];
        this.show({
          command: null,
          ...(paint ? {
            publicReplyDrafts: drafts,
            publicConsentHash: null,
            publicReplyReceipt: {
              ...replyReceipt,
              reviewHandle: packet.reviewHandle,
              expectedReviewRevision,
            },
            publicNotice: 'Ответ принят.',
          } : {}),
        });
        if (paintUi) void this.loadPublicReader({ preserveNotice: paint });
        return;
      }
      if (packet.kind === 'public-role-report' && 'reportId' in receipt && 'receiptToken' in receipt) {
        const reportReceipt = parsePublicRoleReportReceipt(receipt);
        const paintUi = this.publicMutationUiCurrent(packet);
        this.publicMutationBind = null;
        const expectedRevision = packet.body.expectedRevision;
        const typed = this.currentReaderItem(packet.reviewHandle) ?? undefined;
        // Late older ACK still settles the journal but must not paint over a newer published
        // revision or erase that revision's report draft/context.
        const paint = paintUi && mayPaintPublicReportReceipt(typed, expectedRevision);
        this.show({
          command: null,
          ...(paint ? {
            publicReportDraft: null,
            publicReportReceipt: {
              ...reportReceipt,
              reviewHandle: packet.reviewHandle,
              expectedRevision,
            },
            publicNotice: 'Жалоба отправлена. Отзыв остаётся видимым до решения человека.',
          } : {}),
        });
        return;
      }
      if ((packet.kind === 'organization-create' || packet.kind === 'training-create')
        && 'kind' in receipt && 'direction' in receipt) {
        this.rememberReviews([receipt], ++this.serial, 'receipt');
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = packet.kind === 'organization-create'
          ? {
            ...prior,
            organizationScore: null,
            organizationComment: '',
            organizationDiscrepancy: '',
            discrepancyDecision: null,
          }
          : {
            ...prior,
            trainingComment: '',
            trainingDiscrepancy: '',
            discrepancyDecision: null,
          };
        this.show({ feedbackDrafts: drafts });
      }
      if (packet.kind === 'peer-reply' && 'reply' in receipt && 'direction' in receipt) {
        // ACK display-only until typed received history refresh; do not grant another reply from receipt.
        this.rememberReviews([receipt], ++this.serial, 'receipt');
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        const replyText = { ...(prior.replyText ?? {}) };
        delete replyText[packet.reviewId];
        drafts[packet.gameId] = { ...prior, replyText };
        this.show({ feedbackDrafts: drafts });
      }
      if (packet.kind === 'peer-report' && 'reportId' in receipt && receipt.status === 'submitted') {
        // Receipt already bound to original packet by validateReceipt — clear consent, keep detail draft.
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = {
          ...prior,
          reportReviewId: undefined,
          reportConsent: false,
          reportConsentVersion: undefined,
          reportDetail: prior.reportDetail,
        };
        this.show({ feedbackDrafts: drafts });
      }
      // Resolving ACK: verified resolvedDispute stays on the ACK receipt only.
      // Never fabricate dispute timestamps/rights or regress the projection from historical receipt fields.
      // Authoritative DTO comes from loadDispute below; follow-up GET failure stays a distinct retryable read error.
      // Historical note ACK settles the original action only — refresh current projection before next op.
      this.show({own,disputes,command:null,notice:reconciling ? 'Исходное действие подтверждено. Обновляем текущие данные.' : 'Изменения сохранены.'});
      // Receipt replay is history; always read current rights/version separately.
      const gameId = packet.gameId;
      void this.loadResults(gameId); void this.loadReminders();
      const disputeWrite = packet.kind === 'dispute' || packet.kind === 'withdraw' || packet.kind === 'respond' || packet.kind === 'help';
      const resolvingAck = packet.kind === 'ack' && packet.body.resolvingDisputeId !== undefined;
      const noteWrite = packet.kind === 'note-upsert' || packet.kind === 'note-delete';
      // Dispute lifecycle and resolving ACK refresh own hub; ordinary ACK keeps local notice settlement.
      if (disputeWrite || resolvingAck) void this.loadOwn();
      if (disputeWrite) {
        const id = 'disputeId' in packet ? packet.disputeId : 'id' in receipt && 'history' in receipt ? receipt.id : null;
        if (id) void this.loadDispute(id);
      }
      if (resolvingAck && packet.kind === 'ack') void this.loadDispute(packet.body.resolvingDisputeId!);
      if (this.snapshot.selection?.disputeId) void this.loadDispute(this.snapshot.selection.disputeId);
      // After upsert ACK: typed GET reestablishes rights/version; GET failure is retryable READ, not write success.
      if (noteWrite && packet.kind === 'note-upsert') void this.loadNote(packet.gameId, packet.contextId);
      if (packet.kind === 'peer-create' || packet.kind === 'organization-create' || packet.kind === 'training-create') {
        void this.loadReviews('sent');
      }
      if (packet.kind === 'peer-reply' || packet.kind === 'peer-report') void this.loadReviews('received');
    } catch(error) {
      if(!valid()) return;
      const definite=!reconciling && error instanceof PostgameError && error.status < 500 && error.kind === 'business' && !['COMMAND_IN_PROGRESS','KEY_REUSED','IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      const noteConflict = definite && packet.kind.startsWith('note-') && error instanceof PostgameError && error.code === 'VERSION_CONFLICT';
      const peerConflict = definite && (packet.kind === 'peer-reply' || packet.kind === 'peer-report')
        && error instanceof PostgameError && error.code === 'VERSION_CONFLICT';
      const roleDiscrepancy = definite && (packet.kind === 'organization-create' || packet.kind === 'training-create')
        && error instanceof PostgameError
        && (error.code === 'FEEDBACK_DISCREPANCY_REQUIRED' || error.code === 'FEEDBACK_DISCREPANCY_UNEXPECTED');
      const noteUnknown = !definite && (packet.kind === 'note-upsert' || packet.kind === 'note-delete');
      const peerUnknown = !definite && (
        packet.kind === 'peer-create' || packet.kind === 'organization-create' || packet.kind === 'training-create'
        || packet.kind === 'peer-reply' || packet.kind === 'peer-report'
      );
      const publicUnknown = !definite && isPublicRolePacketKind(packet.kind);
      const publicBusiness = definite && isPublicRolePacketKind(packet.kind);
      const venueUnknown = !definite && isVenueExperiencePacketKind(packet.kind);
      const venueBusiness = definite && isVenueExperiencePacketKind(packet.kind);
      if (peerConflict && packet.kind === 'peer-report') {
        // Preserve detail draft; reset consent after revision change.
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = { ...prior, reportConsent: false, reportConsentVersion: undefined };
        this.show({ feedbackDrafts: drafts });
        void this.loadReviews('received');
      }
      if (peerConflict && packet.kind === 'peer-reply') {
        void this.loadReviews('received');
        void this.loadResults(packet.gameId);
      }
      if (roleDiscrepancy && error instanceof PostgameError
        && (error.code === 'FEEDBACK_DISCREPANCY_REQUIRED' || error.code === 'FEEDBACK_DISCREPANCY_UNEXPECTED')) {
        // Bind to packet kind + context captured at owned-packet send — never transplant late current results.
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        const kind = packet.kind === 'organization-create' ? 'organization' : 'training';
        const decisionContext = roleDiscrepancyContext
          ?? roleDiscrepancyContextFromResults(this.snapshot.games[packet.gameId]?.data);
        drafts[packet.gameId] = {
          ...prior,
          discrepancyDecision: roleDiscrepancyDecisionFromError(kind, error.code, decisionContext),
        };
        this.show({ feedbackDrafts: drafts });
        void this.loadResults(packet.gameId);
      }
      const notice = definite
        ? (noteConflict
          ? 'Версия заметки изменилась. Обновите заметку и сохраните снова.'
          : peerConflict
            ? (packet.kind === 'peer-report'
              ? 'Версия отзыва изменилась. Проверьте новую редакцию и снова подтвердите согласие.'
              : 'Версия ответа изменилась. Обновите отзыв и сохраните снова.')
            : roleDiscrepancy
              ? 'Проверьте пояснение расхождения и подтвердите отправку снова.'
              : publicBusiness
                ? (packet.kind === 'public-role-reply'
                  ? publicRoleReplyBusinessNotice(error instanceof PostgameError ? error.code : undefined)
                  : packet.kind === 'public-role-report'
                    ? publicRoleReportBusinessNotice(error instanceof PostgameError ? error.code : undefined)
                    : publicRoleBusinessNotice(
                      error instanceof PostgameError ? error.code : undefined,
                      packet.kind === 'public-role-command' ? 'command' : 'create',
                    ))
                : 'Изменение отклонено. Обновите данные и проверьте условия.')
        : (noteUnknown
          ? (packet.kind === 'note-delete'
            ? 'Пока не удалось подтвердить удаление. Проверьте исходное действие.'
            : 'Пока не удалось подтвердить сохранение. Проверьте исходное действие.')
          : peerUnknown
            ? 'Результат отправки пока неизвестен. Проверьте исходное действие.'
              : publicUnknown
              ? (packet.kind === 'public-role-reply'
                ? 'Не удалось подтвердить ответ. Он мог быть принят — не повторяйте отправку.'
                : packet.kind === 'public-role-report'
                  ? 'Не удалось подтвердить жалобу. Она могла быть получена — не повторяйте отправку.'
                  : 'Отзыв мог быть принят. Проверьте «Мои публичные отзывы о ролях».')
              : venueUnknown
                ? 'Не удалось подтвердить отправку опыта площадки. Текст сохранён — не повторяйте отправку автоматически.'
                : unknownNotice);
      // Dirty note/feedback drafts retained on conflict/UNKNOWN; competing writes stay blocked while UNKNOWN.
      // Preserve original owned-packet discrepancy fingerprint across UNKNOWN for reconcile.
      // Public 409/422 retain draft and require reread/reconsent; private CommandReview notice stays unset for public kinds.
      // Journal settles once; notice/hash/preview/follow-up GET only on original dispatch surface+origin.
      if (isPublicRolePacketKind(packet.kind)) {
        const paintUi = this.publicMutationUiCurrent(packet);
        // Hard auth on reply/report: keep immutable UNKNOWN packet (no definite free-key); retire owned reader only.
        const hardAuthReplyReport = (packet.kind === 'public-role-reply' || packet.kind === 'public-role-report')
          && this.isHardAuthorizationDenial(error);
        const settleJournal = definite && !hardAuthReplyReport;
        if (settleJournal) this.publicMutationBind = null;
        if (paintUi && hardAuthReplyReport) {
          this.retireOwnedPublicReaderAuthority(error, {
            command: {
              packet,
              status: 'unknown',
              ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
            },
            notice: null,
          });
        } else {
          if (paintUi) this.publicPreviewGen++;
          this.show({
            command: settleJournal ? null : {
              packet,
              status: 'unknown',
              ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
            },
            notice: null,
            ...(paintUi ? {
              publicConsentHash: settleJournal ? null : this.snapshot.publicConsentHash,
              publicNotice: notice,
            } : {}),
          });
          if (paintUi && publicBusiness && packet.kind === 'public-role-create') {
            void this.loadPublicEligibility({ preserveNotice: true });
          }
          if (paintUi && publicBusiness && packet.kind === 'public-role-command') {
            void this.loadOwnPublicReviews({ preserveNotice: true });
          }
          if (paintUi && publicBusiness && !hardAuthReplyReport
            && (packet.kind === 'public-role-reply' || packet.kind === 'public-role-report')) {
            void this.loadPublicReader({ preserveNotice: true });
          }
        }
      } else if (isVenueExperiencePacketKind(packet.kind)) {
        const paintUi = !!this.snapshot.venueExperience
          && this.snapshot.venueExperience.gameId === packet.gameId
          && this.snapshot.venueExperience.venueId === packet.venueId;
        if (paintUi && venueBusiness) this.venuePreviewGen++;
        this.show({
          command: definite ? null : {
            packet,
            status: 'unknown',
            ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
          },
          notice: null,
          ...(paintUi ? {
            venueConsentHash: definite ? null : this.snapshot.venueConsentHash,
            venueDraft: definite && this.snapshot.venueDraft
              ? { ...this.snapshot.venueDraft, consent: false }
              : this.snapshot.venueDraft,
            venueNotice: venueBusiness
              ? (error instanceof PostgameError && error.status === 409
                ? 'Версия изменилась. Перечитайте допуск и подтвердите заново.'
                : 'Отправка недоступна для этой игры. Текст сохранён.')
              : notice,
          } : {}),
        });
        if (paintUi && venueBusiness) void this.loadVenueEligibility({ preserveNotice: true });
      } else {
        this.show({
          command: definite ? null : {
            packet,
            status: 'unknown',
            ...(roleDiscrepancyContext ? { roleDiscrepancyContext } : {}),
            ...(firstDispatchedAt !== undefined ? { firstDispatchedAt } : {}),
          },
          notice,
        });
      }
    } finally { if(this.inFlight === packet) this.inFlight=null; }
  }
}
