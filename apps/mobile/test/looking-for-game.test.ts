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
