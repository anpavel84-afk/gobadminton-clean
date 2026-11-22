import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { API_ORIGIN, createPublicApi, PublicApiError } from '../src/public-api.ts';
import {
  RoleReputationCoordinator,
  compactHistoryLabel,
  gameRoleReputationPath,
  heldHistoryLabel,
  parseRoleReputationSummary,
  publishedReviewsLabel,
  roleReputationPath,
} from '../src/role-reputation.ts';
import type { RoleReputationSummary } from '../src/role-reputation.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const gameId = '11111111-1111-4111-8111-111111111111';
const orgHandle = 'a'.repeat(32);
const trainHandle = 'b'.repeat(32);

function summary(partial: Partial<RoleReputationSummary> & Pick<RoleReputationSummary, 'role' | 'roleHandle'>): RoleReputationSummary {
  return {
    subjectDisplayName: null,
    heldGamesCount: partial.role === 'organization' ? 2 : null,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: 0,
    projectionVersion: 'p'.repeat(32),
    items: [],
    nextCursor: null,
    availability: 'available',
    ...partial,
  };
}

function review(handle: string, role: 'organization' | 'training', text = 'Ок') {
  return {
    reviewHandle: handle,
    role,
    text,
    topics: role === 'organization' ? ['flow'] : ['attention'],
    authorLabel: role === 'organization' ? 'Участник игры' as const : 'Участник тренировки' as const,
    experienceState: 'published' as const,
    publishedRevision: 1,
    replyAggregateVersion: 0,
    reply: null,
    subjectOwnReply: null,
    allowedActions: { canReport: false, canReply: false },
  };
}

test('role-reputation parser keeps availability vs zero distinct and rejects malformed bodies', () => {
  const available = parseRoleReputationSummary(summary({
    role: 'organization',
    roleHandle: orgHandle,
    heldGamesCount: 0,
    publishedReviewCount: 0,
  }));
  assert.equal(available.availability, 'available');
  assert.equal(available.heldGamesCount, 0);
  assert.equal(heldHistoryLabel(available.heldGamesCount, true), 'По подтверждённой истории проведённых игр пока нет. История может быть неполной');
  assert.equal(heldHistoryLabel(null, true), null);
  assert.equal(compactHistoryLabel(null, true), null);
  assert.equal(publishedReviewsLabel(0), 'Пока нет опубликованных отзывов по этой роли.');

  const unavailable = parseRoleReputationSummary(summary({
    role: 'organization',
    roleHandle: orgHandle,
    availability: 'unavailable',
    heldGamesCount: null,
    publishedReviewCount: 0,
    projectionVersion: 'unavailable',
  }));
  assert.equal(unavailable.availability, 'unavailable');
  assert.equal(unavailable.heldGamesCount, null);

  const withReview = parseRoleReputationSummary(summary({
    role: 'training',
    roleHandle: trainHandle,
    publishedReviewCount: 1,
    items: [{
      ...review(trainHandle.replace(/b/g, 'c'), 'training', 'Ясно объясняет'),
      experienceState: 'basis_under_review',
      reply: { text: 'Спасибо', experienceState: 'published', publishedRevision: 1 },
      replyAggregateVersion: 1,
    }],
  }));
  assert.equal(withReview.items[0]?.experienceState, 'basis_under_review');
  assert.equal(withReview.items[0]?.reply?.text, 'Спасибо');

  assert.throws(() => parseRoleReputationSummary({ ...summary({ role: 'organization', roleHandle: orgHandle }), items: 'x' }), PublicApiError);
  assert.throws(() => parseRoleReputationSummary({ ...summary({ role: 'organization', roleHandle: orgHandle }), heldGamesCount: '0' }), PublicApiError);
  assert.throws(() => parseRoleReputationSummary({
    ...summary({ role: 'organization', roleHandle: orgHandle, publishedReviewCount: 1 }),
    items: [{ ...review(orgHandle, 'organization'), authorLabel: 'Игрок' }],
  }), PublicApiError);
  assert.throws(() => parseRoleReputationSummary({
    ...summary({ role: 'organization', roleHandle: orgHandle, publishedReviewCount: 1 }),
    items: [{ ...review(orgHandle, 'organization'), topics: ['explanations'] }],
  }), PublicApiError);
});

test('credential-free PublicApi routes stay fixed-origin and omit credentials', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createPublicApi(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    const path = String(url);
    if (path.includes(`/games/${gameId}/role-reputations/organization`)) {
      return Response.json(summary({ role: 'organization', roleHandle: orgHandle, publishedReviewCount: 1, items: [review('d'.repeat(32), 'organization')] }));
    }
    if (path.includes(`/role-reputations/${orgHandle}`)) {
      return Response.json(summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 2,
        items: [review('e'.repeat(32), 'organization', 'Ещё')],
        nextCursor: null,
      }));
    }
    return new Response(null, { status: 404 });
  });

  assert.equal(gameRoleReputationPath(gameId, 'organization'), `/games/${gameId}/role-reputations/organization`);
  assert.equal(
    roleReputationPath(orgHandle, { gameId, cursor: 'cur', limit: 20 }),
    `/role-reputations/${orgHandle}?gameId=${gameId}&cursor=cur&limit=20`,
  );

  const first = await api.gameRoleReputation(gameId, 'organization');
  assert.equal(first.roleHandle, orgHandle);
  assert.equal(first.items.length, 1);
  const page = await api.roleReputation(orgHandle, { gameId, cursor: 'cur', limit: 20 });
  assert.equal(page.items[0]?.text, 'Ещё');

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(call.url.startsWith(`${API_ORIGIN}/v1/`));
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.credentials, 'omit');
    assert.equal((call.init.headers as Record<string, string>).Accept, 'application/json');
    assert.equal((call.init.headers as Record<string, string>).Authorization, undefined);
    assert.equal((call.init.headers as Record<string, string>).Cookie, undefined);
  }

  await assert.rejects(api.gameRoleReputation(gameId, 'training'), (e: unknown) => e instanceof PublicApiError && e.kind === 'unavailable');
  assert.throws(() => gameRoleReputationPath('not-uuid', 'organization'), PublicApiError);
  assert.throws(() => roleReputationPath('short', { gameId }), PublicApiError);
});

async function flush() {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
}

test('coordinator expands lazily, paginates with dedupe, retires late game/role callbacks', async () => {
  let orgLoads = 0;
  let moreLoads = 0;
  const waiters: Array<() => void> = [];
  const ports = {
    gameRole: async (id: string, role: 'organization' | 'training') => {
      assert.equal(id, gameId);
      if (role === 'training') {
        return summary({ role: 'training', roleHandle: trainHandle, publishedReviewCount: 0 });
      }
      orgLoads += 1;
      return summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 2,
        items: [review('1'.repeat(32), 'organization', 'Первый')],
        nextCursor: 'cursor-a',
      });
    },
    byHandle: async (handle: string, query: { gameId: string; cursor?: string; limit?: number }) => {
      moreLoads += 1;
      assert.equal(handle, orgHandle);
      assert.equal(query.gameId, gameId);
      assert.equal(query.cursor, 'cursor-a');
      await new Promise<void>(resolve => waiters.push(resolve));
      return summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 2,
        items: [
          review('1'.repeat(32), 'organization', 'Первый'),
          review('2'.repeat(32), 'organization', 'Второй'),
        ],
        nextCursor: null,
      });
    },
  };

  const coordinator = new RoleReputationCoordinator(ports);
  coordinator.bind(gameId, { wantTraining: true });
  assert.equal(coordinator.getSnapshot().expanded, false);
  assert.equal(orgLoads, 0);

  coordinator.expand();
  await flush();
  const ready = coordinator.getSnapshot();
  assert.equal(ready.expanded, true);
  assert.equal(ready.organization.phase, 'ready');
  assert.equal(ready.organization.summary?.items.length, 1);
  assert.equal(ready.training.phase, 'ready');
  assert.equal(orgLoads, 1);

  coordinator.loadMore('organization');
  assert.equal(coordinator.getSnapshot().organization.loadingMore, true);
  assert.equal(moreLoads, 1);
  waiters.splice(0).forEach(done => done());
  await flush();
  const paged = coordinator.getSnapshot().organization.summary!;
  assert.equal(paged.items.length, 2);
  assert.equal(paged.items.map(i => i.text).join('|'), 'Первый|Второй');
  assert.equal(paged.nextCursor, null);
  assert.equal(coordinator.getSnapshot().organization.loadingMore, false);

  // Switch game while a late more-callback is outstanding — must not paint into the new card.
  let releaseLate: () => void = () => {};
  let orgReady: (value: RoleReputationSummary) => void = () => {};
  const late = new RoleReputationCoordinator({
    gameRole: async () => new Promise<RoleReputationSummary>(resolve => { orgReady = resolve; }),
    byHandle: async () => {
      await new Promise<void>(resolve => { releaseLate = resolve; });
      return summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 1,
        items: [review('9'.repeat(32), 'organization', 'Поздний')],
        nextCursor: null,
      });
    },
  });
  const otherGame = '22222222-2222-4222-8222-222222222222';
  late.bind(gameId, { wantTraining: false });
  late.expand();
  orgReady(summary({
    role: 'organization',
    roleHandle: orgHandle,
    publishedReviewCount: 1,
    items: [review('8'.repeat(32), 'organization', 'Старт')],
    nextCursor: 'cursor-late',
  }));
  await flush();
  late.loadMore('organization');
  late.bind(otherGame, { wantTraining: false });
  releaseLate();
  await flush();
  assert.equal(late.getSnapshot().gameId, otherGame);
  assert.equal(late.getSnapshot().expanded, false);
  assert.equal(late.getSnapshot().organization.summary, null);

  // Retry after error.
  let fail = true;
  const retrying = new RoleReputationCoordinator({
    gameRole: async () => {
      if (fail) throw new PublicApiError('network');
      return summary({ role: 'organization', roleHandle: orgHandle, publishedReviewCount: 0 });
    },
    byHandle: async () => summary({ role: 'organization', roleHandle: orgHandle }),
  });
  retrying.bind(gameId, { wantTraining: false });
  retrying.expand();
  await flush();
  assert.equal(retrying.getSnapshot().organization.phase, 'error');
  fail = false;
  retrying.retry('organization');
  await flush();
  assert.equal(retrying.getSnapshot().organization.phase, 'ready');
});

test('#522 native role-history source wiring and APK22 counter', () => {
  const card = read('../src/components/game-card.tsx');
  const disclosure = read('../src/components/game-role-reputation.tsx');
  const api = read('../src/public-api.ts');
  const module = read('../src/role-reputation.ts');
  assert.match(card, /GameRoleReputationDisclosure/);
  assert.match(card, /Отзывы и история/);
  assert.doesNotMatch(card, /Отзывы и история ролей пока недоступны/);
  assert.match(disclosure, /Отзывы и история/);
  assert.match(disclosure, /basis_under_review/);
  assert.match(disclosure, /Ещё отзывы/);
  assert.match(disclosure, /Основание на проверке/);
  assert.doesNotMatch(disclosure, /Поделиться опытом|Сообщить о нарушении|canReply|canReport/);
  assert.match(api, /gameRoleReputation/);
  assert.match(api, /roleReputation/);
  assert.match(api, /credentials: 'omit'/);
  assert.match(api, /gameRoleReputationPath|roleReputationPath|parseRoleReputationSummary/);
  assert.match(module, /RoleReputationCoordinator/);
  assert.match(module, /gameId/);
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 22);
});
