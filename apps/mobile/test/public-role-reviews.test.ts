import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, wire, validateReceipt, reviewComment } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import {
  buildPublicCreateBody,
  buildPublicWithdrawBody,
  consentPreviewBody,
  draftEditorKey,
  emptyPublicRoleDraft,
  isPublicRolePacketKind,
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
  await owner.withdrawOwnPublic(item);
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

  const withdrawPromise = owner.withdrawOwnPublic(v2);
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

  // Follow-up stale GET v2 must not repaint old text / writable withdraw.
  ownPhase = 'stale-v2';
  await owner.loadOwnPublicReviews();
  await tick();
  const afterStale = owner.getSnapshot().publicOwn.data?.items.find(i => i.id === reviewId);
  assert.equal(afterStale?.status, 'withdrawn');
  assert.equal(afterStale?.text, null);
  assert.equal(mayWithdrawOwnPublic(afterStale!), false);
  assert.equal(mergeOwnPublicReviewItem(afterAck, v2, 3), null);

  ownPhase = 'v3';
  await owner.loadOwnPublicReviews();
  await tick();
  assert.equal(owner.getSnapshot().publicOwn.data?.items[0]?.version, 3);
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

test('validateReceipt accepts public create/withdraw; CommandReview excludes public kinds; APK34 wiring', () => {
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

  const postgameUi = read('../src/components/postgame.tsx');
  assert.match(postgameUi, /isPublicRolePacketKind/);
  assert.match(postgameUi, /publicRole/);
  assert.match(postgameUi, /PublicRoleReviewHost/);
  assert.match(postgameUi, /bindPublicRoleFocusTrigger/);

  const disclosure = read('../src/components/game-role-reputation.tsx');
  assert.match(disclosure, /Поделиться опытом/);
  assert.match(disclosure, /beginPublicAuthorEntry/);
  assert.match(disclosure, /PublicRoleAuthorEntryButton|rememberPublicRoleFocusTarget/);
  assert.match(disclosure, /consumePendingPublicAuthor/);
  assert.doesNotMatch(disclosure, /canReply|canReport|Сообщить о нарушении/);
  assert.doesNotMatch(disclosure, /borderWidth:\s*1/);

  const host = read('../src/components/public-role-reviews.tsx');
  assert.match(host, /publicRoleHostListeners|notifyPublicRoleHostEpoch/);
  assert.match(host, /restorePublicTriggerFocus|bindPublicRoleFocusTrigger/);
  assert.match(host, /rememberPublicRoleFocusTarget/);
  assert.match(host, /PublicRoleAuthorEntryButton/);
  assert.doesNotMatch(host, /без выдуманного исполнителя/);
  assert.match(host, /срок и исполнитель не обещаются/);

  const myGames = read('../app/my-games.tsx');
  assert.match(myGames, /Отзывы/);
  assert.match(myGames, /Мои публичные отзывы о ролях/);
  assert.match(myGames, /PublicOwnReviewsEntry|FocusContext/);

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
