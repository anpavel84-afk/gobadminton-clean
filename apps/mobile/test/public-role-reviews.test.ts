import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, wire, validateReceipt, reviewComment } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import {
  applyOwnPublicAckToItem,
  bindPublicRoleFocusRef,
  buildPublicCreateBody,
  buildPublicWithdrawBody,
  clearPublicRoleFocusTarget,
  coldClaimStillOwnsNavigation,
  coldPendingResumeEventualLive,
  coldPendingResumePathPhase,
  consentPreviewBody,
  currentPublicRoleFocusTarget,
  draftEditorKey,
  emptyPublicRoleDraft,
  isPublicRolePacketKind,
  mayPaintOwnPublicReceipt,
  mayPaintPublicReplyReceipt,
  mayPaintPublicReportReceipt,
  mayWithdrawOwnPublic,
  mergeActorAwareReaderItem,
  mergeOwnPublicReviewItem,
  normalizePublicRoleText,
  parseConsentPreview,
  parseOwnEligibility,
  parseOwnPublicRoleReviewsPage,
  parsePublicRoleMutationReceipt,
  parsePublicRoleReplyReceipt,
  parsePublicRoleReportReceipt,
  publicAuthorReturnPath,
  publicRoleBusinessNotice,
  publicRoleReplyBusinessNotice,
  publicRoleReportBusinessNotice,
  publicRoleReviewText,
  publicRoleStatusLabel,
  publicRoleTopics,
  rememberPublicRoleFocusTarget,
  samePublicReaderOrigin,
  subjectOwnReplyLabel,
  usableOwnRoleHandle,
  PublicRoleError,
} from '../src/public-role-reviews.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const handle = 'a'.repeat(32);
const handleB = 'b'.repeat(32);
const gameId = '11111111-1111-4111-8111-111111111111';
const gameB = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise(resolve => setImmediate(resolve));
/** Press-time capture: rendered actor + current history surface gen. */
function withdrawWithRender(
  owner: PostgameCoordinator,
  item: Parameters<PostgameCoordinator['withdrawOwnPublic']>[0],
  expectedActor: Actor | null = actor,
) {
  const surface = owner.getSnapshot().publicSurface;
  assert.equal(surface?.mode, 'history');
  return owner.withdrawOwnPublic(item, expectedActor, surface!.gen);
}

function eligibilityBody(over: Record<string, unknown> = {}) {
  return {
    roleHandle: handle,
    role: 'organization',
    bases: [{
      gameId,
      role: 'organization',
      endsAt: '2026-10-01T18:00:00.000Z',
      proofVersion: 2,
      outcomeVersion: 1,
      attendanceVersion: 1,
      projectionHashPreview: null,
      admission: 'may_submit',
      reason: null,
    }],
    ...over,
  };
}

function idlePort(over: Partial<ConstructorParameters<typeof PostgameCoordinator>[0]> = {}) {
  return {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => { throw new PostgameError('private', 404); },
    publicEligibility: async () => eligibilityBody(),
    publicConsentPreview: async () => ({ consentProjectionHash: '1'.repeat(64) }),
    publicOwnReviews: async () => ({ items: [] }),
    send: async () => { throw new PostgameError('invalid'); },
    ...over,
  };
}

test('public text allows LF / normalizes CRLF; private reviewComment rejects LF', () => {
  assert.equal(normalizePublicRoleText('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(publicRoleReviewText('Первая строка\nВторая'), 'Первая строка\nВторая');
  assert.throws(() => publicRoleReviewText(''), PublicRoleError);
  assert.throws(() => publicRoleReviewText('x'.repeat(501)), PublicRoleError);
  assert.throws(() => publicRoleReviewText('bad\u0000'), PublicRoleError);
  assert.throws(() => reviewComment('Первая\nВторая'));
  assert.deepEqual(publicRoleTopics('organization', ['agreements', 'flow']), ['agreements', 'flow']);
  assert.throws(() => publicRoleTopics('organization', ['explanations']), PublicRoleError);
  assert.throws(() => publicRoleTopics('training', ['agreements', 'flow', 'attention']), PublicRoleError);
});

test('eligibility/own/receipt parsers and withdraw status fence', () => {
  const elig = parseOwnEligibility(eligibilityBody());
  assert.equal(elig.bases[0]?.admission, 'may_submit');
  assert.equal(elig.bases[0]?.role, 'organization');
  assert.throws(() => parseOwnEligibility(eligibilityBody({ roleHandle: 'b'.repeat(32) }), handle), PublicRoleError);
  // Nested basis role required and must match parent — reject mismatch / missing / invalid.
  assert.throws(() => parseOwnEligibility(eligibilityBody({
    bases: [{
      gameId,
      role: 'training',
      endsAt: '2026-10-01T18:00:00.000Z',
      proofVersion: 2,
      outcomeVersion: 1,
      attendanceVersion: 1,
      projectionHashPreview: null,
      admission: 'may_submit',
      reason: null,
    }],
  })), PublicRoleError);
  assert.throws(() => parseOwnEligibility(eligibilityBody({
    bases: [{
      gameId,
      endsAt: '2026-10-01T18:00:00.000Z',
      proofVersion: 2,
      outcomeVersion: 1,
      attendanceVersion: 1,
      projectionHashPreview: null,
      admission: 'may_submit',
      reason: null,
    }],
  })), PublicRoleError);
  assert.throws(() => parseOwnEligibility(eligibilityBody({
    bases: [{
      gameId,
      role: 'peer',
      endsAt: '2026-10-01T18:00:00.000Z',
      proofVersion: 2,
      outcomeVersion: 1,
      attendanceVersion: 1,
      projectionHashPreview: null,
      admission: 'may_submit',
      reason: null,
    }],
  })), PublicRoleError);

  const page = parseOwnPublicRoleReviewsPage({
    items: [{
      id: '22222222-2222-4222-8222-222222222222',
      reviewHandle: 'c'.repeat(32),
      role: 'organization',
      roleHandle: '',
      subjectDisplayName: null,
      status: 'withdrawn',
      version: 3,
      text: null,
      topics: [],
      receiptToken: null,
      pendingIntakeStatus: 'waiting_intake',
      approvedRevision: null,
      pendingRevision: null,
    }],
  });
  assert.equal(usableOwnRoleHandle(page.items[0]!.roleHandle), false);
  assert.equal(publicRoleStatusLabel(page.items[0]!.status, page.items[0]!.pendingIntakeStatus), 'Отозван');
  assert.equal(mayWithdrawOwnPublic(page.items[0]!), false);

  const receipt = parsePublicRoleMutationReceipt({
    id: '22222222-2222-4222-8222-222222222222',
    reviewHandle: 'c'.repeat(32),
    version: 3,
    status: 'withdrawn',
    receiptToken: 'opaque-token',
    pendingIntakeStatus: 'waiting_intake',
  });
  assert.equal(publicRoleStatusLabel(receipt.status, receipt.pendingIntakeStatus), 'Отозван');
  assert.equal(parseConsentPreview({ consentProjectionHash: 'd'.repeat(64) }).consentProjectionHash, 'd'.repeat(64));
  assert.match(publicRoleBusinessNotice('VERSION_CONFLICT'), /Основание устарело/);
  assert.doesNotMatch(publicRoleBusinessNotice('BASIS_VERSION_CONFLICT'), /BASIS_VERSION_CONFLICT/);
});

test('consentPreview/create/withdraw wire + guest return path reuse existing game route', () => {
  const body = buildPublicCreateBody({
    basis: parseOwnEligibility(eligibilityBody()).bases[0]!,
    role: 'organization',
    text: 'Текст\nс переносом',
    topics: ['agreements'],
    consentProjectionHash: 'e'.repeat(64),
  });
  const create = wire({ kind: 'public-role-create', gameId, roleHandle: handle, body });
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/me/role-reviews');
  const withdraw = wire({
    kind: 'public-role-command',
    gameId: 'public-role-own',
    reviewId: '22222222-2222-4222-8222-222222222222',
    body: buildPublicWithdrawBody({
      id: '22222222-2222-4222-8222-222222222222',
      reviewHandle: 'c'.repeat(32),
      role: 'organization',
      roleHandle: handle,
      subjectDisplayName: 'Org',
      status: 'submitted',
      version: 2,
      text: 'x',
      topics: [],
      receiptToken: 't',
      pendingIntakeStatus: 'waiting_intake',
      approvedRevision: null,
      pendingRevision: 1,
    }),
  });
  assert.equal(withdraw.path, `/me/role-reviews/22222222-2222-4222-8222-222222222222/commands`);
  assert.equal((withdraw.body as { action: string }).action, 'withdraw');
  // Transport admits revision actions too — not falsely restricted at wire level.
  const revision = wire({
    kind: 'public-role-command',
    gameId,
    reviewId: '22222222-2222-4222-8222-222222222222',
    body: {
      action: 'submit_revision',
      expectedVersion: 2,
      gameId,
      expectedBasisVersions: { proofVersion: 2, outcomeVersion: 1, attendanceVersion: 1 },
      text: 'Правка',
      topics: ['flow'],
      consentProjectionHash: 'f'.repeat(64),
    },
  });
  assert.equal((revision.body as { action: string }).action, 'submit_revision');
  assert.equal(publicAuthorReturnPath(gameId), `/games/${encodeURIComponent(gameId)}`);
  assert.equal(isPublicRolePacketKind('public-role-create'), true);
  assert.equal(isPublicRolePacketKind('peer-create'), false);
  const preview = consentPreviewBody({
    role: 'organization', subjectRoleHandle: handle, text: 'Hi\nthere', topics: ['communication'],
  });
  assert.equal(preview.text.includes('\n'), true);
});

test('PostgameCoordinator owns public mutations; consent reset; late eligibility ignored; no autosend', async () => {
  const keys: string[] = [];
  let eligCalls = 0;
  let releaseElig!: () => void;
  const lateElig = new Promise<unknown>(resolve => { releaseElig = () => resolve(eligibilityBody()); });
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async () => {
        eligCalls += 1;
        if (eligCalls === 1) return lateElig;
        return eligibilityBody();
      },
      publicConsentPreview: async () => ({ consentProjectionHash: '1'.repeat(64) }),
      send: async (packet) => {
        keys.push(packet.key);
        if (packet.kind === 'public-role-create') {
          return {
            id: '33333333-3333-4333-8333-333333333333',
            reviewHandle: 'c'.repeat(32),
            version: 1,
            status: 'submitted',
            receiptToken: 'receipt-1',
            pendingIntakeStatus: 'waiting_intake',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => `key-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'loading');
  // Change selection while first eligibility in flight.
  owner.patchPublicDraft({ audience: 'public', text: 'Черновик', topics: ['agreements'], consent: true });
  assert.equal(owner.getSnapshot().publicDraft?.consent, false); // reset on text/topics/audience
  owner.patchPublicDraft({ consent: true });
  assert.equal(owner.getSnapshot().publicDraft?.consent, true);
  owner.closePublicSurface();
  releaseElig();
  await tick();
  // Late eligibility must not reopen closed surface / overwrite.
  assert.equal(owner.getSnapshot().publicSurface, null);
  assert.equal(owner.getSnapshot().publicDraft, null);

  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  // Production: consent-sensitive patch resets; explicit consent is a separate action.
  owner.patchPublicDraft({ audience: 'public', text: 'Публичный текст', topics: ['flow'] });
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  owner.patchPublicDraft({ consent: true });
  await owner.submitPublicCreate();
  await tick();
  assert.equal(owner.getSnapshot().publicReceipt?.receiptToken, 'receipt-1');
  assert.equal(owner.getSnapshot().publicReceipt?.pendingIntakeStatus, 'waiting_intake');
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(keys.length, 1);

  // Reauth same actor restores UNKNOWN journal only — never autosend public create.
  owner.patchPublicDraft({ text: 'ignored-after-receipt' });
  const before = keys.length;
  owner.setActor({ ...actor, generation: 2 });
  await tick();
  assert.equal(keys.length, before);
});

test('withdraw receipt status fence; original UNKNOWN replay; business 422 keeps draft', async () => {
  const keys: string[] = [];
  let mode: 'ok' | 'unknown' | 'business' = 'ok';
  const item = {
    id: '44444444-4444-4444-8444-444444444444',
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Текст',
    topics: ['agreements'],
    receiptToken: 'r',
    pendingIntakeStatus: 'waiting_intake' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => ({ items: [item] }),
      send: async (packet) => {
        keys.push(packet.key);
        if (mode === 'unknown') throw new PostgameError('network', 503);
        if (mode === 'business') throw new PostgameError('business', 422, 'VERSION_CONFLICT');
        return {
          id: item.id,
          reviewHandle: item.reviewHandle,
          version: 3,
          status: 'withdrawn',
          receiptToken: 'withdraw-receipt',
          pendingIntakeStatus: 'waiting_intake',
        };
      },
    }),
  }, () => `w-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  mode = 'unknown';
  await withdrawWithRender(owner, item);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().publicNotice?.includes('мог'), true);
  const originalKey = owner.getSnapshot().command!.packet.key;
  mode = 'ok';
  await owner.reconcilePublic();
  await tick();
  assert.equal(keys.filter(k => k === originalKey).length, 2);
  assert.equal(owner.getSnapshot().publicReceipt?.status, 'withdrawn');
  assert.equal(publicRoleStatusLabel(
    owner.getSnapshot().publicReceipt!.status,
    owner.getSnapshot().publicReceipt!.pendingIntakeStatus,
  ), 'Отозван');
});

test('business 422 on public create retains draft and clears consent hash', async () => {
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicConsentPreview: async () => ({ consentProjectionHash: '2'.repeat(64) }),
      send: async () => { throw new PostgameError('business', 422, 'VERSION_CONFLICT'); },
    }),
  }, () => 'biz-key');
  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  owner.patchPublicDraft({ audience: 'public', text: 'Сохранить черновик', topics: ['agreements'] });
  owner.patchPublicDraft({ consent: true });
  await owner.submitPublicCreate();
  await tick();
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Сохранить черновик');
  assert.equal(owner.getSnapshot().publicConsentHash, null);
  assert.equal(owner.getSnapshot().command, null);
  assert.ok(owner.getSnapshot().publicNotice);
  assert.doesNotMatch(owner.getSnapshot().publicNotice ?? '', /VERSION_CONFLICT|BASIS_VERSION_CONFLICT/);
  assert.match(owner.getSnapshot().publicNotice ?? '', /Основание устарело|допуск|согласие/);
});

test('focus bind: attach→remember→detach clears by retained identity; stable held survives null cleanup', () => {
  const held: { current: { focus: () => void } | null } = { current: null };
  const a = { focus: () => {} };
  const b = { focus: () => {} };

  // Realistic callback-ref order: attach, remember on press, detach on unmount (React already nulled ref.current).
  bindPublicRoleFocusRef(held, a);
  rememberPublicRoleFocusTarget(held.current);
  assert.equal(currentPublicRoleFocusTarget(), a);
  bindPublicRoleFocusRef(held, null);
  assert.equal(held.current, null);
  assert.equal(currentPublicRoleFocusTarget(), null);

  bindPublicRoleFocusRef(held, b);
  rememberPublicRoleFocusTarget(held.current);
  clearPublicRoleFocusTarget(a);
  assert.equal(currentPublicRoleFocusTarget(), b);
  bindPublicRoleFocusRef(held, null);
  assert.equal(currentPublicRoleFocusTarget(), null);

  // Detach with nothing remembered is safe.
  bindPublicRoleFocusRef(held, a);
  bindPublicRoleFocusRef(held, null);
  assert.equal(currentPublicRoleFocusTarget(), null);
});

test('applyOwnPublicAckToItem: older withdraw ACK cannot replace newer typed GET; same-version terminal applies', () => {
  const base = {
    id: '55555555-5555-4555-8555-555555555555',
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    topics: ['agreements'],
    receiptToken: 'live',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: null,
  };
  const v4 = { ...base, status: 'submitted', version: 4, text: 'После повторной подачи' };
  const ackV3 = {
    id: base.id,
    reviewHandle: base.reviewHandle,
    version: 3,
    status: 'withdrawn',
    receiptToken: 'old-ack',
    pendingIntakeStatus: 'waiting_intake' as const,
  };
  assert.equal(applyOwnPublicAckToItem(v4, ackV3, 4).version, 4);
  assert.equal(applyOwnPublicAckToItem(v4, ackV3, 4).status, 'submitted');
  assert.equal(applyOwnPublicAckToItem(v4, ackV3, 4).text, 'После повторной подачи');
  assert.equal(mayPaintOwnPublicReceipt(ackV3, v4, 4), false);
  assert.equal(mayPaintOwnPublicReceipt(ackV3, v4, 2), false);
  assert.equal(mayPaintOwnPublicReceipt(ackV3, { ...base, status: 'submitted', version: 2, text: 'x' }, 2), true);

  const v3 = { ...base, status: 'submitted', version: 3, text: 'До отзыва' };
  const applied = applyOwnPublicAckToItem(v3, ackV3, 3);
  assert.equal(applied.status, 'withdrawn');
  assert.equal(applied.version, 3);
  assert.equal(applied.text, null);
  assert.equal(mayWithdrawOwnPublic(applied), false);
});

test('deferred withdraw ACK after newer typed GET keeps v4; same-actor UNKNOWN settle does not downgrade', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Исходный текст',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const v4 = {
    ...v2,
    version: 4,
    text: 'Повторная подача с другого клиента',
    receiptToken: 'r4',
    pendingRevision: 2,
  };
  let ownPhase: 'v2' | 'v4' = 'v2';
  let releaseWithdraw!: (value: unknown) => void;
  const withdrawPending = new Promise<unknown>(resolve => { releaseWithdraw = resolve; });
  let mode: 'defer' | 'unknown' | 'ack' = 'defer';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => ({
        items: ownPhase === 'v4' ? [v4] : [v2],
      }),
      send: async () => {
        if (mode === 'unknown') throw new PostgameError('network', 503);
        if (mode === 'defer') return withdrawPending;
        return {
          id: reviewId,
          reviewHandle: 'c'.repeat(32),
          version: 3,
          status: 'withdrawn',
          receiptToken: 'w-receipt-v3',
          pendingIntakeStatus: 'waiting_intake',
        };
      },
    }),
  }, () => 'deferred-ack-v3');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 2);

  // Delayed withdraw ACK v3 in flight.
  mode = 'defer';
  const withdrawPromise = withdrawWithRender(owner, v2);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');

  // Typed GET v4 wins while ACK is still outstanding.
  ownPhase = 'v4';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.text, v4.text);
  assert.equal(mayWithdrawOwnPublic(owner.getSnapshot().publicOwn.data!.items[0]!), true);

  releaseWithdraw({
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    version: 3,
    status: 'withdrawn',
    receiptToken: 'w-receipt-v3',
    pendingIntakeStatus: 'waiting_intake',
  });
  await withdrawPromise;
  await tick();

  const afterAck = owner.getSnapshot().publicOwn.data?.items.find(i => i.id === reviewId);
  assert.equal(afterAck?.version, 4);
  assert.equal(afterAck?.status, 'submitted');
  assert.equal(afterAck?.text, v4.text);
  assert.equal(mayWithdrawOwnPublic(afterAck!), true);
  assert.equal(owner.getSnapshot().command, null);
  // (a) Older ACK settles journal but must not paint withdrawn receipt/notice over typed v4.
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Отзыв отозван.');

  // Same-actor UNKNOWN: original withdraw packet settles later without downgrading accepted v4.
  mode = 'unknown';
  await withdrawWithRender(owner, v4);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownKey = owner.getSnapshot().command!.packet.key;
  owner.setActor({ ...actor, generation: 2 });
  await tick();
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');

  ownPhase = 'v4';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);

  mode = 'ack';
  await owner.reconcilePublic();
  await tick();
  const afterUnknown = owner.getSnapshot().publicOwn.data?.items.find(i => i.id === reviewId);
  assert.equal(afterUnknown?.version, 4);
  assert.equal(afterUnknown?.status, 'submitted');
  assert.equal(afterUnknown?.text, v4.text);
  assert.equal(mayWithdrawOwnPublic(afterUnknown!), true);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
});

test('withdraw order: ACK v3 then stale GET v2 cannot resurrect text or withdraw action', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Живой текст',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'waiting_intake' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  let ownPhase: 'v2' | 'stale-v2' | 'v3' = 'v2';
  let releaseWithdraw!: (value: unknown) => void;
  const withdrawPending = new Promise<unknown>(resolve => { releaseWithdraw = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => {
        if (ownPhase === 'v3') {
          return {
            items: [{
              ...v2,
              status: 'withdrawn',
              version: 3,
              text: null,
              pendingIntakeStatus: 'none',
              receiptToken: null,
            }],
          };
        }
        return { items: [v2] };
      },
      send: async () => withdrawPending,
    }),
  }, () => 'withdraw-order');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.text, 'Живой текст');
  assert.equal(mayWithdrawOwnPublic(owner.getSnapshot().publicOwn.data!.items[0]!), true);

  const withdrawPromise = withdrawWithRender(owner, v2);
  await tick();
  releaseWithdraw({
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    version: 3,
    status: 'withdrawn',
    receiptToken: 'w-receipt',
    pendingIntakeStatus: 'waiting_intake',
  });
  await withdrawPromise;
  await tick();

  const afterAck = owner.getSnapshot().publicOwn.data?.items.find(i => i.id === reviewId);
  assert.equal(afterAck?.status, 'withdrawn');
  assert.equal(afterAck?.text, null);
  assert.equal(mayWithdrawOwnPublic(afterAck!), false);
  assert.equal(owner.getSnapshot().publicReceipt?.status, 'withdrawn');
  assert.equal(owner.getSnapshot().publicNotice, 'Отзыв отозван.');

  // Follow-up stale GET v2 must not repaint old text / writable withdraw.
  ownPhase = 'stale-v2';
  await owner.loadOwnPublicReviews();
  await tick();
  const afterStale = owner.getSnapshot().publicOwn.data?.items.find(i => i.id === reviewId);
  assert.equal(afterStale?.status, 'withdrawn');
  assert.equal(afterStale?.text, null);
  assert.equal(mayWithdrawOwnPublic(afterStale!), false);
  assert.equal(mergeOwnPublicReviewItem(afterAck, v2, 3), null);
  // Stale older GET must not clear a matching terminal receipt.
  assert.equal(owner.getSnapshot().publicReceipt?.status, 'withdrawn');

  ownPhase = 'v3';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 3);
});

test('ACK v3 then typed GET v4 retires painted withdraw receipt/notice', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'До отзыва',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const v4 = {
    ...v2,
    version: 4,
    text: 'Повторная подача',
    receiptToken: 'r4',
    pendingRevision: 2,
  };
  let ownPhase: 'v2' | 'v4' = 'v2';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => ({ items: ownPhase === 'v4' ? [v4] : [v2] }),
      send: async () => ({
        id: reviewId,
        reviewHandle: 'c'.repeat(32),
        version: 3,
        status: 'withdrawn',
        receiptToken: 'w-receipt-v3',
        pendingIntakeStatus: 'waiting_intake',
      }),
    }),
  }, () => 'ack-then-get-v4');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  await withdrawWithRender(owner, v2);
  await tick();
  assert.equal(owner.getSnapshot().publicReceipt?.status, 'withdrawn');
  assert.equal(owner.getSnapshot().publicNotice, 'Отзыв отозван.');

  // (b) Newer typed GET retires the historical receipt/notice.
  ownPhase = 'v4';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.status, 'submitted');
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().publicNotice, null);
});

test('captured withdraw callback: 403 / new version / surface close / account rotation send zero', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const ready = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Живой',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const newer = { ...ready, version: 3, text: 'Новее', receiptToken: 'r3' };
  let ownPhase: 'ready' | 'newer' | 'deny' = 'ready';
  let sends = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => {
        if (ownPhase === 'deny') throw new PostgameError('private', 403);
        return { items: ownPhase === 'newer' ? [newer] : [ready] };
      },
      send: async () => {
        sends += 1;
        return {
          id: reviewId,
          reviewHandle: 'c'.repeat(32),
          version: 3,
          status: 'withdrawn',
          receiptToken: 'w',
          pendingIntakeStatus: 'waiting_intake',
        };
      },
    }),
  }, () => `cap-${sends}`);

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  const surface = owner.getSnapshot().publicSurface!;
  const capturedItem = ready;
  const capturedActor = actor;
  const capturedGen = surface.gen;
  const invokeCaptured = () => owner.withdrawOwnPublic(capturedItem, capturedActor, capturedGen);

  // Private 403 retires own-list authority — captured press must not POST.
  ownPhase = 'deny';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.status, 'unavailable');
  await invokeCaptured();
  await tick();
  assert.equal(sends, 0);
  assert.equal(owner.getSnapshot().command, null);

  // Restore ready, capture again, then typed newer version fences the old row.
  ownPhase = 'ready';
  owner.closePublicSurface();
  owner.openOwnPublicHistory();
  await tick();
  const genReady = owner.getSnapshot().publicSurface!.gen;
  const capturedReady = () => owner.withdrawOwnPublic(ready, actor, genReady);
  ownPhase = 'newer';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 3);
  await capturedReady();
  await tick();
  assert.equal(sends, 0);
  assert.equal(owner.getSnapshot().command, null);

  // Surface close fences the prior generation.
  const genBeforeClose = owner.getSnapshot().publicSurface!.gen;
  const itemBeforeClose = owner.getSnapshot().publicOwn.data!.items[0]!;
  owner.closePublicSurface();
  await owner.withdrawOwnPublic(itemBeforeClose, actor, genBeforeClose);
  await tick();
  assert.equal(sends, 0);

  // Account rotation: previous account's captured row must not bind to the new actor.
  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  const genA = owner.getSnapshot().publicSurface!.gen;
  const itemA = owner.getSnapshot().publicOwn.data!.items[0]!;
  owner.setActor({ actorId: 'actor-b', sessionId: 'session-b', generation: 1 });
  owner.openOwnPublicHistory();
  await tick();
  await owner.withdrawOwnPublic(itemA, actor, genA);
  await tick();
  assert.equal(sends, 0);
  assert.equal(owner.getSnapshot().command, null);

  // (d) Legitimate current-row withdraw still posts; same-actor UNKNOWN preserves original packet.
  ownPhase = 'newer';
  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  const live = owner.getSnapshot().publicOwn.data!.items[0]!;
  await withdrawWithRender(owner, live);
  await tick();
  assert.equal(sends, 1);
  assert.equal(owner.getSnapshot().publicReceipt?.status, 'withdrawn');
});

test('late create receipt cannot attach to other composer; ABA + UNKNOWN same-actor reauth', async () => {
  const keys: string[] = [];
  let releaseA!: (value: unknown) => void;
  const pendingA = new Promise<unknown>(resolve => { releaseA = resolve; });
  let createCalls = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async (_actor, roleHandle) => eligibilityBody({
        roleHandle,
        bases: [{
          gameId: roleHandle === handleB ? gameB : gameId,
          role: 'organization',
          endsAt: '2026-10-01T18:00:00.000Z',
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
          projectionHashPreview: null,
          admission: 'may_submit',
          reason: null,
        }],
      }),
      publicConsentPreview: async () => ({ consentProjectionHash: '3'.repeat(64) }),
      send: async (packet) => {
        keys.push(packet.key);
        createCalls += 1;
        if (createCalls === 1) return pendingA;
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `late-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId, subjectDisplayName: 'A' });
  await tick();
  owner.patchPublicDraft({ audience: 'public', text: 'Отзыв A', topics: ['agreements'] });
  owner.patchPublicDraft({ consent: true });
  const sendA = owner.submitPublicCreate();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');

  // Close A / open B while A in flight.
  owner.closePublicSurface();
  owner.openPublicComposer({ roleHandle: handleB, role: 'organization', gameId: gameB, subjectDisplayName: 'B' });
  await tick();
  owner.patchPublicDraft({ audience: 'public', text: 'Черновик B', topics: ['flow'] });
  owner.patchPublicDraft({ consent: true });
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Черновик B');

  releaseA({
    id: '66666666-6666-4666-8666-666666666666',
    reviewHandle: 'c'.repeat(32),
    version: 1,
    status: 'submitted',
    receiptToken: 'receipt-A',
    pendingIntakeStatus: 'waiting_intake',
  });
  await sendA;
  await tick();
  // Late A must not disable B with A's receipt.
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Черновик B');
  assert.equal(owner.getSnapshot().publicSurface?.target?.roleHandle, handleB);

  // ABA: reopen A — still must not inherit late A receipt (new surface generation).
  owner.closePublicSurface();
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId, subjectDisplayName: 'A' });
  await tick();
  assert.equal(owner.getSnapshot().publicReceipt, null);

  // UNKNOWN path: create, then reauth — journal restores, never autosend.
  owner.patchPublicDraft({ audience: 'public', text: 'Повтор', topics: ['communication'] });
  owner.patchPublicDraft({ consent: true });
  await owner.submitPublicCreate();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownKey = owner.getSnapshot().command!.packet.key;
  const before = keys.length;
  owner.setActor({ ...actor, generation: 2 });
  await tick();
  assert.equal(keys.length, before);
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
});

test('validateReceipt accepts public create/withdraw; CommandReview excludes public kinds; APK36 root-host source wiring', () => {
  const createPacket = {
    kind: 'public-role-create' as const,
    gameId,
    roleHandle: handle,
    body: buildPublicCreateBody({
      basis: parseOwnEligibility(eligibilityBody()).bases[0]!,
      role: 'organization',
      text: 'Ок',
      topics: [],
      consentProjectionHash: 'a'.repeat(64),
    }),
    actor,
    key: 'k1',
    method: 'POST' as const,
    path: '/me/role-reviews',
  };
  const receipt = validateReceipt({
    id: '55555555-5555-4555-8555-555555555555',
    reviewHandle: 'c'.repeat(32),
    version: 1,
    status: 'submitted',
    receiptToken: 'tok',
    pendingIntakeStatus: 'waiting_intake',
  }, createPacket);
  assert.equal('receiptToken' in receipt && receipt.receiptToken, 'tok');

  // Source wiring only — not mounted native acceptance.
  const root = read('../app/_layout.tsx');
  assert.match(root, /AuthProvider/);
  assert.match(root, /PublicRoleReviewHost/);
  assert.match(root, /<AuthProvider>[\s\S]*<PublicRoleReviewHost\s*\/>/);

  const postgameUi = read('../src/components/postgame.tsx');
  assert.match(postgameUi, /isPublicRolePacketKind/);
  assert.match(postgameUi, /publicRole/);
  assert.doesNotMatch(postgameUi, /PublicRoleReviewHost/);
  assert.doesNotMatch(postgameUi, /bindPublicRoleFocusTrigger/);

  const disclosure = read('../src/components/game-role-reputation.tsx');
  assert.match(disclosure, /Поделиться опытом/);
  assert.match(disclosure, /beginPublicAuthorEntry/);
  assert.match(disclosure, /PublicRoleAuthorEntryButton|rememberPublicRoleFocusTarget/);
  assert.doesNotMatch(disclosure, /consumePendingPublicAuthor|resumePendingPublicAuthor/);
  assert.doesNotMatch(disclosure, /PublicRoleReviewHost/);
  assert.match(disclosure, /Ответить или пожаловаться|beginPublicReaderEntry|openPublicReader/);
  assert.match(disclosure, /publicReaderLocalGoal|publicAuthorLocalGoal/);
  assert.match(disclosure, /publicReaderReturnPath/);
  assert.doesNotMatch(disclosure, /rememberPendingPublicAuthor|rememberPendingPublicReader/);
  // Reply/report actions live on root reader sheet — not inside game-disclosure list rows.
  assert.doesNotMatch(disclosure, /allowedActions\.canReply|allowedActions\.canReport|Сообщить о нарушении/);
  assert.doesNotMatch(disclosure, /borderWidth:\s*1/);

  const host = read('../src/components/public-role-reviews.tsx');
  assert.doesNotMatch(host, /publicRoleHostListeners|notifyPublicRoleHostEpoch|forcePublicRoleHostReleaseForTest|usePublicRoleHostOwnership/);
  assert.match(host, /restorePublicTriggerFocus/);
  assert.match(host, /rememberPublicRoleFocusTarget/);
  assert.match(host, /clearPublicRoleFocusTarget/);
  assert.match(host, /claimPublicRoleGoal/);
  assert.match(host, /publicRoleGoalPath|router\.replace/);
  assert.match(host, /usePathname/);
  assert.match(host, /pendingResume|isLive/);
  assert.match(host, /coldClaimStillOwnsNavigation|navGenAtClaim|pathAtClaim/);
  assert.match(host, /coldPendingResumePathPhase|waitFromPath/);
  assert.match(host, /coldPendingResumeEventualLive|pathnameRef\.current/);
  assert.match(host, /openResumedPublicComposer|openResumedPublicReader/);
  assert.match(host, /resumePendingPublicAuthor/);
  assert.match(host, /resumePendingPublicReader/);
  assert.match(host, /PublicRoleAuthorEntryButton/);
  assert.match(host, /PublicRoleReaderSheet/);
  assert.match(host, /submitPublicReply|submitPublicReport/);
  assert.match(host, /canReply|canReport|Сообщить о нарушении/);
  assert.match(host, /Публикую ответ от своего имени по этой роли/);
  assert.match(host, /withdrawOwnPublic\(item,\s*s\.actor,\s*surface\.gen\)/);
  assert.match(host, /submitPublicReply\(item\.reviewHandle,\s*s\.actor,\s*s\.publicSurface!\.gen\)/);
  // Separate per-action receipt gates — not a combined reply+report rowDisabled.
  // Reply: handle-bound; report: handle + publishedRevision-bound (independent).
  assert.match(host, /reportAckRevision\s*=\s*s\.publicReportReceipt\?\.expectedRevision/);
  assert.match(
    host,
    /replyDisabled\s*=\s*threadBusy\s*\|\|\s*replyAckHandle\s*===\s*item\.reviewHandle/,
  );
  assert.match(
    host,
    /reportDisabled\s*=\s*threadBusy\s*\|\|\s*\(\s*reportAckHandle\s*===\s*item\.reviewHandle\s*&&\s*reportAckRevision\s*===\s*item\.publishedRevision\s*\)/,
  );
  assert.doesNotMatch(host, /rowDisabled\s*=\s*threadBusy[\s\S]*replyAckHandle[\s\S]*reportAckHandle/);
  assert.doesNotMatch(host, /без выдуманного исполнителя/);
  assert.match(host, /срок и исполнитель не обещаются/);

  const myGames = read('../app/my-games.tsx');
  assert.match(myGames, /Отзывы/);
  assert.match(myGames, /Мои публичные отзывы о ролях/);
  assert.match(myGames, /PublicOwnReviewsEntry|rememberPublicRoleFocusTarget/);

  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(coordinator, /resumePendingPublicAuthor/);
  assert.match(coordinator, /resumePendingPublicReader/);
  assert.match(coordinator, /clearPendingPublicGoals/);
  assert.match(coordinator, /rememberPendingPublicReader/);
  assert.match(coordinator, /openPublicReader/);
  assert.match(coordinator, /openResumedPublicComposer/);
  assert.match(coordinator, /openResumedPublicReader/);
  assert.match(coordinator, /publicGameRoleOrigin|publicPlayerRoleOrigin/);
  assert.match(coordinator, /resumeFrozenGameId/);
  assert.match(coordinator, /submitPublicReply/);
  assert.match(coordinator, /submitPublicReport/);
  assert.match(coordinator, /public-role-reply/);
  assert.match(coordinator, /public-role-report/);
  assert.match(coordinator, /mergeActorAwareReaderItem|mayPaintPublicReplyReceipt|mayPaintPublicReportReceipt/);

  const authCoordinator = read('../src/auth-coordinator.ts');
  assert.match(authCoordinator, /publicGameRoleOrigin:\s*\(gameId,\s*role\)\s*=>\s*publicApi\.gameRoleReputation/);
  assert.match(authCoordinator, /publicPlayerRoleOrigin:\s*\(publicPlayerId,\s*role,\s*query\)\s*=>\s*publicApi\.playerRoleReputation/);
  assert.match(authCoordinator, /persistExpiredAuthDrops/);

  const api = read('../src/native-api.ts');
  assert.match(api, /publicRoleEligibility/);
  assert.match(api, /publicRoleConsentPreview/);
  assert.match(api, /publicRoleOwn/);
  assert.match(api, /publicRoleByHandle/);
  assert.match(api, /\/me\/role-reviews\/eligibility/);
  assert.match(api, /\/me\/role-reviews\/consent-preview/);
  assert.match(api, /actorAwareRoleReputationPath|role-reputations\//);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /publicEligibility/);
  assert.match(auth, /publicConsentPreview/);
  assert.match(auth, /publicOwnReviews/);
  assert.match(auth, /publicRoleByHandle/);

  const controller = read('../../api/src/games/role-reputation.controller.ts');
  assert.match(controller, /requirePrincipal/);
  assert.match(controller, /requirePrincipalMutation/);
  assert.match(controller, /getByHandle[\s\S]*authorization[\s\S]*requirePrincipal[\s\S]*optionalSession/);
  assert.match(controller, /replyCommand[\s\S]*requirePrincipalMutation/);
  assert.match(controller, /report[\s\S]*requirePrincipalMutation/);
  assert.doesNotMatch(controller, /replyCommand[\s\S]*requireCookieMutation/);
  assert.doesNotMatch(controller, /report[\s\S]*requireCookieMutation/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 51);
  assert.equal(draftEditorKey(emptyPublicRoleDraft(gameId), handle, 'organization').includes(gameId), true);
});

test('resumePendingPublicAuthor consumes once under actor; logout/missing actor fences; empty draft no autosend', async () => {
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('invalid');
      },
    }),
  }, () => `key-${keys.length + 1}`);

  const target = { roleHandle: handle, role: 'organization' as const, gameId, subjectDisplayName: 'Org' };
  // No actor: remember ok, resume is a no-op.
  owner.rememberPendingPublicAuthor(target);
  assert.equal(owner.resumePendingPublicAuthor(), false);
  assert.equal(owner.getSnapshot().pendingPublicAuthor?.roleHandle, handle);
  assert.equal(owner.getSnapshot().publicSurface, null);

  owner.setActor(actor);
  assert.equal(owner.resumePendingPublicAuthor(), true);
  assert.equal(owner.getSnapshot().pendingPublicAuthor, null);
  assert.equal(owner.getSnapshot().publicSurface?.mode, 'composer');
  assert.equal(owner.getSnapshot().publicSurface?.target?.roleHandle, handle);
  assert.equal(owner.getSnapshot().publicDraft?.text, '');
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(keys.length, 0);

  // Exactly once — second resume with no pending is false; surface stays open, no autosend.
  assert.equal(owner.resumePendingPublicAuthor(), false);
  assert.equal(keys.length, 0);

  // Logout keeps pending if re-remembered after clear; resume without actor fails.
  owner.closePublicSurface();
  owner.rememberPendingPublicAuthor(target);
  owner.setActor(null);
  assert.equal(owner.resumePendingPublicAuthor(), false);
  assert.equal(owner.getSnapshot().pendingPublicAuthor?.gameId, gameId);
  assert.equal(owner.getSnapshot().publicSurface, null);

  // Late auth: same actor resumes once with fresh empty draft.
  owner.setActor(actor);
  assert.equal(owner.resumePendingPublicAuthor(), true);
  assert.equal(owner.getSnapshot().pendingPublicAuthor, null);
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(owner.getSnapshot().publicDraft?.text, '');
  assert.equal(keys.length, 0);
});

test('own list max 50; empty roleHandle not authoring authority', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: `66666666-6666-4666-8666-${String(i).padStart(12, '0')}`,
    reviewHandle: 'c'.repeat(32),
    role: 'training' as const,
    roleHandle: i === 0 ? '' : handle,
    subjectDisplayName: i === 0 ? null : 'T',
    status: 'published',
    version: 1,
    text: 'ok',
    topics: ['attention'],
    receiptToken: null,
    pendingIntakeStatus: 'none' as const,
    approvedRevision: 1,
    pendingRevision: null,
  }));
  const page = parseOwnPublicRoleReviewsPage({ items });
  assert.equal(page.items.length, 50);
  assert.equal(usableOwnRoleHandle(page.items[0]!.roleHandle), false);
  assert.throws(() => parseOwnPublicRoleReviewsPage({
    items: [...items, items[0]],
  }), PublicRoleError);
});

test('deferred consent preview retired by private 403 eligibility reread; dirty draft kept, no create', async () => {
  const keys: string[] = [];
  let releasePreview!: (value: unknown) => void;
  const previewPending = new Promise<unknown>(resolve => { releasePreview = resolve; });
  let eligPhase: 'ready' | 'deny' = 'ready';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async () => {
        if (eligPhase === 'deny') throw new PostgameError('private', 403);
        return eligibilityBody();
      },
      publicConsentPreview: async () => previewPending,
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('invalid');
      },
    }),
  }, () => `auth-retire-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'ready');
  owner.patchPublicDraft({ audience: 'public', text: 'Черновик до отзыва допуска', topics: ['agreements'] });
  owner.patchPublicDraft({ consent: true });
  assert.equal(owner.getSnapshot().publicDraft?.consent, true);

  const createPromise = owner.submitPublicCreate();
  await tick();
  assert.equal(keys.length, 0);

  eligPhase = 'deny';
  await owner.loadPublicEligibility();
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'unavailable');
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(owner.getSnapshot().publicConsentHash, null);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Черновик до отзыва допуска');
  assert.deepEqual(owner.getSnapshot().publicDraft?.topics, ['agreements']);
  assert.equal(owner.getSnapshot().publicDraft?.gameId, gameId);

  releasePreview({ consentProjectionHash: '4'.repeat(64) });
  await createPromise;
  await tick();
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(owner.getSnapshot().publicConsentHash, null);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Черновик до отзыва допуска');
});

test('deferred consent preview retired by eligibility network/malformed failure; no create', async () => {
  for (const mode of ['network', 'malformed'] as const) {
    const keys: string[] = [];
    let releasePreview!: (value: unknown) => void;
    const previewPending = new Promise<unknown>(resolve => { releasePreview = resolve; });
    let eligPhase: 'ready' | 'fail' = 'ready';
    const owner = new PostgameCoordinator({
      ...idlePort({
        publicEligibility: async () => {
          if (eligPhase === 'fail') {
            if (mode === 'network') throw new PostgameError('network', 503);
            return { roleHandle: handle, role: 'organization', bases: 'bad' };
          }
          return eligibilityBody();
        },
        publicConsentPreview: async () => previewPending,
        send: async (packet) => {
          keys.push(packet.key);
          throw new PostgameError('invalid');
        },
      }),
    }, () => `${mode}-${keys.length + 1}`);

    owner.setActor(actor);
    owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
    await tick();
    owner.patchPublicDraft({ audience: 'public', text: `Черновик ${mode}`, topics: ['flow'] });
    owner.patchPublicDraft({ consent: true });
    const createPromise = owner.submitPublicCreate();
    await tick();

    eligPhase = 'fail';
    await owner.loadPublicEligibility();
    await tick();
    assert.equal(owner.getSnapshot().publicEligibility.status, 'error');
    assert.equal(owner.getSnapshot().publicDraft?.consent, false);
    assert.equal(owner.getSnapshot().publicConsentHash, null);
    assert.equal(owner.getSnapshot().publicDraft?.text, `Черновик ${mode}`);

    releasePreview({ consentProjectionHash: '5'.repeat(64) });
    await createPromise;
    await tick();
    assert.equal(keys.length, 0, mode);
    assert.equal(owner.getSnapshot().command, null);
    assert.equal(owner.getSnapshot().publicDraft?.consent, false);
    assert.equal(owner.getSnapshot().publicConsentHash, null);
  }
});

test('deferred consent preview + newer basis revision does not auto-submit or rebase', async () => {
  const keys: string[] = [];
  let releasePreview!: (value: unknown) => void;
  const previewPending = new Promise<unknown>(resolve => { releasePreview = resolve; });
  let eligPhase: 'v1' | 'v2' = 'v1';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async () => eligibilityBody({
        bases: [{
          gameId,
          role: 'organization',
          endsAt: '2026-10-01T18:00:00.000Z',
          proofVersion: eligPhase === 'v2' ? 3 : 2,
          outcomeVersion: eligPhase === 'v2' ? 2 : 1,
          attendanceVersion: 1,
          projectionHashPreview: null,
          admission: 'may_submit',
          reason: null,
        }],
      }),
      publicConsentPreview: async () => previewPending,
      send: async (packet) => {
        keys.push(packet.key);
        return {
          id: '77777777-7777-4777-8777-777777777777',
          reviewHandle: 'c'.repeat(32),
          version: 1,
          status: 'submitted',
          receiptToken: 'should-not-send',
          pendingIntakeStatus: 'waiting_intake',
        };
      },
    }),
  }, () => `basis-rev-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  owner.patchPublicDraft({ audience: 'public', text: 'Текст до смены основания', topics: ['communication'] });
  owner.patchPublicDraft({ consent: true });
  const createPromise = owner.submitPublicCreate();
  await tick();
  assert.equal(keys.length, 0);

  eligPhase = 'v2';
  await owner.loadPublicEligibility();
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'ready');
  assert.equal(owner.getSnapshot().publicEligibility.data?.bases[0]?.proofVersion, 3);
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(owner.getSnapshot().publicConsentHash, null);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Текст до смены основания');
  assert.deepEqual(owner.getSnapshot().publicDraft?.topics, ['communication']);

  releasePreview({ consentProjectionHash: '6'.repeat(64) });
  await createPromise;
  await tick();
  // Retired preview must not create on captured v1 basis or silently rebase onto v2.
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().publicDraft?.consent, false);
  assert.equal(owner.getSnapshot().publicConsentHash, null);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'Текст до смены основания');
});

test('eligibility 401 retires consent; UNKNOWN create packet preserved without autosend', async () => {
  const keys: string[] = [];
  let releasePreview!: (value: unknown) => void;
  const previewPending = new Promise<unknown>(resolve => { releasePreview = resolve; });
  let eligPhase: 'ready' | 'auth' = 'ready';
  let sendMode: 'defer-preview' | 'unknown' = 'defer-preview';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async () => {
        if (eligPhase === 'auth') throw new PostgameError('private', 401);
        return eligibilityBody();
      },
      publicConsentPreview: async () => {
        if (sendMode === 'unknown') return { consentProjectionHash: '7'.repeat(64) };
        return previewPending;
      },
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `unk-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  owner.patchPublicDraft({ audience: 'public', text: 'UNKNOWN сохраняется', topics: ['agreements'] });
  owner.patchPublicDraft({ consent: true });

  // First: 401 during deferred preview retires authority without send.
  const blocked = owner.submitPublicCreate();
  await tick();
  eligPhase = 'auth';
  await owner.loadPublicEligibility();
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'unavailable');
  releasePreview({ consentProjectionHash: '8'.repeat(64) });
  await blocked;
  await tick();
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().publicDraft?.text, 'UNKNOWN сохраняется');

  // Fresh ready path → UNKNOWN create; same-actor reauth restores original key, never autosend.
  eligPhase = 'ready';
  await owner.loadPublicEligibility();
  await tick();
  owner.patchPublicDraft({ consent: true });
  sendMode = 'unknown';
  await owner.submitPublicCreate();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownKey = owner.getSnapshot().command!.packet.key;
  const before = keys.length;
  owner.setActor({ ...actor, generation: 2 });
  await tick();
  assert.equal(keys.length, before);
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
});

test('#522 QA5: null-actor reauth keeps version floor; deferred GET then older withdraw ACK cannot paint over v4', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Исходный текст',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const v4 = {
    ...v2,
    version: 4,
    text: 'Повторная подача с другого клиента',
    receiptToken: 'r4',
    pendingRevision: 2,
  };
  const ackV3 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    version: 3,
    status: 'withdrawn' as const,
    receiptToken: 'w-receipt-v3',
    pendingIntakeStatus: 'waiting_intake' as const,
  };
  let ownPhase: 'v2' | 'v4' | 'defer' = 'v2';
  let sendMode: 'unknown' | 'ack-v3' = 'unknown';
  let releaseOwn!: (value: unknown) => void;
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => {
        if (ownPhase === 'defer') {
          return new Promise(resolve => { releaseOwn = resolve; });
        }
        return { items: ownPhase === 'v4' ? [v4] : [v2] };
      },
      send: async () => {
        if (sendMode === 'ack-v3') return ackV3;
        throw new PostgameError('network', 503);
      },
    }),
  }, () => 'qa5-null-reauth-floor');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 2);

  // Withdraw v2 → UNKNOWN, then typed GET establishes resubmitted v4 (+ floor).
  await withdrawWithRender(owner, v2);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownKey = owner.getSnapshot().command!.packet.key;

  ownPhase = 'v4';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);
  assert.equal(mayPaintOwnPublicReceipt(ackV3, owner.getSnapshot().publicOwn.data!.items[0], 4), false);

  // Production AuthCoordinator.refresh(): show(hydrating) → postgame.setActor(null), then accept → setActor(same).
  // Must not bypass the null phase with a direct actor swap — that missed the floor wipe.
  ownPhase = 'defer';
  owner.setActor(null);
  await tick();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicOwn.data, undefined);
  assert.equal(owner.getSnapshot().publicReceipt, null);

  owner.setActor({ ...actor, sessionId: 'reauth-session', generation: 2 });
  await tick();
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().publicOwn.status, 'loading');
  // Private typed rows stay unloaded until GET; floor must still fence older ACK paint.
  assert.equal(owner.getSnapshot().publicOwn.data?.items?.[0]?.version, undefined);

  // Explicit reconciliation of original withdrawn ACK v3 must not paint over established v4 floor
  // even while the reauth GET is still outstanding (typed rows not yet restored).
  sendMode = 'ack-v3';
  ownPhase = 'v4'; // ACK follow-up GET may complete; deferred reauth GET stays stale.
  await owner.reconcilePublic();
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Отзыв отозван.');
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.status, 'submitted');

  // Resolve stale reauth GET (gen fenced) — must not resurrect withdrawn paint.
  releaseOwn({ items: [v4] });
  await tick();
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Отзыв отозван.');
});

test('#522 QA5: different account after null-actor quarantine cannot restore floor, UNKNOWN, or private rows', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Приватный текст аккаунта A',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const v4 = {
    ...v2,
    version: 4,
    text: 'Повторная подача A',
    receiptToken: 'r4',
    pendingRevision: 2,
  };
  const ackV3 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    version: 3,
    status: 'withdrawn' as const,
    receiptToken: 'w-receipt-v3',
    pendingIntakeStatus: 'waiting_intake' as const,
  };
  let ownPhase: 'v2' | 'v4' | 'empty' = 'v2';
  let sendMode: 'unknown' | 'ack-v3' = 'unknown';
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => ({ items: ownPhase === 'empty' ? [] : ownPhase === 'v4' ? [v4] : [v2] }),
      send: async (packet) => {
        keys.push(packet.key);
        if (sendMode === 'ack-v3') return ackV3;
        throw new PostgameError('network', 503);
      },
    }),
  }, () => 'qa5-cross-account');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  await withdrawWithRender(owner, v2);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  ownPhase = 'v4';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 4);

  // Hydrating null parks A's UNKNOWN + floor; account B must not inherit them.
  owner.setActor(null);
  await tick();
  ownPhase = 'empty';
  const beforeB = keys.length;
  owner.setActor({ actorId: 'actor-b', sessionId: 'session-b', generation: 1 });
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().publicDraft, null);
  assert.equal(owner.getSnapshot().publicOwn.data?.items?.length ?? 0, 0);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Отзыв отозван.');
  assert.equal(keys.length, beforeB);

  // B has no restored write/reconcile authority for A's packet; no cross-account send.
  sendMode = 'ack-v3';
  await owner.reconcilePublic();
  await tick();
  assert.equal(keys.length, beforeB);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);

  // Fresh empty own list for B is not overwritten by A's withdrawn ACK or private text.
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items?.length ?? 0, 0);
  assert.equal(owner.getSnapshot().publicOwn.data?.items?.[0]?.text, undefined);
});

test('#522 QA4: withdraw 409 VERSION_CONFLICT notice survives owning follow-up own-list GET', async () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const v2 = {
    id: reviewId,
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Живой текст',
    topics: ['agreements'],
    receiptToken: 'r2',
    pendingIntakeStatus: 'none' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  const conflictNotice = publicRoleBusinessNotice('VERSION_CONFLICT', 'command');
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicOwnReviews: async () => ({ items: [v2] }),
      send: async () => {
        throw new PostgameError('business', 409, 'VERSION_CONFLICT');
      },
    }),
  }, () => 'qa4-withdraw-409');

  owner.setActor(actor);
  owner.openOwnPublicHistory();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 2);
  assert.equal(owner.getSnapshot().publicReceipt, null);

  await withdrawWithRender(owner, v2);
  await tick();

  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReceipt, null);
  assert.equal(owner.getSnapshot().publicNotice, conflictNotice);
  assert.equal(owner.getSnapshot().publicOwn.status, 'ready');
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 2);
  // Owning automatic reread must not erase the actionable rejection explanation.
  assert.match(owner.getSnapshot().publicNotice ?? '', /Версия отзыва изменилась/);

  // Unrelated manual refresh without preserveNotice may clear a stale notice.
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicNotice, null);
});

test('#522 reader report cancel + profile origin omits game query; reply UNKNOWN keeps key', async () => {
  const reviewHandle = 'd'.repeat(32);
  const actorItem = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: { status: 'submitted', version: 0, pendingRevision: 1 },
    allowedActions: { canReport: true, canReply: true },
  };
  const page = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [actorItem],
    nextCursor: 'next-1',
    availability: 'available',
  };
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        if (query.cursor) {
          return { ...page, items: [{ ...actorItem, reviewHandle: 'e'.repeat(32) }], nextCursor: null };
        }
        // Profile origin must not invent gameId.
        assert.equal(query.gameId, undefined);
        return page;
      },
      publicConsentPreview: async () => ({ consentProjectionHash: 'b'.repeat(64) }),
      send: async (packet) => {
        keys.push(packet.key);
        if (packet.kind === 'public-role-reply') throw new PostgameError('network', 503);
        if (packet.kind === 'public-role-report') {
          assert.equal(packet.gameQuery, null);
          return { reportId: '88888888-8888-4888-8888-888888888888', receiptToken: 'r2', status: 'submitted' };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => `prof-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.nextCursor, 'next-1');
  await owner.loadPublicReader({ cursor: 'next-1', append: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 2);

  owner.beginPublicReport(actorItem);
  assert.equal(owner.getSnapshot().publicReportDraft?.reasonCode, 'harassment');
  owner.cancelPublicReport();
  assert.equal(owner.getSnapshot().publicReportDraft, null);
  assert.equal(keys.length, 0);

  owner.beginPublicReport(actorItem);
  owner.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Пояснение' });
  await owner.submitPublicReport();
  await tick();
  assert.equal(owner.getSnapshot().publicReportReceipt?.status, 'submitted');
  assert.equal(keys.length, 1);

  // Text edit resets consent — drive real separate edit → toggle → submit.
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Ответ субъекта' });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  await owner.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.kind, 'public-role-reply');
  const unknownPacket = owner.getSnapshot().command!.packet;
  assert.equal(unknownPacket.kind, 'public-role-reply');
  if (unknownPacket.kind !== 'public-role-reply') throw new Error('expected public-role-reply');
  assert.equal(unknownPacket.method, 'POST');
  assert.match(unknownPacket.path, /\/role-reviews\/[0-9a-f]{32}\/reply-commands/);
  assert.equal(unknownPacket.reviewHandle, reviewHandle);
  assert.equal(unknownPacket.body.action, 'submit_revision');
  assert.equal(unknownPacket.body.expectedVersion, 0);
  assert.equal(unknownPacket.body.expectedReviewRevision, 2);
  assert.equal(unknownPacket.body.text, 'Ответ субъекта');
  const unknownKey = unknownPacket.key;
  assert.equal(keys.length, 2);
  // Late surface replace must not inherit authority to autosend.
  owner.closePublicSurface();
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  const afterReplace = owner.getSnapshot().command;
  assert.ok(afterReplace);
  assert.equal(afterReplace.packet.key, unknownKey);
  assert.equal(afterReplace.status, 'unknown');
  assert.equal(afterReplace.packet.kind, 'public-role-reply');
  if (afterReplace.packet.kind !== 'public-role-reply') throw new Error('expected public-role-reply');
  assert.equal(afterReplace.packet.method, 'POST');
  assert.equal(afterReplace.packet.body.text, 'Ответ субъекта');
  assert.equal(isPublicRolePacketKind('public-role-reply'), true);
  assert.equal(isPublicRolePacketKind('public-role-report'), true);
});

test('#522 address1: subjectOwnReplyLabel is Russian human; raw status never printed', () => {
  assert.equal(subjectOwnReplyLabel({ status: 'submitted' }), 'Ваш ответ: ожидает разбора');
  assert.equal(subjectOwnReplyLabel({ status: 'revision_waiting' }), 'Ваш ответ: ожидает разбора');
  assert.equal(subjectOwnReplyLabel({ status: 'published' }), 'Ваш ответ: опубликован');
  assert.equal(subjectOwnReplyLabel({ status: 'needs_correction' }), 'Ваш ответ: нужна правка');
  assert.doesNotMatch(subjectOwnReplyLabel({ status: 'weird_code' }), /weird_code|submitted|revision_waiting/);
  assert.equal(
    mayPaintPublicReplyReceipt(
      { version: 1 },
      { replyAggregateVersion: 2, publishedRevision: 1, subjectOwnReply: { version: 2 } },
      0,
      1,
    ),
    false,
  );
  assert.equal(
    mayPaintPublicReplyReceipt(
      { version: 2 },
      { replyAggregateVersion: 1, publishedRevision: 1, subjectOwnReply: null },
      1,
      1,
    ),
    true,
  );
  assert.equal(
    mayPaintPublicReplyReceipt(
      { version: 1 },
      { replyAggregateVersion: 1, publishedRevision: 2, subjectOwnReply: null },
      0,
      1,
    ),
    false,
  );
  assert.equal(mayPaintPublicReportReceipt({ publishedRevision: 2 }, 2), true);
  assert.equal(mayPaintPublicReportReceipt({ publishedRevision: 3 }, 2), false);
  assert.equal(mayPaintPublicReportReceipt(undefined, 2), false);
  const older = {
    reviewHandle: 'd'.repeat(32),
    publishedRevision: 2,
    replyAggregateVersion: 1,
    subjectOwnReply: { status: 'submitted', version: 1, pendingRevision: 1 },
    allowedActions: { canReply: true, canReport: true },
  };
  const newer = {
    ...older,
    replyAggregateVersion: 3,
    subjectOwnReply: { status: 'revision_waiting', version: 3, pendingRevision: 2 },
    allowedActions: { canReply: false, canReport: true },
  };
  assert.equal(mergeActorAwareReaderItem(older, newer).replyAggregateVersion, 3);
  assert.equal(mergeActorAwareReaderItem(newer, older).replyAggregateVersion, 3);
  assert.equal(mergeActorAwareReaderItem(older, {
    ...older,
    allowedActions: { canReply: false, canReport: false },
  }).allowedActions.canReply, false);
});

test('#522 address1: reply consent retires on newer typed versions; dirty text kept', async () => {
  const reviewHandle = 'd'.repeat(32);
  const baseItem = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null,
    allowedActions: { canReport: true, canReply: true },
  };
  let page = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [baseItem],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'c'.repeat(64) }),
    }),
  }, () => 'consent-key');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Черновик ответа' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');
  page = {
    ...page,
    items: [{ ...baseItem, publishedRevision: 2, replyAggregateVersion: 1 }],
  };
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
});

test('#522 address1: append duplicate newer handle merges; older rights do not regress', async () => {
  const reviewHandle = 'd'.repeat(32);
  const v1 = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        if (query.cursor) {
          return {
            roleHandle: handle,
            role: 'organization',
            subjectDisplayName: 'Org',
            heldGamesCount: 1,
            countScope: 'confirmed_history',
            historyMayBeIncomplete: true,
            publishedReviewCount: 1,
            projectionVersion: 'q'.repeat(32),
            items: [{
              ...v1,
              replyAggregateVersion: 2,
              subjectOwnReply: { status: 'submitted', version: 2, pendingRevision: 1 },
              allowedActions: { canReport: true, canReply: false },
            }],
            nextCursor: null,
            availability: 'available',
          };
        }
        return {
          roleHandle: handle,
          role: 'organization',
          subjectDisplayName: 'Org',
          heldGamesCount: 1,
          countScope: 'confirmed_history',
          historyMayBeIncomplete: true,
          publishedReviewCount: 1,
          projectionVersion: 'q'.repeat(32),
          items: [v1],
          nextCursor: 'cur-1',
          availability: 'available',
        };
      },
    }),
  }, () => 'dup-key');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.replyAggregateVersion, 0);
  await owner.loadPublicReader({ cursor: 'cur-1', append: true });
  await tick();
  const item = owner.getSnapshot().publicReader.data?.items[0];
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 1);
  assert.equal(item?.replyAggregateVersion, 2);
  assert.equal(item?.allowedActions.canReply, false);
  assert.equal(item?.subjectOwnReply?.version, 2);
});

test('#522 address1: guest reader pending survives cancel; resumes once with fresh rights', async () => {
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => ({
        roleHandle: handle,
        role: 'organization',
        subjectDisplayName: 'Org',
        heldGamesCount: 1,
        countScope: 'confirmed_history',
        historyMayBeIncomplete: true,
        publishedReviewCount: 0,
        projectionVersion: 'q'.repeat(32),
        items: [],
        nextCursor: null,
        availability: 'available',
      }),
    }),
  }, () => 'reader-pending');
  const target = {
    roleHandle: handle,
    role: 'organization' as const,
    origin: { kind: 'profile' as const, publicPlayerId: 'public-peer-a' },
    subjectDisplayName: 'Org',
  };
  owner.rememberPendingPublicReader(target);
  assert.equal(owner.resumePendingPublicReader(), false);
  assert.equal(owner.getSnapshot().pendingPublicReader?.roleHandle, handle);
  // Cancelled guest auth (null actor) must not destroy remembered reader goal.
  owner.setActor(null);
  assert.equal(owner.getSnapshot().pendingPublicReader?.origin.kind, 'profile');
  owner.setActor(actor);
  assert.equal(owner.resumePendingPublicReader(), true);
  assert.equal(owner.getSnapshot().pendingPublicReader, null);
  assert.equal(owner.getSnapshot().publicSurface?.mode, 'reader');
  assert.equal(owner.getSnapshot().publicSurface?.reader?.origin.kind, 'profile');
  await tick();
  assert.equal(owner.resumePendingPublicReader(), false);
});

test('#522 address1: reply ACK scoped to owned row; second row stays operable', async () => {
  const h1 = 'd'.repeat(32);
  const h2 = 'e'.repeat(32);
  const mk = (reviewHandle: string, canReply = true) => ({
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply },
  });
  let pageItems = [mk(h1), mk(h2)];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => ({
        roleHandle: handle,
        role: 'organization',
        subjectDisplayName: 'Org',
        heldGamesCount: 1,
        countScope: 'confirmed_history',
        historyMayBeIncomplete: true,
        publishedReviewCount: 2,
        projectionVersion: 'q'.repeat(32),
        items: pageItems,
        nextCursor: 'more',
        availability: 'available',
      }),
      publicConsentPreview: async () => ({ consentProjectionHash: 'a'.repeat(64) }),
      send: async (packet) => {
        if (packet.kind === 'public-role-reply') {
          return { version: 1, status: 'submitted', receiptToken: 'tok-r' };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => 'ack-scope');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.patchPublicReplyDraft(h1, { text: 'Первый ответ' });
  owner.patchPublicReplyDraft(h1, { consent: true });
  await owner.submitPublicReply(h1);
  await tick();
  assert.equal(owner.getSnapshot().publicReplyReceipt?.reviewHandle, h1);
  assert.equal(owner.getSnapshot().publicNotice, 'Ответ принят.');
  // Other row remains writable; pagination not frozen by receipt.
  owner.patchPublicReplyDraft(h2, { text: 'Второй ответ' });
  assert.equal(owner.getSnapshot().publicReplyDrafts[h2]?.text, 'Второй ответ');
  owner.patchPublicReplyDraft(h2, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[h2]?.consent, true);
  // Owned row cannot send a duplicate new key while receipt is painted.
  const before = owner.getSnapshot().command;
  await owner.submitPublicReply(h1);
  assert.equal(owner.getSnapshot().command, before);
  pageItems = [
    { ...mk(h1, false), replyAggregateVersion: 1, subjectOwnReply: { status: 'submitted', version: 1, pendingRevision: 1 } },
    mk(h2),
  ];
  await owner.loadPublicReader({ preserveNotice: true });
  await tick();
});

test('#522 address1: deferred reply ACK v1 after typed v2 does not paint receipt', async () => {
  const reviewHandle = 'd'.repeat(32);
  let releaseAck: (value: unknown) => void = () => {};
  const ackGate = new Promise(resolve => { releaseAck = resolve; });
  let page = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [{
      reviewHandle,
      role: 'organization' as const,
      text: 'Текст',
      topics: ['agreements'],
      authorLabel: 'Участник игры' as const,
      experienceState: 'published' as const,
      publishedRevision: 1,
      replyAggregateVersion: 0,
      reply: null,
      subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
      allowedActions: { canReport: true, canReply: true },
    }],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'b'.repeat(64) }),
      send: async () => ackGate,
    }),
  }, () => 'late-ack');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Ответ' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  const submit = owner.submitPublicReply(reviewHandle);
  // Wait until mutate reached send gate (journal in flight) before typed refresh.
  for (let i = 0; i < 20 && !owner.getSnapshot().command; i++) await tick();
  assert.equal(owner.getSnapshot().command?.packet.kind, 'public-role-reply');
  // Typed refresh advances aggregate before deferred ACK settles.
  page = {
    ...page,
    items: [{
      ...page.items[0]!,
      replyAggregateVersion: 2,
      subjectOwnReply: { status: 'submitted', version: 2, pendingRevision: 1 },
      allowedActions: { canReply: false, canReport: true },
    }],
  };
  await owner.loadPublicReader();
  await tick();
  releaseAck({ version: 1, status: 'submitted', receiptToken: 'late' });
  await submit;
  await tick();
  assert.equal(owner.getSnapshot().publicReplyReceipt, null);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Ответ принят.');
});

test('#522 address2: same-row report repress preserves draft; in-flight cancel does not erase packet', async () => {
  const reviewHandle = 'd'.repeat(32);
  const actorItem = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null,
    allowedActions: { canReport: true, canReply: false },
  };
  let releaseSend: (value: unknown) => void = () => {};
  const sendGate = new Promise(resolve => { releaseSend = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => ({
        roleHandle: handle,
        role: 'organization',
        subjectDisplayName: 'Org',
        heldGamesCount: 1,
        countScope: 'confirmed_history',
        historyMayBeIncomplete: true,
        publishedReviewCount: 1,
        projectionVersion: 'q'.repeat(32),
        items: [actorItem],
        nextCursor: null,
        availability: 'available',
      }),
      send: async (packet) => {
        assert.equal(packet.kind, 'public-role-report');
        return sendGate;
      },
    }),
  }, () => 'report-inflight');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.beginPublicReport(actorItem);
  owner.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Уже набрано' });
  assert.equal(owner.getSnapshot().publicReportDraft?.reasonCode, 'spam');
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'Уже набрано');
  owner.beginPublicReport(actorItem);
  assert.equal(owner.getSnapshot().publicReportDraft?.reasonCode, 'spam');
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'Уже набрано');

  const submit = owner.submitPublicReport();
  for (let i = 0; i < 20 && !owner.getSnapshot().command; i++) await tick();
  const packet = owner.getSnapshot().command?.packet;
  assert.equal(packet?.kind, 'public-role-report');
  if (!packet || packet.kind !== 'public-role-report') throw new Error('expected public-role-report');
  const originalKey = packet.key;
  const originalBody = { ...packet.body };
  owner.cancelPublicReport();
  assert.equal(owner.getSnapshot().publicReportDraft?.reasonCode, 'spam');
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'Уже набрано');
  const afterCancel = owner.getSnapshot().command;
  assert.ok(afterCancel);
  assert.equal(afterCancel.packet.key, originalKey);
  assert.equal(afterCancel.packet.kind, 'public-role-report');
  if (afterCancel.packet.kind !== 'public-role-report') throw new Error('expected public-role-report');
  assert.deepEqual(afterCancel.packet.body, originalBody);
  releaseSend({
    reportId: '88888888-8888-4888-8888-888888888888',
    receiptToken: 'r-keep',
    status: 'submitted',
  });
  await submit;
  await tick();
  assert.equal(owner.getSnapshot().publicReportReceipt?.status, 'submitted');
  assert.equal(owner.getSnapshot().publicReportDraft, null);
});

test('#522 address2: append failure keeps prior rows and retries same cursor', async () => {
  const h1 = 'd'.repeat(32);
  const h2 = 'e'.repeat(32);
  const mk = (reviewHandle: string) => ({
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  });
  const cursors: Array<string | undefined> = [];
  let appendFails = true;
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        cursors.push(query.cursor);
        if (query.cursor === 'page-2') {
          if (appendFails) throw new PostgameError('network', 503);
          return {
            roleHandle: handle,
            role: 'organization',
            subjectDisplayName: 'Org',
            heldGamesCount: 1,
            countScope: 'confirmed_history',
            historyMayBeIncomplete: true,
            publishedReviewCount: 2,
            projectionVersion: 'q'.repeat(32),
            items: [mk(h2)],
            nextCursor: null,
            availability: 'available',
          };
        }
        return {
          roleHandle: handle,
          role: 'organization',
          subjectDisplayName: 'Org',
          heldGamesCount: 1,
          countScope: 'confirmed_history',
          historyMayBeIncomplete: true,
          publishedReviewCount: 2,
          projectionVersion: 'q'.repeat(32),
          items: [mk(h1)],
          nextCursor: 'page-2',
          availability: 'available',
        };
      },
    }),
  }, () => 'append-retry');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'ready');
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 1);
  assert.equal(owner.getSnapshot().publicReader.data?.nextCursor, 'page-2');
  owner.patchPublicReplyDraft(h1, { text: 'Черновик на первой странице' });
  await owner.loadPublicReader({ cursor: 'page-2', append: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'ready');
  assert.equal(owner.getSnapshot().publicReaderMoreError, true);
  assert.equal(owner.getSnapshot().publicReaderLoadingMore, false);
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 1);
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.reviewHandle, h1);
  assert.equal(owner.getSnapshot().publicReader.data?.nextCursor, 'page-2');
  assert.equal(owner.getSnapshot().publicReplyDrafts[h1]?.text, 'Черновик на первой странице');
  assert.equal(owner.getSnapshot().publicSurface?.reader?.origin.kind, 'profile');

  appendFails = false;
  await owner.loadPublicReader({ cursor: 'page-2', append: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReaderMoreError, false);
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 2);
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.reviewHandle, h1);
  assert.equal(owner.getSnapshot().publicReader.data?.items[1]?.reviewHandle, h2);
  assert.equal(owner.getSnapshot().publicReader.data?.nextCursor, null);
  assert.equal(owner.getSnapshot().publicReplyDrafts[h1]?.text, 'Черновик на первой странице');
  assert.deepEqual(cursors.filter(c => c === 'page-2'), ['page-2', 'page-2']);

  // Auth denial retires rows/forms rather than keeping stale append state.
  const denied = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        if (query.cursor) throw new PostgameError('private', 403);
        return {
          roleHandle: handle,
          role: 'organization',
          subjectDisplayName: 'Org',
          heldGamesCount: 1,
          countScope: 'confirmed_history',
          historyMayBeIncomplete: true,
          publishedReviewCount: 1,
          projectionVersion: 'q'.repeat(32),
          items: [mk(h1)],
          nextCursor: 'deny-next',
          availability: 'available',
        };
      },
    }),
  }, () => 'append-deny');
  denied.setActor(actor);
  denied.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  denied.beginPublicReport(mk(h1));
  denied.patchPublicReplyDraft(h1, { text: 'Скроется при denial' });
  await denied.loadPublicReader({ cursor: 'deny-next', append: true });
  await tick();
  assert.equal(denied.getSnapshot().publicReader.status, 'unavailable');
  assert.equal(denied.getSnapshot().publicReaderMoreError, false);
  assert.equal(denied.getSnapshot().publicReportDraft, null);
  assert.equal(denied.getSnapshot().publicReplyDrafts[h1]?.consent, false);
});

test('#522 address3: same-handle same-revision canReport false retires editor; UNKNOWN journal untouched', async () => {
  const reviewHandle = 'd'.repeat(32);
  const canReportItem = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: false },
  };
  let pageItems = [canReportItem];
  let nextCursor: string | null = 'dup-page';
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        if (query.cursor === 'dup-page') {
          return {
            roleHandle: handle,
            role: 'organization',
            subjectDisplayName: 'Org',
            heldGamesCount: 1,
            countScope: 'confirmed_history',
            historyMayBeIncomplete: true,
            publishedReviewCount: 1,
            projectionVersion: 'q'.repeat(32),
            items: [{
              ...canReportItem,
              allowedActions: { canReport: false, canReply: false },
            }],
            nextCursor: null,
            availability: 'available',
          };
        }
        return {
          roleHandle: handle,
          role: 'organization',
          subjectDisplayName: 'Org',
          heldGamesCount: 1,
          countScope: 'confirmed_history',
          historyMayBeIncomplete: true,
          publishedReviewCount: 1,
          projectionVersion: 'q'.repeat(32),
          items: pageItems,
          nextCursor,
          availability: 'available',
        };
      },
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `addr3-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.beginPublicReport(canReportItem);
  owner.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Черновик жалобы' });
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'Черновик жалобы');
  assert.equal(owner.getSnapshot().publicReportDraft?.publishedRevision, 2);

  // Refresh: same handle + same approved revision, canReport lost → editor retired.
  pageItems = [{
    ...canReportItem,
    allowedActions: { canReport: false, canReply: false },
  }];
  nextCursor = null;
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, false);
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.publishedRevision, 2);
  assert.equal(owner.getSnapshot().publicReportDraft, null);
  const beforeRefuse = keys.length;
  await owner.submitPublicReport();
  await tick();
  assert.equal(keys.length, beforeRefuse);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReportDraft, null);

  // Re-open while permitted, dispatch UNKNOWN, then append duplicate with canReport false.
  pageItems = [canReportItem];
  nextCursor = 'dup-page';
  await owner.loadPublicReader();
  await tick();
  owner.beginPublicReport(canReportItem);
  owner.patchPublicReportDraft({ reasonCode: 'harassment', explanation: 'После UNKNOWN' });
  await owner.submitPublicReport();
  await tick();
  const unknownCmd = owner.getSnapshot().command;
  assert.ok(unknownCmd);
  assert.equal(unknownCmd.status, 'unknown');
  assert.equal(unknownCmd.packet.kind, 'public-role-report');
  if (unknownCmd.packet.kind !== 'public-role-report') throw new Error('expected public-role-report');
  const unknownKey = unknownCmd.packet.key;
  const unknownBody = { ...unknownCmd.packet.body };
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'После UNKNOWN');

  await owner.loadPublicReader({ cursor: 'dup-page', append: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.items.length, 1);
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, false);
  assert.equal(owner.getSnapshot().publicReportDraft, null);
  const afterAppend = owner.getSnapshot().command;
  assert.ok(afterAppend);
  assert.equal(afterAppend.status, 'unknown');
  assert.equal(afterAppend.packet.key, unknownKey);
  assert.equal(afterAppend.packet.kind, 'public-role-report');
  if (afterAppend.packet.kind !== 'public-role-report') throw new Error('expected public-role-report');
  assert.deepEqual(afterAppend.packet.body, unknownBody);
  assert.equal(keys.filter(k => k === unknownKey).length, 1);
});

test('#522 address6: post-success reply receipt does not disable report; report receipt does not disable reply', async () => {
  const reviewHandle = 'd'.repeat(32);
  const item = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  let pageItems = [item];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => ({
        roleHandle: handle,
        role: 'organization',
        subjectDisplayName: 'Org',
        heldGamesCount: 1,
        countScope: 'confirmed_history',
        historyMayBeIncomplete: true,
        publishedReviewCount: 1,
        projectionVersion: 'q'.repeat(32),
        items: pageItems,
        nextCursor: null,
        availability: 'available',
      }),
      publicConsentPreview: async () => ({ consentProjectionHash: 'c'.repeat(64) }),
      send: async (packet) => {
        if (packet.kind === 'public-role-reply') {
          return { version: 1, status: 'submitted', receiptToken: 'reply-tok' };
        }
        if (packet.kind === 'public-role-report') {
          return {
            reportId: '88888888-8888-4888-8888-888888888888',
            receiptToken: 'report-tok',
            status: 'submitted',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => 'independent-gates');
  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();

  // Direction A: successful reply ACK — report remains operable with canReport true.
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Ответ субъекта' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  await owner.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(owner.getSnapshot().publicReplyReceipt?.reviewHandle, reviewHandle);
  assert.equal(owner.getSnapshot().publicReplyReceipt?.expectedReviewRevision, 2);
  assert.equal(owner.getSnapshot().publicReportReceipt, null);
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
  owner.beginPublicReport(item);
  assert.equal(owner.getSnapshot().publicReportDraft?.reviewHandle, reviewHandle);
  owner.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'После ответа' });
  assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'После ответа');

  // Clear painted reply receipt via typed refresh that advances aggregate (report draft stays).
  // Retirement requires strict advance past painted ACK version (here 1), not tip/aggregate equality.
  pageItems = [{
    ...item,
    replyAggregateVersion: 2,
    subjectOwnReply: { status: 'submitted', version: 2, pendingRevision: 1 },
    allowedActions: { canReply: false, canReport: true },
  }];
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReplyReceipt, null);

  // Direction B: successful report ACK — reply editor remains operable when canReply returns.
  owner.cancelPublicReport();
  owner.beginPublicReport({ ...item, allowedActions: { canReply: false, canReport: true } });
  owner.patchPublicReportDraft({ reasonCode: 'harassment', explanation: 'Жалоба' });
  await owner.submitPublicReport();
  await tick();
  assert.equal(owner.getSnapshot().publicReportReceipt?.reviewHandle, reviewHandle);
  assert.equal(owner.getSnapshot().publicReportReceipt?.expectedRevision, 2);
  assert.equal(owner.getSnapshot().command, null);
  // Same-revision receipt still dedupes — cannot open another report for revision 2.
  owner.beginPublicReport({ ...item, allowedActions: { canReply: false, canReport: true } });
  assert.equal(owner.getSnapshot().publicReportDraft, null);

  pageItems = [{
    ...item,
    publishedRevision: 3,
    replyAggregateVersion: 1,
    subjectOwnReply: null,
    allowedActions: { canReply: true, canReport: true },
  }];
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
  // Newer published revision retires report receipt — must not block reply or report N+1.
  assert.equal(owner.getSnapshot().publicReportReceipt, null);
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Новый ответ после жалобы' });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Новый ответ после жалобы');
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  owner.beginPublicReport({
    ...item,
    publishedRevision: 3,
    allowedActions: { canReply: true, canReport: true },
  });
  assert.equal(owner.getSnapshot().publicReportDraft?.publishedRevision, 3);
});

test('#522 address6: reply receipt revision-bound — ACK then GET N→N+1 retires; GET before old ACK does not paint or erase draft', async () => {
  const reviewHandle = 'd'.repeat(32);
  // Legitimate initial aggregate 0 → ValidACK expectedVersion+1 (=1). N→N+1 keeps aggregate unchanged.
  const mk = (publishedRevision: number, over: Record<string, unknown> = {}) => ({
    reviewHandle,
    role: 'organization' as const,
    text: publishedRevision === 1 ? 'Текст v1' : 'Текст v2',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
    ...over,
  });

  // --- Ordering A: ACK paints on revision N, then typed GET N+1 (aggregate unchanged) retires ---
  let pageA = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [mk(1)],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const ownerA = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageA,
      publicConsentPreview: async () => ({ consentProjectionHash: 'd'.repeat(64) }),
      send: async (packet) => {
        if (packet.kind === 'public-role-reply') {
          return {
            version: packet.body.expectedVersion + 1,
            status: 'submitted',
            receiptToken: 'ack-n',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => 'rev-ack-then-get');
  ownerA.setActor(actor);
  ownerA.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerA.patchPublicReplyDraft(reviewHandle, { text: 'Ответ на v1' });
  ownerA.patchPublicReplyDraft(reviewHandle, { consent: true });
  await ownerA.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(ownerA.getSnapshot().publicReplyReceipt?.reviewHandle, reviewHandle);
  assert.equal(ownerA.getSnapshot().publicReplyReceipt?.expectedReviewRevision, 1);
  assert.equal(ownerA.getSnapshot().publicReplyReceipt?.version, 1);
  assert.equal(ownerA.getSnapshot().publicNotice, 'Ответ принят.');

  // Same replyAggregateVersion / subjectOwnReply null — only publishedRevision advances.
  pageA = {
    ...pageA,
    items: [mk(2)],
  };
  await ownerA.loadPublicReader({ preserveNotice: true });
  await tick();
  assert.equal(ownerA.getSnapshot().publicReplyReceipt, null);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.publishedRevision, 2);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.replyAggregateVersion, 0);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
  // Fresh consent required for the new published revision — no silent rebase/autosend.
  ownerA.patchPublicReplyDraft(reviewHandle, { text: 'Ответ на v2' });
  assert.equal(ownerA.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  assert.equal(ownerA.getSnapshot().publicConsentHash, null);
  const beforeSend = ownerA.getSnapshot().command;
  await ownerA.submitPublicReply(reviewHandle);
  assert.equal(ownerA.getSnapshot().command, beforeSend);
  assert.match(ownerA.getSnapshot().publicNotice ?? '', /согласи/i);

  // --- Ordering B: typed GET N+1 before deferred ACK for N — no paint, draft/consent kept ---
  let releaseAck: (value: unknown) => void = () => {};
  const ackGate = new Promise(resolve => { releaseAck = resolve; });
  let pageB = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'r'.repeat(32),
    items: [mk(1)],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const ownerB = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageB,
      publicConsentPreview: async () => ({ consentProjectionHash: 'e'.repeat(64) }),
      send: async () => ackGate,
    }),
  }, () => 'rev-get-before-ack');
  ownerB.setActor(actor);
  ownerB.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerB.patchPublicReplyDraft(reviewHandle, { text: 'Ответ на v1' });
  ownerB.patchPublicReplyDraft(reviewHandle, { consent: true });
  const submit = ownerB.submitPublicReply(reviewHandle);
  for (let i = 0; i < 20 && !ownerB.getSnapshot().command; i++) await tick();
  const inFlight = ownerB.getSnapshot().command;
  assert.ok(inFlight);
  assert.equal(inFlight.packet.kind, 'public-role-reply');
  if (inFlight.packet.kind !== 'public-role-reply') throw new Error('expected public-role-reply');
  assert.equal(inFlight.packet.body.expectedReviewRevision, 1);

  // Newer published revision arrives while ACK deferred; user starts fresh draft for N+1.
  pageB = { ...pageB, items: [mk(2)] };
  await ownerB.loadPublicReader();
  await tick();
  assert.equal(ownerB.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  ownerB.patchPublicReplyDraft(reviewHandle, { text: 'Черновик на v2' });
  ownerB.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(ownerB.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик на v2');
  assert.equal(ownerB.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);

  // Valid ACK for frozen packet (expectedVersion+1); newer publishedRevision prevents paint.
  releaseAck({
    version: inFlight.packet.body.expectedVersion + 1,
    status: 'submitted',
    receiptToken: 'late-n',
  });
  await submit;
  await tick();
  // Stale acceptance must not paint; new-revision draft/consent must survive.
  assert.equal(ownerB.getSnapshot().publicReplyReceipt, null);
  assert.notEqual(ownerB.getSnapshot().publicNotice, 'Ответ принят.');
  assert.equal(ownerB.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик на v2');
  assert.equal(ownerB.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  assert.equal(ownerB.getSnapshot().command, null);
  assert.equal(ownerB.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
  assert.equal(ownerB.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
});

test('#522 address8: root-read authority loss retires reply consent; retry new revision needs fresh consent', async () => {
  const reviewHandle = 'd'.repeat(32);
  const mk = (publishedRevision: number) => ({
    reviewHandle,
    role: 'organization' as const,
    text: `Текст v${publishedRevision}`,
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  });
  let mode: 'ok1' | 'fail' | 'ok2' | 'mismatch' = 'ok1';
  let page = {
    roleHandle: handle,
    role: 'organization' as const,
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [mk(1)],
    nextCursor: 'more' as string | null,
    availability: 'available' as const,
  };
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        if (query.cursor === 'more') {
          // Append transient failure path is separate — root authority stays.
          throw new PostgameError('network', 503);
        }
        if (mode === 'fail') throw new PostgameError('network', 503);
        if (mode === 'mismatch') {
          return { ...page, roleHandle: 'f'.repeat(32), role: 'training' as const };
        }
        return page;
      },
      publicConsentPreview: async () => ({ consentProjectionHash: 'a'.repeat(64) }),
      send: async (packet) => {
        keys.push(packet.key);
        if (packet.kind === 'public-role-reply') {
          return {
            version: packet.body.expectedVersion + 1,
            status: 'submitted',
            receiptToken: 'reply-ok',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => `addr8-root-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.patchPublicReplyDraft(reviewHandle, { text: 'Черновик ответа' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');

  // Append transient failure: prior rows + consent retained; same cursor retry UX.
  await owner.loadPublicReader({ cursor: 'more', append: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'ready');
  assert.equal(owner.getSnapshot().publicReaderMoreError, true);
  assert.equal(owner.getSnapshot().publicReader.data?.nextCursor, 'more');
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');

  // Root network failure: authority lost — consent/hash retired, draft text kept.
  mode = 'fail';
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'error');
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');
  assert.equal(owner.getSnapshot().publicConsentHash, null);

  // Retry with newer published revision — no silent send without fresh consent.
  mode = 'ok2';
  page = { ...page, items: [mk(2)], nextCursor: null };
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'ready');
  assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.publishedRevision, 2);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');
  const beforeSend = keys.length;
  await owner.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(keys.length, beforeSend);
  assert.match(owner.getSnapshot().publicNotice ?? '', /согласи/i);

  // Failed-mutation recovery GET (preserveNotice) after root mismatch also retires consent.
  owner.patchPublicReplyDraft(reviewHandle, { text: 'После сбоя' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  mode = 'mismatch';
  await owner.loadPublicReader({ preserveNotice: true });
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'error');
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'После сбоя');
  assert.equal(owner.getSnapshot().publicConsentHash, null);

  // Explicit renewed consent on the new revision works after authority restored.
  mode = 'ok2';
  await owner.loadPublicReader();
  await tick();
  assert.equal(owner.getSnapshot().publicReader.status, 'ready');
  assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  await owner.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(keys.length, beforeSend + 1);
  assert.equal(owner.getSnapshot().publicReplyReceipt?.expectedReviewRevision, 2);
});

test('#522 address8: report receipt revision-bound — ACK then GET N→N+1 retires; GET before old ACK does not paint or erase draft', async () => {
  const reviewHandle = 'd'.repeat(32);
  const mk = (publishedRevision: number) => ({
    reviewHandle,
    role: 'organization' as const,
    text: publishedRevision === 1 ? 'Текст v1' : 'Текст v2',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  });

  // --- Ordering A: ACK paints on revision N, then typed GET N+1 retires; N+1 report allowed ---
  let pageA = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [mk(1)],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const ownerA = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageA,
      send: async (packet) => {
        if (packet.kind === 'public-role-report') {
          assert.equal(packet.body.expectedRevision, 1);
          return {
            reportId: '88888888-8888-4888-8888-888888888888',
            receiptToken: 'rep-n',
            status: 'submitted',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => 'rep-ack-then-get');
  ownerA.setActor(actor);
  ownerA.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerA.beginPublicReport(mk(1));
  ownerA.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Жалоба на v1' });
  await ownerA.submitPublicReport();
  await tick();
  assert.equal(ownerA.getSnapshot().publicReportReceipt?.reviewHandle, reviewHandle);
  assert.equal(ownerA.getSnapshot().publicReportReceipt?.expectedRevision, 1);
  assert.match(ownerA.getSnapshot().publicNotice ?? '', /Жалоба отправлена/);
  // Same-revision repeated report stays deduped.
  ownerA.beginPublicReport(mk(1));
  assert.equal(ownerA.getSnapshot().publicReportDraft, null);

  pageA = { ...pageA, items: [mk(2)] };
  await ownerA.loadPublicReader({ preserveNotice: true });
  await tick();
  assert.equal(ownerA.getSnapshot().publicReportReceipt, null);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.publishedRevision, 2);
  assert.equal(ownerA.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
  ownerA.beginPublicReport(mk(2));
  assert.equal(ownerA.getSnapshot().publicReportDraft?.publishedRevision, 2);
  ownerA.patchPublicReportDraft({ reasonCode: 'harassment', explanation: 'Жалоба на v2' });
  assert.equal(ownerA.getSnapshot().publicReportDraft?.explanation, 'Жалоба на v2');

  // --- Ordering B: typed GET N+1 before deferred ACK for N — no paint, draft kept ---
  let releaseAck: (value: unknown) => void = () => {};
  const ackGate = new Promise(resolve => { releaseAck = resolve; });
  let pageB = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'r'.repeat(32),
    items: [mk(1)],
    nextCursor: null as string | null,
    availability: 'available',
  };
  const ownerB = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageB,
      send: async () => ackGate,
    }),
  }, () => 'rep-get-before-ack');
  ownerB.setActor(actor);
  ownerB.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerB.beginPublicReport(mk(1));
  ownerB.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Жалоба на v1' });
  const submit = ownerB.submitPublicReport();
  for (let i = 0; i < 20 && !ownerB.getSnapshot().command; i++) await tick();
  const inFlight = ownerB.getSnapshot().command;
  assert.ok(inFlight);
  assert.equal(inFlight.packet.kind, 'public-role-report');
  if (inFlight.packet.kind !== 'public-role-report') throw new Error('expected public-role-report');
  assert.equal(inFlight.packet.body.expectedRevision, 1);

  pageB = { ...pageB, items: [mk(2)] };
  await ownerB.loadPublicReader();
  await tick();
  // Open editor for N retired by revision move; start fresh draft for N+1.
  assert.equal(ownerB.getSnapshot().publicReportDraft, null);
  ownerB.beginPublicReport(mk(2));
  ownerB.patchPublicReportDraft({ reasonCode: 'other', explanation: 'Черновик на v2' });
  assert.equal(ownerB.getSnapshot().publicReportDraft?.publishedRevision, 2);
  assert.equal(ownerB.getSnapshot().publicReportDraft?.explanation, 'Черновик на v2');

  releaseAck({
    reportId: '99999999-9999-4999-9999-999999999999',
    receiptToken: 'late-rep',
    status: 'submitted',
  });
  await submit;
  await tick();
  // Stale acceptance must not paint; new-revision report draft must survive.
  assert.equal(ownerB.getSnapshot().publicReportReceipt, null);
  assert.notEqual(ownerB.getSnapshot().publicNotice, 'Жалоба отправлена. Отзыв остаётся видимым до решения человека.');
  assert.equal(ownerB.getSnapshot().publicReportDraft?.publishedRevision, 2);
  assert.equal(ownerB.getSnapshot().publicReportDraft?.explanation, 'Черновик на v2');
  assert.equal(ownerB.getSnapshot().command, null);
  assert.equal(ownerB.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
});

test('samePublicReaderOrigin distinguishes game vs profile and ids', () => {
  assert.equal(
    samePublicReaderOrigin({ kind: 'game', gameId }, { kind: 'game', gameId }),
    true,
  );
  assert.equal(
    samePublicReaderOrigin({ kind: 'game', gameId }, { kind: 'game', gameId: gameB }),
    false,
  );
  assert.equal(
    samePublicReaderOrigin(
      { kind: 'profile', publicPlayerId: 'public-peer-a' },
      { kind: 'profile', publicPlayerId: 'public-peer-a' },
    ),
    true,
  );
  assert.equal(
    samePublicReaderOrigin(
      { kind: 'game', gameId },
      { kind: 'profile', publicPlayerId: 'public-peer-a' },
    ),
    false,
  );
});

test('#522 address10: deferred reply/report 409 on A does not paint or refresh B; same A still notices', async () => {
  const reviewHandle = 'd'.repeat(32);
  const item = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  const pageBody = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [item],
    nextCursor: 'cursor-a' as string | null,
    availability: 'available',
  };
  const conflictReply = publicRoleReplyBusinessNotice('VERSION_CONFLICT');
  const conflictReport = publicRoleReportBusinessNotice('VERSION_CONFLICT');

  // --- Reply: deferred 409 after A→B (same roleHandle, game→profile) ---
  let releaseReply: (err: unknown) => void = () => {};
  const replyGate = new Promise((_, reject) => { releaseReply = reject; });
  let replyGets = 0;
  const ownerReply = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        replyGets += 1;
        if (query.cursor) {
          return {
            ...pageBody,
            items: [{ ...item, reviewHandle: 'e'.repeat(32) }],
            nextCursor: null,
          };
        }
        return { ...pageBody };
      },
      publicConsentPreview: async () => ({ consentProjectionHash: 'c'.repeat(64) }),
      send: async () => replyGate,
    }),
  }, () => 'addr10-reply-409');
  ownerReply.setActor(actor);
  ownerReply.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  await ownerReply.loadPublicReader({ cursor: 'cursor-a', append: true });
  await tick();
  assert.equal(ownerReply.getSnapshot().publicReader.data?.items.length, 2);
  assert.equal(ownerReply.getSnapshot().publicReader.data?.nextCursor, null);
  const getsAfterAppend = replyGets;
  ownerReply.patchPublicReplyDraft(reviewHandle, { text: 'Ответ A' });
  ownerReply.patchPublicReplyDraft(reviewHandle, { consent: true });
  const replySubmit = ownerReply.submitPublicReply(reviewHandle);
  for (let i = 0; i < 20 && !ownerReply.getSnapshot().command; i++) await tick();
  assert.equal(ownerReply.getSnapshot().command?.packet.kind, 'public-role-reply');
  const replyHash = ownerReply.getSnapshot().publicConsentHash;
  assert.ok(replyHash);

  ownerReply.closePublicSurface();
  ownerReply.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  await ownerReply.loadPublicReader({ cursor: 'cursor-a', append: true });
  await tick();
  const getsOnB = replyGets;
  ownerReply.patchPublicReplyDraft(reviewHandle, { text: 'Черновик B' });
  // Drive a consent hash on B so rejection must not clear it.
  // Preview path needs canReply; use patch only — hash stays null until preview; seed via submit gate already open.
  assert.equal(ownerReply.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик B');
  const bRows = ownerReply.getSnapshot().publicReader.data?.items.length;
  const bCursor = ownerReply.getSnapshot().publicReader.data?.nextCursor;

  releaseReply(new PostgameError('business', 409, 'VERSION_CONFLICT'));
  await replySubmit.catch(() => {});
  await tick();
  await tick();
  // Journal settled; B must not inherit A's notice/refresh/hash wipe.
  assert.equal(ownerReply.getSnapshot().command, null);
  assert.notEqual(ownerReply.getSnapshot().publicNotice, conflictReply);
  assert.equal(ownerReply.getSnapshot().publicReader.data?.items.length, bRows);
  assert.equal(ownerReply.getSnapshot().publicReader.data?.nextCursor, bCursor);
  assert.equal(ownerReply.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик B');
  assert.equal(replyGets, getsOnB); // no rejection follow-up GET on B
  assert.ok(getsOnB > getsAfterAppend);

  // Same original game surface: deferred 409 paints notice and rereads.
  let releaseStay: (err: unknown) => void = () => {};
  const stayGate = new Promise((_, reject) => { releaseStay = reject; });
  let stayGets = 0;
  const ownerStay = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => {
        stayGets += 1;
        return { ...pageBody, nextCursor: null };
      },
      publicConsentPreview: async () => ({ consentProjectionHash: 'd'.repeat(64) }),
      send: async () => stayGate,
    }),
  }, () => 'addr10-reply-stay');
  ownerStay.setActor(actor);
  ownerStay.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  const getsReady = stayGets;
  ownerStay.patchPublicReplyDraft(reviewHandle, { text: 'Остаёмся' });
  ownerStay.patchPublicReplyDraft(reviewHandle, { consent: true });
  const staySubmit = ownerStay.submitPublicReply(reviewHandle);
  for (let i = 0; i < 20 && !ownerStay.getSnapshot().command; i++) await tick();
  releaseStay(new PostgameError('business', 409, 'VERSION_CONFLICT'));
  await staySubmit.catch(() => {});
  await tick();
  await tick();
  assert.equal(ownerStay.getSnapshot().command, null);
  assert.equal(ownerStay.getSnapshot().publicNotice, conflictReply);
  assert.equal(ownerStay.getSnapshot().publicConsentHash, null);
  assert.ok(stayGets > getsReady); // permission reread on original surface

  // --- Report: deferred 409 after A→B ---
  let releaseReport: (err: unknown) => void = () => {};
  const reportGate = new Promise((_, reject) => { releaseReport = reject; });
  let reportGets = 0;
  const ownerReport = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        reportGets += 1;
        if (query.cursor) {
          return {
            ...pageBody,
            items: [{ ...item, reviewHandle: 'f'.repeat(32) }],
            nextCursor: null,
          };
        }
        return { ...pageBody };
      },
      send: async () => reportGate,
    }),
  }, () => 'addr10-report-409');
  ownerReport.setActor(actor);
  ownerReport.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  await ownerReport.loadPublicReader({ cursor: 'cursor-a', append: true });
  await tick();
  ownerReport.beginPublicReport(item);
  ownerReport.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'A report' });
  const reportSubmit = ownerReport.submitPublicReport();
  for (let i = 0; i < 20 && !ownerReport.getSnapshot().command; i++) await tick();
  assert.equal(ownerReport.getSnapshot().command?.packet.kind, 'public-role-report');

  ownerReport.closePublicSurface();
  ownerReport.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-b' },
  });
  await tick();
  await ownerReport.loadPublicReader({ cursor: 'cursor-a', append: true });
  await tick();
  const reportGetsOnB = reportGets;
  ownerReport.beginPublicReport(item);
  ownerReport.patchPublicReportDraft({ reasonCode: 'other', explanation: 'B draft' });
  const reportRows = ownerReport.getSnapshot().publicReader.data?.items.length;

  releaseReport(new PostgameError('business', 409, 'VERSION_CONFLICT'));
  await reportSubmit.catch(() => {});
  await tick();
  await tick();
  assert.equal(ownerReport.getSnapshot().command, null);
  assert.notEqual(ownerReport.getSnapshot().publicNotice, conflictReport);
  assert.equal(ownerReport.getSnapshot().publicReader.data?.items.length, reportRows);
  assert.equal(ownerReport.getSnapshot().publicReportDraft?.explanation, 'B draft');
  assert.equal(reportGets, reportGetsOnB);
});

test('#522 address10: UNKNOWN quarantine keeps original bind; PROFILE reopen cannot inherit ACK', async () => {
  const reviewHandle = 'd'.repeat(32);
  const item = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null as null | { status: string; version: number; pendingRevision: number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  const page = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [item],
    nextCursor: null as string | null,
    availability: 'available',
  };

  // Close/reopen PROFILE then null quarantine: reconcile settles journal but must not paint PROFILE.
  const keys: string[] = [];
  let mode: 'unknown' | 'ack' = 'unknown';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'e'.repeat(64) }),
      send: async (packet) => {
        keys.push(packet.key);
        if (mode === 'unknown') throw new PostgameError('network', 503);
        if (packet.kind === 'public-role-reply') {
          return { version: packet.body.expectedVersion + 1, status: 'submitted', receiptToken: 'ok' };
        }
        if (packet.kind === 'public-role-report') {
          return {
            reportId: '88888888-8888-4888-8888-888888888888',
            receiptToken: 'rok',
            status: 'submitted',
          };
        }
        throw new PostgameError('invalid');
      },
    }),
  }, () => `q-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  owner.patchPublicReplyDraft(reviewHandle, { text: 'UNKNOWN game' });
  owner.patchPublicReplyDraft(reviewHandle, { consent: true });
  await owner.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownPacket = owner.getSnapshot().command!.packet;
  assert.equal(unknownPacket.kind, 'public-role-reply');
  if (unknownPacket.kind !== 'public-role-reply') throw new Error('expected reply');
  const frozen = {
    key: unknownPacket.key,
    method: unknownPacket.method,
    path: unknownPacket.path,
    body: { ...unknownPacket.body },
    reviewHandle: unknownPacket.reviewHandle,
    gameId: unknownPacket.gameId,
    actorId: unknownPacket.actor.actorId,
  };

  owner.closePublicSurface();
  owner.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  // Identical-handle PROFILE must not own the old game dispatch.
  owner.setActor(null);
  owner.setActor({ ...actor, sessionId: 'session-reauth', generation: 2 });
  await tick();
  const restored = owner.getSnapshot().command;
  assert.ok(restored);
  assert.equal(restored.status, 'unknown');
  assert.equal(restored.packet.kind, 'public-role-reply');
  if (restored.packet.kind !== 'public-role-reply') throw new Error('expected reply');
  assert.equal(restored.packet.key, frozen.key);
  assert.equal(restored.packet.method, frozen.method);
  assert.equal(restored.packet.path, frozen.path);
  assert.equal(restored.packet.reviewHandle, frozen.reviewHandle);
  assert.equal(restored.packet.gameId, frozen.gameId);
  assert.equal(restored.packet.actor.actorId, frozen.actorId);
  assert.deepEqual(restored.packet.body, frozen.body);
  assert.equal(owner.getSnapshot().publicReplyReceipt, null);

  mode = 'ack';
  await owner.reconcilePublic();
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().publicReplyReceipt, null);
  assert.notEqual(owner.getSnapshot().publicNotice, 'Ответ принят.');
  // Explicit reconcile used original key once more — no autosend before reconcile.
  assert.equal(keys.filter(k => k === frozen.key).length, 2);

  // Close/reopen identical game origin also keeps bind invalid across quarantine.
  mode = 'unknown';
  const ownerIdent = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'f'.repeat(64) }),
      send: async (packet) => {
        if (mode === 'unknown') throw new PostgameError('network', 503);
        if (packet.kind !== 'public-role-reply') throw new PostgameError('invalid');
        return { version: packet.body.expectedVersion + 1, status: 'submitted', receiptToken: 'id' };
      },
    }),
  }, () => 'ident-q');
  ownerIdent.setActor(actor);
  ownerIdent.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerIdent.patchPublicReplyDraft(reviewHandle, { text: 'Ident' });
  ownerIdent.patchPublicReplyDraft(reviewHandle, { consent: true });
  await ownerIdent.submitPublicReply(reviewHandle);
  await tick();
  ownerIdent.closePublicSurface();
  ownerIdent.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerIdent.setActor(null);
  ownerIdent.setActor({ ...actor, sessionId: 'session-ident', generation: 2 });
  await tick();
  mode = 'ack';
  await ownerIdent.reconcilePublic();
  await tick();
  assert.equal(ownerIdent.getSnapshot().command, null);
  assert.equal(ownerIdent.getSnapshot().publicReplyReceipt, null);

  // Legitimate same original still-open reader recovers new-session UI after fresh read.
  mode = 'unknown';
  const ownerLegit = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'a'.repeat(64) }),
      send: async (packet) => {
        if (mode === 'unknown') throw new PostgameError('network', 503);
        if (packet.kind === 'public-role-report') {
          return {
            reportId: '99999999-9999-4999-9999-999999999999',
            receiptToken: 'legit-rep',
            status: 'submitted',
          };
        }
        if (packet.kind !== 'public-role-reply') throw new PostgameError('invalid');
        return { version: packet.body.expectedVersion + 1, status: 'submitted', receiptToken: 'legit' };
      },
    }),
  }, () => 'legit-q');
  ownerLegit.setActor(actor);
  ownerLegit.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerLegit.patchPublicReplyDraft(reviewHandle, { text: 'Legit recover' });
  ownerLegit.patchPublicReplyDraft(reviewHandle, { consent: true });
  await ownerLegit.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(ownerLegit.getSnapshot().command?.status, 'unknown');
  // Null quarantine while original game reader still current — then same-account fresh session.
  ownerLegit.setActor(null);
  ownerLegit.setActor({ ...actor, sessionId: 'session-legit', generation: 2 });
  await tick();
  assert.equal(ownerLegit.getSnapshot().publicSurface?.mode, 'reader');
  assert.equal(ownerLegit.getSnapshot().publicSurface?.reader?.origin.kind, 'game');
  mode = 'ack';
  await ownerLegit.reconcilePublic();
  await tick();
  assert.equal(ownerLegit.getSnapshot().command, null);
  assert.equal(ownerLegit.getSnapshot().publicReplyReceipt?.status, 'submitted');
  assert.equal(ownerLegit.getSnapshot().publicNotice, 'Ответ принят.');

  // Report UNKNOWN → PROFILE reopen → quarantine: no report receipt on replacement.
  mode = 'unknown';
  const ownerRep = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      send: async () => {
        if (mode === 'unknown') throw new PostgameError('network', 503);
        return {
          reportId: '77777777-7777-4777-8777-777777777777',
          receiptToken: 'rep-q',
          status: 'submitted',
        };
      },
    }),
  }, () => 'rep-q');
  ownerRep.setActor(actor);
  ownerRep.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerRep.beginPublicReport(item);
  ownerRep.patchPublicReportDraft({ reasonCode: 'threat', explanation: 'Game report' });
  await ownerRep.submitPublicReport();
  await tick();
  const repPacket = ownerRep.getSnapshot().command!.packet;
  assert.equal(repPacket.kind, 'public-role-report');
  if (repPacket.kind !== 'public-role-report') throw new Error('expected report');
  const repKey = repPacket.key;
  const repBody = { ...repPacket.body };
  ownerRep.closePublicSurface();
  ownerRep.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-z' },
  });
  await tick();
  ownerRep.setActor(null);
  ownerRep.setActor({ ...actor, sessionId: 'session-rep', generation: 2 });
  await tick();
  const after = ownerRep.getSnapshot().command!.packet;
  assert.equal(after.kind, 'public-role-report');
  if (after.kind !== 'public-role-report') throw new Error('expected report');
  assert.equal(after.key, repKey);
  assert.deepEqual(after.body, repBody);
  mode = 'ack';
  await ownerRep.reconcilePublic();
  await tick();
  assert.equal(ownerRep.getSnapshot().command, null);
  assert.equal(ownerRep.getSnapshot().publicReportReceipt, null);
});

test('#522 address13: reply/report hard auth denial retires owned reader; UNKNOWN packet immutable', async () => {
  const reviewHandle = 'd'.repeat(32);
  const item = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст с правами',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: { status: 'submitted', version: 1, pendingRevision: null as number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  const pageBody = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [item],
    nextCursor: null as string | null,
    availability: 'available' as const,
  };

  for (const denial of [
    new PostgameError('private', 404),
    new PostgameError('business', 403, 'RESOURCE_UNAVAILABLE'),
    new PostgameError('private', 401),
  ] as const) {
    const keys: string[] = [];
    let releaseSend: (err: unknown) => void = () => {};
    const sendGate = new Promise((_, reject) => { releaseSend = reject; });
    let lateGetBody: unknown = { ...pageBody };
    let releaseLateGet: (value: unknown) => void = () => {};
    const lateGetGate = new Promise(resolve => { releaseLateGet = resolve; });
    let getPhase: 'ready' | 'inflight' | 'fresh' = 'ready';
    const owner = new PostgameCoordinator({
      ...idlePort({
        publicRoleByHandle: async () => {
          if (getPhase === 'inflight') return lateGetGate;
          if (getPhase === 'fresh') {
            return {
              ...pageBody,
              items: [{ ...item, replyAggregateVersion: 2, allowedActions: { canReport: true, canReply: true } }],
            };
          }
          return lateGetBody;
        },
        publicConsentPreview: async () => ({ consentProjectionHash: 'c'.repeat(64) }),
        send: async (packet) => {
          keys.push(packet.key);
          return sendGate;
        },
      }),
    }, () => `addr13-reply-${denial.status}-${keys.length + 1}`);

    owner.setActor(actor);
    owner.openPublicReader({
      roleHandle: handle,
      role: 'organization',
      origin: { kind: 'game', gameId },
    });
    await tick();
    assert.equal(owner.getSnapshot().publicReader.status, 'ready');
    assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
    assert.ok(owner.getSnapshot().publicReader.data?.items[0]?.subjectOwnReply);

    owner.patchPublicReplyDraft(reviewHandle, { text: 'Грязный ответ до denial' });
    owner.patchPublicReplyDraft(reviewHandle, { consent: true });
    owner.beginPublicReport(item);
    owner.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Открытый редактор' });
    assert.equal(owner.getSnapshot().publicReportDraft?.explanation, 'Открытый редактор');
    assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);

    const submit = owner.submitPublicReply(reviewHandle);
    for (let i = 0; i < 20 && !owner.getSnapshot().command; i++) await tick();
    assert.equal(owner.getSnapshot().command?.packet.kind, 'public-role-reply');
    const cmd = owner.getSnapshot().command!;
    assert.equal(cmd.packet.kind, 'public-role-reply');
    if (cmd.packet.kind !== 'public-role-reply') throw new Error('expected reply');
    const frozen = {
      key: cmd.packet.key,
      method: cmd.packet.method,
      path: cmd.packet.path,
      body: { ...cmd.packet.body },
      reviewHandle: cmd.packet.reviewHandle,
      actorId: cmd.packet.actor.actorId,
    };
    assert.equal(owner.getSnapshot().publicConsentHash, 'c'.repeat(64));

    // In-flight reader GET started after mutate — must not resurrect after hard denial.
    getPhase = 'inflight';
    const pendingGet = owner.loadPublicReader({ preserveNotice: true });
    await tick();

    releaseSend(denial);
    await submit.catch(() => {});
    await tick();
    await tick();

    const after = owner.getSnapshot();
    assert.equal(after.command?.status, 'unknown');
    assert.equal(after.command?.packet.kind, 'public-role-reply');
    if (after.command?.packet.kind !== 'public-role-reply') throw new Error('expected reply UNKNOWN');
    assert.equal(after.command.packet.key, frozen.key);
    assert.equal(after.command.packet.method, frozen.method);
    assert.equal(after.command.packet.path, frozen.path);
    assert.deepEqual(after.command.packet.body, frozen.body);
    assert.equal(after.command.packet.reviewHandle, frozen.reviewHandle);
    assert.equal(after.command.packet.actor.actorId, frozen.actorId);
    assert.equal(after.publicReader.status, 'unavailable');
    assert.equal(after.publicReader.data, undefined);
    assert.equal(after.publicReportDraft, null);
    assert.equal(after.publicConsentHash, null);
    assert.equal(after.publicReplyReceipt, null);
    assert.equal(after.publicReportReceipt, null);
    assert.equal(after.publicReplyDrafts[reviewHandle]?.text, 'Грязный ответ до denial');
    assert.equal(after.publicReplyDrafts[reviewHandle]?.consent, false);
    assert.equal(
      after.publicNotice,
      denial.status === 401
        ? 'Войдите снова, чтобы ответить или пожаловаться.'
        : 'Не удалось загрузить отзывы.',
    );
    // Write authority gone until fresh typed ready read.
    owner.patchPublicReplyDraft(reviewHandle, { consent: true });
    assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
    owner.beginPublicReport(item);
    assert.equal(owner.getSnapshot().publicReportDraft, null);

    // Late GET that would have restored private page must be ignored (reader gen bumped on denial).
    lateGetBody = {
      ...pageBody,
      items: [{ ...item, allowedActions: { canReport: true, canReply: true }, subjectOwnReply: item.subjectOwnReply }],
    };
    releaseLateGet(lateGetBody);
    await pendingGet;
    await tick();
    assert.equal(owner.getSnapshot().publicReader.status, 'unavailable');
    assert.equal(owner.getSnapshot().publicReader.data, undefined);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().command?.packet.key, frozen.key);

    // Fresh owning GET may reestablish permissions; consent must be renewed; no autosend / new key.
    const keysBeforeFresh = keys.length;
    getPhase = 'fresh';
    await owner.loadPublicReader();
    await tick();
    assert.equal(owner.getSnapshot().publicReader.status, 'ready');
    assert.equal(owner.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
    assert.equal(owner.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
    assert.equal(owner.getSnapshot().publicConsentHash, null);
    assert.equal(keys.length, keysBeforeFresh);
    assert.equal(owner.getSnapshot().command?.packet.key, frozen.key);
  }

  // Report hard private 404 — same retirement + UNKNOWN packet.
  const reportKeys: string[] = [];
  const ownerReport = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageBody,
      send: async (packet) => {
        reportKeys.push(packet.key);
        throw new PostgameError('private', 404);
      },
    }),
  }, () => `addr13-report-${reportKeys.length + 1}`);
  ownerReport.setActor(actor);
  ownerReport.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  ownerReport.beginPublicReport(item);
  ownerReport.patchPublicReportDraft({ reasonCode: 'harassment', explanation: 'Жалоба до denial' });
  ownerReport.patchPublicReplyDraft(reviewHandle, { text: 'Черновик ответа' });
  ownerReport.patchPublicReplyDraft(reviewHandle, { consent: true });
  await ownerReport.submitPublicReport();
  await tick();
  const repCmd = ownerReport.getSnapshot().command;
  assert.equal(repCmd?.status, 'unknown');
  assert.equal(repCmd?.packet.kind, 'public-role-report');
  if (repCmd?.packet.kind !== 'public-role-report') throw new Error('expected report');
  const repFrozen = {
    key: repCmd.packet.key,
    method: repCmd.packet.method,
    path: repCmd.packet.path,
    body: { ...repCmd.packet.body },
    gameQuery: repCmd.packet.gameQuery,
  };
  assert.equal(ownerReport.getSnapshot().publicReader.status, 'unavailable');
  assert.equal(ownerReport.getSnapshot().publicReportDraft, null);
  assert.equal(ownerReport.getSnapshot().publicConsentHash, null);
  assert.equal(ownerReport.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик ответа');
  assert.equal(ownerReport.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  const capturedCommand = ownerReport.getSnapshot().command;
  assert.equal(capturedCommand?.packet.key, repFrozen.key);
  assert.equal(capturedCommand?.packet.method, repFrozen.method);
  assert.equal(capturedCommand?.packet.path, repFrozen.path);
  if (capturedCommand == null || capturedCommand.packet.kind !== 'public-role-report') throw new Error('expected report');
  assert.deepEqual(capturedCommand.packet.body, repFrozen.body);
  assert.equal(capturedCommand.packet.gameQuery, repFrozen.gameQuery);

  // Delayed A denial after B open must not clear B rows/cursor/drafts/authority.
  let releaseA: (err: unknown) => void = () => {};
  const aGate = new Promise((_, reject) => { releaseA = reject; });
  let bGets = 0;
  const ownerAB = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async (_a, _h, query) => {
        bGets += 1;
        if (query.cursor) {
          return {
            ...pageBody,
            items: [{ ...item, reviewHandle: 'e'.repeat(32) }],
            nextCursor: null,
          };
        }
        return { ...pageBody, nextCursor: 'cursor-b' };
      },
      publicConsentPreview: async () => ({ consentProjectionHash: 'd'.repeat(64) }),
      send: async () => aGate,
    }),
  }, () => 'addr13-ab');
  ownerAB.setActor(actor);
  ownerAB.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerAB.patchPublicReplyDraft(reviewHandle, { text: 'Ответ A' });
  ownerAB.patchPublicReplyDraft(reviewHandle, { consent: true });
  const aSubmit = ownerAB.submitPublicReply(reviewHandle);
  for (let i = 0; i < 20 && !ownerAB.getSnapshot().command; i++) await tick();
  assert.equal(ownerAB.getSnapshot().command?.packet.kind, 'public-role-reply');
  const aKey = ownerAB.getSnapshot().command!.packet.key;

  ownerAB.closePublicSurface();
  ownerAB.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-b' },
  });
  await tick();
  await ownerAB.loadPublicReader({ cursor: 'cursor-b', append: true });
  await tick();
  const getsOnB = bGets;
  ownerAB.patchPublicReplyDraft(reviewHandle, { text: 'Черновик B' });
  ownerAB.patchPublicReplyDraft(reviewHandle, { consent: true });
  ownerAB.beginPublicReport(item);
  ownerAB.patchPublicReportDraft({ reasonCode: 'other', explanation: 'B report' });
  const bRows = ownerAB.getSnapshot().publicReader.data?.items.length;
  const bCursor = ownerAB.getSnapshot().publicReader.data?.nextCursor;
  const bStatus = ownerAB.getSnapshot().publicReader.status;

  releaseA(new PostgameError('private', 404));
  await aSubmit.catch(() => {});
  await tick();
  await tick();
  assert.equal(ownerAB.getSnapshot().command?.status, 'unknown');
  assert.equal(ownerAB.getSnapshot().command?.packet.key, aKey);
  assert.equal(ownerAB.getSnapshot().publicReader.status, bStatus);
  assert.equal(ownerAB.getSnapshot().publicReader.data?.items.length, bRows);
  assert.equal(ownerAB.getSnapshot().publicReader.data?.nextCursor, bCursor);
  assert.equal(ownerAB.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Черновик B');
  assert.equal(ownerAB.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, true);
  assert.equal(ownerAB.getSnapshot().publicReportDraft?.explanation, 'B report');
  assert.equal(bGets, getsOnB);

  // Reply consent-preview hard denial retires write authority (no packet yet).
  const ownerPreview = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => pageBody,
      publicConsentPreview: async () => { throw new PostgameError('private', 403); },
      send: async () => { throw new PostgameError('invalid'); },
    }),
  }, () => 'addr13-preview');
  ownerPreview.setActor(actor);
  ownerPreview.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  ownerPreview.patchPublicReplyDraft(reviewHandle, { text: 'До preview denial' });
  ownerPreview.patchPublicReplyDraft(reviewHandle, { consent: true });
  ownerPreview.beginPublicReport(item);
  await ownerPreview.submitPublicReply(reviewHandle);
  await tick();
  assert.equal(ownerPreview.getSnapshot().command, null);
  assert.equal(ownerPreview.getSnapshot().publicReader.status, 'unavailable');
  assert.equal(ownerPreview.getSnapshot().publicReportDraft, null);
  assert.equal(ownerPreview.getSnapshot().publicConsentHash, null);
  assert.equal(ownerPreview.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'До preview denial');
  assert.equal(ownerPreview.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
  ownerPreview.patchPublicReplyDraft(reviewHandle, { consent: true });
  assert.equal(ownerPreview.getSnapshot().publicReplyDrafts[reviewHandle]?.consent, false);
});

test('#522 address15: reply/report ACK parsers reject empty receiptToken; opaque nonempty accepted', () => {
  assert.throws(
    () => parsePublicRoleReplyReceipt({ version: 1, status: 'submitted', receiptToken: '' }),
    PublicRoleError,
  );
  assert.throws(
    () => parsePublicRoleReportReceipt({
      reportId: '88888888-8888-4888-8888-888888888888',
      receiptToken: '',
      status: 'submitted',
    }),
    PublicRoleError,
  );
  const replyOk = parsePublicRoleReplyReceipt({
    version: 1,
    status: 'submitted',
    receiptToken: 'opaque-reply',
  });
  assert.equal(replyOk.receiptToken, 'opaque-reply');
  assert.equal(replyOk.version, 1);
  assert.equal(replyOk.status, 'submitted');
  const reportOk = parsePublicRoleReportReceipt({
    reportId: '88888888-8888-4888-8888-888888888888',
    receiptToken: 'opaque-report',
    status: 'submitted',
  });
  assert.equal(reportOk.receiptToken, 'opaque-report');
  assert.equal(reportOk.reportId, '88888888-8888-4888-8888-888888888888');
  assert.equal(reportOk.status, 'submitted');
  // Author mutation parser unchanged — empty token still type-accepted there.
  const author = parsePublicRoleMutationReceipt({
    id: '22222222-2222-4222-8222-222222222222',
    reviewHandle: 'c'.repeat(32),
    version: 1,
    status: 'submitted',
    receiptToken: '',
    pendingIntakeStatus: 'waiting_intake',
  });
  assert.equal(author.receiptToken, '');
});

test('#522 address15: empty reply/report ACK keeps immutable UNKNOWN; explicit valid ACK reconciles same packet', async () => {
  const reviewHandle = 'd'.repeat(32);
  const item = {
    reviewHandle,
    role: 'organization' as const,
    text: 'Текст',
    topics: ['agreements'],
    authorLabel: 'Участник игры' as const,
    experienceState: 'published' as const,
    publishedRevision: 2,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: { status: 'submitted', version: 1, pendingRevision: null as number | null },
    allowedActions: { canReport: true, canReply: true },
  };
  const page = {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: 'q'.repeat(32),
    items: [item],
    nextCursor: null as string | null,
    availability: 'available' as const,
  };

  // --- Reply: otherwise-valid ACK with empty token → UNKNOWN; valid ACK reconciles same packet ---
  const replyKeys: string[] = [];
  let replyMode: 'empty' | 'valid' = 'empty';
  const ownerReply = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      publicConsentPreview: async () => ({ consentProjectionHash: 'f'.repeat(64) }),
      send: async (packet) => {
        replyKeys.push(packet.key);
        if (packet.kind !== 'public-role-reply') throw new PostgameError('invalid');
        if (replyMode === 'empty') {
          return { version: packet.body.expectedVersion + 1, status: 'submitted', receiptToken: '' };
        }
        return {
          version: packet.body.expectedVersion + 1,
          status: 'submitted',
          receiptToken: 'reply-ack-ok',
        };
      },
    }),
  }, () => `addr15-reply-${replyKeys.length + 1}`);

  ownerReply.setActor(actor);
  ownerReply.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'game', gameId },
  });
  await tick();
  assert.equal(ownerReply.getSnapshot().publicReader.status, 'ready');
  assert.equal(ownerReply.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);

  ownerReply.patchPublicReplyDraft(reviewHandle, { text: 'Ответ до empty ACK' });
  ownerReply.patchPublicReplyDraft(reviewHandle, { consent: true });
  await ownerReply.submitPublicReply(reviewHandle);
  await tick();

  const replyCmd = ownerReply.getSnapshot().command;
  assert.equal(replyCmd?.status, 'unknown');
  assert.equal(replyCmd?.packet.kind, 'public-role-reply');
  if (replyCmd == null || replyCmd.packet.kind !== 'public-role-reply') throw new Error('expected reply UNKNOWN');
  const replyFrozen = {
    key: replyCmd.packet.key,
    method: replyCmd.packet.method,
    path: replyCmd.packet.path,
    body: { ...replyCmd.packet.body },
    reviewHandle: replyCmd.packet.reviewHandle,
    actorId: replyCmd.packet.actor.actorId,
  };
  assert.equal(replyKeys.length, 1);
  assert.equal(replyKeys[0], replyFrozen.key);
  assert.equal(ownerReply.getSnapshot().publicReplyReceipt, null);
  assert.notEqual(ownerReply.getSnapshot().publicNotice, 'Ответ принят.');
  assert.equal(ownerReply.getSnapshot().publicReader.status, 'ready');
  assert.equal(ownerReply.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReply, true);
  assert.equal(ownerReply.getSnapshot().publicReplyDrafts[reviewHandle]?.text, 'Ответ до empty ACK');

  // Before reconcile: UNKNOWN packet still matches the original capture (no paint / no new key).
  const replyStill = ownerReply.getSnapshot().command;
  assert.equal(replyStill?.status, 'unknown');
  if (replyStill == null || replyStill.packet.kind !== 'public-role-reply') throw new Error('expected reply UNKNOWN');
  assert.equal(replyStill.packet.key, replyFrozen.key);
  assert.equal(replyStill.packet.method, replyFrozen.method);
  assert.equal(replyStill.packet.path, replyFrozen.path);
  assert.deepEqual(replyStill.packet.body, replyFrozen.body);
  assert.equal(replyStill.packet.reviewHandle, replyFrozen.reviewHandle);
  assert.equal(replyStill.packet.actor.actorId, replyFrozen.actorId);
  assert.equal(replyKeys.length, 1);

  replyMode = 'valid';
  await ownerReply.reconcilePublic();
  await tick();
  assert.equal(ownerReply.getSnapshot().command, null);
  assert.equal(ownerReply.getSnapshot().publicReplyReceipt?.receiptToken, 'reply-ack-ok');
  assert.equal(ownerReply.getSnapshot().publicReplyReceipt?.version, replyFrozen.body.expectedVersion + 1);
  assert.equal(ownerReply.getSnapshot().publicNotice, 'Ответ принят.');
  assert.equal(replyKeys.length, 2);
  assert.equal(replyKeys[1], replyFrozen.key);

  // --- Report: empty token ACK → UNKNOWN; valid ACK reconciles same packet ---
  const reportKeys: string[] = [];
  let reportMode: 'empty' | 'valid' = 'empty';
  const ownerReport = new PostgameCoordinator({
    ...idlePort({
      publicRoleByHandle: async () => page,
      send: async (packet) => {
        reportKeys.push(packet.key);
        if (packet.kind !== 'public-role-report') throw new PostgameError('invalid');
        if (reportMode === 'empty') {
          return {
            reportId: '88888888-8888-4888-8888-888888888888',
            receiptToken: '',
            status: 'submitted',
          };
        }
        return {
          reportId: '88888888-8888-4888-8888-888888888888',
          receiptToken: 'report-ack-ok',
          status: 'submitted',
        };
      },
    }),
  }, () => `addr15-report-${reportKeys.length + 1}`);

  ownerReport.setActor(actor);
  ownerReport.openPublicReader({
    roleHandle: handle,
    role: 'organization',
    origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  });
  await tick();
  assert.equal(ownerReport.getSnapshot().publicReader.status, 'ready');
  assert.equal(ownerReport.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);

  ownerReport.beginPublicReport(item);
  ownerReport.patchPublicReportDraft({ reasonCode: 'spam', explanation: 'Жалоба до empty ACK' });
  await ownerReport.submitPublicReport();
  await tick();

  const reportCmd = ownerReport.getSnapshot().command;
  assert.equal(reportCmd?.status, 'unknown');
  assert.equal(reportCmd?.packet.kind, 'public-role-report');
  if (reportCmd == null || reportCmd.packet.kind !== 'public-role-report') throw new Error('expected report UNKNOWN');
  const reportFrozen = {
    key: reportCmd.packet.key,
    method: reportCmd.packet.method,
    path: reportCmd.packet.path,
    body: { ...reportCmd.packet.body },
    gameQuery: reportCmd.packet.gameQuery,
    reviewHandle: reportCmd.packet.reviewHandle,
    actorId: reportCmd.packet.actor.actorId,
  };
  assert.equal(reportKeys.length, 1);
  assert.equal(reportKeys[0], reportFrozen.key);
  assert.equal(ownerReport.getSnapshot().publicReportReceipt, null);
  assert.notEqual(
    ownerReport.getSnapshot().publicNotice,
    'Жалоба отправлена. Отзыв остаётся видимым до решения человека.',
  );
  assert.equal(ownerReport.getSnapshot().publicReader.status, 'ready');
  assert.equal(ownerReport.getSnapshot().publicReader.data?.items[0]?.allowedActions.canReport, true);
  assert.equal(ownerReport.getSnapshot().publicReportDraft?.explanation, 'Жалоба до empty ACK');

  const reportStill = ownerReport.getSnapshot().command;
  assert.equal(reportStill?.status, 'unknown');
  if (reportStill == null || reportStill.packet.kind !== 'public-role-report') throw new Error('expected report UNKNOWN');
  assert.equal(reportStill.packet.key, reportFrozen.key);
  assert.equal(reportStill.packet.method, reportFrozen.method);
  assert.equal(reportStill.packet.path, reportFrozen.path);
  assert.deepEqual(reportStill.packet.body, reportFrozen.body);
  assert.equal(reportStill.packet.gameQuery, reportFrozen.gameQuery);
  assert.equal(reportStill.packet.reviewHandle, reportFrozen.reviewHandle);
  assert.equal(reportStill.packet.actor.actorId, reportFrozen.actorId);
  assert.equal(reportKeys.length, 1);

  reportMode = 'valid';
  await ownerReport.reconcilePublic();
  await tick();
  assert.equal(ownerReport.getSnapshot().command, null);
  assert.equal(ownerReport.getSnapshot().publicReportReceipt?.receiptToken, 'report-ack-ok');
  assert.equal(ownerReport.getSnapshot().publicReportReceipt?.reportId, '88888888-8888-4888-8888-888888888888');
  assert.equal(
    ownerReport.getSnapshot().publicNotice,
    'Жалоба отправлена. Отзыв остаётся видимым до решения человека.',
  );
  assert.equal(reportKeys.length, 2);
  assert.equal(reportKeys[1], reportFrozen.key);
});

function publicOriginSummary(over: Record<string, unknown> = {}) {
  return {
    roleHandle: handle,
    role: 'organization',
    subjectDisplayName: 'Org',
    heldGamesCount: 1,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 0,
    projectionVersion: 'q'.repeat(32),
    items: [],
    nextCursor: null,
    availability: 'available',
    ...over,
  };
}

test('#522 QA1: resumed author/reader suppress on origin/role denial; no fallback basis opens sheet', async () => {
  const otherGame = gameB;
  const authorDenied = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => publicOriginSummary(),
      publicEligibility: async () => eligibilityBody({
        bases: [{
          gameId: otherGame,
          role: 'organization',
          endsAt: '2026-10-01T18:00:00.000Z',
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
          projectionHashPreview: null,
          admission: 'may_submit',
          reason: null,
        }],
      }),
    }),
  }, () => 'qa1-author');
  authorDenied.setActor(actor);
  assert.equal(await authorDenied.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), false);
  assert.equal(authorDenied.getSnapshot().publicSurface, null);
  assert.equal(authorDenied.getSnapshot().publicDraft, null);

  const authorOk = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => publicOriginSummary(),
    }),
  }, () => 'qa1-author-ok');
  authorOk.setActor(actor);
  assert.equal(await authorOk.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), true);
  assert.equal(authorOk.getSnapshot().publicSurface?.mode, 'composer');
  assert.equal(authorOk.getSnapshot().publicSurface?.target?.gameId, gameId);
  assert.equal(authorOk.getSnapshot().publicSurface?.resumeFrozenGameId, gameId);
  await tick();
  assert.equal(authorOk.getSnapshot().publicDraft?.gameId, gameId);
  assert.equal(authorOk.getSnapshot().publicDraft?.consent, false);

  const readerPage = publicOriginSummary();
  const readerDenied = new PostgameCoordinator({
    ...idlePort({
      publicPlayerRoleOrigin: async () => publicOriginSummary(),
      publicRoleByHandle: async () => { throw new PostgameError('private', 404); },
    }),
  }, () => 'qa1-reader-deny');
  readerDenied.setActor(actor);
  assert.equal(await readerDenied.openResumedPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  }), false);
  assert.equal(readerDenied.getSnapshot().publicSurface, null);

  const readerMismatch = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => publicOriginSummary(),
      publicRoleByHandle: async () => ({ ...readerPage, role: 'training' }),
    }),
  }, () => 'qa1-reader-mismatch');
  readerMismatch.setActor(actor);
  assert.equal(await readerMismatch.openResumedPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'game', gameId },
  }), false);
  assert.equal(readerMismatch.getSnapshot().publicSurface, null);

  const readerOk = new PostgameCoordinator({
    ...idlePort({
      publicPlayerRoleOrigin: async () => publicOriginSummary(),
      publicRoleByHandle: async () => readerPage,
    }),
  }, () => 'qa1-reader-ok');
  readerOk.setActor(actor);
  assert.equal(await readerOk.openResumedPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  }), true);
  assert.equal(readerOk.getSnapshot().publicSurface?.mode, 'reader');
  assert.equal(readerOk.getSnapshot().publicSurface?.reader?.origin.kind, 'profile');
});

test('#522 QA2: denied/replaced public origin role handle suppress; missing origin port fail-closes resumed only', async () => {
  const missingPort = new PostgameCoordinator({ ...idlePort() }, () => 'qa2-missing-port');
  missingPort.setActor(actor);
  assert.equal(await missingPort.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), false);
  assert.equal(missingPort.getSnapshot().publicSurface, null);
  // Normal signed-in composer still opens without origin ports.
  missingPort.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  assert.equal(missingPort.getSnapshot().publicSurface?.mode, 'composer');
  missingPort.closePublicSurface();

  const replacedGame = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => publicOriginSummary({ roleHandle: handleB }),
    }),
  }, () => 'qa2-replaced-game');
  replacedGame.setActor(actor);
  assert.equal(await replacedGame.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), false);
  assert.equal(replacedGame.getSnapshot().publicSurface, null);

  const deniedGame = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => { throw new PostgameError('private', 404); },
    }),
  }, () => 'qa2-denied-game');
  deniedGame.setActor(actor);
  assert.equal(await deniedGame.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), false);

  const replacedProfile = new PostgameCoordinator({
    ...idlePort({
      publicPlayerRoleOrigin: async () => publicOriginSummary({ roleHandle: handleB }),
      publicRoleByHandle: async () => publicOriginSummary(),
    }),
  }, () => 'qa2-replaced-profile');
  replacedProfile.setActor(actor);
  assert.equal(await replacedProfile.openResumedPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  }), false);
  assert.equal(replacedProfile.getSnapshot().publicSurface, null);

  let profileCalls = 0;
  const profileOk = new PostgameCoordinator({
    ...idlePort({
      publicPlayerRoleOrigin: async (publicPlayerId, role) => {
        profileCalls += 1;
        assert.equal(publicPlayerId, 'public-peer-a');
        assert.equal(role, 'organization');
        return publicOriginSummary();
      },
      publicRoleByHandle: async (_actor, roleHandle, query) => {
        assert.equal(roleHandle, handle);
        assert.equal(query.gameId, undefined);
        return publicOriginSummary();
      },
    }),
  }, () => 'qa2-profile-ok');
  profileOk.setActor(actor);
  assert.equal(await profileOk.openResumedPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
  }), true);
  assert.equal(profileCalls, 1);
  assert.equal(profileOk.getSnapshot().publicSurface?.reader?.origin.kind, 'profile');
});

test('#522 QA2: resumed frozen basis survives second eligibility; later removal goes unavailable without fallback', async () => {
  let eligPhase: 'both' | 'other-only' = 'both';
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => publicOriginSummary(),
      publicEligibility: async () => {
        if (eligPhase === 'other-only') {
          return eligibilityBody({
            bases: [{
              gameId: gameB,
              role: 'organization',
              endsAt: '2026-10-01T18:00:00.000Z',
              proofVersion: 2,
              outcomeVersion: 1,
              attendanceVersion: 1,
              projectionHashPreview: null,
              admission: 'may_submit',
              reason: null,
            }],
          });
        }
        return eligibilityBody({
          bases: [
            {
              gameId,
              role: 'organization',
              endsAt: '2026-10-01T18:00:00.000Z',
              proofVersion: 2,
              outcomeVersion: 1,
              attendanceVersion: 1,
              projectionHashPreview: null,
              admission: 'may_submit',
              reason: null,
            },
            {
              gameId: gameB,
              role: 'organization',
              endsAt: '2026-10-01T19:00:00.000Z',
              proofVersion: 2,
              outcomeVersion: 1,
              attendanceVersion: 1,
              projectionHashPreview: null,
              admission: 'may_submit',
              reason: null,
            },
          ],
        });
      },
    }),
  }, () => 'qa2-frozen');
  owner.setActor(actor);
  assert.equal(await owner.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  }), true);
  await tick();
  assert.equal(owner.getSnapshot().publicSurface?.resumeFrozenGameId, gameId);
  assert.equal(owner.getSnapshot().publicDraft?.gameId, gameId);

  await owner.loadPublicEligibility();
  await tick();
  assert.equal(owner.getSnapshot().publicDraft?.gameId, gameId);
  assert.equal(owner.getSnapshot().publicEligibility.status, 'ready');

  eligPhase = 'other-only';
  await owner.loadPublicEligibility();
  await tick();
  assert.equal(owner.getSnapshot().publicEligibility.status, 'unavailable');
  assert.equal(owner.getSnapshot().publicDraft?.gameId, gameId);
  assert.notEqual(owner.getSnapshot().publicDraft?.gameId, gameB);
  assert.match(owner.getSnapshot().publicNotice ?? '', /Нет подтверждённой встречи/);

  // Normal (non-resumed) composer may still prefer another eligible basis.
  const normal = new PostgameCoordinator({
    ...idlePort({
      publicEligibility: async () => eligibilityBody({
        bases: [{
          gameId: gameB,
          role: 'organization',
          endsAt: '2026-10-01T18:00:00.000Z',
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
          projectionHashPreview: null,
          admission: 'may_submit',
          reason: null,
        }],
      }),
    }),
  }, () => 'qa2-normal-chooser');
  normal.setActor(actor);
  normal.openPublicComposer({ roleHandle: handle, role: 'organization', gameId });
  await tick();
  assert.equal(normal.getSnapshot().publicSurface?.resumeFrozenGameId, undefined);
  assert.equal(normal.getSnapshot().publicDraft?.gameId, gameB);
});

test('#522 QA2: navigate-away / surface replacement fences delayed resumed author open', async () => {
  let releaseOrigin: (value: unknown) => void = () => {};
  const originPending = new Promise<unknown>(resolve => { releaseOrigin = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => originPending,
      publicRoleByHandle: async () => publicOriginSummary(),
    }),
  }, () => 'qa2-lifetime');
  owner.setActor(actor);

  let live = true;
  const opening = owner.openResumedPublicComposer(
    { roleHandle: handle, role: 'organization', gameId },
    { isLive: () => live },
  );
  await tick();
  // Host navigates away / claim gen retires while origin validation is delayed.
  live = false;
  releaseOrigin(publicOriginSummary());
  assert.equal(await opening, false);
  assert.equal(owner.getSnapshot().publicSurface, null);

  let releaseOrigin2: (value: unknown) => void = () => {};
  const originPending2 = new Promise<unknown>(resolve => { releaseOrigin2 = resolve; });
  const replaced = new PostgameCoordinator({
    ...idlePort({
      publicGameRoleOrigin: async () => originPending2,
    }),
  }, () => 'qa2-surface-replace');
  replaced.setActor(actor);
  const opening2 = replaced.openResumedPublicComposer({
    roleHandle: handle, role: 'organization', gameId,
  });
  await tick();
  // Reader/history bumps eligibility+surface gen — delayed resume must not overwrite.
  replaced.openPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'game', gameId },
  });
  releaseOrigin2(publicOriginSummary());
  assert.equal(await opening2, false);
  assert.equal(replaced.getSnapshot().publicSurface?.mode, 'reader');
  assert.equal(replaced.getSnapshot().publicSurface?.resumeFrozenGameId, undefined);
});

test('#522 QA3: host claim/pending/eventual navigation seams fence three promise boundaries', async () => {
  const goalPath = `/games/${gameId}`;

  // 1) Delayed SecureStore claim + unrelated navigation → no old-origin replace authority.
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: '/games',
    navGenAtClaim: 1,
    currentPath: '/players/other',
    currentNavGen: 2,
    goalPath,
  }), false);
  // ABA back to claim-start path still drops (cannot revive).
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: '/games',
    navGenAtClaim: 1,
    currentPath: '/games',
    currentNavGen: 3,
    goalPath,
  }), false);
  // Already-at-goal claim + Messages → Back same game (navGen +2): must not revive on path===goal.
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: goalPath,
    navGenAtClaim: 4,
    currentPath: goalPath,
    currentNavGen: 6,
    goalPath,
  }), false);
  // Different start → unrelated → goal with 2+ generation hops: reject (not a single own commit).
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: '/games',
    navGenAtClaim: 1,
    currentPath: goalPath,
    currentNavGen: 3,
    goalPath,
  }), false);
  // Unchanged claim-start path may restore; own single expected hop different→goal stays live.
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: '/games',
    navGenAtClaim: 1,
    currentPath: '/games',
    currentNavGen: 1,
    goalPath,
  }), true);
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: goalPath,
    navGenAtClaim: 4,
    currentPath: goalPath,
    currentNavGen: 4,
    goalPath,
  }), true);
  assert.equal(coldClaimStillOwnsNavigation({
    pathAtClaim: '/games',
    navGenAtClaim: 1,
    currentPath: goalPath,
    currentNavGen: 2,
    goalPath,
  }), true);

  // 2) Pending restore superseded before first match → retire (later ordinary visit cannot reopen).
  assert.equal(coldPendingResumePathPhase({
    pendingPath: goalPath,
    waitFromPath: '/games',
    currentPath: '/games',
    matched: false,
  }), 'wait');
  assert.equal(coldPendingResumePathPhase({
    pendingPath: goalPath,
    waitFromPath: '/games',
    currentPath: '/players/other',
    matched: false,
  }), 'retire');
  assert.equal(coldPendingResumePathPhase({
    pendingPath: goalPath,
    waitFromPath: '/games',
    currentPath: goalPath,
    matched: false,
  }), 'open');
  // After matched navigate-away also retires (no opens before passive cleanup reliance alone).
  assert.equal(coldPendingResumePathPhase({
    pendingPath: goalPath,
    waitFromPath: '/games',
    currentPath: '/my-games',
    matched: true,
  }), 'retire');

  // 3) Matched origin then pathname changes while validation delayed → eventual isLive false sync.
  assert.equal(coldPendingResumeEventualLive({
    pendingStillCurrent: true,
    genMatches: true,
    hasPublicSurface: false,
    currentPath: '/players/other',
    pendingPath: goalPath,
  }), false);
  assert.equal(coldPendingResumeEventualLive({
    pendingStillCurrent: true,
    genMatches: true,
    hasPublicSurface: false,
    currentPath: goalPath,
    pendingPath: goalPath,
  }), true);
  // Auth/surface retirement still fail-closes.
  assert.equal(coldPendingResumeEventualLive({
    pendingStillCurrent: true,
    genMatches: true,
    hasPublicSurface: true,
    currentPath: goalPath,
    pendingPath: goalPath,
  }), false);
  assert.equal(coldPendingResumeEventualLive({
    pendingStillCurrent: false,
    genMatches: true,
    hasPublicSurface: false,
    currentPath: goalPath,
    pendingPath: goalPath,
  }), false);

  // Positive own expected commit opens once via production eventual-live seam (not a fake boolean).
  let path = goalPath;
  let releaseOk: (value: unknown) => void = () => {};
  const originOk = new Promise<unknown>(resolve => { releaseOk = resolve; });
  const own = new PostgameCoordinator({
    ...idlePort({ publicGameRoleOrigin: async () => originOk }),
  }, () => 'qa3-own-restore');
  own.setActor(actor);
  const ownOpen = own.openResumedPublicComposer(
    { roleHandle: handle, role: 'organization', gameId },
    {
      isLive: () => coldPendingResumeEventualLive({
        pendingStillCurrent: true,
        genMatches: true,
        hasPublicSurface: !!own.getSnapshot().publicSurface,
        currentPath: path,
        pendingPath: goalPath,
      }),
    },
  );
  await tick();
  releaseOk(publicOriginSummary());
  assert.equal(await ownOpen, true);
  assert.equal(own.getSnapshot().publicSurface?.mode, 'composer');
  assert.equal(own.getSnapshot().publicSurface?.resumeFrozenGameId, gameId);
  own.closePublicSurface();

  // Delayed validation after pathname left matched origin → no open (finding 3 production seam).
  let releaseAway: (value: unknown) => void = () => {};
  const originAway = new Promise<unknown>(resolve => { releaseAway = resolve; });
  const away = new PostgameCoordinator({
    ...idlePort({ publicGameRoleOrigin: async () => originAway }),
  }, () => 'qa3-path-away');
  away.setActor(actor);
  path = goalPath;
  const awayOpen = away.openResumedPublicComposer(
    { roleHandle: handle, role: 'organization', gameId },
    {
      isLive: () => coldPendingResumeEventualLive({
        pendingStillCurrent: true,
        genMatches: true,
        hasPublicSurface: !!away.getSnapshot().publicSurface,
        currentPath: path,
        pendingPath: goalPath,
      }),
    },
  );
  await tick();
  path = '/players/other';
  releaseAway(publicOriginSummary());
  assert.equal(await awayOpen, false);
  assert.equal(away.getSnapshot().publicSurface, null);

  // Surface replacement still fences delayed resume (prior QA2 retirement preserved).
  let releaseSurf: (value: unknown) => void = () => {};
  const originSurf = new Promise<unknown>(resolve => { releaseSurf = resolve; });
  const surf = new PostgameCoordinator({
    ...idlePort({ publicGameRoleOrigin: async () => originSurf }),
  }, () => 'qa3-surface-retire');
  surf.setActor(actor);
  path = goalPath;
  const surfOpen = surf.openResumedPublicComposer(
    { roleHandle: handle, role: 'organization', gameId },
    {
      isLive: () => coldPendingResumeEventualLive({
        pendingStillCurrent: true,
        genMatches: true,
        hasPublicSurface: !!surf.getSnapshot().publicSurface,
        currentPath: path,
        pendingPath: goalPath,
      }),
    },
  );
  await tick();
  surf.openPublicReader({
    roleHandle: handle, role: 'organization', origin: { kind: 'game', gameId },
  });
  releaseSurf(publicOriginSummary());
  assert.equal(await surfOpen, false);
  assert.equal(surf.getSnapshot().publicSurface?.mode, 'reader');
  assert.equal(surf.getSnapshot().publicSurface?.resumeFrozenGameId, undefined);
});
