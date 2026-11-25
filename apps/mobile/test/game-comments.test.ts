import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import {
  CommunityError, freezeGameCommentPacket, gameCommentsPath, gameCommentWire,
  parseGameComment, parseGameCommentPage, parseGameCommentReceipt, commentText,
} from '../src/game-comments.ts';
import type { GameComment, GameCommentQuery, GameCommentAction } from '../src/game-comments.ts';
import { GameCommentsCoordinator } from '../src/game-comments-coordinator.ts';
import type { GameCommentPorts } from '../src/game-comments-coordinator.ts';
import { createNativeApi } from '../src/native-api.ts';
import { createPublicApi } from '../src/public-api.ts';

const gameId = '10000000-0000-4000-8000-000000000001';
const rootId = '10000000-0000-4000-8000-000000000003';
const replyId = '10000000-0000-4000-8000-000000000004';
const actor = { actorId: 'actor', sessionId: 'session', generation: 1 };
const scope = { gameId };
const stamp = '2026-11-15T12:00:00Z';
const row = (overrides: Partial<GameComment> = {}): GameComment => ({
  id: rootId, entityKind: 'game', entityId: gameId, parentCommentId: null, body: 'Question',
  deleted: false, version: 1, createdAt: stamp, updatedAt: stamp, edited: false, mine: true, replyCount: 0,
  author: {
    displayName: 'Игрок', publicPlayerId: null, profilePublic: false,
    avatar: { uploadedUrl: null, providerUrl: null },
  },
  ...overrides,
});
const page = (q: GameCommentQuery, items = [row()], nextCursor: string | null = null) => ({
  entityKind: 'game' as const, entityId: gameId, parentCommentId: q.parentCommentId, items, nextCursor,
  visibleCount: items.length, canCreate: true,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
};

async function fixture() {
  let serial = 10, writes = 0;
  const packets: unknown[] = [];
  const ports: GameCommentPorts = {
    guestComments: async (q: GameCommentQuery) => ({ ...page(q), canCreate: false, items: [row({ mine: false })] }),
    comments: async (q: GameCommentQuery) => page(q),
    send: async (p) => {
      writes++; packets.push(p);
      return row({ version: p.action.kind === 'create' ? 1 : 2, body: String(p.body.text ?? null),
        deleted: p.action.kind === 'delete', id: p.action.kind === 'create' ? rootId : (p.action as { comment: GameComment }).comment.id,
        parentCommentId: p.action.kind === 'create' ? p.action.parentCommentId : null });
    },
    random: () => `10000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`,
  };
  const owner = new GameCommentsCoordinator(ports);
  owner.setActor(actor); owner.open(gameId); await owner.refresh();
  return { owner, ports, packets, writes: () => writes };
}

const read = (p: string) => readFileSync(new NodeURL(p, import.meta.url), 'utf8');

test('#522 game comment text bounds, exact path, and text-only create body', () => {
  assert.equal(commentText(' 😀\n Text '), '😀\n Text');
  assert.throws(() => commentText('😀'.repeat(1001)));
  const q: GameCommentQuery = { gameId, order: 'asc', parentCommentId: null, cursor: null };
  assert.equal(gameCommentsPath(q), `/games/${gameId}/comments?limit=20&order=asc`);
  const create = freezeGameCommentPacket(actor, scope, { kind: 'create', text: 'When?', parentCommentId: null }, replyId);
  assert.equal(create.path, `/games/${gameId}/comments`);
  assert.deepEqual(create.body, { text: 'When?' });
  assert.equal(Object.hasOwn(create.body, 'photoIds'), false);
  assert.throws(() => freezeGameCommentPacket(actor, scope, {
    kind: 'edit', comment: row({ parentCommentId: replyId }), text: 'no',
  }, replyId));
});

test('page validates game identity/order/parent; rejects photos and venue kind', () => {
  const q: GameCommentQuery = { gameId, parentCommentId: null, order: 'asc', cursor: null };
  assert.equal(parseGameCommentPage(page(q), scope, q).items[0]!.id, rootId);
  assert.throws(() => parseGameComment({ ...row(), entityKind: 'venue' as never }));
  assert.throws(() => parseGameComment({ ...row(), photos: [{ id: replyId }] }));
  assert.throws(() => parseGameCommentPage({ ...page(q), entityId: replyId }, scope, q));
  const raw = {
    ...row(),
    author: {
      displayName: 'Public', profilePublic: true, publicPlayerId: replyId,
      avatar: { uploadedUrl: null, providerUrl: 'https://provider.test/private' },
    },
  };
  assert.equal(parseGameComment(raw).author!.avatar.providerUrl, null);
});

test('immutable packet/receipt: version, tombstone, masked body; wire rebuild rejects forged path', () => {
  const p = freezeGameCommentPacket(actor, scope, { kind: 'edit', comment: row(), text: 'Changed' }, replyId);
  assert.equal(p.body.expectedVersion, 1);
  assert.ok(Object.isFrozen(p.action));
  const receipt = row({ version: 2, body: 'Ch*****' });
  assert.equal(parseGameCommentReceipt(receipt, p).body, 'Ch*****');
  for (const bad of [
    { ...receipt, version: 1 }, { ...receipt, entityId: replyId },
    { ...receipt, id: replyId }, { ...receipt, mine: false },
  ]) assert.throws(() => parseGameCommentReceipt(bad, p));
  const deletion = freezeGameCommentPacket(actor, scope, { kind: 'delete', comment: row() }, replyId);
  assert.equal(parseGameCommentReceipt(row({ version: 2, deleted: true, body: null }), deletion).deleted, true);
  const forged = { ...p, path: `/games/${replyId}/comments` };
  assert.throws(() => gameCommentWire(forged as typeof p));
});

test('guest→login journey: sorted pages, ascending replies, mine/canCreate, root mutations', async () => {
  const { owner, ports, packets } = await fixture();
  owner.setActor(null);
  await owner.refresh();
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, false);
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.items[0]?.mine, false);
  assert.equal(owner.review({ kind: 'create', text: 'Nope', parentCommentId: null }), null);

  owner.setActor(actor);
  ports.comments = async (q: GameCommentQuery) =>
    q.parentCommentId
      ? page(q, [row({ id: replyId, parentCommentId: q.parentCommentId, mine: false, body: 'Answer' })])
      : q.cursor
        ? page(q, [row({ id: replyId, createdAt: '2026-11-15T13:00:00Z', mine: false })])
        : page(q, [row()], 'next');
  await owner.refresh();
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, true);
  await owner.loadThread(null, true);
  assert.equal(owner.getSnapshot().roots.pages.length, 2);

  owner.setDraft('root', 'When do we start?');
  const created = owner.review({ kind: 'create', text: 'When do we start?', parentCommentId: null })!;
  assert.ok(created);
  assert.deepEqual(created.body, { text: 'When do we start?' });
  await owner.commit(created.key);
  assert.equal(owner.getSnapshot().operations[0]!.status, 'confirmed');

  await owner.loadThread(rootId);
  assert.equal(owner.getSnapshot().replies[rootId]!.pages[0]!.page.items[0]!.id, replyId);
  owner.setDraft(rootId, 'Reply text');
  const reply = owner.review({ kind: 'create', text: 'Reply text', parentCommentId: rootId })!;
  await owner.commit(reply.key);
  assert.equal((packets.at(-1) as { body: { parentCommentId?: string } }).body.parentCommentId, rootId);

  ports.comments = async (q: GameCommentQuery) =>
    q.parentCommentId ? page(q, []) : page(q, [row()]);
  await owner.refresh();
  const liveRoot = owner.rows().find(c => c.id === rootId)!;
  assert.equal(owner.beginEdit(rootId), true);
  owner.setDraft(`edit:${rootId}`, 'Edited root');
  const edited = owner.review({ kind: 'edit', comment: liveRoot, text: 'Edited root' })!;
  ports.send = async (p) => {
    packets.push(p);
    return row({ version: 2, body: 'Edited root', edited: true });
  };
  await owner.commit(edited.key);
  assert.equal((packets.at(-1) as { method: string }).method, 'PUT');

  ports.comments = async (q: GameCommentQuery) =>
    q.parentCommentId ? page(q, []) : page(q, [row({ version: 2, body: 'Edited root', edited: true })]);
  await owner.refresh();
  const liveEdited = owner.rows().find(c => c.id === rootId)!;
  const removed = owner.review({ kind: 'delete', comment: liveEdited })!;
  ports.send = async (p) => {
    packets.push(p);
    return row({ version: 3, body: null, deleted: true, edited: true });
  };
  await owner.commit(removed.key);
  assert.equal((packets.at(-1) as { method: string }).method, 'DELETE');
});

test('game/actor/view change and token wait retire late callbacks; UNKNOWN keeps same key', async () => {
  const { owner, ports, writes } = await fixture();
  owner.setDraft('root', 'unsent');
  const delayed = deferred<unknown>();
  ports.comments = () => delayed.promise;
  const reading = owner.loadThread(null);
  owner.setActor(null);
  delayed.resolve(page({ gameId, order: 'asc', parentCommentId: null, cursor: null }));
  await reading;
  assert.deepEqual(owner.getSnapshot().drafts, {});
  assert.equal(writes(), 0);

  owner.setActor(actor); await owner.refresh();
  ports.send = async () => { throw new CommunityError('network'); };
  const p = owner.review({ kind: 'create', text: 'Hold', parentCommentId: null })!;
  await owner.commit(p.key);
  assert.equal(owner.getSnapshot().operations[0]!.status, 'unknown');
  owner.detach(); owner.open(gameId); await owner.refresh();
  assert.equal(owner.getSnapshot().operations[0]!.packet, p);
  assert.equal(owner.getSnapshot().operations[0]!.status, 'unknown');

  owner.open(replyId); await owner.refresh();
  assert.deepEqual(owner.getSnapshot().operations, []);
});

test('lost response: immutable same-key recovery; late ACK cannot paint another actor/game', async () => {
  const { owner, ports, packets } = await fixture();
  let calls = 0;
  ports.send = async (p) => {
    packets.push(p); calls++;
    if (calls === 1) throw new CommunityError('network');
    return row({ version: 1, body: String(p.body.text) });
  };
  const p = owner.review({ kind: 'create', text: 'Recover me', parentCommentId: null })!;
  await owner.commit(p.key);
  assert.equal(owner.getSnapshot().operations[0]!.status, 'unknown');
  assert.equal(calls, 1);
  await owner.reconcile(p.key);
  assert.equal(calls, 2);
  assert.equal(packets[0], packets[1]);
  assert.equal(owner.getSnapshot().operations[0]!.status, 'confirmed');

  const delayed = deferred<unknown>();
  ports.send = () => delayed.promise;
  owner.setDraft('root', 'Second');
  const pending = owner.review({ kind: 'create', text: 'Second', parentCommentId: null })!;
  const writing = owner.commit(pending.key);
  owner.setActor({ ...actor, generation: 2 });
  delayed.resolve(row({ body: 'Second' }));
  await writing;
  assert.equal(owner.getSnapshot().operations.length, 0);
});

test('production guest transport omits credentials; native bearer bodies use Idempotency-Key', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({
      entityKind: 'game', entityId: gameId, parentCommentId: null, items: [],
      nextCursor: null, visibleCount: 0, canCreate: false,
    }));
  };
  const pub = createPublicApi(fetcher), api = createNativeApi(fetcher);
  await pub.gameComments({ gameId, order: 'asc', parentCommentId: null, cursor: null });
  assert.equal(seen[0]!.init.credentials, 'omit');
  assert.deepEqual(seen[0]!.init.headers, { Accept: 'application/json' });
  assert.match(seen[0]!.url, new RegExp(`/v1/games/${gameId}/comments`));

  const action: GameCommentAction = { kind: 'create', text: 'Wire body', parentCommentId: null };
  const p = freezeGameCommentPacket(actor, scope, action, replyId);
  await api.gameCommentMutation('opaque', p);
  assert.equal(seen[1]!.url, `https://dev.gobadminton.ru/v1/games/${gameId}/comments`);
  assert.equal((seen[1]!.init.headers as Record<string, string>)['Idempotency-Key'], replyId);
  assert.equal((seen[1]!.init.headers as Record<string, string>).Authorization, 'Bearer opaque');
  assert.deepEqual(JSON.parse(seen[1]!.init.body as string), { text: 'Wire body' });
  const invalid = createNativeApi(async () => new Response('{}', { status: 401 }));
  await assert.rejects(invalid.gameComments('bad', { gameId, parentCommentId: null, cursor: null, order: 'asc' }));
});

test('composition mounts only for published/public game; provider above Stack; SOURCE_PENDING contract', () => {
  const detail = read('../app/games/[id].tsx');
  const layout = read('../app/_layout.tsx');
  const contract = read('../../../docs/product/NATIVE_UI_BEHAVIOR_CONTRACT.md');
  const readme = read('../README.md');
  const ui = read('../src/components/game-comments.tsx');
  assert.match(detail, /NativeGameComments/);
  assert.match(detail, /game\.status === 'published' && game\.visibility === 'public'/);
  assert.match(layout, /GameCommentsProvider/);
  assert.ok(layout.indexOf('GameCommentsProvider') < layout.indexOf('MessagesOwner'));
  assert.match(ui, /\/players\/\[publicPlayerId\]/);
  assert.match(ui, /useFocusEffect/);
  assert.match(contract, /R-22/);
  assert.match(contract, /SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE/);
  assert.match(readme, /APK56|counter \*\*55→56\*\*/);
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 56);
});

test('descending roots still transport reply reads as order=asc', async () => {
  const { owner, ports } = await fixture();
  const seen: GameCommentQuery[] = [];
  ports.comments = async (q: GameCommentQuery) => {
    seen.push(q);
    if (q.parentCommentId) {
      assert.equal(q.order, 'asc');
      return page(q, [row({
        id: replyId, parentCommentId: q.parentCommentId, mine: false, body: 'Answer',
        createdAt: '2026-11-15T11:00:00Z',
      })]);
    }
    assert.equal(q.order, 'desc');
    return page(q, [row({ createdAt: '2026-11-15T13:00:00Z' })]);
  };
  owner.setOrder('desc');
  await owner.loadThread(null);
  assert.equal(owner.getSnapshot().order, 'desc');
  assert.equal(seen.at(-1)?.order, 'desc');
  await owner.loadThread(rootId);
  assert.equal(seen.at(-1)?.parentCommentId, rootId);
  assert.equal(seen.at(-1)?.order, 'asc');
  assert.equal(owner.getSnapshot().replies[rootId]!.pages[0]!.query.order, 'asc');
});

test('leave/background during token wait blocks POST; return awaits fresh authority before actions', async () => {
  const { owner, ports } = await fixture();
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, true);
  const gate = deferred<void>();
  let permitAtSend: boolean | null = null;
  let posts = 0;
  ports.send = async (_p, permit) => {
    await gate.promise;
    permitAtSend = permit();
    if (!permitAtSend) throw new CommunityError('network');
    posts++;
    return row({ body: 'Deferred' });
  };
  const packet = owner.review({ kind: 'create', text: 'Deferred', parentCommentId: null })!;
  const writing = owner.commit(packet.key);
  owner.setForeground(false);
  assert.equal(owner.getSnapshot().foreground, false);
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, false);
  assert.equal(owner.review({ kind: 'create', text: 'Nope', parentCommentId: null }), null);
  gate.resolve();
  await writing;
  assert.equal(permitAtSend, false);
  assert.equal(posts, 0);

  const fresh = deferred<unknown>();
  let reads = 0;
  ports.comments = async (q: GameCommentQuery) => {
    reads++;
    if (reads === 1) return fresh.promise;
    return page(q);
  };
  owner.setForeground(true);
  assert.equal(owner.getSnapshot().foreground, true);
  assert.equal(owner.getSnapshot().roots.phase, 'loading');
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, false);
  assert.equal(owner.canReconcile(packet.key), false);
  assert.equal(owner.review({ kind: 'create', text: 'Early', parentCommentId: null }), null);
  fresh.resolve(page({ gameId, order: 'asc', parentCommentId: null, cursor: null }));
  await new Promise(r => setImmediate(r));
  assert.equal(owner.getSnapshot().roots.phase, 'ready');
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, true);
  assert.equal(owner.getSnapshot().operations[0]?.status, 'unknown');
  assert.equal(owner.getSnapshot().operations[0]?.packet, packet);
  assert.equal(owner.canReconcile(packet.key), true);
});

test('safety acknowledgement invalidates pages and late read cannot restore stale canCreate mid-refresh', async () => {
  const { owner, ports } = await fixture();
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, true);
  const late = deferred<unknown>();
  let calls = 0;
  ports.comments = async (q: GameCommentQuery) => {
    calls++;
    if (calls === 1) return late.promise;
    return page(q, [row({ mine: false, body: 'After block' })], null);
  };
  owner.invalidateAfterSafety();
  assert.equal(owner.getSnapshot().roots.phase, 'loading');
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, false);
  assert.equal(owner.review({ kind: 'create', text: 'Blocked', parentCommentId: null }), null);
  // Detach before late read lands — must not paint/restore authority on a retired view.
  owner.detach();
  late.resolve(page({ gameId, order: 'asc', parentCommentId: null, cursor: null }, [row()], null));
  await new Promise(r => setImmediate(r));
  assert.equal(owner.getSnapshot().focused, false);
  assert.equal(owner.getSnapshot().roots.pages[0]?.page.canCreate, false);
  assert.notEqual(owner.getSnapshot().roots.phase, 'ready');
});
