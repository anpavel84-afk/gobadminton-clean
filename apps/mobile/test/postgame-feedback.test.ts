import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseResults, parsePrivateReview, parseMeReviewsPage, parseReviewReportReceipt,
  wire, validateReceipt, peerCreateReasonLabel, peerReviewsOnly, peerReviewsForGame,
  privateReviewsOnly, privateReviewsForGame, privateReviewHeadline, reviewKindModeLabel,
  shouldOmitRoleDiscrepancy, roleDiscrepancyPresentation, resolveFeedbackDisplayMode,
  feedbackDiscrepancyDraftPatch, DISCREPANCY_REQUIRED_MESSAGE, DISCREPANCY_UNEXPECTED_MESSAGE,
  DISCREPANCY_OMIT_HINT, feedbackSectionVisible, mergeReviewPages, projectReviewsFromStore,
  reviewCommandsOpen, displayOnlyReview, resolvePeerDraftSubject, peerHistoryEmptyText,
  normalizeFormReason,
} from '../src/postgame.ts';
import {
  boundRoleDiscrepancyFieldError,
  feedbackResultsNavParams,
  formatPrivateReviewWhen,
  parseResultsFeedbackSection,
  peerReviewHistoryLabel,
  privateHubHistoryEmptyText,
  privateReviewHistoryDetail,
  privateReviewKindHistoryLabel,
  roleDiscrepancyActiveDecision,
  roleDiscrepancyContextFromResults,
  roleDiscrepancyDecisionFromError,
  roleDiscrepancyRequiredBlocksCreate,
} from '../src/postgame-feedback.ts';
import type { Attendance, Intent, Packet, PrivateReview, Results } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import { game as publicGame } from './fixtures.ts';
import type { Game } from '@gobadminton/contracts/game-types';

const game = { ...publicGame, version: 1 } satisfies Game;
const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const date = '2026-11-14T10:00:00Z';
const contextB = 'context-b';

const peerReview = (overrides: Partial<PrivateReview> = {}): PrivateReview => ({
  id: 'review-1',
  gameId: game.id,
  kind: 'peer',
  subjectContextId: contextB,
  recipientDisplay: 'Илья',
  peerRating: 'play_again',
  organizationScore: null,
  comment: 'Спасибо',
  tags: ['communication'],
  experienceAssertion: 'i_experienced_this_game',
  discrepancyExplanation: null,
  attendanceContext: 'present',
  outcomeContext: 'held',
  version: 1,
  editedAt: null,
  createdAt: date,
  direction: 'sent',
  reply: null,
  allowedActions: { canEdit: true, canReply: false, canReport: false },
  ...overrides,
});

const feedbackReady = {
  installed: true, writesEnabled: true,
  capabilities: {
    canCreateNote: false,
    canCreatePeer: true,
    canCreateOrganization: true,
    canCreateTraining: false,
    organizationRecipientDisplay: 'PG3 manager' as string | null,
    peerCreateReason: null as null,
    peerSubjects: [{ contextId: contextB, displayName: 'Илья' }],
  },
  myNotes: [] as [],
  gameReviews: [peerReview()] as PrivateReview[],
};

const result: Results = {
  gameId: game.id,
  outcome: { value: 'held', version: 1, reason: 'ok', provenance: { source: 'manager_explicit', recordedAt: date, createdAt: date } },
  allowedActions: { canRecordOutcome: false },
  feedback: feedbackReady,
};

function packet(intent: Intent): Packet {
  const w = wire(intent);
  return { ...intent, actor, key: 'original-key', method: w.method, path: w.path };
}

function setup(opts: {
  results?: Results | 'deny';
  reviews?: { received?: PrivateReview[]; sent?: PrivateReview[]; nextCursor?: string | null };
} = {}) {
  const sentPkts: Packet[] = [];
  const reviews = {
    received: [...(opts.reviews?.received ?? [])],
    sent: [...(opts.reviews?.sent ?? [peerReview()])],
  };
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string) => {
      if (opts.results === 'deny') throw new PostgameError('private', 403);
      const base = opts.results ?? result;
      return { ...structuredClone(base), gameId: id };
    },
    reviews: async (_a: Actor, direction: 'sent' | 'received', _cursor?: string) => ({
      items: structuredClone(reviews[direction]),
      nextCursor: opts.reviews?.nextCursor ?? null,
    }),
    send: async (p: Packet, _authority?: Actor): Promise<unknown> => {
      sentPkts.push(p);
      if (p.kind === 'peer-create') {
        const row = peerReview({
          id: 'review-new',
          subjectContextId: p.body.subjectContextId,
          peerRating: p.body.peerRating,
          comment: p.body.comment ?? null,
          tags: p.body.tags ?? [],
          version: 1,
        });
        reviews.sent.push(row);
        return row;
      }
      if (p.kind === 'organization-create') {
        const row = peerReview({
          id: 'org-new',
          kind: 'organization',
          subjectContextId: null,
          peerRating: null,
          organizationScore: p.body.organizationScore ?? null,
          comment: p.body.comment ?? null,
          tags: [],
          discrepancyExplanation: p.body.discrepancyExplanation ?? null,
          recipientDisplay: 'PG3 manager',
          version: 1,
        });
        reviews.sent.push(row);
        return row;
      }
      if (p.kind === 'training-create') {
        const row = peerReview({
          id: 'train-new',
          kind: 'training',
          subjectContextId: null,
          peerRating: null,
          organizationScore: null,
          comment: p.body.comment,
          tags: [],
          discrepancyExplanation: p.body.discrepancyExplanation ?? null,
          recipientDisplay: 'Тренер',
          version: 1,
        });
        reviews.sent.push(row);
        return row;
      }
      if (p.kind === 'peer-reply') {
        const prior = [...reviews.received, ...reviews.sent].find(r => r.id === p.reviewId);
        if (!prior) throw new PostgameError('business', 404, 'FEEDBACK_NOT_FOUND');
        if ((prior.reply?.version ?? 0) !== p.body.expectedVersion) {
          throw new PostgameError('business', 409, 'VERSION_CONFLICT');
        }
        const next = {
          ...prior,
          reply: {
            text: p.body.text,
            version: p.body.expectedVersion + 1,
            editedAt: p.body.expectedVersion > 0 ? date : null,
            updatedAt: date,
          },
        };
        reviews.received = reviews.received.map(r => r.id === p.reviewId ? next : r);
        return next;
      }
      if (p.kind === 'peer-report') {
        if (p.body.expectedVersion < 1) throw new PostgameError('business', 409, 'VERSION_CONFLICT');
        return {
          reportId: 'report-1',
          status: 'submitted' as const,
          reviewId: p.reviewId,
          version: p.body.expectedVersion,
        };
      }
      throw new PostgameError('invalid');
    },
  };
  const coordinator = new PostgameCoordinator(port, () => `key-${sentPkts.length}`);
  coordinator.setActor(actor);
  return { coordinator, port, sentPkts, reviews };
}

test('parse peer review + me page + report receipt; non-peer filtered from UI helpers', () => {
  const row = peerReview();
  assert.equal(parsePrivateReview(row).peerRating, 'play_again');
  const org = peerReview({
    id: 'org-1', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 5, direction: 'sent',
  });
  assert.equal(parsePrivateReview(org).kind, 'organization');
  assert.deepEqual(peerReviewsOnly([row, org]).map(r => r.id), ['review-1']);
  assert.deepEqual(peerReviewsForGame([row, peerReview({ id: 'x', gameId: 'other' })], game.id).map(r => r.id), ['review-1']);
  assert.deepEqual(parseMeReviewsPage({ items: [row], nextCursor: null }), { items: [row], nextCursor: null });
  assert.throws(() => parseMeReviewsPage({ items: [row, row], nextCursor: null }));
  assert.deepEqual(parseReviewReportReceipt({
    reportId: 'report-1', status: 'submitted', reviewId: 'review-1', version: 1,
  }), { reportId: 'report-1', status: 'submitted', reviewId: 'review-1', version: 1 });
  assert.equal(peerCreateReasonLabel('attendance_unmarked'), 'Посещение ещё не отмечено');
});

test('wire peer create/reply/report and validate receipts; reply uses reply.version', () => {
  const create = packet({
    kind: 'peer-create', gameId: game.id,
    body: {
      kind: 'peer', subjectContextId: contextB, peerRating: 'neutral',
      experienceAssertion: 'i_experienced_this_game', comment: 'ok', tags: ['agreements'],
    },
  });
  assert.deepEqual(wire(create), { method: 'POST', path: `/games/${game.id}/reviews`, body: create.body });
  const created = peerReview({ peerRating: 'neutral', comment: 'ok', tags: ['agreements'], version: 1 });
  const createdReceipt = validateReceipt(created, create);
  assert.ok('kind' in createdReceipt);
  assert.equal(createdReceipt.kind, 'peer');

  const reply = packet({
    kind: 'peer-reply', gameId: game.id, reviewId: 'review-1',
    body: { expectedVersion: 0, text: 'Взаимно' },
  });
  assert.equal(wire(reply).path, '/reviews/review-1/reply');
  const withReply = peerReview({
    direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
    reply: { text: 'Взаимно', version: 1, editedAt: null, updatedAt: date },
  });
  assert.equal((validateReceipt(withReply, reply) as PrivateReview).reply?.version, 1);

  const report = packet({
    kind: 'peer-report', gameId: game.id, reviewId: 'review-1',
    body: {
      expectedVersion: 1, reasonCode: 'spam', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(wire(report).method, 'POST');
  assert.deepEqual(validateReceipt({
    reportId: 'r1', status: 'submitted', reviewId: 'review-1', version: 1,
  }, report), { reportId: 'r1', status: 'submitted', reviewId: 'review-1', version: 1 });
});

test('results parse keeps peer caps + gameReviews; feedback visible when history ready and results denied', () => {
  const parsed = parseResults(result);
  assert.equal(parsed.feedback?.capabilities.canCreatePeer, true);
  assert.equal(parsed.feedback?.capabilities.canCreateOrganization, true);
  assert.equal(parsed.feedback?.capabilities.organizationRecipientDisplay, 'PG3 manager');
  assert.equal(parsed.feedback?.gameReviews?.length, 1);
  assert.equal(feedbackSectionVisible(game.id, parsed.feedback, {
    received: { status: 'ready', data: { items: [], nextCursor: null } },
    sent: { status: 'ready', data: { items: [], nextCursor: null } },
  }), true);
  assert.equal(feedbackSectionVisible(game.id, undefined, {
    received: { status: 'ready', data: { items: [peerReview({ direction: 'received', allowedActions: { canEdit: false, canReply: true, canReport: true } })], nextCursor: null } },
    sent: { status: 'idle' },
  }), true);
  assert.equal(peerCreateReasonLabel(null), null);
});

test('coordinator: create from peerSubjects, history independent of denied results, report without writes', async () => {
  const received = peerReview({
    id: 'recv-1', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: {
      ...result,
      feedback: {
        ...feedbackReady,
        writesEnabled: false,
        capabilities: { ...feedbackReady.capabilities, canCreatePeer: false, peerCreateReason: 'no_eligible_peers' },
        gameReviews: [received],
      },
    },
    reviews: { received: [received], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  // Actual UI two-step: open report target (consent false + known version), then explicit checkbox.
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-1', reportConsent: false, reportConsentVersion: 1, reportReason: 'harassment',
  });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, false);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 1);
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  s.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: 'recv-1',
    body: {
      expectedVersion: 1, reasonCode: 'harassment', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-report');
  await s.coordinator.confirm();
  assert.equal(s.sentPkts.filter(p => p.kind === 'peer-report').length, 1);
  assert.equal(s.sentPkts.at(-1)?.kind, 'peer-report');

  // Denied results still allow history lane.
  const denied = setup({ results: 'deny', reviews: { received: [received], sent: [] } });
  await denied.coordinator.loadResults(game.id);
  assert.equal(denied.coordinator.getSnapshot().games[game.id]?.status, 'unavailable');
  await denied.coordinator.loadReviews('received');
  assert.equal(denied.coordinator.getSnapshot().reviewHistory.received.status, 'ready');
  assert.equal(denied.coordinator.getSnapshot().reviewsById['recv-1']?.id, 'recv-1');
});

test('coordinator: peer create requires canCreatePeer+subject; reply expectedVersion is reply.version; 409 resets report consent', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.coordinator.setFeedbackDraft(game.id, { peerRating: 'play_again', subjectContextId: contextB });
  s.coordinator.review({
    kind: 'peer-create', gameId: game.id,
    body: {
      kind: 'peer', subjectContextId: contextB, peerRating: 'play_again',
      experienceAssertion: 'i_experienced_this_game',
    },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-create');
  await s.coordinator.confirm();
  assert.equal(s.sentPkts[0]?.kind, 'peer-create');

  const received = peerReview({
    id: 'recv-2', direction: 'received', version: 2,
    allowedActions: { canEdit: false, canReply: true, canReport: true },
    reply: { text: 'old', version: 1, editedAt: null, updatedAt: date },
  });
  const r = setup({
    reviews: { received: [received], sent: [] },
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [received] } },
  });
  await r.coordinator.loadResults(game.id);
  await r.coordinator.loadReviews('received');
  // Wrong expectedVersion (review.version instead of reply.version) must not arm.
  r.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-2',
    body: { expectedVersion: 2, text: 'nope' },
  });
  assert.equal(r.coordinator.getSnapshot().review, null);
  r.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-2',
    body: { expectedVersion: 1, text: 'ok reply' },
  });
  assert.equal(r.coordinator.getSnapshot().review?.kind, 'peer-reply');
  r.coordinator.cancelReview();

  // Real 409 report: initial UI consent grant, one send, detail preserved, consent reset, regrant.
  r.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-2', reportConsent: false, reportConsentVersion: 2, reportDetail: 'keep me',
  });
  r.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 2 });
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  const originalSend = r.port.send;
  r.port.send = async (p: Packet, a?: Actor) => {
    if (p.kind === 'peer-report') {
      r.sentPkts.push(p);
      throw new PostgameError('business', 409, 'VERSION_CONFLICT');
    }
    return originalSend(p, a);
  };
  r.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: 'recv-2',
    body: {
      expectedVersion: 2, reasonCode: 'harassment', detail: 'keep me',
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(r.coordinator.getSnapshot().review?.kind, 'peer-report');
  await r.coordinator.confirm();
  assert.equal(r.sentPkts.filter(p => p.kind === 'peer-report').length, 1);
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, false);
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportDetail, 'keep me');
  // Conflict path refreshes history — wait for that flight before a fresh version reload.
  for (let i = 0; i < 50 && r.coordinator.getSnapshot().reviewHistory.received.status === 'loading'; i++) {
    await new Promise<void>(res => setImmediate(res));
  }
  r.reviews.received = [{ ...received, version: 3, comment: 'fresh3' }];
  await r.coordinator.loadReviews('received');
  assert.equal(r.coordinator.getSnapshot().reviewsById['recv-2']?.version, 3);
  // First explicit new-revision grant must work in one press (no vacuous setter-only assert).
  r.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-2', reportConsent: false, reportConsentVersion: 3, reportDetail: 'keep me',
  });
  r.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 3 });
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 3);
});

test('mergeReviewPages keeps highest reply across parent review-version advances', () => {
  const v1Reply = peerReview({
    id: 'merge-reply', direction: 'received', version: 1, comment: 'v1',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
  });
  const v2NoReply = peerReview({
    id: 'merge-reply', direction: 'received', version: 2, comment: 'v2',
    reply: null,
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const merged = mergeReviewPages([v1Reply], [v2NoReply], 'received');
  assert.equal(merged[0]?.version, 2);
  assert.equal(merged[0]?.comment, 'v2');
  assert.equal(merged[0]?.reply?.version, 1);
  assert.equal(merged[0]?.reply?.text, 'reply-v1');
  const v2Reply2 = {
    ...v2NoReply,
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
  };
  const advanced = mergeReviewPages(merged, [v2Reply2], 'received');
  assert.equal(advanced[0]?.reply?.version, 2);
  assert.equal(advanced[0]?.reply?.text, 'reply-v2');

  // Reverse arrival: older parent with independently newer reply must not drop reply v2.
  const priorV2Reply1 = peerReview({
    id: 'merge-reverse', direction: 'received', version: 2, comment: 'comment-new',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const incomingV1Reply2 = peerReview({
    id: 'merge-reverse', direction: 'received', version: 1, comment: 'comment-old',
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  const reversed = mergeReviewPages([priorV2Reply1], [incomingV1Reply2], 'received');
  assert.equal(reversed[0]?.version, 2);
  assert.equal(reversed[0]?.comment, 'comment-new');
  assert.equal(reversed[0]?.allowedActions.canReply, true);
  assert.equal(reversed[0]?.reply?.version, 2);
  assert.equal(reversed[0]?.reply?.text, 'reply-v2');
  // Opposite order still keeps parent v2 + highest reply.
  const forward = mergeReviewPages([incomingV1Reply2], [priorV2Reply1], 'received');
  assert.equal(forward[0]?.version, 2);
  assert.equal(forward[0]?.comment, 'comment-new');
  assert.equal(forward[0]?.reply?.version, 2);
  assert.equal(forward[0]?.reply?.text, 'reply-v2');
});

test('mergeReviewPages is monotonic; UNKNOWN retry keeps original packet; reauth does not autosend', async () => {
  const older = peerReview({ version: 1, comment: 'old' });
  const newer = peerReview({ version: 2, comment: 'new' });
  assert.equal(mergeReviewPages([newer], [older], 'sent')[0]?.comment, 'new');
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.coordinator.review({
    kind: 'peer-create', gameId: game.id,
    body: {
      kind: 'peer', subjectContextId: contextB, peerRating: 'neutral',
      experienceAssertion: 'i_experienced_this_game',
    },
  });
  // Force UNKNOWN by failing send once.
  const originalSend = s.port.send;
  let fail = true;
  s.port.send = async (p: Packet, a?: Actor) => {
    if (fail) { fail = false; throw new PostgameError('network', 0); }
    return originalSend(p, a);
  };
  await s.coordinator.confirm();
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  const key = s.coordinator.getSnapshot().command?.packet.key;
  // Same-account reauth (null → actor) restores UNKNOWN without autosend.
  s.coordinator.setActor(null);
  s.coordinator.setActor(actor);
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  assert.equal(s.coordinator.getSnapshot().command?.packet.key, key);
  assert.equal(s.sentPkts.length, 0);
  await s.coordinator.reconcile(game.id);
  assert.equal(s.sentPkts.length, 1);
  assert.equal(s.sentPkts[0]?.key, key);
});

test('ROOT peer explicit current-revision consent toggles ON on first click after version change', async () => {
  const row = peerReview({
    id: 'recv-root', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  s.coordinator.setFeedbackDraft(game.id, { reportReviewId: row.id, reportConsent: false, reportConsentVersion: 1 });
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  s.reviews.received = [{ ...row, version: 2, comment: 'fresh2' }];
  await s.coordinator.loadReviews('received');
  // Exact actual ReportForm checkbox handler for false versionOk and checked older consent.
  const prior = s.coordinator.getSnapshot().feedbackDrafts[game.id]!;
  const versionOk = prior.reportConsentVersion === 2;
  s.coordinator.setFeedbackDraft(game.id, {
    reportConsent: !(!!prior.reportConsent && versionOk),
    reportConsentVersion: 2,
  });
  assert.equal(
    s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent,
    true,
    'explicit current-version user consent must take one press',
  );
  assert.equal(s.sentPkts.length, 0);
});

test('ROOT peer history pending is display-only and cannot arm stale new reply', async () => {
  const row = peerReview({
    id: 'recv-pending', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  let resolve!: (p: { items: PrivateReview[]; nextCursor: null }) => void;
  s.port.reviews = () => new Promise(r => { resolve = r; });
  const flight = s.coordinator.loadReviews('received');
  try {
    assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'loading');
    assert.equal(reviewCommandsOpen('loading'), false);
    s.coordinator.review({
      kind: 'peer-reply', gameId: game.id, reviewId: row.id,
      body: { expectedVersion: 0, text: 'new reply' },
    });
    assert.equal(s.coordinator.getSnapshot().review, null, 'pending old rights cannot grant a new write');
  } finally {
    resolve({ items: [row], nextCursor: null });
    await flight;
  }
});

test('ROOT peer definitive own-history deny retires old new-report authority', async () => {
  const row = peerReview({
    id: 'recv-deny', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  s.coordinator.setFeedbackDraft(game.id, { reportReviewId: row.id, reportConsent: false, reportConsentVersion: 1 });
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  s.port.reviews = async () => { throw new PostgameError('private', 403); };
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'unavailable');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id], undefined);
  s.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: row.id,
    body: {
      expectedVersion: 1, reasonCode: 'harassment', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(s.coordinator.getSnapshot().review, null, 'denied own-history must not retain old report authority');
});

test('denied Results keeps history canReply UI authority; writes-off results still gate reply', async () => {
  const row = peerReview({
    id: 'recv-ui', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const denied = setup({ results: 'deny', reviews: { received: [row], sent: [] } });
  await denied.coordinator.loadResults(game.id);
  await denied.coordinator.loadReviews('received');
  assert.equal(denied.coordinator.getSnapshot().games[game.id]?.status, 'unavailable');
  assert.equal(denied.coordinator.getSnapshot().reviewsById['recv-ui']?.allowedActions.canReply, true);
  assert.equal(reviewCommandsOpen(denied.coordinator.getSnapshot().reviewHistory.received.status), true);
  denied.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-ui',
    body: { expectedVersion: 0, text: 'history reply' },
  });
  assert.equal(denied.coordinator.getSnapshot().review?.kind, 'peer-reply');
  denied.coordinator.cancelReview();

  const writesOff = setup({
    results: {
      ...result,
      feedback: {
        ...feedbackReady,
        writesEnabled: false,
        capabilities: { ...feedbackReady.capabilities, canCreatePeer: false, peerCreateReason: 'no_eligible_peers' },
        gameReviews: [row],
      },
    },
    reviews: {
      received: [peerReview({
        id: 'recv-ui', direction: 'received',
        allowedActions: { canEdit: false, canReply: false, canReport: true },
      })],
      sent: [],
    },
  });
  await writesOff.coordinator.loadResults(game.id);
  await writesOff.coordinator.loadReviews('received');
  writesOff.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-ui',
    body: { expectedVersion: 0, text: 'blocked' },
  });
  assert.equal(writesOff.coordinator.getSnapshot().review, null);
  writesOff.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-ui', reportConsent: false, reportConsentVersion: 1,
  });
  writesOff.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  writesOff.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: 'recv-ui',
    body: {
      expectedVersion: 1, reasonCode: 'spam', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(writesOff.coordinator.getSnapshot().review?.kind, 'peer-report');
});

test('deferred results/history same-version rights; older gen cannot restore; non-peer cursor retained', async () => {
  const row = peerReview({
    id: 'recv-defer', direction: 'received', version: 1, comment: 'v1',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const revoked = {
    ...row,
    comment: 'v1-rights',
    allowedActions: { canEdit: false, canReply: false, canReport: true },
  };
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [], nextCursor: 'cursor-a' },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.nextCursor, 'cursor-a');
  // Newer history rights win at same version.
  s.reviews.received = [revoked];
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v1-rights');
  // Stale results gameReviews with old reply rights must not restore after newer history.
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v1-rights');

  // Deferred older results after newer history: in-flight stale canReply:true must not restore.
  let resolveStaleResults!: (value: Results) => void;
  s.port.results = () => new Promise(r => { resolveStaleResults = r; });
  const staleResultsFlight = s.coordinator.loadResults(game.id);
  s.reviews.received = [revoked];
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);
  resolveStaleResults({
    ...structuredClone(result),
    gameId: game.id,
    feedback: { ...feedbackReady, gameReviews: [row] },
  });
  await staleResultsFlight;
  assert.equal(
    s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply,
    false,
    'deferred older results must not restore reply after newer history revoke',
  );
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v1-rights');

  // Deferred older history after newer results: start history first, then results own higher version.
  const v2 = peerReview({
    id: 'recv-defer', direction: 'received', version: 2, comment: 'v2-current',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: true },
  });
  let resolveStaleHistory!: (value: { items: PrivateReview[]; nextCursor: null }) => void;
  s.port.reviews = () => new Promise(r => { resolveStaleHistory = r; });
  const staleHistoryFlight = s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'loading');
  s.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [v2] },
  });
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.version, 2);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.reply?.version, 1);
  // Old delayed history (lower version, misleading canReply, missing reply) must not regress current.
  resolveStaleHistory({
    items: [{
      ...row,
      comment: 'stale-v1',
      reply: null,
      allowedActions: { canEdit: false, canReply: true, canReport: true },
    }],
    nextCursor: null,
  });
  await staleHistoryFlight;
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.version, 2);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v2-current');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.reply?.version, 1);

  // Same-version reply-floor: typed history with weaker reply payload keeps current reply.
  s.reviews.received = [{
    ...v2,
    comment: 'v2-same-reply-floor',
    reply: null,
    allowedActions: { canEdit: false, canReply: false, canReport: true },
  }];
  s.port.reviews = async () => ({
    items: structuredClone(s.reviews.received),
    nextCursor: null,
  });
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v2-same-reply-floor');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.reply?.version, 1);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, false);

  // Legitimate newer typed history restores current authority — revoked rights are not frozen forever.
  const restored = {
    ...v2,
    comment: 'v2-restored',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  };
  const org = peerReview({
    id: 'org-defer', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 4, direction: 'received',
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  s.reviews.received = [restored, org];
  s.port.reviews = async () => ({ items: structuredClone(s.reviews.received), nextCursor: 'cursor-b' });
  // Fresh root load (not more) — replace cursor set; mixed non-peer page keeps nextCursor honest.
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.nextCursor, 'cursor-b');
  assert.equal(
    peerReviewsOnly(s.coordinator.getSnapshot().reviewHistory.received.data?.items ?? []).length,
    1,
  );
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.allowedActions.canReply, true);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-defer']?.comment, 'v2-restored');
  const projected = projectReviewsFromStore(
    s.coordinator.getSnapshot().reviewHistory.received.data?.items ?? [],
    s.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(projected.find(r => r.id === 'recv-defer')?.allowedActions.canReply, true);
  assert.equal(displayOnlyReview(restored).allowedActions.canReply, false);
});

test('ROOT Astra UX: no silent recipient rebind; cursor empty is non-definitive; pending strips report UI rights', () => {
  const a = { contextId: 'ctx-a', displayName: 'Анна' };
  const b = { contextId: 'ctx-b', displayName: 'Борис' };
  // Explicit pin stays; singular list never auto-selects without draft.
  assert.deepEqual(resolvePeerDraftSubject([a], a.contextId), { selected: a, needsReselect: false });
  assert.deepEqual(resolvePeerDraftSubject([a], undefined), { selected: undefined, needsReselect: false });
  assert.deepEqual(resolvePeerDraftSubject([a], 'gone'), { selected: undefined, needsReselect: true });
  // Prior choice left the list: keep draft fields elsewhere; never fall back to first remaining.
  assert.deepEqual(resolvePeerDraftSubject([b], a.contextId), { selected: undefined, needsReselect: true });
  assert.deepEqual(resolvePeerDraftSubject([a, b], a.contextId), { selected: a, needsReselect: false });
  assert.deepEqual(resolvePeerDraftSubject([], a.contextId), { selected: undefined, needsReselect: false });

  assert.equal(peerHistoryEmptyText('received', null), 'Пока нет полученных отзывов по этой игре.');
  assert.equal(peerHistoryEmptyText('sent', null), 'Пока нет отправленных отзывов по этой игре.');
  assert.equal(
    peerHistoryEmptyText('received', 'cursor-more'),
    'Среди загруженных отзывов по этой игре пока нет',
  );
  assert.equal(
    peerHistoryEmptyText('sent', 'cursor-more'),
    'Среди загруженных отзывов по этой игре пока нет',
  );

  const row = peerReview({
    id: 'recv-ux', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  assert.equal(reviewCommandsOpen('loading'), false);
  assert.equal(reviewCommandsOpen('error'), false);
  assert.equal(displayOnlyReview(row).allowedActions.canReport, false);
  assert.equal(displayOnlyReview(row).allowedActions.canReply, false);
});

test('actor switch clears private review projection and report draft', async () => {
  const row = peerReview({
    id: 'recv-actor', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: row.id, reportConsent: false, reportConsentVersion: 1,
  });
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  const other: Actor = { actorId: 'actor-b', sessionId: 'session-b', generation: 1 };
  s.coordinator.setActor(other);
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id], undefined);
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'idle');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id], undefined);
});

test('hard-deny then late reply ACK: no private resurrect on pending/failed GET; typed GET restores', async () => {
  const row = peerReview({
    id: 'recv-resurrect', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: row.id,
    body: { expectedVersion: 0, text: 'late ack reply' },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-reply');

  let resolveAck!: (value: unknown) => void;
  const ackFlight = new Promise<unknown>(r => { resolveAck = r; });
  const originalSend = s.port.send;
  s.port.send = async (p: Packet, a?: Actor) => {
    s.sentPkts.push(p);
    if (p.kind === 'peer-reply') return ackFlight;
    return originalSend(p, a);
  };
  const confirmFlight = s.coordinator.confirm();

  // Direction hard-denied while ACK is still in flight — private rows retired.
  s.port.reviews = async () => { throw new PostgameError('private', 403); };
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'unavailable');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id], undefined);

  // Post-deny follow-up GET after ACK: hold pending, then fail — must not resurrect.
  let rejectPostAckGet!: (err: unknown) => void;
  const postAckGet = new Promise<{ items: PrivateReview[]; nextCursor: null }>((_, reject) => {
    rejectPostAckGet = reject;
  });
  s.port.reviews = () => postAckGet;

  const receipt = {
    ...row,
    reply: { text: 'late ack reply', version: 1, editedAt: null, updatedAt: date },
  };
  s.reviews.received = [receipt];
  resolveAck(receipt);
  await confirmFlight;
  assert.equal(
    s.coordinator.getSnapshot().command,
    null,
    'ACK must settle the original packet even when direction is hard-denied',
  );
  assert.equal(
    s.coordinator.getSnapshot().reviewsById[row.id],
    undefined,
    'late receipt must not reintroduce private projection while denied',
  );
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'loading');
  const pendingProjected = projectReviewsFromStore(
    [receipt],
    s.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(pendingProjected[0]?.id, receipt.id);
  assert.equal(
    s.coordinator.getSnapshot().reviewsById[row.id],
    undefined,
    'pending typed GET must not leave a resurrected store row',
  );

  rejectPostAckGet(new PostgameError('network', 0));
  for (let i = 0; i < 50 && s.coordinator.getSnapshot().reviewHistory.received.status === 'loading'; i++) {
    await new Promise<void>(res => setImmediate(res));
  }
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'error');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id], undefined);

  // Successful current typed history clears deny and restores projection + reply floor.
  s.port.reviews = async () => ({ items: structuredClone(s.reviews.received), nextCursor: null });
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.reply?.version, 1);
  const restored = projectReviewsFromStore(
    s.coordinator.getSnapshot().reviewHistory.received.data?.items ?? [],
    s.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(restored.find(r => r.id === row.id)?.reply?.version, 1);
  assert.equal(reviewCommandsOpen(s.coordinator.getSnapshot().reviewHistory.received.status), true);
});

test('reply revision floor survives parent review v2/null and advances on reply v2', async () => {
  const v1 = peerReview({
    id: 'recv-reply-floor', direction: 'received', version: 1, comment: 'v1',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [v1] } },
    reviews: { received: [v1], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-reply-floor']?.reply?.version, 1);

  // Out-of-order / partial projection: review advances, reply payload missing.
  const v2Null = peerReview({
    id: 'recv-reply-floor', direction: 'received', version: 2, comment: 'v2-edit',
    reply: null,
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  s.reviews.received = [v2Null];
  await s.coordinator.loadReviews('received');
  const kept = s.coordinator.getSnapshot().reviewsById['recv-reply-floor'];
  assert.equal(kept?.version, 2);
  assert.equal(kept?.comment, 'v2-edit');
  assert.equal(kept?.reply?.version, 1);
  assert.equal(kept?.reply?.text, 'reply-v1');
  const ui = projectReviewsFromStore(
    s.coordinator.getSnapshot().reviewHistory.received.data?.items ?? [],
    s.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(ui.find(r => r.id === 'recv-reply-floor')?.reply?.version, 1);
  // UI expectedVersion for next reply must stay at accepted reply floor, not reset to 0.
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-reply-floor',
    body: { expectedVersion: 0, text: 'stale zero' },
  });
  assert.equal(s.coordinator.getSnapshot().review, null, 'expectedVersion:0 must not arm after reply v1');
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-reply-floor',
    body: { expectedVersion: 1, text: 'advance reply' },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-reply');
  s.coordinator.cancelReview();

  // Later typed reply v2 advances the independent floor.
  const v2Reply2 = {
    ...v2Null,
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
  };
  s.reviews.received = [v2Reply2];
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-reply-floor']?.reply?.version, 2);
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-reply-floor']?.reply?.text, 'reply-v2');
});

test('deferred create ACK while sent GET pending queues one fresh root GET', async () => {
  const tick = () => new Promise<void>(r => setImmediate(r));
  let resolveEmpty!: (v: { items: PrivateReview[]; nextCursor: null }) => void;
  const emptyPromise = new Promise<{ items: PrivateReview[]; nextCursor: null }>(r => { resolveEmpty = r; });
  let sentGets = 0;
  const s = setup({
    results: {
      ...result,
      feedback: {
        ...feedbackReady,
        gameReviews: [],
        capabilities: { ...feedbackReady.capabilities, canCreatePeer: true, peerSubjects: [{ contextId: contextB, displayName: 'Илья' }] },
      },
    },
    reviews: { received: [], sent: [] },
  });
  s.port.reviews = async (_a, direction) => {
    if (direction !== 'sent') return { items: [], nextCursor: null };
    sentGets++;
    if (sentGets === 1) return emptyPromise;
    return { items: structuredClone(s.reviews.sent), nextCursor: null };
  };
  await s.coordinator.loadResults(game.id);
  const initialSent = s.coordinator.loadReviews('sent');
  await tick();
  assert.equal(s.coordinator.getSnapshot().reviewHistory.sent.status, 'loading');
  assert.equal(sentGets, 1);
  s.coordinator.setFeedbackDraft(game.id, { peerRating: 'play_again', subjectContextId: contextB });
  s.coordinator.review({
    kind: 'peer-create', gameId: game.id,
    body: {
      kind: 'peer', subjectContextId: contextB, peerRating: 'play_again',
      experienceAssertion: 'i_experienced_this_game',
    },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-create');
  await s.coordinator.confirm();
  assert.equal(s.sentPkts.filter(p => p.kind === 'peer-create').length, 1);
  assert.equal(sentGets, 1, 'coalesce: mutation refresh waits for in-flight GET');
  // Extra refresh while busy still coalesces to one followup.
  void s.coordinator.loadReviews('sent');
  resolveEmpty({ items: [], nextCursor: null });
  await initialSent;
  await tick();
  assert.equal(sentGets, 2, 'exactly one fresh root GET after pre-mutation flight');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.sent.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.sent.data?.items[0]?.id, 'review-new');
  assert.equal(s.coordinator.getSnapshot().reviewsById['review-new']?.id, 'review-new');
  assert.equal(s.sentPkts.filter(p => p.kind === 'peer-create').length, 1, 'queued refresh is GET-only');

  // Actor ABA: queued followup must not leak after logout.
  let resolveLogout!: (v: { items: PrivateReview[]; nextCursor: null }) => void;
  const logoutPromise = new Promise<{ items: PrivateReview[]; nextCursor: null }>(r => { resolveLogout = r; });
  let logoutGets = 0;
  const fenced = setup({ reviews: { received: [], sent: [] } });
  fenced.port.reviews = async (_a, direction) => {
    if (direction !== 'sent') return { items: [], nextCursor: null };
    logoutGets++;
    return logoutPromise;
  };
  const logoutFlight = fenced.coordinator.loadReviews('sent');
  await tick();
  void fenced.coordinator.loadReviews('sent');
  fenced.coordinator.setActor(null);
  resolveLogout({ items: [], nextCursor: null });
  await logoutFlight;
  await tick();
  assert.equal(logoutGets, 1, 'actor fence drops queued sent history followup');
  assert.equal(fenced.coordinator.getSnapshot().reviewHistory.sent.status, 'idle');
});

test('reverse parent/reply floor: both orders keep parent v2 and reply v2; consent stays on parent revision', async () => {
  const v2Reply1 = peerReview({
    id: 'recv-reverse', direction: 'received', version: 2, comment: 'comment-new',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [v2Reply1] } },
    reviews: { received: [v2Reply1], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  // Actual UI two-step: open known revision unchecked, then explicit checkbox grant.
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-reverse', reportConsent: false, reportConsentVersion: 2, reportDetail: 'keep',
  });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, false);
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 2 });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 2);

  // Reverse typed history: older parent + independently newer reply.
  const v1Reply2 = peerReview({
    id: 'recv-reverse', direction: 'received', version: 1, comment: 'comment-old',
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  s.reviews.received = [v1Reply2];
  await s.coordinator.loadReviews('received');
  const kept = s.coordinator.getSnapshot().reviewsById['recv-reverse'];
  assert.equal(kept?.version, 2);
  assert.equal(kept?.comment, 'comment-new');
  assert.equal(kept?.allowedActions.canReply, true);
  assert.equal(kept?.reply?.version, 2);
  assert.equal(kept?.reply?.text, 'reply-v2');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 2);
  // Next reply expectedVersion must be reply floor 2, not 0/1.
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-reverse',
    body: { expectedVersion: 1, text: 'stale reply floor' },
  });
  assert.equal(s.coordinator.getSnapshot().review, null, 'expectedVersion:1 must not arm after reply v2');
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-reverse',
    body: { expectedVersion: 2, text: 'advance from floor 2' },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-reply');
  s.coordinator.cancelReview();

  // Forward order (newer parent after older reply bearer) still converges.
  const t = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [v1Reply2] } },
    reviews: { received: [v1Reply2], sent: [] },
  });
  await t.coordinator.loadResults(game.id);
  await t.coordinator.loadReviews('received');
  t.reviews.received = [v2Reply1];
  await t.coordinator.loadReviews('received');
  const forward = t.coordinator.getSnapshot().reviewsById['recv-reverse'];
  assert.equal(forward?.version, 2);
  assert.equal(forward?.comment, 'comment-new');
  assert.equal(forward?.reply?.version, 2);
  assert.equal(forward?.reply?.text, 'reply-v2');
});

test('Results raises independent reply onto history-owned same/lower parent; UI expectedVersion advances', async () => {
  // History owns parent v1/reply v1; later Results same parent + reply v2 must raise reply only.
  const v1Reply1 = peerReview({
    id: 'recv-results-reply', direction: 'received', version: 1, comment: 'hist-v1',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [v1Reply1] } },
    reviews: { received: [v1Reply1], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById['recv-results-reply']?.reply?.version, 1);
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-results-reply', reportConsent: false, reportConsentVersion: 1, reportDetail: 'keep',
  });
  s.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 1 });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);

  const sameParentReply2 = peerReview({
    id: 'recv-results-reply', direction: 'received', version: 1, comment: 'results-stale-comment',
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  s.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [sameParentReply2] },
  });
  await s.coordinator.loadResults(game.id);
  const same = s.coordinator.getSnapshot().reviewsById['recv-results-reply'];
  assert.equal(same?.version, 1);
  assert.equal(same?.comment, 'hist-v1');
  assert.equal(same?.allowedActions.canReply, true);
  assert.equal(same?.allowedActions.canReport, true);
  assert.equal(same?.reply?.version, 2);
  assert.equal(same?.reply?.text, 'reply-v2');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 1);
  const sameUi = projectReviewsFromStore(
    s.coordinator.getSnapshot().reviewHistory.received.data?.items ?? [],
    s.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(sameUi.find(r => r.id === 'recv-results-reply')?.reply?.version, 2);
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-results-reply',
    body: { expectedVersion: 1, text: 'stale after results reply v2' },
  });
  assert.equal(s.coordinator.getSnapshot().review, null, 'expectedVersion:1 must not arm after Results reply v2');
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-results-reply',
    body: { expectedVersion: 2, text: 'advance from Results reply floor 2' },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-reply');
  s.coordinator.cancelReview();

  // History owns parent v2/reply v1; Results lower parent + reply v2 keeps parent v2 authority.
  const v2Reply1 = peerReview({
    id: 'recv-results-lower', direction: 'received', version: 2, comment: 'hist-v2',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const lower = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [v2Reply1] } },
    reviews: { received: [v2Reply1], sent: [] },
  });
  await lower.coordinator.loadResults(game.id);
  await lower.coordinator.loadReviews('received');
  lower.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-results-lower', reportConsent: false, reportConsentVersion: 2, reportDetail: 'keep-v2',
  });
  lower.coordinator.setFeedbackDraft(game.id, { reportConsent: true, reportConsentVersion: 2 });
  const lowerParentReply2 = peerReview({
    id: 'recv-results-lower', direction: 'received', version: 1, comment: 'results-old-parent',
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  lower.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [lowerParentReply2] },
  });
  await lower.coordinator.loadResults(game.id);
  const kept = lower.coordinator.getSnapshot().reviewsById['recv-results-lower'];
  assert.equal(kept?.version, 2);
  assert.equal(kept?.comment, 'hist-v2');
  assert.equal(kept?.allowedActions.canReply, true);
  assert.equal(kept?.allowedActions.canReport, true);
  assert.equal(kept?.reply?.version, 2);
  assert.equal(kept?.reply?.text, 'reply-v2');
  assert.equal(lower.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, true);
  assert.equal(lower.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsentVersion, 2);
  const lowerUi = projectReviewsFromStore(
    lower.coordinator.getSnapshot().reviewHistory.received.data?.items ?? [],
    lower.coordinator.getSnapshot().reviewsById,
  );
  assert.equal(lowerUi.find(r => r.id === 'recv-results-lower')?.reply?.version, 2);
  assert.equal(lowerUi.find(r => r.id === 'recv-results-lower')?.comment, 'hist-v2');
  lower.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-results-lower',
    body: { expectedVersion: 1, text: 'stale lower-parent reply floor' },
  });
  assert.equal(lower.coordinator.getSnapshot().review, null);
  lower.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: 'recv-results-lower',
    body: { expectedVersion: 2, text: 'advance from lower-parent Results reply v2' },
  });
  assert.equal(lower.coordinator.getSnapshot().review?.kind, 'peer-reply');
});

test('Results cannot raise reply after harddeny or while awaiting typed history', async () => {
  const row = peerReview({
    id: 'recv-fence-reply', direction: 'received', version: 1, comment: 'hist',
    reply: { text: 'reply-v1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const denied = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await denied.coordinator.loadResults(game.id);
  await denied.coordinator.loadReviews('received');
  denied.port.reviews = async () => { throw new PostgameError('private', 403); };
  await denied.coordinator.loadReviews('received');
  assert.equal(denied.coordinator.getSnapshot().reviewHistory.received.status, 'unavailable');
  assert.equal(denied.coordinator.getSnapshot().reviewsById[row.id], undefined);

  const resurrect = peerReview({
    id: 'recv-fence-reply', direction: 'received', version: 1, comment: 'results-resurrect',
    reply: { text: 'reply-v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  denied.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [resurrect] },
  });
  await denied.coordinator.loadResults(game.id);
  assert.equal(
    denied.coordinator.getSnapshot().reviewsById[row.id],
    undefined,
    'Results reply v2 must not resurrect after hard deny',
  );

  // Awaiting typed history after reply ACK: Results must not raise reply onto pending store.
  const awaiting = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await awaiting.coordinator.loadResults(game.id);
  await awaiting.coordinator.loadReviews('received');
  awaiting.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: row.id,
    body: { expectedVersion: 1, text: 'ack reply v2' },
  });
  assert.equal(awaiting.coordinator.getSnapshot().review?.kind, 'peer-reply');

  let resolveAck!: (value: unknown) => void;
  const ackFlight = new Promise<unknown>(r => { resolveAck = r; });
  const originalSend = awaiting.port.send;
  awaiting.port.send = async (p: Packet, a?: Actor) => {
    awaiting.sentPkts.push(p);
    if (p.kind === 'peer-reply') return ackFlight;
    return originalSend(p, a);
  };
  let resolveTyped!: (value: { items: PrivateReview[]; nextCursor: null }) => void;
  const typedFlight = new Promise<{ items: PrivateReview[]; nextCursor: null }>(r => { resolveTyped = r; });
  awaiting.port.reviews = () => typedFlight;
  const confirmFlight = awaiting.coordinator.confirm();
  const receipt = {
    ...row,
    reply: { text: 'ack reply v2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  };
  resolveAck(receipt);
  await confirmFlight;
  assert.equal(awaiting.coordinator.getSnapshot().reviewsById[row.id]?.reply?.version, 2);
  assert.equal(awaiting.coordinator.getSnapshot().reviewHistory.received.status, 'loading');

  const resultsWhileAwaiting = peerReview({
    id: 'recv-fence-reply', direction: 'received', version: 1, comment: 'results-while-awaiting',
    reply: { text: 'reply-v3-from-results', version: 3, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  });
  awaiting.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [resultsWhileAwaiting] },
  });
  await awaiting.coordinator.loadResults(game.id);
  const pending = awaiting.coordinator.getSnapshot().reviewsById[row.id];
  assert.equal(pending?.comment, 'hist', 'Results must not adopt parent while awaiting typed');
  assert.equal(pending?.reply?.version, 2, 'Results must not raise reply while awaiting typed');
  assert.equal(pending?.allowedActions.canReply, false, 'receipt ACK strips writes until typed history');

  resolveTyped({ items: [receipt], nextCursor: null });
  for (let i = 0; i < 50 && awaiting.coordinator.getSnapshot().reviewHistory.received.status === 'loading'; i++) {
    await new Promise<void>(res => setImmediate(res));
  }
  assert.equal(awaiting.coordinator.getSnapshot().reviewHistory.received.status, 'ready');
  assert.equal(awaiting.coordinator.getSnapshot().reviewsById[row.id]?.reply?.version, 2);
});

test('ROOT older-generation history may carry newer independent reply without stale parent rights', async () => {
  const row = peerReview({
    id: 'root-gen-reply', direction: 'received', version: 1, comment: 'initial',
    reply: { text: 'reply1', version: 1, editedAt: null, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  const s = setup({
    results: { ...result, feedback: { ...feedbackReady, gameReviews: [row] } },
    reviews: { received: [row], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  let done!: (value: { items: PrivateReview[]; nextCursor: null }) => void;
  const flight = new Promise<{ items: PrivateReview[]; nextCursor: null }>(r => { done = r; });
  s.port.reviews = () => flight;
  const earlier = s.coordinator.loadReviews('received');
  const latest = {
    ...row,
    comment: 'current parent',
    allowedActions: { canEdit: false, canReply: false, canReport: true },
  };
  s.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [latest] },
  });
  await s.coordinator.loadResults(game.id);
  done({
    items: [{
      ...row,
      comment: 'stale parent',
      reply: { text: 'reply2', version: 2, editedAt: date, updatedAt: date },
    }],
    nextCursor: null,
  });
  await earlier;
  const actual = s.coordinator.getSnapshot().reviewsById[row.id];
  assert.equal(actual?.comment, 'current parent');
  assert.equal(actual?.allowedActions.canReply, false);
  assert.equal(actual?.reply?.version, 2, 'independent higher reply must survive older parent read-gen');
  assert.equal(actual?.reply?.text, 'reply2');
  // Reply-only older-gen must not freeze: subsequent Results / current history remain refreshable.
  const afterResults = {
    ...latest,
    comment: 'results refresh',
    reply: { text: 'reply2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: false, canReport: true },
  };
  s.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, gameReviews: [afterResults] },
  });
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.comment, 'results refresh');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.reply?.version, 2);
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.allowedActions.canReply, false);
  const afterHistory = peerReview({
    id: 'root-gen-reply', direction: 'received', version: 1, comment: 'history refresh',
    reply: { text: 'reply2', version: 2, editedAt: date, updatedAt: date },
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  s.reviews.received = [afterHistory];
  s.port.reviews = async () => ({ items: structuredClone(s.reviews.received), nextCursor: null });
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.comment, 'history refresh');
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.allowedActions.canReply, true);
  assert.equal(s.coordinator.getSnapshot().reviewsById[row.id]?.reply?.version, 2);
});
test('#522 private organization/training: wire whitelist, receipts, kind drafts, discrepancy omit, report peer-only', async () => {
  const orgIntent: Intent = {
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      organizationScore: 4, comment: 'Организация ок',
    },
  };
  assert.deepEqual(wire(orgIntent), {
    method: 'POST', path: `/games/${game.id}/reviews`, body: orgIntent.body,
  });
  assert.throws(() => wire({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      organizationScore: 3, subjectContextId: contextB,
    },
  } as unknown as Intent));
  assert.throws(() => wire({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      organizationScore: 3, peerRating: 'play_again',
    },
  } as unknown as Intent));
  const orgReceipt = peerReview({
    id: 'org-r', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 4, comment: 'Организация ок', tags: [], direction: 'sent',
  });
  assert.equal((validateReceipt(orgReceipt, packet(orgIntent)) as PrivateReview).kind, 'organization');

  const trainIntent: Intent = {
    kind: 'training-create', gameId: game.id,
    body: {
      kind: 'training', experienceAssertion: 'i_experienced_this_game',
      comment: 'Тренировка прошла хорошо',
    },
  };
  assert.equal(wire(trainIntent).path, `/games/${game.id}/reviews`);
  assert.throws(() => wire({
    kind: 'training-create', gameId: game.id,
    body: { kind: 'training', experienceAssertion: 'i_experienced_this_game', comment: '' },
  }));
  const trainReceipt = peerReview({
    id: 'train-r', kind: 'training', subjectContextId: null, peerRating: null,
    organizationScore: null, comment: 'Тренировка прошла хорошо', tags: [], direction: 'sent',
  });
  assert.equal((validateReceipt(trainReceipt, packet(trainIntent)) as PrivateReview).kind, 'training');

  assert.equal(reviewKindModeLabel('organization'), 'Организатору лично');
  assert.equal(reviewKindModeLabel('training'), 'Тренировка');
  assert.equal(privateReviewHeadline(orgReceipt), 'Оценка организации: 4 из 5');
  assert.equal(privateReviewHeadline(peerReview({
    kind: 'organization', subjectContextId: null, peerRating: null, organizationScore: null,
  })), null);
  assert.equal(privateReviewHeadline(trainReceipt), null);

  const heldPresent: Results = {
    ...result,
    attendance: {
      installed: true, writesEnabled: true,
      myAttendance: {
        contextId: 'me', value: 'present', version: 1, late: false,
        assertion: { actorDisplay: null, source: 'self_attested', at: date },
        acknowledgedVersion: null, dispute: null, displayName: 'Я',
        allowedActions: {
          canSetAttendance: false, canAcknowledge: false, canDispute: false,
          canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
        },
      },
      roster: null, rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  assert.equal(shouldOmitRoleDiscrepancy(heldPresent), true);
  assert.equal(shouldOmitRoleDiscrepancy({
    ...heldPresent, outcome: { ...heldPresent.outcome, value: 'not_held' },
  }), false);
  assert.equal(shouldOmitRoleDiscrepancy(undefined), false);
  // Null myAttendance is ambiguous — never drop explanation text.
  const ambiguousNullAttendance: Results = {
    ...result,
    attendance: {
      installed: true, writesEnabled: true, myAttendance: null, roster: null,
      rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  assert.equal(shouldOmitRoleDiscrepancy(ambiguousNullAttendance), false);

  const org = peerReview({
    id: 'org-hist', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 5, direction: 'sent',
  });
  const train = peerReview({
    id: 'train-hist', kind: 'training', subjectContextId: null, peerRating: null,
    organizationScore: null, comment: 'ok', direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: false },
  });
  assert.deepEqual(privateReviewsOnly([peerReview(), org, train]).map(r => r.id), ['review-1', 'org-hist', 'train-hist']);
  assert.deepEqual(privateReviewsForGame([org, peerReview({ id: 'x', gameId: 'other' })], game.id).map(r => r.id), ['org-hist']);
  assert.equal(feedbackSectionVisible(game.id, {
    installed: true,
    capabilities: {
      canCreateOrganization: true, organizationRecipientDisplay: 'Host', canCreateTraining: false,
    },
  }, { received: { status: 'idle' }, sent: { status: 'idle' } }), true);

  // Coordinator: organization score-or-comment; training requires comment; kind drafts stay separated.
  const s = setup({
    results: {
      ...heldPresent,
      feedback: {
        ...feedbackReady,
        capabilities: {
          ...feedbackReady.capabilities,
          canCreatePeer: false,
          canCreateOrganization: true,
          canCreateTraining: true,
          organizationRecipientDisplay: 'PG3 manager',
          peerSubjects: [],
        },
      },
    },
    reviews: { received: [train], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  s.coordinator.setFeedbackDraft(game.id, {
    mode: 'organization', organizationScore: 5, organizationComment: '',
    trainingComment: 'не переносить',
  });
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: { kind: 'organization', experienceAssertion: 'i_experienced_this_game', organizationScore: 5 },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'organization-create');
  await s.coordinator.confirm();
  assert.equal(s.sentPkts.filter(p => p.kind === 'organization-create').length, 1);
  const orgSent = s.sentPkts.at(-1);
  assert.ok(orgSent && orgSent.kind === 'organization-create');
  assert.equal(orgSent.body.kind, 'organization');
  assert.ok(!('subjectContextId' in orgSent.body));
  assert.ok(!('peerRating' in orgSent.body));
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.trainingComment, 'не переносить');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationScore, null);

  s.coordinator.setFeedbackDraft(game.id, { mode: 'training', trainingComment: 'Как прошла тренировка' });
  s.coordinator.review({
    kind: 'training-create', gameId: game.id,
    body: {
      kind: 'training', experienceAssertion: 'i_experienced_this_game',
      comment: 'Как прошла тренировка',
    },
  });
  await s.coordinator.confirm();
  assert.equal(s.sentPkts.filter(p => p.kind === 'training-create').length, 1);

  // Empty training intentionally rejected before confirm.
  s.coordinator.setFeedbackDraft(game.id, { trainingComment: '' });
  s.coordinator.review({
    kind: 'training-create', gameId: game.id,
    body: { kind: 'training', experienceAssertion: 'i_experienced_this_game', comment: '   ' },
  });
  assert.equal(s.coordinator.getSnapshot().review, null);

  // Non-peer report blocked even if canReport wrongly set.
  await s.coordinator.loadReviews('received');
  const orgRecv = peerReview({
    id: 'org-recv', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 3, direction: 'received',
    allowedActions: { canEdit: false, canReply: true, canReport: true },
  });
  s.reviews.received = [orgRecv];
  s.port.reviews = async () => ({ items: structuredClone(s.reviews.received), nextCursor: null });
  await s.coordinator.loadReviews('received');
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: orgRecv.id, reportConsent: true, reportConsentVersion: 1,
  });
  s.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: orgRecv.id,
    body: {
      expectedVersion: 1, reasonCode: 'spam', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(s.coordinator.getSnapshot().review, null);

  // Reply works for organization/training when canReply + typed history.
  s.coordinator.setFeedbackDraft(game.id, { replyText: { [orgRecv.id]: 'Спасибо за отзыв' } });
  s.coordinator.review({
    kind: 'peer-reply', gameId: game.id, reviewId: orgRecv.id,
    body: { expectedVersion: 0, text: 'Спасибо за отзыв' },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-reply');
  await s.coordinator.confirm();
  assert.equal(s.sentPkts.filter(p => p.kind === 'peer-reply').length, 1);
});

test('#522 private role: discrepancy REQUIRED/UNEXPECTED preserve draft; writes-off blocks create; denied history still lists kinds', async () => {
  const heldPresent: Results = {
    ...result,
    feedback: {
      ...feedbackReady,
      capabilities: {
        ...feedbackReady.capabilities,
        canCreatePeer: false,
        canCreateOrganization: true,
        canCreateTraining: true,
        peerSubjects: [],
      },
    },
    attendance: {
      installed: true, writesEnabled: true,
      myAttendance: {
        contextId: 'me', value: 'absent', version: 1, late: false,
        assertion: { actorDisplay: 'Org', source: 'manager_explicit', at: date },
        acknowledgedVersion: null, dispute: null, displayName: 'Я',
        allowedActions: {
          canSetAttendance: false, canAcknowledge: false, canDispute: false,
          canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
        },
      },
      roster: null, rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  assert.equal(shouldOmitRoleDiscrepancy(heldPresent), false);

  const s = setup({ results: heldPresent, reviews: { received: [], sent: [] } });
  await s.coordinator.loadResults(game.id);
  s.port.send = async (p: Packet) => {
    s.sentPkts.push(p);
    if (p.kind === 'organization-create' && !('discrepancyExplanation' in p.body && p.body.discrepancyExplanation)) {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_REQUIRED');
    }
    if (p.kind === 'organization-create' && p.body.discrepancyExplanation === 'лишнее') {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_UNEXPECTED');
    }
    return peerReview({
      id: 'org-ok', kind: 'organization', subjectContextId: null, peerRating: null,
      organizationScore: p.kind === 'organization-create' ? (p.body.organizationScore ?? null) : null,
      comment: p.kind === 'organization-create' ? (p.body.comment ?? null) : null,
      discrepancyExplanation: p.kind === 'organization-create' ? (p.body.discrepancyExplanation ?? null) : null,
      tags: [], direction: 'sent',
    });
  };
  s.coordinator.setFeedbackDraft(game.id, {
    mode: 'organization', organizationScore: 3, organizationComment: 'черновик',
  });
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: { kind: 'organization', experienceAssertion: 'i_experienced_this_game', organizationScore: 3, comment: 'черновик' },
  });
  await s.coordinator.confirm();
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationComment, 'черновик');
  assert.equal(
    boundRoleDiscrepancyFieldError(
      s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision,
      'organization',
      heldPresent,
    ),
    DISCREPANCY_REQUIRED_MESSAGE,
  );
  assert.match(s.coordinator.getSnapshot().notice ?? '', /пояснение расхождения/i);

  s.coordinator.setFeedbackDraft(game.id, {
    organizationDiscrepancy: 'лишнее', discrepancyDecision: null,
  });
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      organizationScore: 3, comment: 'черновик', discrepancyExplanation: 'лишнее',
    },
  });
  await s.coordinator.confirm();
  assert.equal(
    boundRoleDiscrepancyFieldError(
      s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision,
      'organization',
      heldPresent,
    ),
    DISCREPANCY_UNEXPECTED_MESSAGE,
  );
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationComment, 'черновик');

  // Writes-off: create blocked; historical ACK path not opened.
  const off = setup({
    results: {
      ...heldPresent,
      feedback: { ...heldPresent.feedback!, writesEnabled: false },
    },
  });
  await off.coordinator.loadResults(game.id);
  off.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: { kind: 'organization', experienceAssertion: 'i_experienced_this_game', organizationScore: 2 },
  });
  assert.equal(off.coordinator.getSnapshot().review, null);

  // Denied results still surface private org/training history.
  const orgHist = peerReview({
    id: 'org-deny', kind: 'organization', subjectContextId: null, peerRating: null,
    organizationScore: 4, direction: 'sent',
  });
  const denied = setup({ results: 'deny', reviews: { received: [], sent: [orgHist] } });
  await denied.coordinator.loadReviews('sent');
  assert.equal(denied.coordinator.getSnapshot().reviewHistory.sent.status, 'ready');
  assert.deepEqual(
    privateReviewsForGame(denied.coordinator.getSnapshot().reviewHistory.sent.data?.items ?? [], game.id).map(r => r.id),
    ['org-deny'],
  );
  assert.equal(feedbackSectionVisible(game.id, undefined, {
    received: { status: 'idle' },
    sent: { status: 'ready', data: { items: [orgHist], nextCursor: null } },
  }), true);
});

test('#522 Root A/B: default-kind discrepancy patch, ambiguous null attendance, lost-tab display mode', async () => {
  // Explicit rendered kind — draft.mode undefined (default org/training) must still write.
  assert.deepEqual(
    feedbackDiscrepancyDraftPatch('organization', 'пояснение орг'),
    { organizationDiscrepancy: 'пояснение орг', discrepancyDecision: null },
  );
  assert.deepEqual(
    feedbackDiscrepancyDraftPatch('training', 'пояснение трен'),
    { trainingDiscrepancy: 'пояснение трен', discrepancyDecision: null },
  );
  const requiredOrg = roleDiscrepancyDecisionFromError(
    'organization', 'FEEDBACK_DISCREPANCY_REQUIRED', result,
  );
  assert.deepEqual(
    feedbackDiscrepancyDraftPatch('organization', 'ещё', requiredOrg),
    { organizationDiscrepancy: 'ещё', discrepancyDecision: requiredOrg },
  );
  const unexpectedTrain = roleDiscrepancyDecisionFromError(
    'training', 'FEEDBACK_DISCREPANCY_UNEXPECTED', result,
  );
  assert.deepEqual(
    feedbackDiscrepancyDraftPatch('training', 'ещё', unexpectedTrain),
    { trainingDiscrepancy: 'ещё', discrepancyDecision: null },
  );

  assert.equal(resolveFeedbackDisplayMode(undefined, {
    peer: false, organization: true, training: false,
  }), 'organization');
  assert.equal(resolveFeedbackDisplayMode(undefined, {
    peer: false, organization: false, training: true,
  }), 'training');
  // Lost training tab: display falls back; draft.mode is not rewritten by the helper.
  assert.equal(resolveFeedbackDisplayMode('training', {
    peer: false, organization: true, training: false,
  }), 'organization');
  assert.equal(resolveFeedbackDisplayMode('received', {
    peer: false, organization: false, training: false,
  }), 'received');

  const ambiguousNull: Results = {
    ...result,
    attendance: {
      installed: true, writesEnabled: true, myAttendance: null, roster: null,
      rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  assert.equal(shouldOmitRoleDiscrepancy(ambiguousNull), false);
  assert.deepEqual(roleDiscrepancyPresentation(ambiguousNull, null), {
    visible: true, editable: true, omitFromWire: false, hint: null,
  });

  const heldPresent: Results = {
    ...result,
    attendance: {
      installed: true, writesEnabled: true,
      myAttendance: {
        contextId: 'me', value: 'present', version: 1, late: false,
        assertion: { actorDisplay: null, source: 'self_attested', at: date },
        acknowledgedVersion: null, dispute: null, displayName: 'Я',
        allowedActions: {
          canSetAttendance: false, canAcknowledge: false, canDispute: false,
          canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
        },
      },
      roster: null, rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  assert.deepEqual(roleDiscrepancyPresentation(heldPresent, null), {
    visible: true, editable: false, omitFromWire: true, hint: DISCREPANCY_OMIT_HINT,
  });
  // Server REQUIRED recovers even when prior omit inference would drop text.
  assert.deepEqual(roleDiscrepancyPresentation(heldPresent, DISCREPANCY_REQUIRED_MESSAGE), {
    visible: true, editable: true, omitFromWire: false, hint: null,
  });
  assert.deepEqual(roleDiscrepancyPresentation(heldPresent, DISCREPANCY_UNEXPECTED_MESSAGE), {
    visible: true, editable: false, omitFromWire: true, hint: DISCREPANCY_OMIT_HINT,
  });

  const s = setup({
    results: {
      ...ambiguousNull,
      feedback: {
        ...feedbackReady,
        capabilities: {
          ...feedbackReady.capabilities,
          canCreatePeer: false,
          canCreateOrganization: true,
          canCreateTraining: true,
          peerSubjects: [],
        },
      },
    },
    reviews: { received: [], sent: [] },
  });
  await s.coordinator.loadResults(game.id);
  // Default mode (no draft.mode): kind-separated discrepancy + peer text retained.
  s.coordinator.setFeedbackDraft(game.id, {
    comment: 'peer-keep',
    ...feedbackDiscrepancyDraftPatch('organization', 'нужно пояснение'),
  });
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.mode, undefined);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationDiscrepancy, 'нужно пояснение');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.comment, 'peer-keep');
  s.coordinator.setFeedbackDraft(game.id, feedbackDiscrepancyDraftPatch('training', 'трен пояснение'));
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.trainingDiscrepancy, 'трен пояснение');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationDiscrepancy, 'нужно пояснение');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.comment, 'peer-keep');

  s.port.send = async (p: Packet) => {
    s.sentPkts.push(p);
    if (p.kind === 'organization-create' && !p.body.discrepancyExplanation) {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_REQUIRED');
    }
    return peerReview({
      id: 'org-ambig', kind: 'organization', subjectContextId: null, peerRating: null,
      organizationScore: null, comment: p.kind === 'organization-create' ? (p.body.comment ?? null) : null,
      discrepancyExplanation: p.kind === 'organization-create' ? (p.body.discrepancyExplanation ?? null) : null,
      tags: [], direction: 'sent',
    });
  };
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      comment: 'после ambiguous', discrepancyExplanation: 'нужно пояснение',
    },
  });
  await s.coordinator.confirm();
  const orgAmbigSent = s.sentPkts.at(-1);
  assert.ok(orgAmbigSent && orgAmbigSent.kind === 'organization-create');
  assert.equal(orgAmbigSent.body.discrepancyExplanation, 'нужно пояснение');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.comment, 'peer-keep');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.trainingDiscrepancy, 'трен пояснение');
});

test('#522 Astra address3: REQUIRED empty discrepancy blocks create; readonly org score Choice disabled', () => {
  // Explicit REQUIRED + empty/whitespace-normalized current-role text blocks; filled text does not.
  // Spaces/newlines alone normalize to empty (trim); tab/C0 are retained for strict wire rejection.
  assert.equal(roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_REQUIRED_MESSAGE, ''), true);
  assert.equal(
    roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_REQUIRED_MESSAGE, normalizeFormReason('   \n  ')),
    true,
  );
  assert.equal(
    roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_REQUIRED_MESSAGE, normalizeFormReason(' \r\n  ')),
    true,
  );
  const withTab = normalizeFormReason('   \n\t  ');
  assert.equal(withTab, '    \t  ', 'tab/C0 must survive normalize for strict wire rejection');
  assert.equal(
    roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_REQUIRED_MESSAGE, withTab),
    false,
    'preserved tab is non-empty; emptiness gate must not pretend trim removed C0',
  );
  assert.equal(
    roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_REQUIRED_MESSAGE, normalizeFormReason('пояснение')),
    false,
  );
  // First ambiguous open / non-REQUIRED must not require discrepancy before submit.
  assert.equal(roleDiscrepancyRequiredBlocksCreate(null, ''), false);
  assert.equal(roleDiscrepancyRequiredBlocksCreate(undefined, ''), false);
  assert.equal(roleDiscrepancyRequiredBlocksCreate(DISCREPANCY_UNEXPECTED_MESSAGE, ''), false);
  assert.equal(roleDiscrepancyRequiredBlocksCreate('other field copy', ''), false);

  const ui = readFileSync(new NodeURL('../src/components/postgame-feedback.tsx', import.meta.url), 'utf8');
  // Readonly organization score affordance: existing Choice gets disabled={!canCreateOrganization}.
  assert.match(ui, /title="Без оценки"[\s\S]*?disabled=\{!canCreateOrganization\}/);
  assert.match(ui, /title=\{String\(n\)\}[\s\S]*?disabled=\{!canCreateOrganization\}/);
  // CTA + handler gate on the same helper for current-role discrepancy after REQUIRED.
  assert.match(ui, /roleDiscrepancyRequiredBlocksCreate/);
  assert.match(ui, /disabled=\{!canCreateOrganization \|\| orgRequiredBlocks/);
  assert.match(ui, /disabled=\{!canCreateTraining \|\| trainingRequiredBlocks/);
  assert.match(
    ui,
    /if \(roleDiscrepancyRequiredBlocksCreate\(discrepancyError, normalizeFormReason\(orgDiscrepancy\)\)\) return;/,
  );
  assert.match(
    ui,
    /if \(roleDiscrepancyRequiredBlocksCreate\(discrepancyError, normalizeFormReason\(trainingDiscrepancy\)\)\) return;/,
  );
  // UI binds through active decision helpers — not a game-global discrepancyFieldError string.
  assert.match(ui, /roleDiscrepancyActiveDecision/);
  assert.match(ui, /boundRoleDiscrepancyFieldError/);
});

test('#522 address7: UNEXPECTED present→fresh absent/contested/not_held; kind fallback; REQUIRED same-context recover', async () => {
  const presentRow: Attendance = {
    contextId: 'me', value: 'present', version: 1, late: false,
    assertion: { actorDisplay: null, source: 'self_attested', at: date },
    acknowledgedVersion: null, dispute: null,
    displayName: 'Я',
    allowedActions: {
      canSetAttendance: false, canAcknowledge: false, canDispute: false,
      canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
    },
  };
  let live: Results = {
    ...result,
    feedback: {
      ...feedbackReady,
      capabilities: {
        ...feedbackReady.capabilities,
        canCreatePeer: false,
        canCreateOrganization: true,
        canCreateTraining: true,
        peerSubjects: [],
      },
    },
    attendance: {
      installed: true, writesEnabled: true,
      myAttendance: presentRow,
      roster: null, rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  const s = setup({ results: live, reviews: { received: [], sent: [] } });
  s.port.results = async (_a: Actor, id: string) => ({ ...structuredClone(live), gameId: id });
  await s.coordinator.loadResults(game.id);

  s.port.send = async (p: Packet) => {
    s.sentPkts.push(p);
    if (p.kind === 'organization-create' && p.body.discrepancyExplanation) {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_UNEXPECTED');
    }
    if (p.kind === 'training-create' && !p.body.discrepancyExplanation) {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_REQUIRED');
    }
    return peerReview({
      id: 'role-bound', kind: p.kind === 'training-create' ? 'training' : 'organization',
      subjectContextId: null, peerRating: null, organizationScore: null,
      comment: 'ok', tags: [], direction: 'sent',
    });
  };

  // UNEXPECTED on present organization — decision bound to organization+present.
  s.coordinator.setFeedbackDraft(game.id, {
    mode: 'organization', organizationComment: 'org-draft', organizationDiscrepancy: 'лишнее',
  });
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      comment: 'org-draft', discrepancyExplanation: 'лишнее',
    },
  });
  await s.coordinator.confirm();
  const unexpectedDecision = s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision;
  assert.ok(unexpectedDecision);
  assert.equal(unexpectedDecision.kind, 'organization');
  assert.equal(unexpectedDecision.fieldError, DISCREPANCY_UNEXPECTED_MESSAGE);
  assert.deepEqual(unexpectedDecision.context, roleDiscrepancyContextFromResults(live));
  assert.equal(
    boundRoleDiscrepancyFieldError(unexpectedDecision, 'organization', live),
    DISCREPANCY_UNEXPECTED_MESSAGE,
  );
  assert.deepEqual(
    roleDiscrepancyPresentation(live, boundRoleDiscrepancyFieldError(unexpectedDecision, 'organization', live)),
    { visible: true, editable: false, omitFromWire: true, hint: DISCREPANCY_OMIT_HINT },
  );
  // Cross-kind: training surface must not inherit organization UNEXPECTED.
  assert.equal(boundRoleDiscrepancyFieldError(unexpectedDecision, 'training', live), null);
  assert.deepEqual(
    roleDiscrepancyPresentation(live, boundRoleDiscrepancyFieldError(unexpectedDecision, 'training', live)),
    { visible: true, editable: false, omitFromWire: true, hint: DISCREPANCY_OMIT_HINT },
  );

  // Kind fallback display (lost training tab → organization): training decision never applies to org.
  const trainRequired = roleDiscrepancyDecisionFromError('training', 'FEEDBACK_DISCREPANCY_REQUIRED', live);
  assert.equal(
    resolveFeedbackDisplayMode('training', { peer: false, organization: true, training: false }),
    'organization',
  );
  assert.equal(
    boundRoleDiscrepancyFieldError(trainRequired, 'organization', live),
    null,
    'fallback display must not transplant training decision onto organization',
  );
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationComment, 'org-draft');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationDiscrepancy, 'лишнее');

  // Fresh absent: retire UNEXPECTED; form becomes editable without a predictably-bad confirmation.
  live = {
    ...live,
    attendance: {
      ...live.attendance!,
      myAttendance: { ...presentRow, value: 'absent', version: 2 },
    },
  };
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision, null);
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationComment, 'org-draft');
  assert.equal(s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationDiscrepancy, 'лишнее');
  assert.deepEqual(roleDiscrepancyPresentation(live, null), {
    visible: true, editable: true, omitFromWire: false, hint: null,
  });

  // Contested (open dispute on present) and not_held also unbound from prior present UNEXPECTED.
  const contested: Results = {
    ...live,
    attendance: {
      ...live.attendance!,
      myAttendance: {
        ...presentRow,
        value: 'present',
        dispute: { id: 'd1', version: 1, challengedVersion: 1, status: 'open' },
      },
    },
  };
  const notHeld: Results = {
    ...live,
    outcome: { ...live.outcome, value: 'not_held' },
    attendance: {
      ...live.attendance!,
      myAttendance: presentRow,
    },
  };
  const stalePresentResults: Results = {
    ...result,
    attendance: {
      installed: true, writesEnabled: true,
      myAttendance: presentRow,
      roster: null, rosterNextCursor: null, summary: null,
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
  };
  const stalePresentUnexpected = roleDiscrepancyDecisionFromError(
    'organization', 'FEEDBACK_DISCREPANCY_UNEXPECTED',
    stalePresentResults,
  );
  assert.equal(boundRoleDiscrepancyFieldError(stalePresentUnexpected, 'organization', contested), null);
  assert.equal(boundRoleDiscrepancyFieldError(stalePresentUnexpected, 'organization', notHeld), null);
  assert.deepEqual(roleDiscrepancyPresentation(contested, null), {
    visible: true, editable: true, omitFromWire: false, hint: null,
  });
  assert.deepEqual(roleDiscrepancyPresentation(notHeld, null), {
    visible: true, editable: true, omitFromWire: false, hint: null,
  });

  // REQUIRED recovery persists while editing in the SAME absent context.
  s.port.send = async (p: Packet) => {
    s.sentPkts.push(p);
    if (p.kind === 'organization-create' && !p.body.discrepancyExplanation) {
      throw new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_REQUIRED');
    }
    return peerReview({
      id: 'org-req', kind: 'organization', subjectContextId: null, peerRating: null,
      organizationScore: null, comment: 'after', tags: [], direction: 'sent',
      discrepancyExplanation: p.kind === 'organization-create' ? (p.body.discrepancyExplanation ?? null) : null,
    });
  };
  s.coordinator.setFeedbackDraft(game.id, {
    mode: 'organization', organizationComment: 'after-absent', organizationDiscrepancy: '',
  });
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: { kind: 'organization', experienceAssertion: 'i_experienced_this_game', comment: 'after-absent' },
  });
  await s.coordinator.confirm();
  const requiredDecision = s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision;
  assert.ok(requiredDecision);
  assert.equal(requiredDecision.fieldError, DISCREPANCY_REQUIRED_MESSAGE);
  assert.equal(
    boundRoleDiscrepancyFieldError(requiredDecision, 'organization', live),
    DISCREPANCY_REQUIRED_MESSAGE,
  );
  const editPatch = feedbackDiscrepancyDraftPatch(
    'organization',
    'пояснение после absent',
    roleDiscrepancyActiveDecision(requiredDecision, 'organization', live),
  );
  assert.equal(editPatch.discrepancyDecision?.fieldError, DISCREPANCY_REQUIRED_MESSAGE);
  s.coordinator.setFeedbackDraft(game.id, editPatch);
  assert.equal(
    s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision?.fieldError,
    DISCREPANCY_REQUIRED_MESSAGE,
  );
  assert.equal(
    s.coordinator.getSnapshot().feedbackDrafts[game.id]?.organizationDiscrepancy,
    'пояснение после absent',
  );
  // New kind must not receive the organization REQUIRED decision.
  assert.equal(boundRoleDiscrepancyFieldError(
    s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision,
    'training',
    live,
  ), null);
});

test('ROOT: delayed role error must not bind to a newer unrelated outcome context', async () => {
  let live: Results = structuredClone(result);
  const s = setup({ results: live, reviews: { received: [], sent: [] } });
  s.port.results = async (_a: Actor, id: string) => ({ ...structuredClone(live), gameId: id });
  await s.coordinator.loadResults(game.id);
  let rejectSend!: (e: unknown) => void;
  s.port.send = async () => new Promise((_resolve, reject) => { rejectSend = reject; });
  s.coordinator.review({ kind: 'organization-create', gameId: game.id,
    body: { kind: 'organization', experienceAssertion: 'i_experienced_this_game', comment: 'context race', discrepancyExplanation: 'old context' } });
  const pending = s.coordinator.confirm();
  await Promise.resolve();
  live = { ...live, outcome: { ...live.outcome, value: 'not_held', version: 2 } };
  await s.coordinator.loadResults(game.id);
  rejectSend(new PostgameError('business', 422, 'FEEDBACK_DISCREPANCY_UNEXPECTED'));
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  const decision = s.coordinator.getSnapshot().feedbackDrafts[game.id]?.discrepancyDecision;
  assert.equal(boundRoleDiscrepancyFieldError(decision, 'organization', live), null,
    'old request rejection cannot suppress explanation required by newer not_held context');
});

test('ROOT: UNKNOWN role retry keeps original owned packet discrepancy context', async () => {
  let live: Results = structuredClone(result);
  const s = setup({ results: live, reviews: { received: [], sent: [] } });
  s.port.results = async (_a: Actor, id: string) => ({ ...structuredClone(live), gameId: id });
  await s.coordinator.loadResults(game.id);
  const heldContext = roleDiscrepancyContextFromResults(live);
  s.port.send = async () => { throw new PostgameError('network', 0); };
  s.coordinator.review({
    kind: 'organization-create', gameId: game.id,
    body: {
      kind: 'organization', experienceAssertion: 'i_experienced_this_game',
      comment: 'unknown race', discrepancyExplanation: 'old held',
    },
  });
  await s.coordinator.confirm();
  const unknownCmd = s.coordinator.getSnapshot().command;
  assert.equal(unknownCmd?.status, 'unknown');
  assert.deepEqual(unknownCmd?.roleDiscrepancyContext, heldContext);
  assert.ok(unknownCmd?.packet);
  assert.ok(!('roleDiscrepancyContext' in unknownCmd.packet),
    'owned-packet fingerprint must not leak onto the API wire packet');

  live = { ...live, outcome: { ...live.outcome, value: 'not_held', version: 2 } };
  await s.coordinator.loadResults(game.id);
  // Reconcile stays non-definite; prove retry does not recapture from the newer context.
  s.port.send = async () => { throw new PostgameError('network', 0); };
  await s.coordinator.reconcile(game.id);
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  assert.deepEqual(
    s.coordinator.getSnapshot().command?.roleDiscrepancyContext,
    heldContext,
    'UNKNOWN retry must keep original owned-packet context, not recapture not_held',
  );
});

test('#522 hub private feedback history helpers + read-only loadReviews (no write)', async () => {
  assert.deepEqual(feedbackResultsNavParams(game.id), { gameId: game.id, section: 'feedback' });
  assert.throws(() => feedbackResultsNavParams('bad id'));
  assert.equal(parseResultsFeedbackSection('feedback'), 'feedback');
  assert.equal(parseResultsFeedbackSection('clarification'), null);
  assert.equal(peerReviewHistoryLabel('neutral'), 'Нейтрально');
  assert.equal(privateReviewKindHistoryLabel('peer'), 'Отзыв игроку');
  assert.equal(privateReviewKindHistoryLabel('training'), 'Тренировочный отзыв');
  assert.equal(privateHubHistoryEmptyText('sent'), 'Пока нет отправленных отзывов');
  assert.equal(privateReviewHistoryDetail(peerReview({ kind: 'peer', peerRating: 'difficulties' })), 'Были трудности');
  assert.match(formatPrivateReviewWhen(date), /\d/);

  const ui = readFileSync(new NodeURL('../src/components/postgame-feedback.tsx', import.meta.url), 'utf8');
  assert.match(ui, /draft\.mode \?\? \(openFeedback \? 'received' : undefined\)/);
  assert.match(ui, /PrivateFeedbackHistorySheet/);
  const rowFn = ui.match(/function PrivateHistoryRow\([\s\S]*?\n\}\n\n\/\*\*/)?.[0] ?? '';
  assert.match(rowFn, /PrivateHistoryRow/);
  assert.doesNotMatch(rowFn, /owner\.review|setFeedbackDraft/);

  let writes = 0;
  const calls: Array<{ direction: string; cursor?: string }> = [];
  const page1 = {
    items: [
      peerReview({ id: 'hub-1', direction: 'received', comment: 'private-text', recipientDisplay: 'Name' }),
      peerReview({
        id: 'hub-2', gameId: 'other-game', direction: 'received', kind: 'organization',
        subjectContextId: null, peerRating: null, organizationScore: 5, reply: {
          text: 'row-reply', version: 1, editedAt: null, updatedAt: date,
        },
      }),
    ],
    nextCursor: 'cur-1' as string | null,
  };
  const s = setup({ reviews: { received: [] } });
  s.port.reviews = async (_a, direction, cursor) => {
    calls.push({ direction, cursor });
    if (!cursor) return { items: structuredClone(page1.items), nextCursor: page1.nextCursor };
    return { items: [peerReview({ id: 'hub-3', direction: 'received' })], nextCursor: null };
  };
  s.port.send = async () => { writes++; throw new PostgameError('invalid'); };
  await s.coordinator.loadReviews('received');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.items.length, 2);
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.nextCursor, 'cur-1');
  assert.equal(
    s.coordinator.getSnapshot().reviewsById['hub-2']?.reply?.text,
    'row-reply',
  );
  await s.coordinator.loadReviews('received', true);
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.items.length, 3);
  assert.equal(s.coordinator.getSnapshot().reviewHistory.received.data?.nextCursor, null);
  assert.deepEqual(calls.map(c => c.cursor), [undefined, 'cur-1']);
  assert.equal(writes, 0);
});

