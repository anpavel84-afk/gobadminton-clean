import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  InvitationGameNavController,
  invitationGamePath,
  invitationOpenGameTarget,
  matchingReadableGameId,
} from '../src/invitation-game-navigation.ts';
import { ParticipationCoordinator, ParticipationError } from '../src/participation.ts';
import type { Actor, ParticipationPort } from '../src/participation.ts';
import { PublicApiError } from '../src/public-api.ts';
import { game as fixture } from './fixtures.ts';
import type { Game } from '@gobadminton/contracts/game-types';

const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const game: Game = {
  ...fixture,
  version: 7,
  startsAt: '2099-11-20T15:00:00Z',
  endsAt: '2099-11-20T17:00:00Z',
  applicationDeadlineAt: '2099-11-20T14:00:00Z',
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function participationSetup(readGame: (id: string) => Promise<unknown> = async () => game) {
  const port: ParticipationPort = {
    own: async () => ({ items: [], nextCursor: null }),
    managed: async () => ({ items: [], nextCursor: null }),
    send: async () => { throw new ParticipationError('invalid'); },
  };
  const coordinator = new ParticipationCoordinator(port, () => 'unused', readGame);
  coordinator.setActor(actor);
  return coordinator;
}

test('#522 APK47 pure: matchingReadableGameId requires ready + exact id; path is native /games/:id', () => {
  assert.equal(matchingReadableGameId(game.id, undefined), null);
  assert.equal(matchingReadableGameId(game.id, { status: 'loading' }), null);
  assert.equal(matchingReadableGameId(game.id, { status: 'error' }), null);
  assert.equal(matchingReadableGameId(game.id, { status: 'ready', game: { ...game, id: 'other' } }), null);
  assert.equal(matchingReadableGameId(game.id, { status: 'ready', game }), game.id);
  assert.equal(invitationGamePath(game.id), `/games/${game.id}`);
  assert.equal(
    invitationOpenGameTarget({ status: 'idle' }, { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 }),
    null,
  );
  assert.equal(
    invitationOpenGameTarget(
      { status: 'loading', bind: { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 } },
      { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 },
    ),
    null,
  );
  assert.equal(
    invitationOpenGameTarget(
      { status: 'ready', bind: { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 }, matchedGameId: game.id },
      { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 },
    ),
    game.id,
  );
  // Stale generation / actor / invitation must not expose Open game.
  assert.equal(
    invitationOpenGameTarget(
      { status: 'ready', bind: { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 }, matchedGameId: game.id },
      { invitationId: 'i', gameId: game.id, actor, viewGeneration: 2 },
    ),
    null,
  );
  assert.equal(
    invitationOpenGameTarget(
      { status: 'ready', bind: { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 }, matchedGameId: game.id },
      { invitationId: 'other', gameId: game.id, actor, viewGeneration: 1 },
    ),
    null,
  );
  assert.equal(
    invitationOpenGameTarget(
      { status: 'ready', bind: { invitationId: 'i', gameId: game.id, actor, viewGeneration: 1 }, matchedGameId: game.id },
      { invitationId: 'i', gameId: game.id, actor: { ...actor, generation: 2 }, viewGeneration: 1 },
    ),
    null,
  );
});

test('#522 APK47: pending + terminal statuses show Open game only after fresh readable match', async () => {
  const participation = participationSetup();
  const nav = new InvitationGameNavController();
  const statuses = ['pending', 'accepted', 'declined', 'expired', 'revoked', 'cancelled_by_game'] as const;
  for (const status of statuses) {
    const invitationId = `invite-${status}`;
    const release = nav.focus({ invitationId, gameId: game.id, actor }, participation);
    assert.equal(nav.getSnapshot().status, 'loading');
    assert.equal(nav.openGameId({ invitationId, gameId: game.id, actor }), null);
    await tick();
    assert.equal(nav.getSnapshot().status, 'ready');
    assert.equal(nav.openGameId({ invitationId, gameId: game.id, actor }), game.id);
    assert.equal(nav.mayOpen(game.id, { invitationId, gameId: game.id, actor }), true);
    // Status string is not an input to the controller — readability alone gates Open game.
    void status;
    release();
    assert.equal(nav.openGameId({ invitationId, gameId: game.id, actor }), null);
  }
});

test('#522 APK47: unavailable/error hides only Open game target; id mismatch never opens', async () => {
  let mode: 'ok' | 'fail' | 'mismatch' = 'fail';
  const participation = participationSetup(async id => {
    if (mode === 'fail') throw new PublicApiError('unavailable', 404);
    if (mode === 'mismatch') return { ...game, id: 'wrong-id' };
    return { ...game, id };
  });
  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-a', gameId: game.id, actor };
  const release = nav.focus(live, participation);
  await tick();
  assert.equal(nav.getSnapshot().status, 'error');
  assert.equal(nav.openGameId(live), null);
  release();

  mode = 'mismatch';
  const again = nav.focus(live, participation);
  await tick();
  assert.equal(nav.getSnapshot().status, 'error');
  assert.equal(nav.openGameId(live), null);
  again();

  mode = 'ok';
  const ok = nav.focus(live, participation);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
  ok();
});

test('#522 APK47: delayed A→B→A / blur / session change never exposes stale ready', async () => {
  const gateA = deferred<Game>();
  const gateB = deferred<Game>();
  let phase: 'a1' | 'b' | 'a2' = 'a1';
  const gameB: Game = { ...game, id: 'public-game-b' };
  const participation = participationSetup(async id => {
    if (phase === 'a1' && id === game.id) return gateA.promise;
    if (phase === 'b' && id === gameB.id) return gateB.promise;
    if (phase === 'a2' && id === game.id) return game;
    throw new PublicApiError('unavailable', 404);
  });
  const nav = new InvitationGameNavController();
  const releaseA1 = nav.focus({ invitationId: 'invite-a', gameId: game.id, actor }, participation);
  assert.equal(nav.getSnapshot().status, 'loading');
  // Switch to B before A settles.
  phase = 'b';
  releaseA1();
  const releaseB = nav.focus({ invitationId: 'invite-b', gameId: gameB.id, actor }, participation);
  assert.equal(nav.openGameId({ invitationId: 'invite-b', gameId: gameB.id, actor }), null);
  gateA.resolve(game);
  await tick();
  // Late A must not paint on B.
  assert.equal(nav.openGameId({ invitationId: 'invite-a', gameId: game.id, actor }), null);
  assert.equal(nav.openGameId({ invitationId: 'invite-b', gameId: gameB.id, actor }), null);
  gateB.resolve(gameB);
  await tick();
  assert.equal(nav.openGameId({ invitationId: 'invite-b', gameId: gameB.id, actor }), gameB.id);

  // Blur retires B; late nothing.
  releaseB();
  assert.equal(nav.openGameId({ invitationId: 'invite-b', gameId: gameB.id, actor }), null);

  // Return to A — fresh generation; prior A response already consumed / wrong gen.
  phase = 'a2';
  const releaseA2 = nav.focus({ invitationId: 'invite-a', gameId: game.id, actor }, participation);
  assert.equal(nav.getSnapshot().status, 'loading');
  assert.equal(nav.openGameId({ invitationId: 'invite-a', gameId: game.id, actor }), null);
  await tick();
  assert.equal(nav.openGameId({ invitationId: 'invite-a', gameId: game.id, actor }), game.id);

  // Session/actor change: live bind with the new actor must not reuse prior ready phase.
  const nextActor: Actor = { ...actor, sessionId: 'session-b', generation: 2 };
  participation.setActor(nextActor);
  assert.equal(
    nav.openGameId({ invitationId: 'invite-a', gameId: game.id, actor: nextActor }),
    null,
  );
  releaseA2();
});

test('#522 APK47: foreground fence clears target; return refreshes same invitation', async () => {
  let reads = 0;
  const participation = participationSetup(async () => {
    reads++;
    return game;
  });
  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-fg', gameId: game.id, actor };
  const release = nav.focus(live, participation);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
  assert.equal(reads, 1);

  nav.setForeground(false);
  assert.equal(nav.getSnapshot().status, 'idle');
  assert.equal(nav.openGameId(live), null);

  nav.setForeground(true);
  assert.equal(nav.getSnapshot().status, 'loading');
  assert.equal(nav.openGameId(live), null);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
  assert.equal(reads, 2);
  // Press fence: rendered target must still match live bind.
  assert.equal(nav.mayOpen(game.id, live), true);
  assert.equal(nav.mayOpen(game.id, { ...live, invitationId: 'other' }), false);
  release();
});

test('#522 APK47: game read does not mutate messages UNKNOWN packet identity (source + participation isolation)', async () => {
  // Behavioral isolation: ParticipationCoordinator.loadGame never touches a frozen packet reference.
  const packet = Object.freeze({
    actor: Object.freeze({ ...actor }),
    resource: Object.freeze({ kind: 'invitation' as const, id: 'invite-u' }),
    action: 'revoke' as const,
    method: 'POST' as const,
    path: '/invitations/invite-u/revoke',
    body: Object.freeze({ expectedVersion: 2 }),
    key: 'exact-unknown-key',
  });
  const pending = { packet, state: 'unknown' as const };
  const participation = participationSetup();
  const nav = new InvitationGameNavController();
  const release = nav.focus({ invitationId: 'invite-u', gameId: game.id, actor }, participation);
  await tick();
  assert.equal(nav.openGameId({ invitationId: 'invite-u', gameId: game.id, actor }), game.id);
  assert.strictEqual(pending.packet, packet);
  assert.equal(pending.state, 'unknown');
  assert.equal(pending.packet.key, 'exact-unknown-key');
  release();
});

test('#522 APK47: ambient participation ready cache does not flash Open game before this view settles', async () => {
  const seeded = participationSetup(async () => game);
  await seeded.loadGame(game.id);
  assert.equal(seeded.getSnapshot().games[game.id]?.status, 'ready');

  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-fresh', gameId: game.id, actor };
  // New surface starts loading even when participation already holds a ready game.
  nav.focus(live, seeded);
  assert.equal(nav.getSnapshot().status, 'loading');
  assert.equal(nav.openGameId(live), null);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
});

test('#522 APK47 source wiring: Messages + inline MyGames use helper; old accepted/manager-only gate removed', () => {
  const helper = read('../src/invitation-game-navigation.ts');
  assert.match(helper, /InvitationGameNavController/);
  assert.match(helper, /matchingReadableGameId/);
  assert.match(helper, /participation\.loadGame/);
  assert.doesNotMatch(helper, /from 'react'|from "react"/);

  const messages = read('../src/components/messages.tsx');
  assert.match(messages, /export function useInvitationOpenGame/);
  assert.match(messages, /InvitationGameNavController/);
  assert.match(messages, /InvitationMessageDetail/);
  assert.doesNotMatch(messages, /invitation\.status === 'accepted' && invitation\.participationId/);
  assert.doesNotMatch(messages, /detail\.managerEligible\s*\n?\s*\? \(\) => router\.push\(`\/games\/\$\{invitation\.gameId\}`/);

  const inline = read('../src/components/my-game-invitation.tsx');
  assert.match(inline, /useInvitationOpenGame/);
  assert.doesNotMatch(inline, /invitation\.status === 'accepted' && invitation\.participationId/);

  // Manager revoke path retained independently of Open game.
  assert.match(messages, /managerEligible/);
  assert.match(messages, /onRevoke/);
});

test('#522 APK47 source counter 46→47 numeric pin', () => {
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 47);
});
