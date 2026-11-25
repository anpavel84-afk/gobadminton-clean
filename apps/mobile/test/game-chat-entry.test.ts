import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { ParticipationError, type Actor, type ManagedGame } from '../src/participation.ts';
import { MessagesError, type GameChat } from '../src/messages.ts';
import {
  GameChatEntryCoordinator,
  isChatWindowOpen,
  isConfirmedChatMember,
  type GameChatEntryRenderedPermit,
  type GameChatWindow,
} from '../src/game-chat-entry.ts';
import type { Participation } from '@gobadminton/contracts/game-types';

const actor: Actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const gameId = '10000000-0000-4000-8000-000000000010';
const otherGame = '10000000-0000-4000-8000-000000000011';
const futureEnds = '2099-12-01T12:00:00.000Z';
const pastEnds = '2020-01-01T12:00:00.000Z';

function windowOpen(partial: Partial<GameChatWindow> = {}): GameChatWindow {
  return Object.freeze({ status: 'published', endsAt: futureEnds, ...partial });
}

function part(status: Participation['status']): Participation {
  return {
    id: 'p1', gameId, userId: 'A', status, version: 1, attemptNumber: 1,
    requestedAt: '2026-01-01T00:00:00.000Z',
  };
}

function chat(partial: Partial<GameChat> = {}): GameChat {
  return {
    id: 'c1', gameId, kind: 'game', lifecycleState: 'active', version: 1,
    lastMessageSeq: '0', readThroughSeq: '0', unreadCount: 0, memberRole: 'member',
    ...partial,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(overrides: {
  parts?: Participation[] | null;
  managed?: ManagedGame[];
  managedPages?: Array<{ items: ManagedGame[]; nextCursor: string | null }>;
  read?: () => Promise<GameChat>;
  managedFail?: boolean;
} = {}) {
  const reads: string[] = [];
  const managedCalls: Array<{ cursor: string | undefined }> = [];
  let parts: Participation[] | null = overrides.parts === undefined
    ? [part('confirmed')]
    : overrides.parts;
  let pageIndex = 0;
  const owner = new GameChatEntryCoordinator({
    detailParts: () => parts,
    managed: async (cursor, permit) => {
      managedCalls.push({ cursor });
      if (!permit()) throw new ParticipationError('stale');
      if (overrides.managedFail) throw new ParticipationError('network');
      if (overrides.managedPages) {
        const page = overrides.managedPages[pageIndex] ?? { items: [], nextCursor: null };
        pageIndex++;
        return page;
      }
      return { items: overrides.managed ?? [], nextCursor: null };
    },
    readChat: async (id, permit) => {
      if (!permit()) throw new ParticipationError('stale');
      reads.push(id);
      if (overrides.read) return overrides.read();
      return chat({ gameId: id });
    },
  });
  owner.setActor(actor);
  return {
    owner, reads, managedCalls,
    setParts: (value: Participation[] | null) => { parts = value; },
  };
}

function capturePermit(owner: GameChatEntryCoordinator): GameChatEntryRenderedPermit {
  const permit = owner.renderedPermit();
  assert.ok(permit);
  return permit!;
}

test('helpers: confirmed + published future window only', () => {
  assert.equal(isConfirmedChatMember(part('confirmed')), true);
  assert.equal(isConfirmedChatMember(part('pending')), false);
  assert.equal(isConfirmedChatMember(part('withdrawn')), false);
  assert.equal(isConfirmedChatMember(undefined), false);
  assert.equal(isChatWindowOpen(windowOpen()), true);
  assert.equal(isChatWindowOpen(windowOpen({ status: 'draft' })), false);
  assert.equal(isChatWindowOpen(windowOpen({ status: 'cancelled' })), false);
  assert.equal(isChatWindowOpen(windowOpen({ endsAt: pastEnds })), false);
  assert.equal(isChatWindowOpen(windowOpen({ endsAt: 'not-a-date' })), false);
});

test('confirmed and manager-on-later-page receive active link; ineligible skip chat GET', async () => {
  const confirmed = setup({ parts: [part('confirmed')] });
  confirmed.owner.focus(gameId, windowOpen());
  await confirmed.owner.load();
  assert.equal(confirmed.reads.length, 1);
  assert.equal(confirmed.owner.getSnapshot().available, true);
  assert.equal(confirmed.owner.getSnapshot().status, 'ready');

  const managerLater = setup({
    parts: [],
    managedPages: [
      { items: [{ id: otherGame } as ManagedGame], nextCursor: 'page-2' },
      { items: [{ id: gameId } as ManagedGame], nextCursor: null },
    ],
  });
  managerLater.owner.focus(gameId, windowOpen());
  await managerLater.owner.load();
  assert.equal(managerLater.managedCalls.length, 2);
  assert.equal(managerLater.reads.length, 1);
  assert.equal(managerLater.owner.getSnapshot().available, true);

  for (const [label, parts] of [
    ['pending', [part('pending')]],
    ['withdrawn', [part('withdrawn')]],
    ['empty', []],
  ] as const) {
    const denied = setup({ parts: [...parts], managed: [] });
    denied.owner.focus(gameId, windowOpen());
    await denied.owner.load();
    assert.equal(denied.reads.length, 0, label);
    assert.equal(denied.owner.getSnapshot().available, false, label);
    assert.equal(denied.owner.getSnapshot().status, 'denied', label);
  }
});

test('draft/cancelled/ended/invalid date never cause chat GET; closed lifecycle hides link', async () => {
  for (const window of [
    windowOpen({ status: 'draft' }),
    windowOpen({ status: 'cancelled' }),
    windowOpen({ endsAt: pastEnds }),
    windowOpen({ endsAt: 'bad' }),
  ]) {
    const s = setup({ parts: [part('confirmed')] });
    s.owner.focus(gameId, window);
    await s.owner.load();
    assert.equal(s.reads.length, 0);
    assert.equal(s.owner.getSnapshot().available, false);
    assert.equal(s.owner.getSnapshot().status, 'closed');
  }

  const closed = setup({
    parts: [part('confirmed')],
    read: async () => chat({ lifecycleState: 'closed' }),
  });
  closed.owner.focus(gameId, windowOpen());
  await closed.owner.load();
  assert.equal(closed.reads.length, 1);
  assert.equal(closed.owner.getSnapshot().available, false);
  assert.equal(closed.owner.getSnapshot().status, 'closed');
});

test('exhausted pagination means no membership; looping cursor never guesses rights', async () => {
  const exhausted = setup({ parts: [], managed: [] });
  exhausted.owner.focus(gameId, windowOpen());
  await exhausted.owner.load();
  assert.equal(exhausted.reads.length, 0);
  assert.equal(exhausted.owner.getSnapshot().status, 'denied');

  const loop = setup({
    parts: [],
    managedPages: [
      { items: [{ id: otherGame } as ManagedGame], nextCursor: 'loop' },
      {
        items: [{ id: '10000000-0000-4000-8000-000000000099' } as ManagedGame],
        nextCursor: 'loop',
      },
    ],
  });
  loop.owner.focus(gameId, windowOpen());
  await loop.owner.load();
  assert.equal(loop.reads.length, 0);
  assert.equal(loop.owner.getSnapshot().status, 'error');
  assert.equal(loop.owner.getSnapshot().available, false);

  const failed = setup({ parts: [], managedFail: true });
  failed.owner.focus(gameId, windowOpen());
  await failed.owner.load();
  assert.equal(failed.reads.length, 0);
  assert.equal(failed.owner.getSnapshot().status, 'error');
});

test('pending detail does not probe; guest-less actor skips; 404 stays hidden', async () => {
  const pending = setup({ parts: null });
  pending.owner.focus(gameId, windowOpen());
  await pending.owner.load();
  assert.equal(pending.reads.length, 0);
  assert.equal(pending.owner.getSnapshot().status, 'idle');

  const noActor = setup({ parts: [part('confirmed')] });
  noActor.owner.setActor(null);
  noActor.owner.focus(gameId, windowOpen());
  await noActor.owner.load();
  assert.equal(noActor.reads.length, 0);

  const gone = setup({
    parts: [part('confirmed')],
    read: async () => { throw new MessagesError('private', 404); },
  });
  gone.owner.focus(gameId, windowOpen());
  await gone.owner.load();
  assert.equal(gone.owner.getSnapshot().available, false);
  assert.equal(gone.owner.getSnapshot().status, 'denied');
});

test('actor swap, blur/background, game change and delayed chat cannot reveal stale availability', async () => {
  const gate = deferred<GameChat>();
  const late = setup({
    parts: [part('confirmed')],
    read: () => gate.promise,
  });
  late.owner.focus(gameId, windowOpen());
  const work = late.owner.load();
  late.owner.focus(otherGame, windowOpen());
  gate.resolve(chat({ gameId }));
  await work;
  assert.equal(late.owner.getSnapshot().focus?.gameId, otherGame);
  assert.equal(late.owner.getSnapshot().available, false);

  const bg = setup({ parts: [part('confirmed')] });
  bg.owner.focus(gameId, windowOpen());
  await bg.owner.load();
  assert.equal(bg.owner.getSnapshot().available, true);
  const permit = capturePermit(bg.owner);
  bg.owner.setForeground(false);
  assert.equal(bg.owner.getSnapshot().available, false);
  assert.equal(bg.owner.mayNavigate(permit), false);

  const swap = setup({ parts: [part('confirmed')] });
  swap.owner.focus(gameId, windowOpen());
  await swap.owner.load();
  const live = capturePermit(swap.owner);
  swap.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(swap.owner.getSnapshot().available, false);
  assert.equal(swap.owner.mayNavigate(live), false);
});

test('rendered-handler expiry and end-time boundary; error→refresh recovers', async () => {
  const s = setup({ parts: [part('confirmed')] });
  s.owner.focus(gameId, windowOpen());
  await s.owner.load();
  const permit = capturePermit(s.owner);
  assert.equal(s.owner.mayNavigate(permit), true);
  assert.equal(s.owner.mayNavigate(permit, Date.parse(futureEnds) + 1), false);

  const release = s.owner.focus(gameId, windowOpen());
  release();
  assert.equal(s.owner.mayNavigate(permit), false);

  let fail = true;
  const recover = setup({
    parts: [part('confirmed')],
    read: async () => {
      if (fail) throw new MessagesError('network');
      return chat();
    },
  });
  recover.owner.focus(gameId, windowOpen());
  await recover.owner.load();
  assert.equal(recover.owner.getSnapshot().status, 'error');
  assert.equal(recover.owner.getSnapshot().available, false);
  fail = false;
  const retry = capturePermit(recover.owner);
  await recover.owner.load(retry);
  assert.equal(recover.owner.getSnapshot().available, true);
  assert.equal(recover.owner.getSnapshot().status, 'ready');
});

test('#522 APK53: native game-chat entry wiring + version counter', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const detail = readFileSync(`${root}/app/games/[id].tsx`, 'utf8');
  const component = readFileSync(`${root}/src/components/game-chat-entry.tsx`, 'utf8');
  const auth = readFileSync(`${root}/src/auth-coordinator.ts`, 'utf8');
  const app = JSON.parse(readFileSync(`${root}/app.json`, 'utf8'));
  assert.match(detail, /GameChatEntryPanel/);
  assert.match(detail, /game\.status/);
  assert.match(detail, /game\.endsAt/);
  assert.match(component, /Чат игры →/);
  assert.match(component, /\/messages\/game\/\[id\]/);
  assert.match(component, /mayNavigate/);
  assert.doesNotMatch(component, /messages\.focus|openThread|loadInbox/);
  assert.match(auth, /gameChatEntry = new GameChatEntryCoordinator/);
  assert.match(auth, /deps\.api\.gameChat\(access, gameId\)/);
  assert.match(auth, /gameChatEntry\.setActor\(actor\)/);
  assert.match(auth, /gameChatEntry\.forget\(\)/);
  assert.equal(app.expo.android.versionCode, 54);
});
