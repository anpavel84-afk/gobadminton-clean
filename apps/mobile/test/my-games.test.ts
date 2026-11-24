import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { GameInvitation } from '../src/messages.ts';
import { MessagesError, parseInvitationPage } from '../src/messages.ts';
import {
  hubRows, hubView, matchesFilter, pendingInviteCount, isPendingInvite, isInviteClockExpired, hubBucket,
  attendanceSourceLabel, ownAttendanceHistoryLine, ownAttendanceDisputeOpen,
  ownAttendanceResultsNavParams, ownAttendancePendingNotice,
} from '../src/my-games.ts';
import type { Actor } from '../src/participation.ts';
import type { OwnResult, Reminder } from '../src/postgame.ts';
import { PostgameError } from '../src/postgame.ts';
import {
  clarificationResultsNavParams,
  feedbackResultsNavParams,
  parseResultsDeepLinkSection,
  parseResultsFeedbackSection,
  peerReviewHistoryLabel,
  privateHubHistoryEmptyText,
  privateReviewHistoryDetail,
  privateReviewKindHistoryLabel,
} from '../src/postgame-feedback.ts';
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

test('ACK during in-flight invitations GET/load-more queues one fresh root read; stale pending never wins; actor fence drops queued work', async () => {
  const pending = invite({ id: 'invite-a', status: 'pending', version: 3 });
  const accepted = invite({ id: 'invite-a', status: 'accepted', version: 4, participationId: 'part-1' });
  const gate = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  let reads = 0;
  const owner = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async (_a, cursor) => {
      reads++;
      if (reads === 1) {
        assert.equal(cursor, undefined);
        return gate.promise;
      }
      assert.equal(cursor, undefined, 'followup after ACK must be a fresh root GET');
      return { items: [accepted], nextCursor: null };
    },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  owner.setActor(actor);
  const first = owner.loadInvitations();
  await tick();
  assert.equal(owner.getSnapshot().invitations.status, 'loading');
  // Exact Auth invitationSettled → postgame.loadInvitations while list is still loading.
  void owner.loadInvitations();
  assert.equal(reads, 1, 'coalesce: do not start a second GET until the invalidated one ends');
  gate.resolve({ items: [pending], nextCursor: null });
  await first; await tick();
  assert.equal(reads, 2);
  assert.equal(owner.getSnapshot().invitations.status, 'ready');
  assert.equal(owner.getSnapshot().invitations.data!.items[0]!.status, 'accepted');
  assert.equal(pendingInviteCount(owner.getSnapshot().invitations.data!.items, now), 0);
  assert.equal(owner.getSnapshot().invitations.data!.items.length, 1);

  // Load-more in flight: ACK invalidates the partial page and refreshes from root once.
  const moreGate = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  let moreReads = 0;
  const paging = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async (_a, cursor) => {
      moreReads++;
      if (moreReads === 1) return { items: [pending], nextCursor: 'next' };
      if (moreReads === 2) {
        assert.equal(cursor, 'next');
        return moreGate.promise;
      }
      assert.equal(cursor, undefined);
      return { items: [accepted], nextCursor: null };
    },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  paging.setActor(actor);
  await paging.loadInvitations();
  assert.equal(pendingInviteCount(paging.getSnapshot().invitations.data!.items, now), 1);
  const more = paging.loadInvitations(true);
  await tick();
  void paging.loadInvitations();
  moreGate.resolve({ items: [invite({ id: 'invite-b', status: 'pending' })], nextCursor: null });
  await more; await tick();
  assert.equal(moreReads, 3);
  assert.equal(paging.getSnapshot().invitations.data!.items[0]!.status, 'accepted');
  assert.equal(paging.getSnapshot().invitations.data!.nextCursor, null);
  assert.equal(pendingInviteCount(paging.getSnapshot().invitations.data!.items, now), 0);

  // Logout / actor change must fence a queued followup — no extra read for the old principal.
  const logoutGate = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  let logoutReads = 0;
  const fenced = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => { logoutReads++; return logoutGate.promise; },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  fenced.setActor(actor);
  const logoutFirst = fenced.loadInvitations();
  await tick();
  void fenced.loadInvitations();
  fenced.setActor(null);
  logoutGate.resolve({ items: [pending], nextCursor: null });
  await logoutFirst; await tick();
  assert.equal(logoutReads, 1);
  assert.equal(fenced.getSnapshot().invitations.status, 'idle');
  assert.equal(fenced.getSnapshot().invitations.data, undefined);
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
  assert.match(screen, /Условия игры доступны в приглашении ниже/);
  assert.doesNotMatch(screen, /без обхода доступа/);
  assert.match(read('../src/components/my-game-invitation.tsx'), /leaseFocus/);
  assert.match(read('../src/components/my-game-invitation.tsx'), /isInviteClockExpired/);
  assert.match(read('../src/components/my-game-invitation.tsx'), /Приглашение в игру, ожидает решения/);
  assert.doesNotMatch(read('../src/components/my-game-invitation.tsx'), /invitation-\$\{invite\.id\}/);
  assert.match(read('../src/auth-coordinator.ts'), /myInvitations/);
  assert.match(read('../src/auth-coordinator.ts'), /invitationSettled/);
  assert.match(read('../src/components/messages.tsx'), /import type \{[^}]*GameInvitation[^}]*\} from '\.\.\/messages\.ts'/);
  assert.doesNotMatch(read('../src/components/messages.tsx'), /invitation: import\('\.\.\/messages\.ts'\)\.GameInvitation/);
});

test('stale actor A finally must not clear B busy or consume B queued invitation refresh', async () => {
  const actorB: Actor = { actorId: 'actor-b', sessionId: 'session-b', generation: 1 };
  const forA = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  const forB = deferred<{ items: GameInvitation[]; nextCursor: string | null }>();
  const actors: string[] = [];
  let reads = 0;
  const owner = new PostgameCoordinator({
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async (who) => {
      reads++;
      actors.push(who.actorId);
      if (who.actorId === actor.actorId) return forA.promise;
      if (reads === 2) return forB.promise;
      return { items: [invite({ id: 'fresh-b', status: 'accepted', participationId: 'p-b' })], nextCursor: null };
    },
    results: async () => { throw new PostgameError('invalid'); },
    send: async () => { throw new PostgameError('invalid'); },
  }, () => 'key');
  owner.setActor(actor);
  const readA = owner.loadInvitations();
  await tick();
  assert.equal(owner.getSnapshot().invitations.status, 'loading');
  owner.setActor(actorB);
  const readB = owner.loadInvitations();
  await tick();
  assert.equal(owner.getSnapshot().invitations.status, 'loading');
  // B ACK-style refresh while B list is in flight: queue followup + invalidate B read.
  void owner.loadInvitations();
  assert.equal(reads, 2, 'coalesce: B followup waits for in-flight B GET');
  forA.resolve({ items: [invite({ id: 'stale-a' })], nextCursor: null });
  await readA; await tick();
  assert.equal(reads, 2, 'stale A finally must not start or steal B followup');
  assert.equal(owner.getSnapshot().actor?.actorId, actorB.actorId);
  assert.equal(owner.getSnapshot().invitations.status, 'loading');
  assert.equal(owner.getSnapshot().invitations.data, undefined);
  forB.resolve({ items: [invite({ id: 'stale-b', status: 'pending' })], nextCursor: null });
  await readB; await tick();
  assert.equal(reads, 3, 'invalidated B finally must still run its own queued fresh root GET');
  assert.deepEqual(actors, [actor.actorId, actorB.actorId, actorB.actorId]);
  assert.equal(owner.getSnapshot().invitations.status, 'ready');
  assert.equal(owner.getSnapshot().invitations.data!.items[0]!.id, 'fresh-b');
  assert.equal(owner.getSnapshot().invitations.data!.items[0]!.status, 'accepted');
});

test('clock-expired pending and zero-seat decision invariants; decline disables while pending', () => {
  const live = invite({ expiresAt: '2026-11-20T00:00:00Z' });
  const clockPast = invite({ id: 'past', expiresAt: '2026-11-01T00:00:00Z' });
  const noExpiry = invite({ id: 'open', expiresAt: null });
  const skewUnknown = invite({ id: 'skew', expiresAt: 'not-a-date' });
  assert.equal(isPendingInvite(live, now), true);
  assert.equal(isInviteClockExpired(live, now), false);
  assert.equal(isPendingInvite(clockPast, now), false);
  assert.equal(isInviteClockExpired(clockPast, now), true);
  assert.equal(isPendingInvite(noExpiry, now), true);
  assert.equal(isInviteClockExpired(noExpiry, now), false);
  assert.equal(isInviteClockExpired(skewUnknown, now), false);
  assert.equal(isPendingInvite(skewUnknown, now), false);

  const body = read('../src/components/messages.tsx');
  assert.match(body, /Свободных мест сейчас нет/);
  assert.match(body, /availablePlaces < 1/);
  assert.match(body, /function DeclineTextButton/);
  assert.match(body, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(body, /disabled=\{declineDisabled\}/);
  assert.match(body, /isInviteClockExpired\(invitation/);
  assert.match(body, /invitationCopy\.expired/);
  assert.doesNotMatch(body, /disabled=\{!!pending \|\| !context\}/);

  const card = read('../src/components/my-game-invitation.tsx');
  assert.match(card, /clockExpired \? invitationCopy\.expired/);
  assert.match(card, /openable && !selected/);
  assert.match(card, /invite\.status === 'pending'/);
  assert.match(card, /clockExpired \? 'Обновить приглашение'/);
});

test('#522 MyGames compact Отзывы section after refresh; same own-history sheet; four filters preserved', () => {
  const screen = read('../app/my-games.tsx');
  assert.match(screen, /\{ value: 'all', label: 'Все' \}/);
  assert.match(screen, /\{ value: 'manage', label: 'Создаю и управляю' \}/);
  assert.match(screen, /\{ value: 'participate', label: 'Заявки и участие' \}/);
  assert.match(screen, /\{ value: 'invites', label: 'Приглашения' \}/);
  assert.doesNotMatch(screen, /value: 'reviews'/);
  assert.match(screen, /Обновить мои игры[\s\S]*Отзывы[\s\S]*PrivateFeedbackHistoryEntry[\s\S]*Мои публичные отзывы о ролях/);
  assert.match(screen, /openOwnPublicHistory/);
  assert.match(screen, /upcoming[\s\S]*draft[\s\S]*past[\s\S]*terminal[\s\S]*unknown/);
});

test('#522 MyGames private feedback history entry + exact section=feedback results nav (no private URL fields)', () => {
  const panel = read('../src/components/postgame-feedback.tsx');
  assert.match(panel, /export function PrivateFeedbackHistoryEntry/);
  assert.match(panel, /loadReviews\(direction\)/);
  assert.match(panel, /loadReviews\(direction, true\)/);
  assert.match(panel, /feedbackResultsNavParams\(gameId\)/);
  assert.match(panel, /К итогам · обратная связь/);
  assert.match(panel, /Показать ещё/);
  assert.match(panel, /privateHubHistoryEmptyText/);
  assert.doesNotMatch(panel, /params:\s*\{[^}]*comment/);
  assert.doesNotMatch(panel, /params:\s*\{[^}]*recipientDisplay/);

  const results = read('../app/my-games/[gameId]/results.tsx');
  assert.match(results, /parseResultsDeepLinkSection\(params\.section\)/);
  assert.match(results, /openFeedback=\{openFeedback\}/);
  assert.match(results, /sectionRef=\{feedbackAnchor\}/);
  assert.match(results, /openFeedback \|\| feedbackSectionVisible/);

  const params = feedbackResultsNavParams('game-abc_1');
  assert.deepEqual(params, { gameId: 'game-abc_1', section: 'feedback' });
  assert.equal(Object.keys(params).sort().join(','), 'gameId,section');
  assert.equal(parseResultsFeedbackSection('feedback'), 'feedback');
  assert.equal(parseResultsFeedbackSection('attendance'), null);
  assert.equal(parseResultsFeedbackSection('clarification'), null);
  assert.equal(parseResultsFeedbackSection(['feedback', 'x']), 'feedback');
  assert.equal(parseResultsFeedbackSection(undefined), null);
  assert.equal(parseResultsDeepLinkSection('feedback'), 'feedback');
  assert.equal(parseResultsDeepLinkSection('clarification'), 'clarification');
  assert.equal(parseResultsDeepLinkSection('attendance'), null);
  assert.equal(privateHubHistoryEmptyText('received'), 'Пока нет полученных отзывов');
  assert.equal(privateHubHistoryEmptyText('sent'), 'Пока нет отправленных отзывов');
  assert.equal(peerReviewHistoryLabel('play_again'), 'Сыграл бы снова');
  assert.equal(privateReviewKindHistoryLabel('organization'), 'Отзыв организации');
  assert.equal(privateReviewHistoryDetail({
    id: 'r', gameId: 'g', kind: 'organization', subjectContextId: null, recipientDisplay: 'X',
    peerRating: null, organizationScore: 4, comment: 'secret', tags: [],
    experienceAssertion: 'i_experienced_this_game', discrepancyExplanation: null,
    attendanceContext: 'present', outcomeContext: 'held', version: 1, editedAt: null,
    createdAt: '2026-11-14T10:00:00Z', direction: 'sent', reply: null,
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  }), 'Оценка 4 из 5');
});

test('#522 APK42 MyGames own attendance source/late/version + open clarification nav parity', () => {
  const screen = read('../app/my-games.tsx');
  assert.match(screen, /ownAttendanceHistoryLine\(r\)/);
  assert.match(screen, /ownAttendancePendingNotice\(r\)/);
  assert.match(screen, /ownAttendanceDisputeOpen\(r\)/);
  assert.match(screen, /ownAttendanceResultsNavParams\(r\)/);
  assert.match(screen, /Уточнение открыто →/);
  assert.match(screen, /Участники \/ Итоги →/);
  assert.match(screen, /row\.own\.length === 0/);
  assert.doesNotMatch(screen, /params:\s*\{[^}]*contextId/);
  assert.doesNotMatch(screen, /params:\s*\{[^}]*disputeId/);
  assert.doesNotMatch(screen, /self_attested/);
  assert.doesNotMatch(screen, /manager_explicit/);

  assert.equal(attendanceSourceLabel('self_attested'), 'Сами отметили');
  assert.equal(attendanceSourceLabel('manager_explicit'), 'Отметил организатор');
  assert.equal(attendanceSourceLabel('case_reviewer'), 'Решение по обращению');
  assert.equal(attendanceSourceLabel(null), 'Источник неизвестен');

  const present: OwnResult = {
    ...own,
    attendance: {
      ...own.attendance,
      value: 'present', version: 2, late: true,
      assertion: { actorDisplay: 'Я', source: 'self_attested', at: date },
      dispute: null,
    },
    notice: null,
  };
  assert.equal(
    ownAttendanceHistoryLine(present),
    'Ваша отметка: Пришёл · опоздание · Сами отметили · v2',
  );
  assert.equal(ownAttendanceDisputeOpen(present), false);
  assert.deepEqual(ownAttendanceResultsNavParams(present), { gameId: game.id });
  assert.equal(ownAttendancePendingNotice(present), false);

  const open: OwnResult = {
    ...present,
    attendance: {
      ...present.attendance,
      late: false,
      assertion: { actorDisplay: 'Организатор', source: 'manager_explicit', at: date },
      dispute: { id: 'dispute-a', status: 'open', challengedVersion: 2, version: 1 },
    },
  };
  assert.equal(
    ownAttendanceHistoryLine(open),
    'Ваша отметка: Пришёл · Отметил организатор · v2',
  );
  assert.equal(ownAttendanceDisputeOpen(open), true);
  assert.deepEqual(ownAttendanceResultsNavParams(open), { gameId: game.id, section: 'clarification' });
  assert.equal(Object.keys(ownAttendanceResultsNavParams(open)).sort().join(','), 'gameId,section');

  const closed: OwnResult = {
    ...open,
    attendance: {
      ...open.attendance,
      dispute: { id: 'dispute-a', status: 'withdrawn', challengedVersion: 2, version: 2 },
    },
  };
  assert.equal(ownAttendanceDisputeOpen(closed), false);
  assert.deepEqual(ownAttendanceResultsNavParams(closed), { gameId: game.id });

  const absentDispute: OwnResult = {
    ...present,
    attendance: { ...present.attendance, dispute: null },
  };
  assert.equal(ownAttendanceDisputeOpen(absentDispute), false);

  const pending: OwnResult = {
    ...present,
    attendance: {
      ...present.attendance,
      version: 3, late: false,
      assertion: { actorDisplay: 'Организатор', source: 'manager_explicit', at: date },
    },
    notice: {
      id: 'n1', attendanceVersion: 3, value: 'present', late: false,
      source: 'manager_explicit', actorDisplay: 'Организатор', createdAt: date, acknowledgedAt: null,
    },
  };
  assert.equal(ownAttendancePendingNotice(pending), true);
  assert.match(ownAttendanceHistoryLine(pending), /Отметил организатор · v3/);

  const personalOnly: OwnResult = {
    ...own,
    gameTitle: null,
    attendance: {
      ...own.attendance,
      value: 'absent', version: 1, late: false,
      assertion: { actorDisplay: null, source: 'case_reviewer', at: date },
      dispute: { id: 'd-open', status: 'open', challengedVersion: 1, version: 1 },
      // Personal projection still shows available attendance fields — never invents level/payment.
      displayName: 'Я',
    },
  };
  assert.equal(
    ownAttendanceHistoryLine(personalOnly),
    'Ваша отметка: Не пришёл · Решение по обращению · v1',
  );
  assert.deepEqual(ownAttendanceResultsNavParams(personalOnly), {
    gameId: game.id, section: 'clarification',
  });

  const clarifyParams = clarificationResultsNavParams('game-abc_1');
  assert.deepEqual(clarifyParams, { gameId: 'game-abc_1', section: 'clarification' });
  assert.equal(Object.keys(clarifyParams).sort().join(','), 'gameId,section');
  assert.equal(parseResultsDeepLinkSection(['clarification', 'x']), 'clarification');
  assert.equal(parseResultsDeepLinkSection('unknown'), null);
});
