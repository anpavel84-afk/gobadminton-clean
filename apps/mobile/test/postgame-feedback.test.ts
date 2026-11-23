import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseResults, parsePrivateReview, parseMeReviewsPage, parseReviewReportReceipt,
  wire, validateReceipt, peerCreateReasonLabel, peerReviewsOnly, peerReviewsForGame,
  feedbackSectionVisible, mergeReviewPages, projectReviewsFromStore, reviewCommandsOpen,
  displayOnlyReview, resolvePeerDraftSubject, peerHistoryEmptyText,
} from '../src/postgame.ts';
import type { Intent, Packet, PrivateReview, Results } from '../src/postgame.ts';
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