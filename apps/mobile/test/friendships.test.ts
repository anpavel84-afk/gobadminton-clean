import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { FriendshipsCoordinator } from '../src/friendships-coordinator.ts';
import {
  FriendshipError, friendCommand, friendshipWire, friendshipsListPath, friendshipStatesPath,
  ownFriendsPrerequisite, parseFriendshipList, parseFriendshipReceipt, parseFriendshipStates,
  parseSocialCapabilities, parseFriendshipView, validVersion, type FriendshipPacket, type FriendshipView,
} from '../src/friendships.ts';
import { createNativeApi } from '../src/native-api.ts';

test('APK57 friendship source binds versionCode and FriendshipsProvider above Stack', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 57);
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /FriendshipsProvider/);
  assert.ok(layout.indexOf('FriendshipsProvider') < layout.indexOf('MessagesOwner'));
  assert.match(read('../README.md'), /APK57|56→57/);
  assert.match(read('../../../docs/product/NATIVE_UI_BEHAVIOR_CONTRACT.md'), /R-23/);
});

const actor = { actorId: 'actor', sessionId: 'session', generation: 1 };
const peerId = 'peer-public-1';
const requestId = '10000000-0000-4000-8000-000000000001';
const friendshipId = '20000000-0000-4000-8000-000000000002';
const bigVersion = '9007199254740993';
const none: FriendshipView = {
  friendshipId: null, relationship: 'none', version: null, request: null,
  peer: { publicPlayerId: peerId, displayName: 'Игрок', avatar: { uploadedUrl: null, providerUrl: null } },
  capabilities: { canRequest: true, canAccept: false, canDecline: false, canCancel: false, canRemove: false },
};
const outgoing: FriendshipView = {
  friendshipId, relationship: 'outgoing_pending', version: bigVersion,
  request: { id: requestId, expiresAt: '2099-01-01T00:00:00.000Z' },
  peer: none.peer, capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: true, canRemove: false },
};
const incoming: FriendshipView = {
  ...outgoing, relationship: 'incoming_pending',
  capabilities: { canRequest: false, canAccept: true, canDecline: true, canCancel: false, canRemove: false },
};
const friends: FriendshipView = {
  friendshipId, relationship: 'friends', version: bigVersion, request: null,
  peer: none.peer, capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: true },
};
const caps = { friends: true, gameRecommendations: false, gameAttention: false, socialPush: false };
const receipt = (outcome: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'removed') =>
  ({ friendshipId, requestId, version: bigVersion, outcome });
const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>(r => { resolve = r; });
  return { promise, resolve };
};
const profile = { version: 1, directoryVisible: true, socialEligible: true };

function setup(send: (packet: FriendshipPacket) => Promise<unknown> = async () => receipt('pending')) {
  const calls: FriendshipPacket[] = [];
  const reads: string[] = [];
  // Distinct new commands need unique deterministic keys; same-key replay reuses the parked packet
  // (does not call random again), so counter-based keys preserve remount/reconcile assertions.
  let keySeq = 0;
  const o = new FriendshipsCoordinator({
    random: () => `immutable-key-${String(++keySeq).padStart(4, '0')}`,
    capabilities: async () => { reads.push('caps'); return caps; },
    list: async (tab, cursor) => {
      reads.push(`list:${tab}:${cursor ?? ''}`);
      return { items: [outgoing], nextCursor: null, asOf: '2026-11-28T00:00:00.000Z' };
    },
    states: async id => { reads.push(`states:${id}`); return { items: [none] }; },
    ownProfile: async () => profile as never,
    send: async (p, permit) => { if (!permit()) throw new FriendshipError('network'); calls.push(p); return send(p); },
  });
  o.setActor(actor);
  return { o, calls, reads };
}

test('parsers keep decimal versions, refuse JS number versions, and bind list/states tightly', () => {
  assert.equal(validVersion(bigVersion), true);
  assert.equal(validVersion(1 as never), false);
  assert.equal(validVersion('01'), false);
  assert.equal(friendshipsListPath('accepted'), '/me/friendships?view=accepted&limit=20');
  assert.equal(friendshipStatesPath(peerId), `/me/friendship-states?publicPlayerId=${peerId}`);
  assert.deepEqual(parseSocialCapabilities(caps), caps);
  assert.equal(parseFriendshipView(none).relationship, 'none');
  assert.equal(parseFriendshipStates({ items: [none] }, peerId).peer?.publicPlayerId, peerId);
  assert.throws(() => parseFriendshipStates({ items: [none, none] }, peerId));
  assert.throws(() => parseFriendshipReceipt({ ...receipt('pending'), version: 1 }, 'request'));
  assert.throws(() => parseFriendshipList({ items: [], nextCursor: null }));
  assert.equal(ownFriendsPrerequisite({ version: 0, directoryVisible: true, socialEligible: true }), true);
  assert.equal(ownFriendsPrerequisite(profile), false);
  assert.deepEqual(friendCommand(none, peerId, 'request'), {
    path: '/friend-requests', body: { targetPublicPlayerId: peerId },
  });
  assert.deepEqual(friendCommand(outgoing, peerId, 'cancel'), {
    path: `/friend-requests/${requestId}/cancel`, body: { expectedVersion: bigVersion },
  });
  assert.deepEqual(friendCommand(friends, peerId, 'remove'), {
    path: `/friendships/${friendshipId}/remove`, body: { expectedVersion: bigVersion },
  });
  assert.equal(friendCommand(friends, peerId, 'request'), null);
});

test('capability-denied never fetches private lists; prerequisite uses own profile fields', async () => {
  const reads: string[] = [];
  const o = new FriendshipsCoordinator({
    random: () => 'k',
    capabilities: async () => { reads.push('caps'); return { ...caps, friends: false }; },
    list: async () => { reads.push('list'); return { items: [], nextCursor: null, asOf: 't' }; },
    states: async () => { reads.push('states'); return { items: [none] }; },
    ownProfile: async () => ({ version: 0, directoryVisible: false, socialEligible: false } as never),
    send: async () => receipt('pending'),
  });
  o.setActor(actor); o.enterList(); await o.loadList();
  assert.equal(o.getSnapshot().listStatus, 'prerequisite');
  assert.ok(!reads.includes('list'));
  const denied = new FriendshipsCoordinator({
    random: () => 'k',
    capabilities: async () => ({ ...caps, friends: false }),
    list: async () => { throw new Error('list'); },
    states: async () => ({ items: [none] }),
    ownProfile: async () => profile as never,
    send: async () => receipt('pending'),
  });
  denied.setActor(actor); denied.enterList(); await denied.loadList();
  assert.equal(denied.getSnapshot().listStatus, 'unavailable');
});

test('tab change retires prior page; out-of-order list reads cannot overwrite current lease', async () => {
  const gate = deferred();
  let listCalls = 0;
  const o = new FriendshipsCoordinator({
    random: () => 'k',
    capabilities: async () => caps,
    list: async (tab) => {
      listCalls++;
      if (tab === 'accepted' && listCalls === 1) return gate.promise;
      return { items: tab === 'incoming' ? [incoming] : [outgoing], nextCursor: null, asOf: 't' };
    },
    states: async () => ({ items: [none] }),
    ownProfile: async () => profile as never,
    send: async () => receipt('pending'),
  });
  o.setActor(actor); o.enterList();
  const first = o.loadList();
  o.setTab('incoming');
  await o.loadList();
  gate.resolve({ items: [outgoing], nextCursor: null, asOf: 'stale' });
  await first;
  assert.equal(o.getSnapshot().tab, 'incoming');
  assert.equal(o.getSnapshot().page?.items[0]?.relationship, 'incoming_pending');
});

test('five commands keep exact bodies; removal confirmation stays UI-side; UNKNOWN retains packet', async () => {
  const { o, calls } = setup(async () => { throw new Error('offline'); });
  o.openProfile(peerId); await o.loadProfile();
  await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.body, { targetPublicPlayerId: peerId });
  assert.equal(o.getSnapshot().command?.status, 'unknown');
  const packet = o.getSnapshot().command!.packet;
  o.closeProfile(); o.openProfile(peerId);
  assert.equal(o.getSnapshot().command?.packet, packet);
  // Remount bumps episode; explicit recovery must still reuse immutable key/body.
  assert.notEqual(packet.viewLease, o.getSnapshot().episode);
  await o.reconcile(o.getSnapshot().episode);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.equal(calls[1]!.key, packet.key);
  assert.equal(calls[1]!.viewLease, packet.viewLease);
  assert.deepEqual(friendshipWire(packet).body, { targetPublicPlayerId: peerId });

  for (const [view, action, body] of [
    [outgoing, 'cancel', { expectedVersion: bigVersion }],
    [incoming, 'accept', { expectedVersion: bigVersion }],
    [incoming, 'decline', { expectedVersion: bigVersion }],
    [friends, 'remove', { expectedVersion: bigVersion }],
  ] as const) {
    const wire = friendCommand(view, peerId, action)!;
    assert.deepEqual(wire.body, body);
    assert.throws(() => friendshipWire({
      actor, action, target: peerId, requestId: view.request?.id ?? null,
      friendshipId: action === 'remove' ? friendshipId : null, key: 'k', path: wire.path,
      body: { expectedVersion: 1 } as never, viewLease: 1, listLease: 1, peerLease: peerId,
    }));
  }
});

test('remount recovery: same-key retry; peer/actor/background/safety fence delayed reconcile; list surface', async () => {
  // Profile remount + explicit same-key retry settles only in the same focused context.
  {
    let attempt = 0;
    const { o, calls } = setup(async () => {
      if (!attempt++) throw new Error('offline');
      return receipt('pending');
    });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const packet = o.getSnapshot().command!.packet;
    o.closeProfile(); o.openProfile(peerId); await o.loadProfile();
    assert.equal(o.getSnapshot().command?.packet, packet);
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().notice, 'Запрос отправлен.');
  }

  // List remount: exit/enter keeps UNKNOWN; explicit reconcile reuses the same packet.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.enterList(); await o.loadList();
    const episode = o.getSnapshot().episode;
    await o.act('cancel', outgoing, peerId, episode, null);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    const packet = o.getSnapshot().command!.packet;
    o.exitList(); o.enterList(); await o.loadList();
    assert.equal(o.getSnapshot().command?.packet, packet);
    assert.notEqual(packet.viewLease, o.getSnapshot().episode);
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
  }

  // Delayed post-token permit on explicit recovery: peer/actor/background/safety → zero recovery send.
  for (const change of ['peer', 'actor', 'background', 'safety'] as const) {
    const token = deferred();
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => ({ items: [outgoing], nextCursor: null, asOf: 't' }),
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        // First act fails immediately (UNKNOWN). Recovery awaits token then rechecks permit.
        if (calls.length === 0) {
          calls.push(p);
          throw new Error('offline');
        }
        await token.promise;
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        return receipt('pending');
      },
    });
    o.setActor(actor);
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    const packet = o.getSnapshot().command!.packet;
    o.closeProfile(); o.openProfile(peerId); await o.loadProfile();
    const work = o.reconcile(o.getSnapshot().episode);
    if (change === 'peer') o.openProfile('other-peer');
    else if (change === 'background') o.setForeground(false);
    else if (change === 'safety') o.invalidate();
    else o.setActor({ ...actor, actorId: 'other' });
    token.resolve(undefined);
    await work;
    assert.equal(calls.length, 1, `${change} must not dispatch recovery after fence`);
    assert.notEqual(o.getSnapshot().notice, 'Запрос отправлен.');
    if (change === 'actor') assert.equal(o.getSnapshot().command, null);
    else assert.equal(o.getSnapshot().command?.packet.key, packet.key);
  }

  // Same context after remount: delayed post-token reconcile sends once and settles.
  {
    const token = deferred();
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => ({ items: [outgoing], nextCursor: null, asOf: 't' }),
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (calls.length === 0) {
          calls.push(p);
          throw new Error('offline');
        }
        await token.promise;
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        return receipt('pending');
      },
    });
    o.setActor(actor);
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const packet = o.getSnapshot().command!.packet;
    o.closeProfile(); o.openProfile(peerId); await o.loadProfile();
    const work = o.reconcile(o.getSnapshot().episode);
    token.resolve(undefined);
    await work;
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.equal(calls[1], packet);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().notice, 'Запрос отправлен.');
  }

  // Wrong peer / closed profile / stale rendered lease: no send; UNKNOWN retained (no noncommit inference).
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const packet = o.getSnapshot().command!.packet;
    o.openProfile('other-peer'); await o.loadProfile();
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.packet, packet);
    o.closeProfile();
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.packet, packet);
    o.openProfile(peerId);
    const stale = o.getSnapshot().episode;
    o.openProfile(peerId);
    await o.reconcile(stale);
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.packet, packet);
  }
});

test('actor/session/background/peer/safety fences drop late receipts; no auto-send on login', async () => {
  for (const change of ['actor', 'session', 'generation', 'background', 'peer', 'safety'] as const) {
    const gate = deferred();
    const { o, calls } = setup(() => gate.promise);
    o.openProfile(peerId); await o.loadProfile();
    const work = o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    if (change === 'background') o.setForeground(false);
    else if (change === 'peer') o.openProfile('other-peer');
    else if (change === 'safety') o.invalidate();
    else o.setActor({
      ...actor,
      ...(change === 'actor' ? { actorId: 'other' }
        : change === 'session' ? { sessionId: 'new' } : { generation: 2 }),
    });
    gate.resolve(receipt('pending'));
    await work;
    assert.equal(calls.length, 1);
    // Late success must not settle as a current-actor notice for a retired lease.
    assert.notEqual(o.getSnapshot().notice, 'Запрос отправлен.');
    if (change === 'actor') {
      // Different principal permanently drops parked UNKNOWN.
      assert.equal(o.getSnapshot().command, null);
    } else if (change === 'session' || change === 'generation') {
      // Same-actor verified reauth restores UNKNOWN; never auto-settles the late receipt.
      assert.equal(o.getSnapshot().command?.status, 'unknown');
      assert.equal(o.getSnapshot().command?.packet.key, calls[0]!.key);
    }
  }
  const idle = setup();
  idle.o.setActor(actor);
  assert.equal(idle.calls.length, 0);
});

test('native API posts closed origin/body/key without cookies; redacted peer stays null', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createNativeApi(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    const path = String(url);
    if (path.endsWith('/me/social-capabilities')) return new Response(JSON.stringify(caps));
    if (path.includes('/me/friendship-states')) {
      return new Response(JSON.stringify({
        items: [{ ...friends, peer: null }],
      }));
    }
    if (path.includes('/me/friendships')) {
      return new Response(JSON.stringify({ items: [{ ...friends, peer: null }], nextCursor: null, asOf: 't' }));
    }
    return new Response(JSON.stringify(receipt('removed')));
  });
  const view = await api.friendshipStates('token', peerId);
  assert.equal(view.peer, null);
  assert.ok(view.capabilities.canRemove);
  const packet = Object.freeze({
    actor, action: 'remove' as const, target: null, requestId: null, friendshipId,
    key: 'wire-key-0001', path: `/friendships/${friendshipId}/remove`,
    body: Object.freeze({ expectedVersion: bigVersion }), viewLease: 1, listLease: 1, peerLease: null,
  });
  await api.friendshipMutation('token', packet);
  const last = calls.at(-1)!;
  assert.equal(last.url, `https://dev.gobadminton.ru/v1/friendships/${friendshipId}/remove`);
  assert.deepEqual(JSON.parse(String(last.init.body)), { expectedVersion: bigVersion });
  assert.equal(last.init.credentials, 'omit');
  assert.equal((last.init.headers as Record<string, string>)['Idempotency-Key'], 'wire-key-0001');
  assert.equal((last.init.headers as Record<string, string>).cookie, undefined);
});

test('wrong receipt identity stays UNKNOWN; disabled server capabilities clear actions', async () => {
  const { o, calls } = setup(async () => ({
    friendshipId, requestId: '30000000-0000-4000-8000-000000000003',
    version: bigVersion, outcome: 'cancelled',
  }));
  o.enterList();
  // Seed list-ready lease with outgoing pending for cancel.
  o.getSnapshot();
  const episode = o.getSnapshot().episode;
  await o.act('cancel', outgoing, peerId, episode, null);
  assert.equal(calls.length, 1);
  assert.equal(o.getSnapshot().command?.status, 'unknown');
  const disabled = parseFriendshipView({
    ...none, capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: false },
  });
  assert.equal(friendCommand(disabled, peerId, 'request'), null);
});

test('QA57: row omission keeps UNKNOWN recovery; same-actor reauth restores; B/logout wipe; deferred token fence', async () => {
  // Server commit succeeded but refreshed list omits the row — explicit same-key recovery still reachable.
  {
    let attempt = 0;
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => {
        // After ambiguous cancel, authoritative list no longer contains the outgoing row.
        return { items: attempt > 0 ? [] : [outgoing], nextCursor: null, asOf: 't' };
      },
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        if (!attempt++) throw new Error('offline after commit');
        return receipt('cancelled');
      },
    });
    o.setActor(actor);
    o.enterList(); await o.loadList();
    const episode = o.getSnapshot().episode;
    await o.act('cancel', outgoing, peerId, episode, null);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    const packet = o.getSnapshot().command!.packet;
    o.refreshList(); await o.loadList();
    assert.equal(o.getSnapshot().page?.items.length, 0);
    assert.equal(o.getSnapshot().command?.packet, packet);
    assert.equal(o.commandMatchesSurface(packet), false);
    // Route return keeps the frozen packet; omission never proves result.
    o.exitList(); o.enterList(); await o.loadList();
    assert.equal(o.getSnapshot().command?.packet.key, packet.key);
    assert.deepEqual(o.getSnapshot().command?.packet.body, packet.body);
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.equal(calls[1]!.key, packet.key);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().notice, 'Запрос отменён.');
  }

  // Same-actor reauth restores UNKNOWN with rebound session; no auto-write; explicit reconcile reuses key/body.
  {
    let allow = false;
    const { o, calls } = setup(async () => {
      if (!allow) throw new Error('offline');
      return receipt('accepted');
    });
    o.enterList(); await o.loadList();
    await o.act('accept', incoming, peerId, o.getSnapshot().episode, null);
    const original = o.getSnapshot().command!.packet;
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    o.setActor(null);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(calls.length, 1);
    o.setActor({ ...actor, sessionId: 'reauth-session', generation: 2 });
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().command!.packet.key, original.key);
    assert.deepEqual(o.getSnapshot().command!.packet.body, original.body);
    assert.equal(o.getSnapshot().command!.packet.actor.sessionId, 'reauth-session');
    assert.equal(calls.length, 1);
    o.enterList(); await o.loadList();
    allow = true;
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.key, original.key);
    assert.deepEqual(calls[1]!.body, original.body);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().notice, 'Запрос принят.');
  }

  // Other actor never sees parked packet; returning A after B cannot resurrect it.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.enterList(); await o.loadList();
    await o.act('decline', incoming, peerId, o.getSnapshot().episode, null);
    const key = o.getSnapshot().command!.packet.key;
    o.setActor({ actorId: 'other', sessionId: 'other-session', generation: 3 });
    assert.equal(o.getSnapshot().command, null);
    o.enterList(); await o.loadList();
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 1);
    await o.act('decline', incoming, peerId, o.getSnapshot().episode, null);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[1]!.key, key);
    o.setActor(actor);
    assert.equal(o.getSnapshot().command, null);
  }

  // Explicit forget (logout policy) wipes parked UNKNOWN; same-account return stays empty.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    o.setActor(null);
    o.forget();
    o.setActor({ ...actor, sessionId: 'after-logout', generation: 4 });
    assert.equal(o.getSnapshot().command, null);
    assert.equal(calls.length, 1);
    o.openProfile(peerId); await o.loadProfile();
    await o.reconcile(o.getSnapshot().episode);
    assert.equal(calls.length, 1);
  }

  // Deferred post-token recovery: background/safety fence; same omitted-row context sends once.
  for (const change of ['background', 'safety'] as const) {
    const token = deferred();
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => ({ items: [], nextCursor: null, asOf: 't' }),
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (calls.length === 0) {
          calls.push(p);
          throw new Error('offline');
        }
        await token.promise;
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        return receipt('cancelled');
      },
    });
    o.setActor(actor);
    o.enterList();
    await o.act('cancel', outgoing, peerId, o.getSnapshot().episode, null);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    const packet = o.getSnapshot().command!.packet;
    await o.loadList();
    assert.equal(o.commandMatchesSurface(packet), false);
    const work = o.reconcile(o.getSnapshot().episode);
    if (change === 'background') o.setForeground(false);
    else o.invalidate();
    token.resolve(undefined);
    await work;
    assert.equal(calls.length, 1, `${change} must not complete deferred recovery`);
    assert.equal(o.getSnapshot().command?.packet.key, packet.key);
  }

  {
    const token = deferred();
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => ({ items: [], nextCursor: null, asOf: 't' }),
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (calls.length === 0) {
          calls.push(p);
          throw new Error('offline');
        }
        await token.promise;
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        return receipt('cancelled');
      },
    });
    o.setActor(actor);
    o.enterList();
    await o.act('cancel', outgoing, peerId, o.getSnapshot().episode, null);
    const packet = o.getSnapshot().command!.packet;
    await o.loadList();
    const work = o.reconcile(o.getSnapshot().episode);
    token.resolve(undefined);
    await work;
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.equal(calls[1]!.key, packet.key);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().notice, 'Запрос отменён.');
  }
});
