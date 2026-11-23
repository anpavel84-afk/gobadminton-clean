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
  consentPreviewBody,
  currentPublicRoleFocusTarget,
  draftEditorKey,
  emptyPublicRoleDraft,
  isPublicRolePacketKind,
  mayPaintOwnPublicReceipt,
  mayWithdrawOwnPublic,
  mergeOwnPublicReviewItem,
  normalizePublicRoleText,
  parseConsentPreview,
  parseOwnEligibility,
  parseOwnPublicRoleReviewsPage,
  parsePublicRoleMutationReceipt,
  publicAuthorReturnPath,
  publicRoleBusinessNotice,
  publicRoleReviewText,
  publicRoleStatusLabel,
  publicRoleTopics,
  rememberPublicRoleFocusTarget,
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

test('validateReceipt accepts public create/withdraw; CommandReview excludes public kinds; APK34 root-host source wiring', () => {
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
  assert.doesNotMatch(disclosure, /canReply|canReport|Сообщить о нарушении/);
  assert.doesNotMatch(disclosure, /borderWidth:\s*1/);

  const host = read('../src/components/public-role-reviews.tsx');
  assert.doesNotMatch(host, /publicRoleHostListeners|notifyPublicRoleHostEpoch|forcePublicRoleHostReleaseForTest|usePublicRoleHostOwnership/);
  assert.match(host, /restorePublicTriggerFocus/);
  assert.match(host, /rememberPublicRoleFocusTarget/);
  assert.match(host, /clearPublicRoleFocusTarget/);
  assert.match(host, /resumePendingPublicAuthor/);
  assert.match(host, /PublicRoleAuthorEntryButton/);
  assert.match(host, /withdrawOwnPublic\(item,\s*s\.actor,\s*surface\.gen\)/);
  assert.doesNotMatch(host, /без выдуманного исполнителя/);
  assert.match(host, /срок и исполнитель не обещаются/);

  const myGames = read('../app/my-games.tsx');
  assert.match(myGames, /Отзывы/);
  assert.match(myGames, /Мои публичные отзывы о ролях/);
  assert.match(myGames, /PublicOwnReviewsEntry|rememberPublicRoleFocusTarget/);

  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(coordinator, /resumePendingPublicAuthor/);

  const api = read('../src/native-api.ts');
  assert.match(api, /publicRoleEligibility/);
  assert.match(api, /publicRoleConsentPreview/);
  assert.match(api, /publicRoleOwn/);
  assert.match(api, /\/me\/role-reviews\/eligibility/);
  assert.match(api, /\/me\/role-reviews\/consent-preview/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /publicEligibility/);
  assert.match(auth, /publicConsentPreview/);
  assert.match(auth, /publicOwnReviews/);

  const controller = read('../../api/src/games/role-reputation.controller.ts');
  assert.match(controller, /requirePrincipal/);
  assert.match(controller, /requirePrincipalMutation/);
  assert.match(controller, /replyCommand[\s\S]*requireCookieMutation/);
  assert.match(controller, /report[\s\S]*requireCookieMutation/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 34);
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
