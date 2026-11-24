import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InvitationGameNavController,
  invitationGamePath,
  invitationOpenGameTarget,
  matchingReadableGameId,
} from '../src/invitation-game-navigation.ts';
import { ParticipationCoordinator, ParticipationError } from '../src/participation.ts';
import type { Actor, ParticipationPort } from '../src/participation.ts';
import { PublicApiError } from '../src/public-api.ts';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { MessagePacket, MessagesPort } from '../src/messages-coordinator.ts';
import { MessagesError } from '../src/messages.ts';
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

test('#522 APK47: lease cleanup retires after foreground gen bump; further foreground issues no reads', async () => {
  let reads = 0;
  const participation = participationSetup(async () => {
    reads++;
    return game;
  });
  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-lease', gameId: game.id, actor };
  const release = nav.focus(live, participation);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
  assert.equal(reads, 1);

  // focus→ready→background→foreground→ready: viewGeneration changes; lease id must not.
  nav.setForeground(false);
  nav.setForeground(true);
  await tick();
  assert.equal(nav.openGameId(live), game.id);
  assert.equal(reads, 2);

  release();
  assert.equal(nav.getSnapshot().status, 'idle');
  assert.equal(nav.openGameId(live), null);

  nav.setForeground(false);
  nav.setForeground(true);
  await tick();
  assert.equal(reads, 2);
  assert.equal(nav.openGameId(live), null);
});

test('#522 APK47: old focus cleanup must not retire a newer focus lease', async () => {
  const gameB: Game = { ...game, id: 'public-game-b' };
  const participation = participationSetup(async id => (id === gameB.id ? gameB : game));
  const nav = new InvitationGameNavController();
  const liveA = { invitationId: 'invite-a', gameId: game.id, actor };
  const liveB = { invitationId: 'invite-b', gameId: gameB.id, actor };
  const releaseA = nav.focus(liveA, participation);
  // New focus without awaiting prior cleanup (ABA / retained release).
  const releaseB = nav.focus(liveB, participation);
  await tick();
  assert.equal(nav.openGameId(liveB), gameB.id);
  releaseA();
  assert.equal(nav.openGameId(liveB), gameB.id);
  assert.equal(nav.openGameId(liveA), null);
  releaseB();
  assert.equal(nav.openGameId(liveB), null);
});

test('#522 APK47: failed game read → same-identity renewFocusedRead → success (hook seam)', async () => {
  let mode: 'fail' | 'ok' = 'fail';
  let reads = 0;
  const participation = participationSetup(async () => {
    reads++;
    if (mode === 'fail') throw new PublicApiError('unavailable', 404);
    return game;
  });
  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-renew', gameId: game.id, actor };
  const release = nav.focus(live, participation);
  await tick();
  assert.equal(nav.getSnapshot().status, 'error');
  assert.equal(nav.openGameId(live), null);
  assert.equal(reads, 1);

  // Same invitation version/id/actor — explicit renew (manual refresh path) must re-read.
  mode = 'ok';
  nav.renewFocusedRead();
  assert.equal(nav.getSnapshot().status, 'loading');
  await tick();
  assert.equal(nav.getSnapshot().status, 'ready');
  assert.equal(nav.openGameId(live), game.id);
  assert.equal(reads, 2);

  // Stale actor fence: renew no-ops when participation actor diverged.
  participation.setActor({ ...actor, sessionId: 'session-b', generation: 2 });
  const before = reads;
  nav.renewFocusedRead();
  assert.equal(reads, before);
  assert.equal(nav.openGameId({ ...live, actor: { ...actor, sessionId: 'session-b', generation: 2 } }), null);
  release();
  // After release, renew must not resurrect the lease.
  nav.renewFocusedRead();
  assert.equal(nav.getSnapshot().status, 'idle');
  assert.equal(reads, before);
});

test('#522 APK47: stale rendered viewGeneration permit false after same-identity new focus; current true', async () => {
  const participation = participationSetup();
  const nav = new InvitationGameNavController();
  const live = { invitationId: 'invite-permit', gameId: game.id, actor };
  const release1 = nav.focus(live, participation);
  await tick();
  const snap1 = nav.getSnapshot();
  assert.equal(snap1.status, 'ready');
  const gen1 = snap1.bind.viewGeneration;
  assert.equal(nav.mayOpen(game.id, { ...live, viewGeneration: gen1 }), true);

  release1();
  const release2 = nav.focus(live, participation);
  await tick();
  const snap2 = nav.getSnapshot();
  assert.equal(snap2.status, 'ready');
  const gen2 = snap2.bind.viewGeneration;
  assert.notEqual(gen1, gen2);
  assert.equal(nav.mayOpen(game.id, { ...live, viewGeneration: gen1 }), false);
  assert.equal(nav.mayOpen(game.id, { ...live, viewGeneration: gen2 }), true);

  // Foreground return also invalidates a retained rendered permit from the prior ready gen.
  nav.setForeground(false);
  nav.setForeground(true);
  await tick();
  const snap3 = nav.getSnapshot();
  assert.equal(snap3.status, 'ready');
  const gen3 = snap3.bind.viewGeneration;
  assert.notEqual(gen2, gen3);
  assert.equal(nav.mayOpen(game.id, { ...live, viewGeneration: gen2 }), false);
  assert.equal(nav.mayOpen(game.id, { ...live, viewGeneration: gen3 }), true);
  release2();
});

test('#522 APK47: MessagesCoordinator UNKNOWN packet survives game read + focus return; manual retry same packet', async () => {
  const inviteResource = { kind: 'invitation' as const, id: 'invite-u' };
  const inviteHeader = {
    id: 'invite-u',
    gameId: game.id,
    status: 'pending' as const,
    version: 2,
    inviterPublicPlayerId: 'public-b',
    inviteePublicPlayerId: 'public-a',
    expiresAt: null,
    participationId: null,
    acceptanceContext: null,
  };
  const sent: MessagePacket[] = [];
  let fail = true;
  let serial = 0;
  const port: MessagesPort = {
    inbox: async () => ({ counts: { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 }, nextCursor: null, items: [] }),
    counts: async () => ({ pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 }),
    identity: async () => 'public-a',
    direct: async () => { throw new Error('unexpected'); },
    game: async () => { throw new Error('unexpected'); },
    members: async () => [],
    invitation: async () => ({ ...inviteHeader }),
    managed: async () => ({ items: [], nextCursor: null }),
    history: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (fail) throw new MessagesError('network');
      return { ...inviteHeader, status: 'declined', version: 3 };
    },
  };
  const messages = new MessagesCoordinator(port, () => 'random-' + (++serial));
  messages.setActor(actor);
  messages.focus(inviteResource);
  await tick();
  await messages.act(inviteResource, 'decline');
  assert.equal(sent.length, 1);
  const packet = sent[0]!;
  const key = 'invitation:invite-u';
  assert.equal(messages.getSnapshot().pending[key]?.state, 'unknown');
  assert.strictEqual(messages.getSnapshot().pending[key]?.packet, packet);

  // Game read + focus return must not mutate the actual pending UNKNOWN packet/key.
  const participation = participationSetup();
  const nav = new InvitationGameNavController();
  const release = nav.focus({ invitationId: 'invite-u', gameId: game.id, actor }, participation);
  await tick();
  assert.equal(nav.openGameId({ invitationId: 'invite-u', gameId: game.id, actor }), game.id);
  assert.strictEqual(messages.getSnapshot().pending[key]?.packet, packet);
  assert.equal(messages.getSnapshot().pending[key]?.state, 'unknown');
  assert.equal(messages.getSnapshot().pending[key]?.packet.key, packet.key);
  release();
  assert.strictEqual(messages.getSnapshot().pending[key]?.packet, packet);
  assert.equal(messages.getSnapshot().pending[key]?.state, 'unknown');

  fail = false;
  await messages.retry(inviteResource);
  assert.strictEqual(sent[1], packet);
  assert.equal(messages.getSnapshot().pending[key], undefined);
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
