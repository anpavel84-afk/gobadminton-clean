import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  FriendshipsCoordinator,
  type FriendshipUnknownBind,
  type FriendshipWarningBind,
} from '../src/friendships-coordinator.ts';
import {
  FRIENDSHIP_UNKNOWN_NOTICE, FRIENDSHIP_RETIREMENT_WARNING,
  FriendshipError, friendCommand, friendshipWire,
  friendshipsListPath, friendshipStatesPath, ownFriendsPrerequisite, parseFriendshipList,
  parseFriendshipReceipt, parseFriendshipStates, parseSocialCapabilities, parseFriendshipView,
  validVersion, type FriendshipPacket, type FriendshipView,
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

function captureUnknown(o: FriendshipsCoordinator): FriendshipUnknownBind {
  const s = o.getSnapshot();
  if (!s.actor || s.command?.status !== 'unknown') throw new Error('expected UNKNOWN bind');
  return {
    actor: { ...s.actor },
    packet: s.command.packet,
    episode: s.episode,
    foreground: s.foreground,
    authority: s.authority,
  };
}

function captureWarning(o: FriendshipsCoordinator): FriendshipWarningBind {
  const s = o.getSnapshot();
  if (!s.actor || !s.outstandingWarning) throw new Error('expected warning bind');
  return {
    actor: { ...s.actor },
    warning: s.outstandingWarning,
    episode: s.episode,
    foreground: s.foreground,
    authority: s.authority,
  };
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

test('five commands keep exact bodies; removal confirmation stays UI-side; UNKNOWN retains packet without resend', async () => {
  const { o, calls } = setup(async () => { throw new Error('offline'); });
  o.openProfile(peerId); await o.loadProfile();
  await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.body, { targetPublicPlayerId: peerId });
  assert.equal(o.getSnapshot().command?.status, 'unknown');
  assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  const packet = o.getSnapshot().command!.packet;
  o.closeProfile(); o.openProfile(peerId);
  assert.equal(o.getSnapshot().command?.packet, packet);
  // Remount bumps episode; never same-key resend.
  assert.notEqual(packet.viewLease, o.getSnapshot().episode);
  o.refreshUnknownRelationship(captureUnknown(o));
  await o.loadProfile();
  assert.equal(calls.length, 1, 'read-only refresh must not POST');
  assert.equal(o.getSnapshot().command?.status, 'unknown');
  assert.equal(o.getSnapshot().command!.packet.key, packet.key);
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

test('remount/reauth: UNKNOWN held; no automatic write; peer/actor/background/safety fences', async () => {
  // Profile remount keeps UNKNOWN; no same-key retry; unlock + ack required for new action.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const packet = o.getSnapshot().command!.packet;
    o.closeProfile(); o.openProfile(peerId); await o.loadProfile();
    assert.equal(o.getSnapshot().command?.packet, packet);
    assert.equal(calls.length, 1);
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadProfile();
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  }

  // List remount: exit/enter keeps UNKNOWN; refresh is GET only.
  {
    const { o, calls, reads } = setup(async () => { throw new Error('offline'); });
    o.enterList(); await o.loadList();
    const episode = o.getSnapshot().episode;
    await o.act('cancel', outgoing, peerId, episode, null);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    const packet = o.getSnapshot().command!.packet;
    o.exitList(); o.enterList(); await o.loadList();
    assert.equal(o.getSnapshot().command?.packet, packet);
    const readsBefore = reads.length;
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadList();
    assert.equal(calls.length, 1);
    assert.ok(reads.length > readsBefore, 'refresh must issue list GET');
    assert.equal(o.getSnapshot().command?.status, 'unknown');
  }

  // Actor/background/safety/peer while held: no additional send.
  for (const change of ['peer', 'actor', 'background', 'safety'] as const) {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    assert.equal(calls.length, 1);
    const packet = o.getSnapshot().command!.packet;
    const stale = captureUnknown(o);
    if (change === 'peer') o.openProfile('other-peer');
    else if (change === 'background') o.setForeground(false);
    else if (change === 'safety') o.invalidate();
    else o.setActor({ ...actor, actorId: 'other' });
    o.refreshUnknownRelationship(stale);
    assert.equal(calls.length, 1, `${change} must not dispatch after fence`);
    assert.notEqual(o.getSnapshot().notice, 'Запрос отправлен.');
    if (change === 'actor') assert.equal(o.getSnapshot().command, null);
    else assert.equal(o.getSnapshot().command?.packet.key, packet.key);
  }

  // Wrong peer / closed profile: refresh no-ops; UNKNOWN retained.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const packet = o.getSnapshot().command!.packet;
    const stale = captureUnknown(o);
    o.openProfile('other-peer'); await o.loadProfile();
    o.refreshUnknownRelationship(stale);
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command?.packet, packet);
    o.closeProfile();
    o.refreshUnknownRelationship(stale);
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
    assert.notEqual(o.getSnapshot().notice, 'Запрос отправлен.');
    if (change === 'actor') {
      assert.equal(o.getSnapshot().command, null);
    } else if (change === 'session' || change === 'generation') {
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
  const episode = o.getSnapshot().episode;
  await o.act('cancel', outgoing, peerId, episode, null);
  assert.equal(calls.length, 1);
  assert.equal(o.getSnapshot().command?.status, 'unknown');
  assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  const disabled = parseFriendshipView({
    ...none, capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: false },
  });
  assert.equal(friendCommand(disabled, peerId, 'request'), null);
});

test('QA57/#522: row omission keeps UNKNOWN hold; reauth restores; B/logout wipe; no resend', async () => {
  // Server commit succeeded but refreshed list omits the row — UNKNOWN held; GET refresh only.
  {
    let attempt = 0;
    const calls: FriendshipPacket[] = [];
    const reads: string[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => caps,
      list: async () => {
        reads.push('list');
        return { items: attempt > 0 ? [] : [outgoing], nextCursor: null, asOf: 't' };
      },
      states: async () => ({ items: [none] }),
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        attempt++;
        throw new Error('offline after commit');
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
    o.exitList(); o.enterList(); await o.loadList();
    assert.equal(o.getSnapshot().command?.packet.key, packet.key);
    assert.deepEqual(o.getSnapshot().command?.packet.body, packet.body);
    const readsBefore = reads.length;
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadList();
    assert.ok(reads.length > readsBefore);
    assert.equal(calls.length, 1, 'never same-key resend');
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  }

  // Same-actor reauth restores UNKNOWN; no auto-write; unlock+ack then new independent action.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
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
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadList();
    assert.equal(calls.length, 1);
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(calls.length, 1);
    o.acknowledgeOutstandingWarning(captureWarning(o));
    await o.act('accept', incoming, peerId, o.getSnapshot().episode, null);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[1]!.key, original.key, 'new action uses a new key');
  }

  // Other actor never sees parked packet; returning A after B cannot resurrect it.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.enterList(); await o.loadList();
    await o.act('decline', incoming, peerId, o.getSnapshot().episode, null);
    const key = o.getSnapshot().command!.packet.key;
    const stale = captureUnknown(o);
    o.setActor({ actorId: 'other', sessionId: 'other-session', generation: 3 });
    assert.equal(o.getSnapshot().command, null);
    o.enterList(); await o.loadList();
    o.refreshUnknownRelationship(stale);
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
    const stale = captureUnknown(o);
    o.setActor(null);
    o.forget();
    o.setActor({ ...actor, sessionId: 'after-logout', generation: 4 });
    assert.equal(o.getSnapshot().command, null);
    assert.equal(calls.length, 1);
    o.openProfile(peerId); await o.loadProfile();
    o.refreshUnknownRelationship(stale);
    assert.equal(calls.length, 1);
  }
});

test('#522 QAFIX9: NEVER resend UNKNOWN; read-only refresh; explicit unlock+ack; clocks irrelevant', async () => {
  // Lost response stays held regardless of elapsed / wall rollback / sleep — no timer gate, no POST.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const key = o.getSnapshot().command!.packet.key;
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);

    // Simulate arbitrary clock / sleep / rollback: still no resend API exists.
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadProfile();
    assert.equal(calls.length, 1);
    assert.equal(o.getSnapshot().command!.packet.key, key);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  }

  // Read-only refresh is GET only and does not prove original commit.
  {
    const reads: string[] = [];
    const calls: FriendshipPacket[] = [];
    const o = new FriendshipsCoordinator({
      random: () => 'immutable-key-0001',
      capabilities: async () => { reads.push('caps'); return caps; },
      list: async () => { reads.push('list'); return { items: [outgoing], nextCursor: null, asOf: 't' }; },
      states: async id => { reads.push(`states:${id}`); return { items: [friends] }; },
      ownProfile: async () => profile as never,
      send: async (p, permit) => {
        if (!permit()) throw new FriendshipError('network');
        calls.push(p);
        throw new Error('offline');
      },
    });
    o.setActor(actor);
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    assert.equal(calls.length, 1);
    const readsBefore = reads.filter(r => r.startsWith('states:')).length;
    o.refreshUnknownRelationship(captureUnknown(o));
    await o.loadProfile();
    assert.equal(calls.length, 1);
    assert.ok(reads.filter(r => r.startsWith('states:')).length > readsBefore);
    assert.equal(o.getSnapshot().profileView?.relationship, 'friends');
    assert.equal(o.getSnapshot().command?.status, 'unknown', 'GET must not settle UNKNOWN');
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_UNKNOWN_NOTICE);
  }

  // Explicit unlock warning persists until ack; then new independent user-chosen action.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const originalKey = o.getSnapshot().command!.packet.key;
    const firstUnlock = captureUnknown(o);
    o.unlockUnknown(firstUnlock);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(calls.length, 1);
    // Automatic load must not drop unresolved warning or silently unlock controls.
    o.enterList();
    await o.loadList();
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(o.getSnapshot().notice, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(o.getSnapshot().command, null);
    const blockedEpisode = o.getSnapshot().episode;
    await o.act('request', none, peerId, blockedEpisode, null);
    assert.equal(o.getSnapshot().command, null, 'new action blocked until warning ack');
    assert.equal(calls.length, 1);
    o.acknowledgeOutstandingWarning(captureWarning(o));
    assert.equal(o.getSnapshot().outstandingWarning, null);
    await o.act('request', none, peerId, o.getSnapshot().episode, null);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[1]!.key, originalKey);
    // Unlock of held UNKNOWN; stale prior bind and second unlock cannot disturb warning.
    const secondUnlock = captureUnknown(o);
    o.unlockUnknown(secondUnlock);
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    o.unlockUnknown(firstUnlock);
    o.unlockUnknown(secondUnlock);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
  }

  // Outstanding warning is per actor/session; logout/account switch clears private state.
  {
    const { o } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    o.setActor(null);
    assert.equal(o.getSnapshot().outstandingWarning, null);
    o.setActor({ ...actor, sessionId: 'reauth-session', generation: 3 });
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(o.getSnapshot().command, null);
    o.setActor(null);
    o.setActor({ actorId: 'other-actor', sessionId: 'other-session', generation: 1 });
    assert.equal(o.getSnapshot().outstandingWarning, null);
    o.setActor(actor);
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    o.forget();
    assert.equal(o.getSnapshot().outstandingWarning, null);
    assert.equal(o.getSnapshot().actor, null);
  }

  // UI source: no misleading "Проверить результат"; honest labels present; binds captured.
  {
    const ui = readFileSync(new URL('../src/components/friendships.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(ui, /Проверить результат/);
    assert.match(ui, /Обновить состояние/);
    assert.match(ui, /Понятно/);
    assert.doesNotMatch(ui, /\.reconcile\b/);
    assert.doesNotMatch(ui, /friendshipIdempotencyReplayBlocked/);
    assert.match(ui, /authority:\s*state\.authority/);
    assert.match(ui, /unlockUnknown\((?:bind|unknownBind|\{)/);
    assert.match(ui, /refreshUnknownRelationship\((?:bind|unknownBind|\{)/);
    assert.match(ui, /acknowledgeOutstandingWarning\(\{/);
    const coordinator = readFileSync(new URL('../src/friendships-coordinator.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(coordinator, /reconcile\s*=/);
    assert.doesNotMatch(coordinator, /firstDispatchedAt/);
    assert.doesNotMatch(coordinator, /CLIENT_RECOVERY/);
    assert.match(coordinator, /refreshUnknownRelationship/);
    assert.match(coordinator, /unlockUnknown/);
    assert.match(coordinator, /FriendshipUnknownBind/);
    assert.match(coordinator, /bindLive/);
  }
});

test('#522 QAFIX10: deferred stale UNKNOWN unlock/refresh/ack binds cannot clear newer hold or cross account', async () => {
  // Old command bind vs newer UNKNOWN — zero clear/write; exact current bind unlocks.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const oldBind = captureUnknown(o);
    o.unlockUnknown(oldBind);
    o.acknowledgeOutstandingWarning(captureWarning(o));
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const newer = o.getSnapshot().command!.packet;
    assert.notEqual(newer, oldBind.packet);
    o.unlockUnknown(oldBind);
    o.refreshUnknownRelationship(oldBind);
    assert.equal(o.getSnapshot().command?.packet, newer);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(calls.length, 2);
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(calls.length, 2);
  }

  // Actor switch: captured A callback must not clear B or write.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const fromA = captureUnknown(o);
    o.setActor({ actorId: 'other-actor', sessionId: 'other-session', generation: 1 });
    assert.equal(o.getSnapshot().command, null);
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const bPacket = o.getSnapshot().command!.packet;
    o.unlockUnknown(fromA);
    o.refreshUnknownRelationship(fromA);
    assert.equal(o.getSnapshot().command?.packet, bPacket);
    assert.equal(o.getSnapshot().outstandingWarning, null);
    assert.equal(calls.length, 2);
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().command, null);
  }

  // Peer/list navigation retires captured episode/surface — zero clear; fresh bind on live surface works.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const onProfile = captureUnknown(o);
    o.closeProfile();
    o.enterList();
    await o.loadList();
    o.unlockUnknown(onProfile);
    o.refreshUnknownRelationship(onProfile);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().outstandingWarning, null);
    assert.equal(calls.length, 1);
    // Restore profile surface; exact current bind unlocks.
    o.exitList();
    o.openProfile(peerId);
    await o.loadProfile();
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    o.acknowledgeOutstandingWarning(captureWarning(o));

    // List-owned cancel UNKNOWN: leave list → stale unlock no-ops; re-enter + fresh bind works.
    o.enterList();
    await o.loadList();
    await o.act('cancel', outgoing, peerId, o.getSnapshot().episode, null);
    const listBind = captureUnknown(o);
    o.exitList();
    o.unlockUnknown(listBind);
    o.refreshUnknownRelationship(listBind);
    assert.equal(o.getSnapshot().command?.status, 'unknown');
    assert.equal(o.getSnapshot().outstandingWarning, null);
    o.enterList();
    await o.loadList();
    o.unlockUnknown(captureUnknown(o));
    assert.equal(o.getSnapshot().command, null);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    assert.equal(calls.length, 2);
  }

  // Foreground + safety invalidation: stale unlock/refresh/ack write nothing.
  {
    const { o, calls } = setup(async () => { throw new Error('offline'); });
    o.openProfile(peerId); await o.loadProfile();
    await o.act('request', none, peerId, o.getSnapshot().episode, peerId);
    const beforeBg = captureUnknown(o);
    o.setForeground(false);
    o.unlockUnknown(beforeBg);
    o.refreshUnknownRelationship(beforeBg);
    assert.equal(o.getSnapshot().command?.packet, beforeBg.packet);
    assert.equal(o.getSnapshot().outstandingWarning, null);
    o.setForeground(true);
    await o.loadProfile();
    const beforeSafety = captureUnknown(o);
    o.invalidate();
    o.unlockUnknown(beforeSafety);
    o.refreshUnknownRelationship(beforeSafety);
    assert.equal(o.getSnapshot().command?.packet, beforeSafety.packet);
    assert.equal(o.getSnapshot().outstandingWarning, null);
    assert.equal(calls.length, 1);
    o.unlockUnknown(captureUnknown(o));
    const warn = captureWarning(o);
    o.invalidate();
    o.acknowledgeOutstandingWarning(warn);
    assert.equal(o.getSnapshot().outstandingWarning, FRIENDSHIP_RETIREMENT_WARNING);
    o.acknowledgeOutstandingWarning(captureWarning(o));
    assert.equal(o.getSnapshot().outstandingWarning, null);
    assert.equal(calls.length, 1);
  }
});
