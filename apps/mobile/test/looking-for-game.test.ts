import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  ProfileCoordinator, ProfileError, createProfileDraft, parseLookingIntent,
} from '../src/profile.ts';
import type { Looking, LookingPacket, OwnProfile, ProfilePacket, ProfilePort } from '../src/profile.ts';
import {
  LOOKING_TTL_1H, LOOKING_TTL_3H, LOOKING_TTL_DEFAULT, lookingDeleteWire, lookingIntentActive,
  lookingIntentExpired, lookingPutWire, lookingStatusLabel,
} from '../src/looking-for-game.ts';
import { createNativeApi } from '../src/native-api.ts';
import type { Actor } from '../src/participation.ts';

const emptyProfile: OwnProfile = {
  publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null,
  bio: null, directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true, trainer: false,
  lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
};
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const city = { id: 'catalog-city', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

function activeLooking(version: number, overrides: Partial<Looking> = {}): Looking {
  return {
    version, state: 'active', cityId: city.id, areaKey: 'sokol',
    startsAt: '2026-11-22T10:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z',
    expiresAt: '2026-11-22T13:00:00.000Z', formatKeys: [], ...overrides,
  };
}

function ackLooking(packet: LookingPacket, base: OwnProfile): Looking {
  if (packet.kind === 'lookingDelete') {
    return {
      version: base.lookingForGame ? base.lookingForGame.version + 1 : 0,
      state: 'inactive', cityId: base.lookingForGame?.cityId ?? null, areaKey: base.lookingForGame?.areaKey ?? null,
      startsAt: base.lookingForGame?.startsAt ?? null, endsAt: base.lookingForGame?.endsAt ?? null,
      expiresAt: base.lookingForGame?.expiresAt ?? null, formatKeys: [],
    };
  }
  const prior = packet.body.expectedVersion ?? 0;
  return activeLooking(prior + 1, { cityId: packet.body.cityId, areaKey: packet.body.areaKey });
}

function setup(base: OwnProfile, overrides: Partial<ProfilePort> = {}, peerBusy: () => boolean = () => false) {
  const sent: { packet: ProfilePacket; authority: Actor }[] = [];
  const lookingSent: { packet: LookingPacket; authority: Actor }[] = [];
  let stored: OwnProfile = { ...base };
  let keys = 0;
  const owner = new ProfileCoordinator({
    read: async () => ({ ...stored }),
    cities: async () => [city],
    ...overrides,
    send: async (packet, authority) => {
      sent.push({ packet, authority });
      return overrides.send ? overrides.send(packet, authority) : (() => { throw new Error('unexpected profile send'); })();
    },
    looking: async (packet, authority) => {
      lookingSent.push({ packet, authority });
      const looking = overrides.looking ? await overrides.looking(packet, authority) : ackLooking(packet, stored);
      stored = { ...stored, lookingForGame: looking };
      return looking;
    },
  }, () => `looking-key-${++keys}`, peerBusy);
  owner.setActor(actor);
  return { owner, sent, lookingSent, get keyCount() { return keys; } };
}

test('looking helpers: TTL wire, active/expired clock, parse rejects GPS-shaped garbage', () => {
  assert.equal(LOOKING_TTL_DEFAULT, LOOKING_TTL_3H);
  assert.deepEqual(lookingPutWire({ cityId: city.id, areaKey: 'metro', ttlMinutes: LOOKING_TTL_1H }), {
    cityId: city.id, areaKey: 'metro', ttlMinutes: 60,
  });
  assert.deepEqual(lookingPutWire({ cityId: city.id, areaKey: null, ttlMinutes: LOOKING_TTL_3H, expectedVersion: 2 }), {
    cityId: city.id, areaKey: null, ttlMinutes: 180, expectedVersion: 2,
  });
  assert.deepEqual(lookingDeleteWire(), {});
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  const live = activeLooking(1, { expiresAt: '2026-11-22T13:00:00.000Z' });
  const expired = activeLooking(1, { expiresAt: '2026-11-22T11:00:00.000Z' });
  assert.equal(lookingIntentActive(live, now), true);
  assert.equal(lookingIntentExpired(live, now), false);
  assert.equal(lookingIntentActive(expired, now), false);
  assert.equal(lookingIntentExpired(expired, now), true);
  assert.match(lookingStatusLabel(live, now), /До/);
  assert.equal(lookingStatusLabel(expired, now), 'Срок поиска истёк');
  assert.equal(lookingStatusLabel(null, now), 'Сейчас выключено');
  assert.deepEqual(parseLookingIntent(live), live);
  assert.throws(() => parseLookingIntent({ ...live, version: -1 }), ProfileError);
});

test('native closed PUT/DELETE transport: exact path, bearer, key, minimal body; no consent/GPS/profile fields', async () => {
  const wires: { method: string; path: string; body: Record<string, unknown>; auth: string | null; key: string | null }[] = [];
  let looking = activeLooking(1);
  const profile: OwnProfile = {
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, areaKey: 'profile-area',
    lookingForGame: looking, socialEligible: true,
  };
  const api = createNativeApi(async (url, init) => {
    const path = String(url).replace('https://dev.gobadminton.ru/v1', '');
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : {};
    wires.push({
      method: init?.method ?? 'GET', path, body,
      auth: headers?.Authorization ?? null,
      key: headers?.['Idempotency-Key'] ?? null,
    });
    if (path === '/me/looking-for-game' && init?.method === 'PUT') {
      looking = activeLooking((body.expectedVersion as number ?? 0) + 1, {
        cityId: body.cityId as string, areaKey: (body.areaKey as string | null) ?? null,
      });
      return new Response(JSON.stringify(looking), { status: 200 });
    }
    if (path === '/me/looking-for-game' && init?.method === 'DELETE') {
      looking = { ...looking, version: looking.version + 1, state: 'inactive' };
      return new Response(JSON.stringify(looking));
    }
    return new Response(JSON.stringify({ ...profile, lookingForGame: looking }));
  });
  const putPacket = Object.freeze({
    kind: 'lookingPut' as const, actor: Object.freeze({ ...actor }), key: 'put-key-16chars!!',
    body: Object.freeze({ cityId: city.id, areaKey: 'sokol', ttlMinutes: LOOKING_TTL_1H, expectedVersion: 1 }),
  });
  const put = await api.mutateOwnLooking('tok', putPacket);
  assert.equal(put.state, 'active');
  assert.equal(put.version, 2);
  assert.equal(wires[0]!.method, 'PUT');
  assert.equal(wires[0]!.path, '/me/looking-for-game');
  assert.equal(wires[0]!.auth, 'Bearer tok');
  assert.equal(wires[0]!.key, 'put-key-16chars!!');
  assert.deepEqual(Object.keys(wires[0]!.body).sort(), ['areaKey', 'cityId', 'expectedVersion', 'ttlMinutes']);
  assert.equal(wires[0]!.body.ttlMinutes, 60);
  assert.equal(Object.hasOwn(wires[0]!.body, 'latitude'), false);
  assert.equal(Object.hasOwn(wires[0]!.body, 'formatKeys'), false);
  assert.equal(Object.hasOwn(wires[0]!.body, 'contactPolicy'), false);

  const delPacket = Object.freeze({
    kind: 'lookingDelete' as const, actor: Object.freeze({ ...actor }), key: 'del-key-16chars!!',
  });
  const stopped = await api.mutateOwnLooking('tok', delPacket);
  assert.equal(stopped.state, 'inactive');
  assert.equal(wires[1]!.method, 'DELETE');
  assert.deepEqual(wires[1]!.body, {});
  assert.equal(Object.hasOwn(wires[1]!.body, 'expectedVersion'), false);
});

test('1h/3h enable, stop version0, missing city, draft preserved; profile version untouched', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 5, displayName: 'Игрок', cityId: city.id, areaKey: 'profile-area', bio: 'описание',
    lookingForGame: null, socialEligible: true,
  };
  const s = setup(base);
  await s.owner.load();
  s.owner.update({ displayName: 'Черновик', bio: 'локальный', areaKey: 'метро' });
  await s.owner.enableLooking('  район  ', LOOKING_TTL_1H);
  assert.equal(s.lookingSent.length, 1);
  assert.equal(s.lookingSent[0]!.packet.kind, 'lookingPut');
  assert.deepEqual(s.lookingSent[0]!.packet.body, {
    cityId: city.id, areaKey: 'район', ttlMinutes: 60,
  });
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 1);
  assert.equal(s.owner.getSnapshot().profile?.version, 5);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик');
  assert.equal(s.owner.getSnapshot().draft.bio, 'локальный');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'метро');
  assert.equal(s.owner.getSnapshot().noticeOwner, 'looking');

  await s.owner.enableLooking('', LOOKING_TTL_3H);
  assert.equal(s.lookingSent[1]!.packet.kind, 'lookingPut');
  assert.deepEqual(s.lookingSent[1]!.packet.body, {
    cityId: city.id, areaKey: null, ttlMinutes: 180, expectedVersion: 1,
  });
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 2);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик');

  await s.owner.stopLooking();
  assert.equal(s.lookingSent[2]!.packet.kind, 'lookingDelete');
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'inactive');
  assert.equal(s.owner.getSnapshot().profile?.version, 5);

  const noCity = setup({ ...emptyProfile, version: 2, displayName: 'Игрок', cityId: null });
  await noCity.owner.load();
  await noCity.owner.enableLooking('x', LOOKING_TTL_1H);
  assert.equal(noCity.lookingSent.length, 0);
  assert.match(noCity.owner.getSnapshot().notice!, /город/);

  const stopNone = setup({ ...base, lookingForGame: null });
  await stopNone.owner.load();
  await stopNone.owner.stopLooking();
  assert.equal(stopNone.lookingSent[0]!.packet.kind, 'lookingDelete');
  assert.equal(stopNone.owner.getSnapshot().profile?.lookingForGame?.version, 0);
  assert.equal(stopNone.owner.getSnapshot().profile?.lookingForGame?.state, 'inactive');
});

test('looking UNKNOWN exact packet retry; late actor ignored; logout/different actor wipe; no auto enable', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  let recovered = false;
  const s = setup(base, {
    looking: async (p) => {
      if (!recovered) throw new ProfileError('network');
      return ackLooking(p, base);
    },
  });
  await s.owner.load();
  s.owner.update({ displayName: 'Локальное' });
  await s.owner.enableLooking('area', LOOKING_TTL_3H);
  const original = s.lookingSent[0]!.packet;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локальное');
  assert.equal(s.owner.getSnapshot().noticeOwner, 'looking');
  recovered = true;
  await s.owner.reconcile();
  assert.strictEqual(s.lookingSent[1]!.packet, original);
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локальное');

  const gate = deferred<Looking>();
  const late = setup(base, { looking: () => gate.promise });
  await late.owner.load();
  const work = late.owner.enableLooking('a', LOOKING_TTL_1H);
  const packet = late.lookingSent[0]!.packet;
  late.owner.setActor({ ...actor, generation: 9 });
  gate.resolve(ackLooking(packet, base));
  await work;
  assert.equal(late.owner.getSnapshot().profile, null);
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(late.owner.getSnapshot().command?.packet, packet);

  recovered = false;
  const wipe = setup(base, { looking: async () => { throw new ProfileError('network'); } });
  await wipe.owner.load();
  await wipe.owner.enableLooking('a', LOOKING_TTL_1H);
  wipe.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(wipe.owner.getSnapshot().command, undefined);
  wipe.owner.setActor(null);
  assert.equal(wipe.owner.getSnapshot().command, undefined);

  const boot = setup(base);
  await boot.owner.load();
  assert.equal(boot.lookingSent.length, 0);
  assert.equal(boot.owner.getSnapshot().profile?.lookingForGame, null);
});

test('looking 409 → refreshAuthoritative adopts nested looking only; dirty draft kept; no silent resend', async () => {
  let server: OwnProfile = {
    ...emptyProfile, version: 2, displayName: 'Servername', cityId: city.id, bio: 'Serverbio',
    lookingForGame: activeLooking(3),
  };
  let writes = 0;
  const s = setup(server, {
    read: async () => ({ ...server }),
    looking: async () => {
      writes += 1;
      throw new ProfileError('business', 409, 'VERSION_CONFLICT');
    },
  });
  await s.owner.load();
  s.owner.update({ displayName: 'Unsaved', bio: 'Dirty', areaKey: 'метро' });
  await s.owner.enableLooking('x', LOOKING_TTL_1H);
  assert.equal(s.owner.getSnapshot().status, 'stale');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved');
  assert.equal(writes, 1);
  server = {
    ...server, version: 2, lookingForGame: activeLooking(4, { areaKey: 'fresh' }),
  };
  await s.owner.refreshAuthoritative();
  assert.equal(writes, 1);
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 4);
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'fresh');
  assert.equal(s.owner.getSnapshot().profile?.version, 2);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'метро');
});

test('shared writer locks: looking blocks policy/profile; peer busy blocks looking; late historical looking rejected', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 6, displayName: 'Игрок', cityId: city.id, lookingForGame: activeLooking(2),
  };
  let busy = false;
  const gate = deferred<Looking>();
  const s = setup(base, { looking: () => gate.promise }, () => busy);
  await s.owner.load();
  busy = true;
  await s.owner.enableLooking('x', LOOKING_TTL_1H);
  assert.equal(s.lookingSent.length, 0);
  busy = false;
  const work = s.owner.enableLooking('x', LOOKING_TTL_1H);
  assert.equal(s.lookingSent.length, 1);
  await s.owner.setContactPolicy('closed');
  assert.equal(s.sent.length, 0);
  await s.owner.save();
  assert.equal(s.sent.length, 0);
  gate.resolve(ackLooking(s.lookingSent[0]!.packet, base));
  await work;

  const staleAck = setup({ ...base, lookingForGame: activeLooking(5) }, {
    looking: async () => activeLooking(3),
  });
  await staleAck.owner.load();
  await staleAck.owner.enableLooking('y', LOOKING_TTL_3H);
  assert.equal(staleAck.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(staleAck.owner.getSnapshot().profile?.lookingForGame?.version, 5);
});

test('ineligible/unavailable business FAIL keeps draft; expired display without write; obsolete footer removed', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, lookingForGame: null, socialEligible: false,
  };
  const s = setup(base, {
    looking: async () => { throw new ProfileError('business', 422, 'SOCIAL_INELIGIBLE'); },
  });
  await s.owner.load();
  s.owner.update({ bio: 'keep' });
  await s.owner.enableLooking('a', LOOKING_TTL_1H);
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().draft.bio, 'keep');
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame, null);
  assert.equal(s.owner.getSnapshot().noticeOwner, 'looking');

  const past = Date.parse('2026-11-22T14:00:00.000Z');
  const expired = activeLooking(1, { expiresAt: '2026-11-22T12:00:00.000Z' });
  assert.equal(lookingIntentActive(expired, past), false);
  assert.equal(lookingIntentExpired(expired, past), true);

  const route = readFileSync(new URL('../app/profile.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /Игровые действия требуют отдельного native-допуска сервера/);
  assert.match(route, /Вход не подаёт заявку и не создаёт игру/);
  const own = readFileSync(new URL('../src/components/own-profile.tsx', import.meta.url), 'utf8');
  assert.match(own, /LookingForGameCard/);
  assert.match(own, /lookingPut|lookingDelete/);
  assert.match(own, /!profile && lookingPending && pendingLookingStatus/);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /lookingPut/);
  assert.match(editor, /Повторить прежний статус «Ищу игру»/);
});

test('same-actor reauth restores looking UNKNOWN with profile=null; pending retry reachable', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 7, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  let recovered = false;
  const s = setup(base, {
    looking: async (p) => {
      if (!recovered) throw new ProfileError('network');
      return ackLooking(p, base);
    },
  });
  await s.owner.load();
  await s.owner.enableLooking('zone', LOOKING_TTL_1H);
  const original = s.lookingSent[0]!.packet;
  s.owner.setActor({ ...actor, sessionId: 'reauth', generation: 2 });
  assert.equal(s.owner.getSnapshot().profile, null);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
  assert.deepEqual(s.owner.getSnapshot().draft, createProfileDraft('', ''));
  recovered = true;
  await s.owner.reconcile();
  assert.equal(s.lookingSent[1]!.authority.sessionId, 'reauth');
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
});

test('address2: historical ACK yields to newer GET; no-record stop; expired notice; wrong ACK', async () => {
  // Same-actor reauth: cached PUT ACK active v1 + fresh inactive v2 → honest current, same key.
  const base: OwnProfile = {
    ...emptyProfile, version: 9, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  const ackV1 = activeLooking(1, { areaKey: 'zone' });
  let phase: 'net' | 'ack' = 'net';
  // Independent of setup's post-looking stored mutation — models later external stop on GET.
  let authoritative: OwnProfile = { ...base };
  const s = setup(base, {
    looking: async () => {
      if (phase === 'net') throw new ProfileError('network');
      return ackV1;
    },
    read: async () => ({ ...authoritative }),
  });
  await s.owner.load();
  await s.owner.enableLooking('zone', LOOKING_TTL_1H);
  const original = s.lookingSent[0]!.packet;
  assert.equal(s.keyCount, 1);
  s.owner.setActor({ ...actor, sessionId: 'reauth', generation: 2 });
  assert.equal(s.owner.getSnapshot().profile, null);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  phase = 'ack';
  authoritative = {
    ...base,
    lookingForGame: { ...ackV1, version: 2, state: 'inactive' },
  };
  await s.owner.reconcile();
  assert.strictEqual(s.lookingSent[1]!.packet, original);
  assert.equal(s.lookingSent.length, 2);
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 2);
  assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'inactive');
  assert.equal(s.owner.getSnapshot().profile?.version, 9);
  assert.match(s.owner.getSnapshot().notice!, /выключено/);

  // Fresh active v2 other body wins; dirty draft + SP version retained.
  const prior: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  const ackPut = activeLooking(1, { areaKey: 'a' });
  let live: OwnProfile = { ...prior };
  let failOnce = true;
  const newer = setup(prior, {
    looking: async () => {
      if (failOnce) throw new ProfileError('network');
      return ackPut;
    },
    read: async () => ({ ...live }),
  });
  await newer.owner.load();
  newer.owner.update({ displayName: 'Черновик', bio: 'dirty' });
  await newer.owner.enableLooking('a', LOOKING_TTL_1H);
  failOnce = false;
  // Explicit future expiry vs current clock — default helper TTL is a fixed past wall time after Root run.
  live = {
    ...prior,
    lookingForGame: activeLooking(2, {
      areaKey: 'other-body',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  };
  await newer.owner.reconcile();
  assert.equal(newer.owner.getSnapshot().command, undefined);
  assert.equal(newer.owner.getSnapshot().profile?.lookingForGame?.version, 2);
  assert.equal(newer.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'other-body');
  assert.equal(newer.owner.getSnapshot().profile?.version, 4);
  assert.equal(newer.owner.getSnapshot().draft.displayName, 'Черновик');
  assert.equal(newer.owner.getSnapshot().draft.bio, 'dirty');
  assert.match(newer.owner.getSnapshot().notice!, /включено/);

  // Canonical no-record STOP: inactive v0 ACK + nested null → confirmed off.
  const stopBase: OwnProfile = {
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  const inactive0: Looking = {
    version: 0, state: 'inactive', cityId: null, areaKey: null,
    startsAt: null, endsAt: null, expiresAt: null, formatKeys: [],
  };
  const stop = setup(stopBase, {
    looking: async () => inactive0,
    read: async () => ({ ...stopBase, lookingForGame: null }),
  });
  await stop.owner.load();
  await stop.owner.stopLooking();
  assert.equal(stop.owner.getSnapshot().command, undefined);
  assert.equal(stop.owner.getSnapshot().profile?.lookingForGame, null);
  assert.equal(stop.owner.getSnapshot().profile?.version, 3);
  assert.match(stop.owner.getSnapshot().notice!, /выключено/);

  // Lost PUT + replay: initial Looking null → network → ACK v1 expired + GET v1; no TTL renew.
  const expiredAck = activeLooking(1, { expiresAt: '2000-01-01T00:00:00.000Z' });
  const expiredBase: OwnProfile = {
    ...emptyProfile, version: 2, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
  };
  let expPhase: 'net' | 'ack' = 'net';
  let expAuth: OwnProfile = { ...expiredBase };
  const expired = setup(expiredBase, {
    looking: async () => {
      if (expPhase === 'net') throw new ProfileError('network');
      return expiredAck;
    },
    read: async () => ({ ...expAuth }),
  });
  await expired.owner.load();
  expired.owner.update({ displayName: 'Локально' });
  await expired.owner.enableLooking('sokol', LOOKING_TTL_1H);
  const expiredOriginal = expired.lookingSent[0]!.packet;
  assert.equal(expiredOriginal.kind, 'lookingPut');
  assert.equal(Object.hasOwn(expiredOriginal.body, 'expectedVersion'), false);
  assert.equal(expired.keyCount, 1);
  assert.equal(expired.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(expired.owner.getSnapshot().profile?.lookingForGame, null);
  expPhase = 'ack';
  expAuth = { ...expiredBase, lookingForGame: expiredAck };
  await expired.owner.reconcile();
  assert.strictEqual(expired.lookingSent[1]!.packet, expiredOriginal);
  assert.equal(expired.lookingSent.length, 2);
  assert.equal(expired.keyCount, 1);
  assert.equal(expired.owner.getSnapshot().command, undefined);
  assert.equal(expired.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
  assert.equal(expired.owner.getSnapshot().profile?.lookingForGame?.version, 1);
  assert.equal(expired.owner.getSnapshot().profile?.lookingForGame?.expiresAt, expiredAck.expiresAt);
  assert.equal(expired.owner.getSnapshot().draft.displayName, 'Локально');
  assert.equal(expired.owner.getSnapshot().profile?.version, 2);
  assert.doesNotMatch(expired.owner.getSnapshot().notice!, /включено/);
  assert.match(expired.owner.getSnapshot().notice!, /истёк/);

  // Wrong ACK (city mismatch) must not clear UNKNOWN.
  const wrong = setup(base, {
    looking: async () => activeLooking(1, { cityId: 'other-city', areaKey: 'zone' }),
  });
  await wrong.owner.load();
  await wrong.owner.enableLooking('zone', LOOKING_TTL_1H);
  assert.equal(wrong.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(wrong.owner.getSnapshot().profile?.lookingForGame, null);

  // Stale nested older than verified ACK must not pretend success.
  const staleNested = setup(base, {
    looking: async () => activeLooking(2, { areaKey: 'zone' }),
    read: async () => ({ ...base, lookingForGame: activeLooking(1, { areaKey: 'zone' }) }),
  });
  await staleNested.owner.load();
  await staleNested.owner.enableLooking('zone', LOOKING_TTL_1H);
  assert.equal(staleNested.owner.getSnapshot().command?.status, 'unknown');
});

test('address4: coherent DELETE ACK→GET timeline; monotonic current; equal-version body guard', async (t) => {
  // Scoped clock so helper TTL and expired fixture stay deterministic without weakening production expiry.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-22T12:00:00.000Z') });
  try {
    const inactiveAckV2: Looking = {
      version: 2, state: 'inactive', cityId: city.id, areaKey: 'sokol',
      startsAt: '2026-11-22T10:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z',
      expiresAt: '2026-11-22T13:00:00.000Z', formatKeys: [],
    };

    // Known current v1 → lost DELETE → ACK inactive v2 + fresh active v3 (external enable).
    const base: OwnProfile = {
      ...emptyProfile, version: 8, displayName: 'Игрок', cityId: city.id,
      lookingForGame: activeLooking(1),
    };
    let phase: 'net' | 'ack' = 'net';
    let authoritative: OwnProfile = { ...base };
    const s = setup(base, {
      looking: async () => {
        if (phase === 'net') throw new ProfileError('network');
        return inactiveAckV2;
      },
      read: async () => ({ ...authoritative }),
    });
    await s.owner.load();
    await s.owner.stopLooking();
    const original = s.lookingSent[0]!.packet;
    assert.equal(original.kind, 'lookingDelete');
    assert.equal(s.keyCount, 1);
    assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 1);
    phase = 'ack';
    authoritative = {
      ...base,
      lookingForGame: activeLooking(3, {
        areaKey: 'external',
        expiresAt: '2026-11-22T13:00:00.000Z',
      }),
    };
    await s.owner.reconcile();
    assert.strictEqual(s.lookingSent[1]!.packet, original);
    assert.equal(s.lookingSent.length, 2);
    assert.equal(s.keyCount, 1);
    assert.equal(s.owner.getSnapshot().command, undefined);
    assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
    assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.version, 3);
    assert.equal(s.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'external');
    assert.equal(s.owner.getSnapshot().profile?.version, 8);
    assert.match(s.owner.getSnapshot().notice!, /включено/);
    assert.doesNotMatch(s.owner.getSnapshot().notice!, /выключено/);

    // Same coherent path: ACK v2 + newer GET v3 past TTL → honest «истёк», not packet.kind «выключено».
    const expiredBase: OwnProfile = {
      ...emptyProfile, version: 5, displayName: 'Игрок', cityId: city.id,
      lookingForGame: activeLooking(1),
    };
    let expPhase: 'net' | 'ack' = 'net';
    let expAuth: OwnProfile = { ...expiredBase };
    const exp = setup(expiredBase, {
      looking: async () => {
        if (expPhase === 'net') throw new ProfileError('network');
        return inactiveAckV2;
      },
      read: async () => ({ ...expAuth }),
    });
    await exp.owner.load();
    await exp.owner.stopLooking();
    const expOriginal = exp.lookingSent[0]!.packet;
    assert.equal(expOriginal.kind, 'lookingDelete');
    assert.equal(exp.keyCount, 1);
    expPhase = 'ack';
    expAuth = {
      ...expiredBase,
      lookingForGame: activeLooking(3, { expiresAt: '2026-11-22T11:00:00.000Z' }),
    };
    await exp.owner.reconcile();
    assert.strictEqual(exp.lookingSent[1]!.packet, expOriginal);
    assert.equal(exp.lookingSent.length, 2);
    assert.equal(exp.keyCount, 1);
    assert.equal(exp.owner.getSnapshot().command, undefined);
    assert.equal(exp.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
    assert.equal(exp.owner.getSnapshot().profile?.lookingForGame?.version, 3);
    assert.match(exp.owner.getSnapshot().notice!, /истёк/);
    assert.doesNotMatch(exp.owner.getSnapshot().notice!, /включено/);
    assert.doesNotMatch(exp.owner.getSnapshot().notice!, /выключено/);

    // Monotonic guard: known current v3 must not adopt older fresh GET v2 relative to stale ACK v1.
    const monoBase: OwnProfile = {
      ...emptyProfile, version: 7, displayName: 'Игрок', cityId: city.id,
      lookingForGame: activeLooking(3),
    };
    let monoPhase: 'net' | 'ack' = 'net';
    let monoAuth: OwnProfile = { ...monoBase };
    const mono = setup(monoBase, {
      looking: async () => {
        if (monoPhase === 'net') throw new ProfileError('network');
        return {
          version: 1, state: 'inactive', cityId: city.id, areaKey: 'sokol',
          startsAt: '2026-11-22T10:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z',
          expiresAt: '2026-11-22T13:00:00.000Z', formatKeys: [],
        };
      },
      read: async () => ({ ...monoAuth }),
    });
    await mono.owner.load();
    await mono.owner.stopLooking();
    const monoOriginal = mono.lookingSent[0]!.packet;
    assert.equal(mono.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(mono.owner.getSnapshot().profile?.lookingForGame?.version, 3);
    monoPhase = 'ack';
    monoAuth = {
      ...monoBase,
      lookingForGame: activeLooking(2, { areaKey: 'stale-external' }),
    };
    await mono.owner.reconcile();
    assert.strictEqual(mono.lookingSent[1]!.packet, monoOriginal);
    assert.equal(mono.keyCount, 1);
    assert.equal(mono.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(mono.owner.getSnapshot().profile?.lookingForGame?.version, 3);
    assert.equal(mono.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'sokol');

    // Equal version vs known current: same version may expire via clock, not mutate canonical fields.
    const eqBase: OwnProfile = {
      ...emptyProfile, version: 6, displayName: 'Игрок', cityId: city.id,
      lookingForGame: activeLooking(2, { areaKey: 'kept' }),
    };
    let eqPhase: 'net' | 'ack' = 'net';
    let eqAuth: OwnProfile = { ...eqBase };
    const eq = setup(eqBase, {
      looking: async () => {
        if (eqPhase === 'net') throw new ProfileError('network');
        return {
          version: 1, state: 'inactive', cityId: city.id, areaKey: 'sokol',
          startsAt: '2026-11-22T10:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z',
          expiresAt: '2026-11-22T13:00:00.000Z', formatKeys: [],
        };
      },
      read: async () => ({ ...eqAuth }),
    });
    await eq.owner.load();
    await eq.owner.stopLooking();
    assert.equal(eq.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(eq.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'kept');
    eqPhase = 'ack';
    eqAuth = {
      ...eqBase,
      lookingForGame: activeLooking(2, { areaKey: 'conflicted' }),
    };
    await eq.owner.reconcile();
    assert.equal(eq.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(eq.owner.getSnapshot().profile?.lookingForGame?.version, 2);
    assert.equal(eq.owner.getSnapshot().profile?.lookingForGame?.areaKey, 'kept');

    // Equal version vs ACK: nested body must match the verified ACK when versions are equal.
    const ackEqBase: OwnProfile = {
      ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
    };
    let ackEqPhase: 'net' | 'ack' = 'net';
    let ackEqAuth: OwnProfile = { ...ackEqBase };
    const ackEqV1 = activeLooking(1, { areaKey: 'zone' });
    const ackEq = setup(ackEqBase, {
      looking: async () => {
        if (ackEqPhase === 'net') throw new ProfileError('network');
        return ackEqV1;
      },
      read: async () => ({ ...ackEqAuth }),
    });
    await ackEq.owner.load();
    await ackEq.owner.enableLooking('zone', LOOKING_TTL_1H);
    assert.equal(ackEq.owner.getSnapshot().command?.status, 'unknown');
    ackEqPhase = 'ack';
    ackEqAuth = {
      ...ackEqBase,
      lookingForGame: activeLooking(1, { areaKey: 'other' }),
    };
    await ackEq.owner.reconcile();
    assert.equal(ackEq.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(ackEq.owner.getSnapshot().profile?.lookingForGame, null);
  } finally {
    t.mock.timers.reset();
  }
});

test('address5: same-version server expiry projection active→inactive; guards retained', async (t) => {
  // Canonical server loadLookingEffective/mapLooking: expires-on-read flips active→inactive
  // at the same version without a bump. Prior equal-version state guard was overstrict.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-22T12:00:00.000Z') });
  try {
    const expiredAt = '2026-11-22T11:00:00.000Z';
    const ackActiveExpired = activeLooking(1, { areaKey: 'zone', expiresAt: expiredAt });
    const projectedInactive: Looking = { ...ackActiveExpired, state: 'inactive' };

    // Same-actor reauth: cached PUT ACK active v1 expired + fresh GET inactive v1 → adopt, same key.
    const reauthBase: OwnProfile = {
      ...emptyProfile, version: 9, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
    };
    let reauthPhase: 'net' | 'ack' = 'net';
    let reauthAuth: OwnProfile = { ...reauthBase };
    const reauth = setup(reauthBase, {
      looking: async () => {
        if (reauthPhase === 'net') throw new ProfileError('network');
        return ackActiveExpired;
      },
      read: async () => ({ ...reauthAuth }),
    });
    await reauth.owner.load();
    await reauth.owner.enableLooking('zone', LOOKING_TTL_1H);
    const reauthOriginal = reauth.lookingSent[0]!.packet;
    assert.equal(reauth.keyCount, 1);
    reauth.owner.setActor({ ...actor, sessionId: 'reauth', generation: 2 });
    assert.equal(reauth.owner.getSnapshot().profile, null);
    assert.equal(reauth.owner.getSnapshot().command?.status, 'unknown');
    reauthPhase = 'ack';
    reauthAuth = { ...reauthBase, lookingForGame: projectedInactive };
    await reauth.owner.reconcile();
    assert.strictEqual(reauth.lookingSent[1]!.packet, reauthOriginal);
    assert.equal(reauth.lookingSent.length, 2);
    assert.equal(reauth.keyCount, 1);
    assert.equal(reauth.owner.getSnapshot().command, undefined);
    assert.equal(reauth.owner.getSnapshot().profile?.lookingForGame?.version, 1);
    assert.equal(reauth.owner.getSnapshot().profile?.lookingForGame?.state, 'inactive');
    assert.equal(reauth.owner.getSnapshot().profile?.lookingForGame?.expiresAt, expiredAt);
    assert.equal(reauth.owner.getSnapshot().profile?.version, 9);
    assert.doesNotMatch(reauth.owner.getSnapshot().notice!, /включено/);
    assert.match(reauth.owner.getSnapshot().notice!, /выключено/);

    // Retained profile + dirty draft: same projection; SP version and draft kept; no extra key.
    const retainedBase: OwnProfile = {
      ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
    };
    let retainedPhase: 'net' | 'ack' = 'net';
    let retainedAuth: OwnProfile = { ...retainedBase };
    const retained = setup(retainedBase, {
      looking: async () => {
        if (retainedPhase === 'net') throw new ProfileError('network');
        return ackActiveExpired;
      },
      read: async () => ({ ...retainedAuth }),
    });
    await retained.owner.load();
    retained.owner.update({ displayName: 'Черновик', bio: 'dirty' });
    await retained.owner.enableLooking('zone', LOOKING_TTL_1H);
    const retainedOriginal = retained.lookingSent[0]!.packet;
    assert.equal(retained.keyCount, 1);
    assert.equal(retained.owner.getSnapshot().command?.status, 'unknown');
    retainedPhase = 'ack';
    retainedAuth = { ...retainedBase, lookingForGame: projectedInactive };
    await retained.owner.reconcile();
    assert.strictEqual(retained.lookingSent[1]!.packet, retainedOriginal);
    assert.equal(retained.lookingSent.length, 2);
    assert.equal(retained.keyCount, 1);
    assert.equal(retained.owner.getSnapshot().command, undefined);
    assert.equal(retained.owner.getSnapshot().profile?.lookingForGame?.state, 'inactive');
    assert.equal(retained.owner.getSnapshot().profile?.lookingForGame?.version, 1);
    assert.equal(retained.owner.getSnapshot().profile?.version, 4);
    assert.equal(retained.owner.getSnapshot().draft.displayName, 'Черновик');
    assert.equal(retained.owner.getSnapshot().draft.bio, 'dirty');
    assert.doesNotMatch(retained.owner.getSnapshot().notice!, /включено/);
    assert.match(retained.owner.getSnapshot().notice!, /выключено/);

    // Reject inactive→active at equal version (DELETE ACK inactive v1 + GET active v1).
    const flipBase: OwnProfile = {
      ...emptyProfile, version: 7, displayName: 'Игрок', cityId: city.id,
      lookingForGame: activeLooking(1, { areaKey: 'zone', expiresAt: expiredAt }),
    };
    let flipPhase: 'net' | 'ack' = 'net';
    let flipAuth: OwnProfile = { ...flipBase };
    const flip = setup(flipBase, {
      looking: async () => {
        if (flipPhase === 'net') throw new ProfileError('network');
        return projectedInactive;
      },
      read: async () => ({ ...flipAuth }),
    });
    await flip.owner.load();
    await flip.owner.stopLooking();
    assert.equal(flip.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(flip.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
    flipPhase = 'ack';
    flipAuth = { ...flipBase, lookingForGame: ackActiveExpired };
    await flip.owner.reconcile();
    assert.equal(flip.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(flip.owner.getSnapshot().profile?.lookingForGame?.state, 'active');
    assert.equal(flip.owner.getSnapshot().profile?.lookingForGame?.version, 1);

    // Premature inactive: future expiresAt at equal version must not pretend success.
    const futureAt = '2026-11-22T13:00:00.000Z';
    const prematureAck = activeLooking(1, { areaKey: 'zone', expiresAt: futureAt });
    const prematureBase: OwnProfile = {
      ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
    };
    let prematurePhase: 'net' | 'ack' = 'net';
    let prematureAuth: OwnProfile = { ...prematureBase };
    const premature = setup(prematureBase, {
      looking: async () => {
        if (prematurePhase === 'net') throw new ProfileError('network');
        return prematureAck;
      },
      read: async () => ({ ...prematureAuth }),
    });
    await premature.owner.load();
    await premature.owner.enableLooking('zone', LOOKING_TTL_1H);
    assert.equal(premature.owner.getSnapshot().command?.status, 'unknown');
    prematurePhase = 'ack';
    prematureAuth = {
      ...prematureBase,
      lookingForGame: { ...prematureAck, state: 'inactive' },
    };
    await premature.owner.reconcile();
    assert.equal(premature.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(premature.owner.getSnapshot().profile?.lookingForGame, null);

    // Changed city/area under inactive cloak at equal version → UNKNOWN.
    const mutateBase: OwnProfile = {
      ...emptyProfile, version: 5, displayName: 'Игрок', cityId: city.id, lookingForGame: null,
    };
    let mutatePhase: 'net' | 'ack' = 'net';
    let mutateAuth: OwnProfile = { ...mutateBase };
    const mutate = setup(mutateBase, {
      looking: async () => {
        if (mutatePhase === 'net') throw new ProfileError('network');
        return ackActiveExpired;
      },
      read: async () => ({ ...mutateAuth }),
    });
    await mutate.owner.load();
    await mutate.owner.enableLooking('zone', LOOKING_TTL_1H);
    assert.equal(mutate.owner.getSnapshot().command?.status, 'unknown');
    mutatePhase = 'ack';
    mutateAuth = {
      ...mutateBase,
      lookingForGame: { ...projectedInactive, areaKey: 'other-area' },
    };
    await mutate.owner.reconcile();
    assert.equal(mutate.owner.getSnapshot().command?.status, 'unknown');
    assert.equal(mutate.owner.getSnapshot().profile?.lookingForGame, null);

    // Honesty case retained elsewhere (address2): fresh GET still active+expired → «истёк».
    // Here prove canonical projection notice never claims «включено».
    assert.match(reauth.owner.getSnapshot().notice!, /выключено/);
  } finally {
    t.mock.timers.reset();
  }
});
