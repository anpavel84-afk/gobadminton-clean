import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  ProfileCoordinator, ProfileError, profileWireBody, visibilityWireBody, createProfileDraft,
} from '../src/profile.ts';
import type { OwnProfile, ProfilePacket, ProfilePort, VisibilityPacket } from '../src/profile.ts';
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

function ackVisibility(packet: ProfilePacket, base: OwnProfile): OwnProfile {
  if (packet.kind !== 'visibility') throw new Error('expected visibility packet');
  return {
    ...base,
    version: packet.body.expectedVersion + 1,
    directoryVisible: packet.body.directoryVisible,
    ...(packet.body.directoryVisible && packet.body.consentPolicyVersion
      ? { consentPolicyVersion: packet.body.consentPolicyVersion }
      : {}),
  };
}

function setup(base: OwnProfile, overrides: Partial<ProfilePort> = {}, peerBusy: () => boolean = () => false) {
  const sent: { packet: ProfilePacket; authority: Actor }[] = [];
  let keys = 0;
  let stored: OwnProfile = { ...base };
  const owner = new ProfileCoordinator({
    read: async () => ({ ...stored }),
    cities: async () => [city],
    send: async (packet, authority) => {
      sent.push({ packet, authority });
      if (overrides.send) return overrides.send(packet, authority);
      throw new Error('unexpected profile/contactPolicy send');
    },
    ...overrides,
    // Default read follows stored visibility ACKs; historical tests override read independently.
    read: overrides.read ?? (async () => ({ ...stored })),
    visibility: async (packet, authority) => {
      sent.push({ packet, authority });
      const profile = overrides.visibility
        ? await overrides.visibility(packet, authority)
        : ackVisibility(packet, stored);
      stored = { ...profile };
      return profile;
    },
  }, () => `vis-key-${++keys}`, peerBusy);
  owner.setActor(actor);
  return { owner, sent, get keyCount() { return keys; } };
}

test('visibility-only wire is PUT body; no PATCH/profileWireBody; consent only ON+present; no city gate', async () => {
  let stored: OwnProfile = {
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: null, areaKey: 'sokol', bio: 'описание',
    directoryVisible: false, contactPolicy: 'closed', socialEligible: true, trainer: true,
    consentPolicyVersion: 'directory-mvp-v1', radarConsented: true, radarConsentPolicyVersion: 'radar-v',
  };
  const before = { ...stored };
  const wires: { method?: string; url: string; body: Record<string, unknown> }[] = [];
  const api = createNativeApi(async (url, init) => {
    if (init?.method === 'PUT' || init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      wires.push({ method: init.method, url: String(url), body });
      if (init.method === 'PATCH') throw new Error('visibility must not use PATCH');
      stored = {
        ...stored,
        version: stored.version + 1,
        directoryVisible: body.directoryVisible as boolean,
      };
    }
    return new Response(JSON.stringify(stored));
  });
  const s = setup(stored, {
    read: () => api.ownProfile('access'),
    visibility: p => api.mutateOwnVisibility('access', p),
  });
  await s.owner.load();
  s.owner.update({ displayName: 'Черновик имени', bio: 'локальный черновик', areaKey: 'метро' });
  await s.owner.setDirectoryVisible(true);
  assert.equal(wires.length, 1);
  assert.match(wires[0]!.url, /\/me\/social-profile\/visibility$/);
  assert.equal(wires[0]!.method, 'PUT');
  assert.deepEqual(wires[0]!.body, {
    directoryVisible: true, expectedVersion: 3, consentPolicyVersion: 'directory-mvp-v1',
  });
  assert.equal(Object.hasOwn(wires[0]!.body, 'cityId'), false);
  assert.equal(Object.hasOwn(wires[0]!.body, 'displayName'), false);
  assert.equal(Object.hasOwn(wires[0]!.body, 'contactPolicy'), false);
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, true);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик имени');
  assert.equal(s.owner.getSnapshot().draft.bio, 'локальный черновик');
  for (const key of ['displayName', 'cityId', 'areaKey', 'bio', 'contactPolicy', 'socialEligible', 'trainer',
    'radarConsented', 'radarConsentPolicyVersion'] as const) {
    assert.equal(stored[key], before[key]);
  }

  const noConsentBase: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Игрок', cityId: null, directoryVisible: false,
    consentPolicyVersion: null, socialEligible: true,
  };
  const noConsent = setup(noConsentBase, {
    visibility: async (packet) => {
      const body = visibilityWireBody(packet.body);
      assert.equal(Object.hasOwn(body, 'consentPolicyVersion'), false);
      assert.deepEqual(Object.keys(body).sort(), ['directoryVisible', 'expectedVersion']);
      return ackVisibility(packet, noConsentBase);
    },
  });
  await noConsent.owner.load();
  await noConsent.owner.setDirectoryVisible(true);
  assert.equal(noConsent.sent.length, 1);
  const onPacket = noConsent.sent[0]!.packet;
  if (onPacket.kind !== 'visibility') throw new Error('expected visibility');
  assert.equal(Object.hasOwn(onPacket.body, 'consentPolicyVersion'), false);
});

test('version0 cannot fake visibility; ready version>=1 toggles; same value is no-op', async () => {
  const zero = setup({ ...emptyProfile, version: 0, displayName: '', cityId: null, directoryVisible: false });
  await zero.owner.load();
  await zero.owner.setDirectoryVisible(true);
  assert.equal(zero.sent.length, 0);
  assert.match(zero.owner.getSnapshot().notice!, /Сначала сохраните/);
  assert.equal(zero.owner.getSnapshot().noticeOwner, 'visibility');

  const ready = setup({
    ...emptyProfile, version: 2, displayName: 'Игрок', cityId: city.id, directoryVisible: false,
  });
  await ready.owner.load();
  await ready.owner.setDirectoryVisible(false);
  assert.equal(ready.sent.length, 0);
  await ready.owner.setDirectoryVisible(true);
  assert.equal(ready.sent.length, 1);
  const packet = ready.sent[0]!.packet;
  if (packet.kind !== 'visibility') throw new Error('expected visibility');
  assert.deepEqual(packet.body, { directoryVisible: true, expectedVersion: 2 });
});

test('shared writer locks: peer busy and pending profile/policy block visibility; visibility blocks peers', async () => {
  let busy = false;
  const base: OwnProfile = {
    ...emptyProfile, version: 5, displayName: 'Игрок', cityId: city.id, directoryVisible: false,
  };
  const gate = deferred<OwnProfile>();
  const s = setup(base, { visibility: () => gate.promise }, () => busy);
  await s.owner.load();
  busy = true;
  await s.owner.setDirectoryVisible(true);
  assert.equal(s.sent.length, 0);
  busy = false;

  const work = s.owner.setDirectoryVisible(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.packet.kind, 'visibility');
  await s.owner.setContactPolicy('closed');
  assert.equal(s.sent.filter(x => x.packet.kind === 'contactPolicy').length, 0);
  await s.owner.save();
  assert.equal(s.sent.filter(x => x.packet.kind === 'profile').length, 0);
  gate.resolve(ackVisibility(s.sent[0]!.packet, base));
  await work;
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, true);
});

test('409 stale keeps draft; consent invalid → rebase notice; refresh CTA remains after peer unlock', async () => {
  const server: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Server', cityId: city.id, bio: 'Serverbio',
    directoryVisible: false, consentPolicyVersion: 'directory-mvp-v1',
  };
  let fresh: OwnProfile = { ...server };
  const rebased = setup(server, {
    read: async () => ({ ...fresh }),
    visibility: async () => { throw new ProfileError('business', 409, 'VERSION_CONFLICT'); },
  });
  await rebased.owner.load();
  rebased.owner.update({ displayName: 'Dirty', bio: 'keep' });
  await rebased.owner.setDirectoryVisible(true);
  assert.equal(rebased.owner.getSnapshot().status, 'stale');
  assert.equal(rebased.owner.getSnapshot().readIntent, 'rebase');
  assert.equal(rebased.owner.getSnapshot().noticeOwner, 'visibility');
  assert.match(rebased.owner.getSnapshot().notice!, /Обновите данные, чтобы проверить видимость/);
  assert.equal(rebased.owner.getSnapshot().draft.displayName, 'Dirty');
  assert.equal(rebased.owner.getSnapshot().profile?.directoryVisible, false);
  fresh = { ...server, version: 5, directoryVisible: false, displayName: 'Fresh' };
  await rebased.owner.refreshAuthoritative();
  assert.equal(rebased.owner.getSnapshot().status, 'ready');
  assert.equal(rebased.owner.getSnapshot().draft.displayName, 'Dirty');
  assert.equal(rebased.owner.getSnapshot().profile?.version, 5);

  // 409 → stale; peer busy blocks refresh; same explicit refresh works after unlock.
  let peerBusy = false;
  let readBase: OwnProfile = { ...server, version: 4 };
  const busyConflict = setup(readBase, {
    read: async () => ({ ...readBase }),
    visibility: async () => { throw new ProfileError('business', 409, 'VERSION_CONFLICT'); },
  }, () => peerBusy);
  await busyConflict.owner.load();
  await busyConflict.owner.setDirectoryVisible(true);
  assert.equal(busyConflict.owner.getSnapshot().status, 'stale');
  assert.equal(busyConflict.owner.getSnapshot().readIntent, 'rebase');
  peerBusy = true;
  await busyConflict.owner.refreshAuthoritative();
  assert.equal(busyConflict.owner.getSnapshot().status, 'stale');
  peerBusy = false;
  readBase = { ...readBase, version: 6, directoryVisible: false };
  await busyConflict.owner.refreshAuthoritative();
  assert.equal(busyConflict.owner.getSnapshot().status, 'ready');
  assert.equal(busyConflict.owner.getSnapshot().profile?.version, 6);

  const consent = setup({
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, directoryVisible: false,
    consentPolicyVersion: 'stale-policy',
  }, {
    visibility: async () => { throw new ProfileError('business', 422, 'CONSENT_POLICY_VERSION_INVALID'); },
  });
  await consent.owner.load();
  await consent.owner.setDirectoryVisible(true);
  assert.equal(consent.owner.getSnapshot().status, 'stale');
  assert.equal(consent.owner.getSnapshot().readIntent, 'rebase');
  assert.match(consent.owner.getSnapshot().notice!, /Не удалось включить видимость/);
  assert.equal(consent.owner.getSnapshot().profile?.directoryVisible, false);
});

test('UNKNOWN keeps original key+body; same-account reauth no autowrite; logout retires; malformed ack fences', async () => {
  const base: OwnProfile = {
    ...emptyProfile, version: 7, displayName: 'Игрок', cityId: city.id, directoryVisible: false,
    consentPolicyVersion: 'directory-mvp-v1',
  };
  let recovered = false;
  const s = setup(base, {
    visibility: async (p) => {
      if (!recovered) throw new ProfileError('network');
      return ackVisibility(p, base);
    },
  });
  await s.owner.load();
  s.owner.update({ displayName: 'Черновик', bio: 'сохранить' });
  await s.owner.setDirectoryVisible(true);
  const original = s.sent[0]!.packet as VisibilityPacket;
  assert.equal(original.kind, 'visibility');
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.deepEqual(visibilityWireBody(original.body), {
    directoryVisible: true, expectedVersion: 7, consentPolicyVersion: 'directory-mvp-v1',
  });
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик');

  const returned = { ...actor, sessionId: 'reauth-gen', generation: 4 };
  s.owner.setActor(returned);
  assert.equal(s.owner.getSnapshot().profile, null);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().profile, null);
  assert.equal(s.keyCount, 1);

  recovered = true;
  await s.owner.reconcile();
  assert.equal(s.sent.length, 2);
  assert.strictEqual(s.sent[1]!.packet, original);
  assert.equal(s.sent[1]!.authority.sessionId, 'reauth-gen');
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, true);
  assert.equal(s.keyCount, 1);

  const other = setup(base, {
    visibility: async () => { throw new ProfileError('network'); },
  });
  await other.owner.load();
  await other.owner.setDirectoryVisible(true);
  other.owner.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  assert.equal(other.owner.getSnapshot().command, undefined);

  const logout = setup(base, {
    visibility: async () => { throw new ProfileError('network'); },
  });
  await logout.owner.load();
  await logout.owner.setDirectoryVisible(true);
  logout.owner.forget();
  assert.equal(logout.owner.getSnapshot().command, undefined);
  assert.equal(logout.owner.getSnapshot().actor, null);

  const malformed = setup(base, {
    visibility: async () => ({ ...base, version: 7, directoryVisible: true }),
  });
  await malformed.owner.load();
  await malformed.owner.setDirectoryVisible(true);
  assert.equal(malformed.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(malformed.owner.getSnapshot().profile?.directoryVisible, false);

  const late = setup({ ...base, version: 9, directoryVisible: false }, {
    visibility: async () => ({ ...base, version: 8, directoryVisible: true }),
  });
  await late.owner.load();
  await late.owner.setDirectoryVisible(true);
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(late.owner.getSnapshot().profile?.version, 9);
});

test('#522: historical visibility ACK yields to post-ACK current GET; read429 keeps key; actor fence', async () => {
  // Lost ON response → external newer OFF → historical replay ACK must not paint intended ON.
  const base: OwnProfile = {
    ...emptyProfile, version: 1, displayName: 'Игрок', cityId: city.id, directoryVisible: false,
    consentPolicyVersion: 'directory-mvp-v1',
  };
  const historicalOn: OwnProfile = {
    ...base, version: 2, directoryVisible: true, consentPolicyVersion: 'directory-mvp-v1',
  };
  const currentOff: OwnProfile = {
    ...base, version: 3, directoryVisible: false, displayName: 'С другого устройства',
  };
  let phase: 'net' | 'ack' = 'net';
  let authoritative: OwnProfile = { ...base };
  const s = setup(base, {
    visibility: async () => {
      if (phase === 'net') throw new ProfileError('network');
      return historicalOn;
    },
    read: async () => ({ ...authoritative }),
  });
  await s.owner.load();
  s.owner.update({ displayName: 'Черновик имени', cityId: city.id, areaKey: 'метро', bio: 'локальное', levelChoice: { kind: 'none' } });
  await s.owner.setDirectoryVisible(true);
  const original = s.sent[0]!.packet as VisibilityPacket;
  assert.equal(original.kind, 'visibility');
  assert.equal(original.body.directoryVisible, true);
  assert.equal(original.body.expectedVersion, 1);
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, false);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик имени');
  phase = 'ack';
  authoritative = currentOff;
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1]!.packet, original);
  assert.equal(s.sent.length, 2);
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().profile?.version, 3);
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, false);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'С другого устройства');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик имени');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'метро');
  assert.equal(s.owner.getSnapshot().draft.bio, 'локальное');
  assert.match(s.owner.getSnapshot().notice!, /скрыт из каталога/);
  assert.doesNotMatch(s.owner.getSnapshot().notice!, /видим в каталоге/);

  // Stale nested GET older than verified ACK must not pretend success / unlock.
  const staleNested = setup(base, {
    visibility: async (packet) => ackVisibility(packet, base),
    read: async () => ({ ...base, version: 1, directoryVisible: false }),
  });
  await staleNested.owner.load();
  await staleNested.owner.setDirectoryVisible(true);
  assert.equal(staleNested.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(staleNested.owner.getSnapshot().profile?.directoryVisible, false);
  assert.equal(staleNested.keyCount, 1);

  // ACK succeeded but current GET business 429 → retain exact original key/lock (not rejected mutation).
  let readAfterAck = false;
  const failGet = setup(base, {
    visibility: async (packet) => ackVisibility(packet, base),
    read: async () => {
      if (!readAfterAck) return { ...base };
      throw new ProfileError('business', 429, 'MODERATION_RATE_LIMITED');
    },
  });
  // First load uses read before ACK; mark so post-ACK read fails.
  await failGet.owner.load();
  failGet.owner.update({ displayName: 'Держать черновик', bio: 'x' });
  readAfterAck = true;
  await failGet.owner.setDirectoryVisible(true);
  const failOriginal = failGet.sent[0]!.packet as VisibilityPacket;
  assert.equal(failGet.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(failGet.owner.getSnapshot().command?.packet, failOriginal);
  assert.equal(failGet.keyCount, 1);
  assert.equal(failGet.owner.getSnapshot().profile?.directoryVisible, false);
  assert.equal(failGet.owner.getSnapshot().draft.displayName, 'Держать черновик');
  assert.match(failGet.owner.getSnapshot().notice!, /не удалось подтвердить изменение видимости/i);
  // Explicit original-key retry still allowed; no auto-write / no new key.
  await failGet.owner.setDirectoryVisible(true);
  assert.equal(failGet.sent.length, 1);
  assert.equal(failGet.keyCount, 1);
  await failGet.owner.reconcile();
  assert.equal(failGet.sent.length, 2);
  assert.strictEqual(failGet.sent[1]!.packet, failOriginal);
  assert.equal(failGet.keyCount, 1);
  assert.equal(failGet.owner.getSnapshot().command?.status, 'unknown');

  // Stale session/actor fence: mid-flight actor replacement retires sending without adopting ACK.
  const fenceGate = deferred<OwnProfile>();
  const fenced = setup(base, {
    visibility: async () => fenceGate.promise,
    read: async () => ({ ...historicalOn }),
  });
  await fenced.owner.load();
  const work = fenced.owner.setDirectoryVisible(true);
  assert.equal(fenced.sent.length, 1);
  fenced.owner.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  fenceGate.resolve(historicalOn);
  await work;
  assert.equal(fenced.owner.getSnapshot().command, undefined);
  assert.equal(fenced.owner.getSnapshot().profile, null);
  assert.equal(fenced.owner.getSnapshot().actor?.actorId, 'B');

  // Logout fence retires UNKNOWN without painting historical visibility.
  const logout = setup(base, {
    visibility: async () => { throw new ProfileError('network'); },
  });
  await logout.owner.load();
  await logout.owner.setDirectoryVisible(true);
  assert.equal(logout.owner.getSnapshot().command?.status, 'unknown');
  logout.owner.forget();
  assert.equal(logout.owner.getSnapshot().command, undefined);
  assert.equal(logout.owner.getSnapshot().actor, null);
  assert.equal(logout.owner.getSnapshot().profile, null);
});

test('own-profile visibility card after Looking before Messages; Switch + pending copy; no city helper', () => {
  const own = readFileSync(new URL('../src/components/own-profile.tsx', import.meta.url), 'utf8');
  assert.match(own, /Показывать профиль в каталоге/);
  assert.match(own, /setDirectoryVisible/);
  assert.match(own, /Что увидят другие игроки/);
  assert.match(own, /Видимость профиля/);
  assert.match(own, /Если включить видимость/);
  assert.doesNotMatch(own, /Чтобы показывать профиль в каталоге, сначала укажите город/);
  assert.ok(own.indexOf('LookingForGameCard') < own.indexOf('Видимость профиля'));
  assert.ok(own.indexOf('Видимость профиля') < own.indexOf('Личные сообщения'));
  assert.match(own, /!profile && visibilityPending && pendingVisibilityStatus/);
  assert.match(own, /Повторить включение видимости|Повторить отключение видимости/);
  assert.match(own, /Сохраняем видимость профиля…/);
  assert.match(own, /Обновить данные/);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /kind === 'visibility'/);
  assert.match(editor, /Сохраняем видимость профиля…/);
  const auth = readFileSync(new URL('../src/auth-coordinator.ts', import.meta.url), 'utf8');
  assert.match(auth, /mutateOwnVisibility/);
  assert.match(auth, /visibility:/);
  assert.match(auth, /trainer\.blocksMutations\(\)/);
  const api = readFileSync(new URL('../src/native-api.ts', import.meta.url), 'utf8');
  assert.match(api, /mutateOwnVisibility/);
  assert.match(api, /\/me\/social-profile\/visibility/);
  const visibilityPort = api.slice(api.indexOf('mutateOwnVisibility'));
  assert.match(visibilityPort, /visibilityWireBody\(packet\.body\)/);
  assert.doesNotMatch(visibilityPort.slice(0, 400), /profileWireBody/);
});

test('profileWireBody never carries directoryVisible; visibilityWireBody omits absent consent', () => {
  assert.deepEqual(visibilityWireBody({ directoryVisible: false, expectedVersion: 2 }), {
    directoryVisible: false, expectedVersion: 2,
  });
  assert.deepEqual(visibilityWireBody({
    directoryVisible: true, expectedVersion: 2, consentPolicyVersion: 'directory-mvp-v1',
  }), {
    directoryVisible: true, expectedVersion: 2, consentPolicyVersion: 'directory-mvp-v1',
  });
  assert.deepEqual(profileWireBody({
    expectedVersion: 1, displayName: 'A', cityId: 'c', areaKey: null, bio: null, level: null,
    patch: { areaKey: false, bio: false, level: false },
  }), { expectedVersion: 1, displayName: 'A', cityId: 'c' });
  assert.equal(Object.hasOwn(profileWireBody({
    expectedVersion: 1, displayName: 'A', cityId: 'c', areaKey: null, bio: null, level: null,
    patch: { areaKey: false, bio: false, level: false },
  }), 'directoryVisible'), false);
  assert.equal(createProfileDraft('n', 'c').displayName, 'n');
});
