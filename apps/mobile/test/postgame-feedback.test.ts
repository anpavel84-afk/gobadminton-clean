import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseResults, parsePrivateReview, parseMeReviewsPage, parseReviewReportReceipt,
  wire, validateReceipt, peerCreateReasonLabel, peerReviewsOnly, peerReviewsForGame,
  feedbackSectionVisible, mergeReviewPages,
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
    send: async (p: Packet): Promise<unknown> => {
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
  assert.equal(validateReceipt(created, create).kind, 'peer');

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
  // Report available when writes disabled.
  s.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-1', reportConsent: true, reportConsentVersion: 1, reportReason: 'harassment',
  });
  s.coordinator.review({
    kind: 'peer-report', gameId: game.id, reviewId: 'recv-1',
    body: {
      expectedVersion: 1, reasonCode: 'harassment', detail: null,
      shareReviewWithSupport: true, gameId: game.id,
    },
  });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'peer-report');
  await s.coordinator.confirm();
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

  r.coordinator.setFeedbackDraft(game.id, {
    reportReviewId: 'recv-2', reportConsent: true, reportConsentVersion: 2, reportDetail: 'keep me',
  });
  // Simulate conflict reset path via setFeedbackDraft version change.
  r.coordinator.setFeedbackDraft(game.id, { reportConsentVersion: 3 });
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportConsent, false);
  assert.equal(r.coordinator.getSnapshot().feedbackDrafts[game.id]?.reportDetail, 'keep me');
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
  s.port.send = async (p, a) => {
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