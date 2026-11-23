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
  playerRoleReputationPath,
  publishedReviewsLabel,
  roleReputationPath,
} from '../src/role-reputation.ts';
import type { RoleReputationSummary } from '../src/role-reputation.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const gameId = '11111111-1111-4111-8111-111111111111';
const peerId = 'public-peer-a';
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
    if (path.includes(`/players/${peerId}/role-reputations/organization`)) {
      return Response.json(summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 1,
        items: [review('f'.repeat(32), 'organization', 'Профиль')],
        nextCursor: 'peer-cur',
      }));
    }
    if (path.includes(`/players/${peerId}/role-reputations/training`)) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });

  assert.equal(gameRoleReputationPath(gameId, 'organization'), `/games/${gameId}/role-reputations/organization`);
  assert.equal(
    roleReputationPath(orgHandle, { gameId, cursor: 'cur', limit: 20 }),
    `/role-reputations/${orgHandle}?gameId=${gameId}&cursor=cur&limit=20`,
  );
  assert.equal(
    playerRoleReputationPath(peerId, 'organization', { limit: 3 }),
    `/players/${peerId}/role-reputations/organization?limit=3`,
  );
  assert.equal(
    playerRoleReputationPath(peerId, 'organization', { cursor: 'peer-cur', limit: 20 }),
    `/players/${peerId}/role-reputations/organization?cursor=peer-cur&limit=20`,
  );
  assert.throws(() => playerRoleReputationPath('bad id', 'organization'), PublicApiError);
  assert.throws(() => roleReputationPath(orgHandle, { gameId: undefined as unknown as string }), PublicApiError);

  const first = await api.gameRoleReputation(gameId, 'organization');
  assert.equal(first.roleHandle, orgHandle);
  assert.equal(first.items.length, 1);
  const page = await api.roleReputation(orgHandle, { gameId, cursor: 'cur', limit: 20 });
  assert.equal(page.items[0]?.text, 'Ещё');
  const profile = await api.playerRoleReputation(peerId, 'organization', { limit: 3 });
  assert.equal(profile.items[0]?.text, 'Профиль');
  assert.equal(profile.nextCursor, 'peer-cur');

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.ok(call.url.startsWith(`${API_ORIGIN}/v1/`));
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.credentials, 'omit');
    assert.equal((call.init.headers as Record<string, string>).Accept, 'application/json');
    assert.equal((call.init.headers as Record<string, string>).Authorization, undefined);
    assert.equal((call.init.headers as Record<string, string>).Cookie, undefined);
  }
  assert.ok(calls[2]?.url.includes(`/players/${peerId}/role-reputations/organization?limit=3`));

  await assert.rejects(api.gameRoleReputation(gameId, 'training'), (e: unknown) => e instanceof PublicApiError && e.kind === 'unavailable');
  await assert.rejects(api.playerRoleReputation(peerId, 'training'), (e: unknown) => e instanceof PublicApiError && e.kind === 'unavailable');
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

test('#522 loadMore network + malformed page preserve reviews/cursor; retry same cursor; stale cannot repaint', async () => {
  const rejections: unknown[] = [];
  const onReject = (reason: unknown) => { rejections.push(reason); };
  process.on('unhandledRejection', onReject);
  try {
    const pageCursors: string[] = [];
    let pageMode: 'network' | 'malformed' | 'ok' = 'network';
    const api = createPublicApi(async (url) => {
      const path = String(url);
      if (path.includes(`/games/${gameId}/role-reputations/organization`)) {
        return Response.json(summary({
          role: 'organization',
          roleHandle: orgHandle,
          publishedReviewCount: 2,
          items: [review('d'.repeat(32), 'organization', 'Старт')],
          nextCursor: 'cursor-a32',
        }));
      }
      if (path.includes(`/role-reputations/${orgHandle}`)) {
        const cursor = new URL(path, 'https://example.test').searchParams.get('cursor') ?? '';
        pageCursors.push(cursor);
        if (pageMode === 'network') {
          throw new TypeError('Failed to fetch');
        }
        if (pageMode === 'malformed') {
          // Same handle, wrong role — parser accepts (roleHandle-only expected); coordinator must catch.
          return Response.json(summary({
            role: 'training',
            roleHandle: orgHandle,
            heldGamesCount: null,
            publishedReviewCount: 1,
            items: [review('e'.repeat(32), 'training', 'Чужой роль')],
            nextCursor: null,
          }));
        }
        return Response.json(summary({
          role: 'organization',
          roleHandle: orgHandle,
          publishedReviewCount: 2,
          items: [
            review('d'.repeat(32), 'organization', 'Старт'),
            review('f'.repeat(32), 'organization', 'Вторая страница'),
          ],
          nextCursor: null,
        }));
      }
      return new Response(null, { status: 404 });
    });
    const coordinator = new RoleReputationCoordinator({
      gameRole: (id, role, signal) => api.gameRoleReputation(id, role, signal),
      byHandle: (handle, query, signal) => api.roleReputation(handle, query, signal),
    });
    coordinator.bind(gameId, { wantTraining: false });
    coordinator.expand();
    await flush();
    const first = coordinator.getSnapshot().organization;
    assert.equal(first.phase, 'ready');
    assert.equal(first.summary?.items.length, 1);
    assert.equal(first.summary?.nextCursor, 'cursor-a32');
    assert.equal(first.moreError, false);

    // Transient network failure on next page — keep accepted history.
    pageMode = 'network';
    coordinator.loadMore('organization');
    assert.equal(coordinator.getSnapshot().organization.loadingMore, true);
    await flush();
    await flush();
    const afterNet = coordinator.getSnapshot().organization;
    assert.equal(afterNet.loadingMore, false);
    assert.equal(afterNet.phase, 'ready');
    assert.equal(afterNet.moreError, true);
    assert.equal(afterNet.summary?.items.length, 1);
    assert.equal(afterNet.summary?.items[0]?.text, 'Старт');
    assert.equal(afterNet.summary?.nextCursor, 'cursor-a32');
    assert.equal(afterNet.summary?.roleHandle, orgHandle);
    assert.deepEqual(pageCursors, ['cursor-a32']);

    // Malformed page — still preserve; no unhandled rejection; loader retired.
    pageMode = 'malformed';
    coordinator.loadMore('organization');
    assert.equal(coordinator.getSnapshot().organization.loadingMore, true);
    assert.equal(coordinator.getSnapshot().organization.moreError, false);
    await flush();
    await flush();
    const afterBad = coordinator.getSnapshot().organization;
    assert.equal(afterBad.loadingMore, false);
    assert.equal(afterBad.phase, 'ready');
    assert.equal(afterBad.moreError, true);
    assert.equal(afterBad.summary?.items.length, 1);
    assert.equal(afterBad.summary?.nextCursor, 'cursor-a32');
    assert.deepEqual(pageCursors, ['cursor-a32', 'cursor-a32']);

    // Explicit page retry queries the same cursor, then succeeds with dedupe.
    pageMode = 'ok';
    coordinator.loadMore('organization');
    await flush();
    await flush();
    const afterOk = coordinator.getSnapshot().organization;
    assert.equal(afterOk.moreError, false);
    assert.equal(afterOk.loadingMore, false);
    assert.equal(afterOk.phase, 'ready');
    assert.equal(afterOk.summary?.items.length, 2);
    assert.equal(afterOk.summary?.items.map(i => i.text).join('|'), 'Старт|Вторая страница');
    assert.equal(afterOk.summary?.nextCursor, null);
    assert.deepEqual(pageCursors, ['cursor-a32', 'cursor-a32', 'cursor-a32']);
    assert.equal(rejections.length, 0);

    // Collapse then late page must not repaint; rebind clears.
    let releaseLate: () => void = () => {};
    let orgReady: (value: RoleReputationSummary) => void = () => {};
    const late = new RoleReputationCoordinator({
      gameRole: async () => new Promise<RoleReputationSummary>(resolve => { orgReady = resolve; }),
      byHandle: async (_handle, query) => {
        assert.equal(query.cursor, 'cursor-stale');
        await new Promise<void>(resolve => { releaseLate = resolve; });
        return summary({
          role: 'organization',
          roleHandle: orgHandle,
          publishedReviewCount: 2,
          items: [review('9'.repeat(32), 'organization', 'Поздний')],
          nextCursor: null,
        });
      },
    });
    late.bind(gameId, { wantTraining: false });
    late.expand();
    orgReady(summary({
      role: 'organization',
      roleHandle: orgHandle,
      publishedReviewCount: 1,
      items: [review('8'.repeat(32), 'organization', 'До collapse')],
      nextCursor: 'cursor-stale',
    }));
    await flush();
    late.loadMore('organization');
    late.collapse();
    releaseLate();
    await flush();
    assert.equal(late.getSnapshot().expanded, false);
    assert.equal(late.getSnapshot().organization.summary, null);
    assert.equal(late.getSnapshot().organization.moreError, false);

    const otherGame = '22222222-2222-4222-8222-222222222222';
    let releaseRebind: () => void = () => {};
    let orgReady2: (value: RoleReputationSummary) => void = () => {};
    const rebound = new RoleReputationCoordinator({
      gameRole: async (id) => {
        if (id !== gameId) {
          return summary({ role: 'organization', roleHandle: orgHandle, publishedReviewCount: 0 });
        }
        return new Promise<RoleReputationSummary>(resolve => { orgReady2 = resolve; });
      },
      byHandle: async () => {
        await new Promise<void>(resolve => { releaseRebind = resolve; });
        return summary({
          role: 'organization',
          roleHandle: orgHandle,
          publishedReviewCount: 1,
          items: [review('7'.repeat(32), 'organization', 'После rebind')],
          nextCursor: null,
        });
      },
    });
    rebound.bind(gameId, { wantTraining: false });
    rebound.expand();
    orgReady2(summary({
      role: 'organization',
      roleHandle: orgHandle,
      publishedReviewCount: 1,
      items: [review('6'.repeat(32), 'organization', 'Старый')],
      nextCursor: 'cursor-rebind',
    }));
    await flush();
    rebound.loadMore('organization');
    rebound.bind(otherGame, { wantTraining: false });
    releaseRebind();
    await flush();
    assert.equal(rebound.getSnapshot().gameId, otherGame);
    assert.equal(rebound.getSnapshot().expanded, false);
    assert.equal(rebound.getSnapshot().organization.summary, null);
    assert.equal(rejections.length, 0);
  } finally {
    process.off('unhandledRejection', onReject);
  }
});

test('#522 loadMore authoritative unavailable retires public material', async () => {
  const api = createPublicApi(async (url) => {
    const path = String(url);
    if (path.includes(`/games/${gameId}/role-reputations/organization`)) {
      return Response.json(summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 1,
        items: [review('d'.repeat(32), 'organization', 'Видимый')],
        nextCursor: 'cursor-priv',
      }));
    }
    if (path.includes(`/role-reputations/${orgHandle}`)) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
  const coordinator = new RoleReputationCoordinator({
    gameRole: (id, role, signal) => api.gameRoleReputation(id, role, signal),
    byHandle: (handle, query, signal) => api.roleReputation(handle, query, signal),
  });
  coordinator.bind(gameId, { wantTraining: false });
  coordinator.expand();
  await flush();
  assert.equal(coordinator.getSnapshot().organization.summary?.items.length, 1);
  coordinator.loadMore('organization');
  await flush();
  await flush();
  const after = coordinator.getSnapshot().organization;
  assert.equal(after.phase, 'unavailable');
  assert.equal(after.summary, null);
  assert.equal(after.moreError, false);
  assert.equal(after.loadingMore, false);
});

test('#522 profile bindPlayer loads both lanes, paginates on player path, fences peer change', async () => {
  const peerB = 'public-peer-b';
  let orgLoads = 0;
  let trainLoads = 0;
  let moreLoads = 0;
  const calls: Array<{ id: string; role: string; cursor?: string }> = [];
  let releaseMore: () => void = () => {};
  const coordinator = new RoleReputationCoordinator({
    gameRole: async () => {
      throw new Error('game path must stay unused');
    },
    byHandle: async () => {
      throw new Error('game handle path must stay unused');
    },
    playerRole: async (id, role, query) => {
      calls.push({ id, role, cursor: query?.cursor });
      if (role === 'training') {
        trainLoads += 1;
        return summary({ role: 'training', roleHandle: trainHandle, publishedReviewCount: 0, heldGamesCount: null });
      }
      if (query?.cursor) {
        moreLoads += 1;
        await new Promise<void>(resolve => { releaseMore = resolve; });
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
      }
      orgLoads += 1;
      return summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 2,
        items: [review('1'.repeat(32), 'organization', 'Первый')],
        nextCursor: 'cursor-profile',
      });
    },
  });

  coordinator.bindPlayer(peerId);
  await flush();
  assert.equal(coordinator.getSnapshot().publicPlayerId, peerId);
  assert.equal(coordinator.getSnapshot().gameId, null);
  assert.equal(coordinator.getSnapshot().expanded, true);
  assert.equal(coordinator.getSnapshot().organization.phase, 'ready');
  assert.equal(coordinator.getSnapshot().training.phase, 'ready');
  assert.equal(orgLoads, 1);
  assert.equal(trainLoads, 1);
  assert.ok(calls.every(c => c.id === peerId));
  assert.ok(calls.some(c => c.role === 'organization' && c.cursor === undefined));
  assert.ok(calls.some(c => c.role === 'training'));

  coordinator.loadMore('organization');
  assert.equal(coordinator.getSnapshot().organization.loadingMore, true);
  assert.equal(moreLoads, 1);
  releaseMore();
  await flush();
  assert.equal(coordinator.getSnapshot().organization.summary?.items.map(i => i.text).join('|'), 'Первый|Второй');
  assert.equal(calls.filter(c => c.cursor === 'cursor-profile').length, 1);

  // Peer A→B clears immediately; late page for A must not paint.
  let releaseLate: () => void = () => {};
  const late = new RoleReputationCoordinator({
    gameRole: async () => { throw new Error('unused'); },
    byHandle: async () => { throw new Error('unused'); },
    playerRole: async (id, role, query) => {
      if (id === peerId && query?.cursor) {
        await new Promise<void>(resolve => { releaseLate = resolve; });
        return summary({
          role: 'organization',
          roleHandle: orgHandle,
          publishedReviewCount: 1,
          items: [review('9'.repeat(32), 'organization', 'Поздний')],
        });
      }
      if (id === peerB) {
        return summary({
          role,
          roleHandle: role === 'organization' ? orgHandle : trainHandle,
          heldGamesCount: role === 'organization' ? 0 : null,
          publishedReviewCount: 0,
        });
      }
      return summary({
        role: 'organization',
        roleHandle: orgHandle,
        publishedReviewCount: 1,
        items: [review('8'.repeat(32), 'organization', 'Старт')],
        nextCursor: 'late-cur',
      });
    },
  });
  late.bindPlayer(peerId);
  await flush();
  late.loadMore('organization');
  late.bindPlayer(peerB);
  releaseLate();
  await flush();
  assert.equal(late.getSnapshot().publicPlayerId, peerB);
  assert.equal(late.getSnapshot().organization.summary?.items.length ?? 0, 0);
  assert.doesNotMatch(JSON.stringify(late.getSnapshot().organization.summary), /Поздний/);

  // Null/unavailable is not zero events.
  const hidden = new RoleReputationCoordinator({
    gameRole: async () => { throw new Error('unused'); },
    byHandle: async () => { throw new Error('unused'); },
    playerRole: async () => { throw new PublicApiError('unavailable', 404); },
  });
  hidden.bindPlayer(peerId);
  await flush();
  assert.equal(hidden.getSnapshot().organization.phase, 'unavailable');
  assert.equal(hidden.getSnapshot().organization.summary, null);
  assert.equal(hidden.getSnapshot().training.phase, 'unavailable');
});

test('#522 native role-history source wiring, composition slot, APK26 counter', () => {
  const card = read('../src/components/game-card.tsx');
  const disclosure = read('../src/components/game-role-reputation.tsx');
  const profile = read('../src/components/player-role-reputation.tsx');
  const detail = read('../app/players/[publicPlayerId].tsx');
  const nav = read('../src/components/main-navigation.tsx');
  const api = read('../src/public-api.ts');
  const module = read('../src/role-reputation.ts');
  assert.match(card, /GameRoleReputationDisclosure/);
  assert.match(card, /Отзывы и история/);
  assert.doesNotMatch(card, /Отзывы и история ролей пока недоступны/);
  // Canonical trainer hierarchy: actions slot into disclosure (toggle → actions → body), not after it.
  assert.match(card, /actions=\{trainerLed \? <View style=\{card\.actionsRow\}><GameActions/);
  assert.doesNotMatch(card, /\/>\s*\{trainerLed \? <View style=\{card\.actionsRow\}>/);
  assert.match(disclosure, /actions\?: ReactNode/);
  // Toggle, then actions slot, then expanded details region (not actions after body).
  assert.match(disclosure, /<\/Pressable>\s*\{actions\}\s*\{expanded \? <View style=\{styles\.details\}/);
  assert.match(disclosure, /export function RoleLaneView/);
  assert.match(disclosure, /Не удалось загрузить следующие отзывы/);
  assert.match(disclosure, /Отзывы и история/);
  assert.match(disclosure, /basis_under_review/);
  assert.match(disclosure, /Ещё отзывы/);
  assert.match(disclosure, /Основание на проверке/);
  assert.match(disclosure, /minHeight:\s*44/);
  assert.match(disclosure, /borderWidth:\s*0/);
  assert.match(disclosure, /backgroundColor:\s*'transparent'/);
  assert.match(disclosure, /textDecorationLine:\s*'underline'/);
  assert.match(disclosure, /paddingVertical:\s*8/);
  assert.match(disclosure, /rotate:\s*'180deg'/);
  assert.doesNotMatch(disclosure, /borderWidth:\s*1/);
  assert.doesNotMatch(disclosure, /Поделиться опытом|Сообщить о нарушении|canReply|canReport/);
  assert.match(profile, /PlayerRoleReputation/);
  assert.match(profile, /bindPlayer/);
  assert.match(profile, /playerRoleReputation/);
  assert.doesNotMatch(profile, /gameId|Отзывы и история|Поделиться опытом|canReply|canReport/);
  assert.match(detail, /PlayerRoleReputation/);
  assert.match(detail, /NativeContactAction[\s\S]*PlayerRoleReputation[\s\S]*NativeSafety/);
  assert.match(api, /gameRoleReputation/);
  assert.match(api, /roleReputation/);
  assert.match(api, /playerRoleReputation/);
  assert.match(api, /credentials: 'omit'/);
  assert.match(api, /playerRoleReputationPath/);
  assert.match(module, /RoleReputationCoordinator/);
  assert.match(module, /bindPlayer/);
  assert.match(module, /playerRoleReputationPath/);
  assert.match(module, /moreError/);
  assert.match(module, /gameId/);
  assert.match(module, /publicPlayerId/);
  assert.match(module, /phase: 'error'/);
  // Game handle path still requires gameId — profile path is separate.
  assert.match(module, /if \(!isVenueId\(query\.gameId\)\) throw new PublicApiError\('invalid'\)/);
  assert.match(nav, /mainNavCompactCells/);
  assert.match(nav, /flexBasis: 'auto'/);
  assert.match(nav, /accessibilityLabel=\{a11yLabel\}/);
  assert.doesNotMatch(nav, /numberOfLines|ellipsizeMode|maxFontSizeMultiplier|allowFontScaling=\{false\}/);
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 33);
});
