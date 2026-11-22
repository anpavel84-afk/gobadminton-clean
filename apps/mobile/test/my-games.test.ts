import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { GameInvitation } from '../src/messages.ts';
import { MessagesError, parseInvitationPage } from '../src/messages.ts';
import { hubRows, hubView, matchesFilter, pendingInviteCount, isPendingInvite, hubBucket } from '../src/my-games.ts';
import type { Actor } from '../src/participation.ts';
import type { OwnResult, Reminder } from '../src/postgame.ts';
import { PostgameError } from '../src/postgame.ts';
import { game as publicGame } from './fixtures.ts';
import type { Game } from '@gobadminton/contracts/game-types';

const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const game = { ...publicGame, version: 1 } satisfies Game;
const date = '2026-11-14T10:00:00Z';
const now = Date.parse('2026-11-14T12:00:00Z');
const invite = (over: Partial<GameInvitation> = {}): GameInvitation => ({
  id: 'invite-a', gameId: game.id, status: 'pending', version: 3,
  inviterPublicPlayerId: 'inviter', inviteePublicPlayerId: 'public-a',
  expiresAt: '2026-11-20T00:00:00Z', participationId: null, ...over,
});
const own: OwnResult = {
  gameId: game.id, contextId: 'context-a', gameTitle: 'Игра', endsAt: date,
  attendance: {
    contextId: 'context-a', value: 'unknown', version: 0, late: false,
    assertion: { actorDisplay: null, source: null, at: null }, acknowledgedVersion: null, dispute: null,
    displayName: 'Игрок',
    allowedActions: { canSetAttendance: true, canAcknowledge: false, canDispute: true, canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false },
  },
  notice: null,
};
const reminder: Reminder = {
  id: 'reminder-a', gameId: game.id, gameTitle: 'Игра', endsAt: date, ordinal: 1, version: 1, state: 'visible',
  dueAt: date, visibleAt: date, resultsPath: `/my-games/${game.id}/results`,
  allowedActions: { canOpenResults: true, canLater: true },
};
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function invitePort(pages: Array<{ items: GameInvitation[]; nextCursor: string | null }>) {
  const cursors: (string | undefined)[] = [];
  let index = 0;
  return {
    cursors,
    invitations: async (_actor: Actor, cursor?: string) => {
      cursors.push(cursor);
      const page = pages[index++] ?? { items: [], nextCursor: null };
      if (cursor && pages.length === 1) return { items: page.items, nextCursor: null };
      return page;
    },
  };
}

test('invite-only row visible in all/invites; manage/participate unchanged; same-game dedup retains every context', () => {
  const managed = { ...game, management: { role: 'manager' as const, createdByMe: false } };
  const part = { id: 'p', gameId: game.id, userId: actor.actorId, status: 'confirmed' as const, version: 1, attemptNumber: 1, requestedAt: date };
  const inviteOnly = invite({ id: 'invite-only', gameId: 'private-game' });
  const union = hubRows([managed], [part], [own], [reminder], [invite(), inviteOnly]);
  assert.equal(union.length, 2);
  const shared = union.find(r => r.gameId === game.id)!;
  assert.equal(shared.managed?.id, game.id);
  assert.equal(shared.parts.length, 1);
  assert.equal(shared.own.length, 1);
  assert.equal(shared.reminders.length, 1);
  assert.equal(shared.invites.length, 1);
  assert.ok(matchesFilter(shared, 'all'));
  assert.ok(matchesFilter(shared, 'manage'));
  assert.ok(matchesFilter(shared, 'participate'));
  assert.ok(matchesFilter(shared, 'invites'));
  const only = union.find(r => r.gameId === 'private-game')!;
  assert.ok(matchesFilter(only, 'all'));
  assert.ok(matchesFilter(only, 'invites'));
  assert.equal(matchesFilter(only, 'manage'), false);
  assert.equal(matchesFilter(only, 'participate'), false);
  assert.deepEqual(hubView(union, 'invites').rows.map(r => r.gameId).sort(), [game.id, 'private-game'].sort());
  // Reminder-only stays reachable via manage/all even after invites filter exists.
  const reminderOnly = hubRows([], [], [], [{ ...reminder, gameId: 'reminder-only' }], []);
  assert.ok(matchesFilter(reminderOnly[0]!, 'manage'));
  assert.ok(matchesFilter(reminderOnly[0]!, 'all'));
});

test('pending invite count is loaded-only and partial cursor must not imply full catalog', async () => {
  const first = invite({ id: 'i1' }), second = invite({ id: 'i2', expiresAt: '2026-11-01T00:00:00Z' }), third = invite({ id: 'i3' });
  assert.equal(pendingInviteCount([first, second, third], now), 2);
  assert.equal(isPendingInvite(second, now), false);
  const lane = invitePort([
    { items: [first, second], nextCursor: 'next' },
    { items: [third], nextCursor: null },
  ]);
  const owner = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: lane.invitations,
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  owner.setActor(actor);
  await owner.loadInvitations();
  assert.equal(owner.getSnapshot().invitations.status, 'ready');
  assert.equal(pendingInviteCount(owner.getSnapshot().invitations.data!.items, now), 1);
  assert.equal(owner.getSnapshot().invitations.data!.nextCursor, 'next');
  await owner.loadInvitations(true);
  assert.equal(pendingInviteCount(owner.getSnapshot().invitations.data!.items, now), 2);
  assert.equal(owner.getSnapshot().invitations.data!.nextCursor, null);
  assert.deepEqual(lane.cursors, [undefined, 'next']);
});

test('invitation paging loop guard, partial retry, actor/session fence and stale response drop', async () => {
  const gate = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  const owner = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => gate.promise,
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  owner.setActor(actor);
  const first = owner.loadInvitations();
  owner.setActor({ ...actor, sessionId: 'session-b', generation: 2 });
  gate.resolve({ items: [invite()], nextCursor: null });
  await first; await tick();
  assert.equal(owner.getSnapshot().invitations.status, 'idle');
  assert.equal(owner.getSnapshot().invitations.data, undefined);

  let calls = 0;
  const paging = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async (_a, cursor) => {
      calls++;
      if (!cursor) return { items: [invite({ id: 'a' })], nextCursor: 'loop' };
      return { items: [invite({ id: 'b' })], nextCursor: 'loop' };
    },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  paging.setActor(actor);
  await paging.loadInvitations();
  await paging.loadInvitations(true);
  assert.equal(paging.getSnapshot().invitations.status, 'error');
  assert.equal(calls, 2);

  const denied = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => { throw new MessagesError('private', 404); },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  denied.setActor(actor);
  await denied.loadInvitations();
  assert.equal(denied.getSnapshot().invitations.status, 'unavailable');
});

test('accepted/declined/expired stay visible without pretending participation; private invite keeps unknown bucket', () => {
  const accepted = invite({ id: 'acc', status: 'accepted', participationId: 'part-1' });
  const declined = invite({ id: 'dec', gameId: 'g2', status: 'declined' });
  const expired = invite({ id: 'exp', gameId: 'g3', status: 'expired', expiresAt: '2026-11-01T00:00:00Z' });
  const rows = hubRows([], [], [], [], [accepted, declined, expired]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(matchesFilter(row, 'invites'));
    assert.equal(row.parts.length, 0);
    assert.equal(hubBucket(row, undefined, now), 'unknown');
  }
  assert.equal(pendingInviteCount([accepted, declined, expired], now), 0);
});

test('Messages owner across MyGames/detail keeps same UNKNOWN key, no auto-write on read/reauth, no duplicate decision', async () => {
  const inviteResource = { kind: 'invitation' as const, id: 'invite-a' };
  const base = invite({ acceptanceContext: {
    gameVersion: 1, title: 'Игра', startsAt: date, endsAt: date, timezone: 'Europe/Moscow',
    applicationDeadlineAt: date, venueName: 'Зал', venueAddress: 'Адрес', formatKey: 'doubles',
    activityKind: 'regular', trainingDescription: null, trainerDisplayName: null,
    levelScaleId: 'scale', levelScaleVersion: 1, allowedLevelIds: ['A'], availablePlaces: 2,
    settlementPurpose: 'no_trainer_fee', priceStatus: null, priceMinor: null, currency: null, settlementTerms: 'Вне приложения',
  }});
  const sent: unknown[] = [];
  let fail = true;
  let settled = 0;
  const messages = new MessagesCoordinator({
    inbox: async () => ({ items: [], nextCursor: null, counts: { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 } }),
    counts: async () => ({ pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 }),
    identity: async () => 'public-a',
    direct: async () => { throw new Error('unexpected'); },
    game: async () => { throw new Error('unexpected'); },
    members: async () => [],
    invitation: async () => base,
    history: async () => ({ items: [], nextCursor: null }),
    send: async packet => {
      sent.push(packet);
      if (fail) throw new MessagesError('network');
      return { invitation: { ...base, status: 'accepted', participationId: 'part-1' }, participation: { id: 'part-1', gameId: base.gameId, status: 'confirmed' } };
    },
  }, () => 'idem-key');
  messages.invitationSettled = () => { settled++; };
  messages.setActor(actor);
  messages.focus(inviteResource); await tick();
  await messages.act(inviteResource, 'accept');
  const packet = messages.getSnapshot().pending['invitation:invite-a']!.packet;
  assert.equal(packet.key, 'idem-key');
  assert.deepEqual(packet.body, { expectedVersion: 3, expectedGameVersion: 1 });
  assert.equal(settled, 0);
  // Tab blur/refocus and detail GET never auto-send or invent a new key while UNKNOWN remains.
  messages.focus(null);
  messages.focus(inviteResource); await tick();
  await messages.loadDetail(inviteResource);
  assert.equal(sent.length, 1);
  await messages.act(inviteResource, 'accept');
  assert.equal(sent.length, 1);
  fail = false;
  await messages.retry(inviteResource);
  assert.strictEqual(sent[1], packet);
  assert.equal(settled, 1);
  assert.equal(messages.getSnapshot().pending['invitation:invite-a'], undefined);
});

test('parseInvitationPage validates list DTO; screen keeps invites filter inside MyGames', () => {
  const page = parseInvitationPage({
    items: [{
      id: 'invite-a', gameId: game.id, status: 'pending', version: 2,
      inviterPublicPlayerId: 'a', inviteePublicPlayerId: 'b', expiresAt: null, participationId: null,
      decidedAt: null, createdAt: date,
    }],
    nextCursor: null,
  });
  assert.equal(page.items[0]!.id, 'invite-a');
  assert.equal(page.items[0]!.acceptanceContext, undefined);
  const screen = read('../app/my-games.tsx');
  assert.match(screen, /owner\.filter\(f\.value\)/);
  assert.doesNotMatch(screen, /router\.push\('\/messages'\)/);
  assert.match(screen, /MyGameInvitations/);
  assert.match(screen, /loadInvitations/);
  assert.match(read('../src/components/my-game-invitation.tsx'), /leaseFocus/);
  assert.match(read('../src/auth-coordinator.ts'), /myInvitations/);
  assert.match(read('../src/auth-coordinator.ts'), /invitationSettled/);
});
