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
    // Default read follows stored visibility ACKs; overrides.read still replaces independently.
    read: overrides.read ?? (async () => ({ ...stored })),
    cities: overrides.cities ?? (async () => [city]),
    send: async (packet, authority) => {
      sent.push({ packet, authority });
      if (overrides.send) return overrides.send(packet, authority);
      throw new Error('unexpected profile/contactPolicy send');
    },
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
  // Seed hidden baseline so setDirectoryVisible(true) is not a no-op against historicalOn.
  const fenceGate = deferred<OwnProfile>();
  const fenced = setup(base, {
    visibility: async () => fenceGate.promise,
    read: async () => ({ ...base }),
  });
  await fenced.owner.load();
  assert.equal(fenced.owner.getSnapshot().profile?.directoryVisible, false);
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

test('#522: same-account draft survives actor-null reauth; different actor/logout retire', async () => {
  const serverV1: OwnProfile = {
    ...emptyProfile, version: 1, displayName: 'Server', cityId: city.id, areaKey: 'server-area',
    bio: 'Server bio', directoryVisible: false, consentPolicyVersion: 'directory-mvp-v1',
  };
  let authoritative: OwnProfile = { ...serverV1 };
  let phase: 'lost' | 'ack' = 'lost';
  const s = setup(serverV1, {
    visibility: async (packet) => {
      if (phase === 'lost') throw new ProfileError('network');
      return ackVisibility(packet, authoritative);
    },
    read: async () => ({ ...authoritative }),
  });
  await s.owner.load();
  s.owner.update({
    displayName: 'Unsaved local name',
    bio: 'Unsaved local bio',
    areaKey: 'local-metro',
    cityId: city.id,
    levelChoice: { kind: 'none' },
  });
  await s.owner.setDirectoryVisible(true);
  const original = s.sent[0]!.packet as VisibilityPacket;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved local name');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Unsaved local bio');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');

  // sameActor → null → sameActor: draft + original key survive; no autowrite.
  s.owner.setActor(null);
  assert.equal(s.owner.getSnapshot().actor, null);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().draft.displayName, '');
  const returned = { ...actor, sessionId: 'reauth-session', generation: 3 };
  s.owner.setActor(returned);
  assert.equal(s.owner.getSnapshot().profile, null);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved local name');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Unsaved local bio');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');
  assert.equal(s.keyCount, 1);
  assert.equal(s.sent.length, 1);

  // Explicit original-key retry after fresh current read: dirty fields kept, pristine follow server.
  phase = 'ack';
  authoritative = {
    ...serverV1, version: 2, directoryVisible: true, displayName: 'Server',
    bio: 'Server bio', areaKey: 'fresh-area',
  };
  await s.owner.reconcile();
  assert.equal(s.sent.length, 2);
  assert.strictEqual(s.sent[1]!.packet, original);
  assert.equal(s.sent[1]!.authority.sessionId, 'reauth-session');
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, true);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'Server');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved local name');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Unsaved local bio');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');
  assert.match(s.owner.getSnapshot().notice!, /видим в каталоге/);

  // Different actor retires quarantined draft + packet.
  const other = setup(serverV1, {
    visibility: async () => { throw new ProfileError('network'); },
  });
  await other.owner.load();
  other.owner.update({ displayName: 'Keep local', bio: 'x' });
  await other.owner.setDirectoryVisible(true);
  assert.equal(other.owner.getSnapshot().draft.displayName, 'Keep local');
  other.owner.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  assert.equal(other.owner.getSnapshot().command, undefined);
  assert.equal(other.owner.getSnapshot().draft.displayName, '');
  other.owner.setActor({ ...actor, sessionId: 'back-A', generation: 2 });
  assert.equal(other.owner.getSnapshot().command, undefined);
  assert.equal(other.owner.getSnapshot().draft.displayName, '');

  // Explicit logout/forget retires quarantine — same-account return has no draft/packet.
  const loggedOut = setup(serverV1, {
    visibility: async () => { throw new ProfileError('network'); },
  });
  await loggedOut.owner.load();
  loggedOut.owner.update({ displayName: 'Gone on logout', bio: 'y' });
  await loggedOut.owner.setDirectoryVisible(true);
  loggedOut.owner.setActor(null);
  loggedOut.owner.forget();
  loggedOut.owner.setActor({ ...actor, sessionId: 'after-forget', generation: 5 });
  assert.equal(loggedOut.owner.getSnapshot().command, undefined);
  assert.equal(loggedOut.owner.getSnapshot().draft.displayName, '');
  assert.equal(loggedOut.owner.getSnapshot().profile, null);
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
  // Outside-profile: pending UNKNOWN and post-rejection recovery (stale/error) without profile.
  assert.match(own, /visibilityOutsideRecovery/);
  assert.match(own, /!profile && \(visibilityPending \|\| visibilityOutsideRecovery\) && pendingVisibilityStatus/);
  assert.match(own, /Повторить включение видимости|Повторить отключение видимости/);
  assert.match(own, /Сохраняем видимость профиля…/);
  assert.match(own, /Обновить данные/);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /kind === 'visibility'/);
  assert.match(editor, /Сохраняем видимость профиля…/);
  // Editor refresh/retry CTAs are not gated on a loaded profile.
  assert.match(editor, /status === 'stale'[\s\S]*refreshAuthoritative/);
  assert.match(editor, /\(state\.status === 'error' \|\| state\.status === 'idle'\)[\s\S]*retryRead/);
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

test('#522 P1: null-profile same-actor rejection → reachable authoritative recovery keeps dirty; read failure recoverable', async () => {
  const serverV1: OwnProfile = {
    ...emptyProfile, version: 1, displayName: 'Server', cityId: city.id, areaKey: 'server-area',
    bio: 'Server bio', directoryVisible: false, consentPolicyVersion: 'directory-mvp-v1',
  };
  for (const reject of [
    { status: 409, code: 'VERSION_CONFLICT', expect: 'stale' as const },
    { status: 422, code: 'CONSENT_POLICY_VERSION_INVALID', expect: 'stale' as const },
    { status: 422, code: 'VISIBILITY_NOT_ALLOWED', expect: 'error' as const },
  ]) {
    let authoritative: OwnProfile = { ...serverV1 };
    let phase: 'lost' | 'reject' | 'ok' = 'lost';
    let citiesEmpty = false;
    const s = setup(serverV1, {
      visibility: async (packet) => {
        if (phase === 'lost') throw new ProfileError('network');
        if (phase === 'reject') throw new ProfileError('business', reject.status, reject.code);
        return ackVisibility(packet, authoritative);
      },
      read: async () => ({ ...authoritative }),
      cities: async () => (citiesEmpty ? [] : [city]),
    });
    await s.owner.load();
    s.owner.update({
      displayName: 'Dirty local', bio: 'Keep bio', areaKey: 'local-metro', cityId: city.id,
    });
    await s.owner.setDirectoryVisible(true);
    const original = s.sent[0]!.packet;
    assert.equal(s.owner.getSnapshot().command?.status, 'unknown');

    s.owner.setActor(null);
    s.owner.setActor({ ...actor, sessionId: `reauth-${reject.code}`, generation: 2 });
    assert.equal(s.owner.getSnapshot().profile, null);
    assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
    assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
    assert.equal(s.owner.getSnapshot().draft.displayName, 'Dirty local');

    phase = 'reject';
    await s.owner.reconcile();
    assert.equal(s.owner.getSnapshot().command, undefined);
    assert.equal(s.owner.getSnapshot().profile, null);
    assert.equal(s.owner.getSnapshot().status, reject.expect);
    assert.equal(s.owner.getSnapshot().draft.displayName, 'Dirty local');
    assert.equal(s.owner.getSnapshot().draft.bio, 'Keep bio');
    assert.equal(s.keyCount, 1);
    assert.equal(s.sent.length, 2);

    // Explicit recovery: 409/consent → refreshAuthoritative; other 4xx → retryRead/load.
    authoritative = {
      ...serverV1, version: 3, directoryVisible: false, displayName: 'Fresh Server',
      bio: 'Fresh bio', areaKey: 'fresh-area',
    };
    citiesEmpty = false;
    if (reject.expect === 'stale') {
      assert.equal(s.owner.getSnapshot().readIntent, 'rebase');
      await s.owner.refreshAuthoritative();
    } else {
      await s.owner.retryRead();
    }
    assert.equal(s.owner.getSnapshot().profile?.version, 3);
    assert.equal(s.owner.getSnapshot().profile?.displayName, 'Fresh Server');
    assert.equal(s.owner.getSnapshot().draft.displayName, 'Dirty local');
    assert.equal(s.owner.getSnapshot().draft.bio, 'Keep bio');
    assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');
    assert.equal(s.owner.getSnapshot().status, 'ready');
    assert.equal(s.owner.getSnapshot().command, undefined);
    assert.equal(s.keyCount, 1);
  }

  // Retry-read network failure after null-profile rejection stays recoverable; UNKNOWN not invented.
  let authoritativeFail: OwnProfile = { ...serverV1 };
  let phaseFail: 'lost' | 'reject' | 'read' = 'lost';
  let readFails = false;
  const fail = setup(serverV1, {
    visibility: async (packet) => {
      if (phaseFail === 'lost') throw new ProfileError('network');
      if (phaseFail === 'reject') throw new ProfileError('business', 409, 'VERSION_CONFLICT');
      return ackVisibility(packet, authoritativeFail);
    },
    read: async () => {
      if (readFails) throw new ProfileError('network');
      return { ...authoritativeFail };
    },
  });
  await fail.owner.load();
  fail.owner.update({ displayName: 'Hold', bio: 'x' });
  await fail.owner.setDirectoryVisible(true);
  fail.owner.setActor(null);
  fail.owner.setActor({ ...actor, sessionId: 'fail-reauth', generation: 3 });
  phaseFail = 'reject';
  await fail.owner.reconcile();
  assert.equal(fail.owner.getSnapshot().status, 'stale');
  assert.equal(fail.owner.getSnapshot().profile, null);
  readFails = true;
  await fail.owner.refreshAuthoritative();
  assert.equal(fail.owner.getSnapshot().status, 'error');
  assert.equal(fail.owner.getSnapshot().readIntent, 'rebase');
  assert.equal(fail.owner.getSnapshot().profile, null);
  assert.equal(fail.owner.getSnapshot().draft.displayName, 'Hold');
  assert.equal(fail.owner.getSnapshot().command, undefined);
  readFails = false;
  authoritativeFail = { ...serverV1, version: 4, displayName: 'After fail' };
  await fail.owner.retryRead();
  assert.equal(fail.owner.getSnapshot().status, 'ready');
  assert.equal(fail.owner.getSnapshot().profile?.version, 4);
  assert.equal(fail.owner.getSnapshot().draft.displayName, 'Hold');
});

test('#522 P1: success with empty cities → subsequent load/editor remount preserves dirty + adopts pristine', async () => {
  const serverV1: OwnProfile = {
    ...emptyProfile, version: 1, displayName: 'Server', cityId: city.id, areaKey: 'server-area',
    bio: 'Server bio', directoryVisible: false, consentPolicyVersion: 'directory-mvp-v1',
  };
  let authoritative: OwnProfile = { ...serverV1 };
  let phase: 'lost' | 'ack' = 'lost';
  let citiesEmpty = false;
  const s = setup(serverV1, {
    visibility: async (packet) => {
      if (phase === 'lost') throw new ProfileError('network');
      return ackVisibility(packet, authoritative);
    },
    read: async () => ({ ...authoritative }),
    cities: async () => (citiesEmpty ? [] : [city]),
  });
  // First load with cities so the editor can dirty the draft, then lose catalog on reauth.
  await s.owner.load();
  // Only name+area dirty; bio stays pristine against server.
  s.owner.update({
    displayName: 'Unsaved name', areaKey: 'local-metro', cityId: city.id,
  });
  await s.owner.setDirectoryVisible(true);
  s.owner.setActor(null);
  s.owner.setActor({ ...actor, sessionId: 'empty-cities', generation: 2 });
  assert.equal(s.owner.getSnapshot().cities.length, 0);
  assert.equal(s.owner.getSnapshot().profile, null);

  phase = 'ack';
  authoritative = {
    ...serverV1, version: 2, directoryVisible: true, displayName: 'Server',
    bio: 'Server bio', areaKey: 'remote-area',
  };
  await s.owner.reconcile();
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().profile?.directoryVisible, true);
  assert.equal(s.owner.getSnapshot().status, 'idle');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved name');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Server bio');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');

  // Editor remount / idle retry-load: dirty kept; pristine bio adopts newer GET.
  authoritative = {
    ...authoritative, version: 2, displayName: 'Server Renamed', bio: 'Bio after catalog',
    areaKey: 'catalog-area',
  };
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().cities.length, 1);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Unsaved name');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'local-metro');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Bio after catalog');
  assert.equal(s.owner.getSnapshot().draft.cityId, city.id);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'Server Renamed');
  assert.equal(s.owner.getSnapshot().profile?.bio, 'Bio after catalog');
});

test('#522 P1: existing profile ACK+GET rebases pristine remote edits; dirty bio survives; save uses fresh version', async () => {
  const serverV1: OwnProfile = {
    ...emptyProfile, version: 1, displayName: 'Alice', cityId: city.id, areaKey: 'north',
    bio: 'old bio', directoryVisible: false, consentPolicyVersion: 'directory-mvp-v1',
    level: null,
  };
  let authoritative: OwnProfile = { ...serverV1 };
  let phase: 'lost' | 'ack' = 'lost';
  const s = setup(serverV1, {
    visibility: async (packet) => {
      if (phase === 'lost') throw new ProfileError('network');
      return ackVisibility(packet, authoritative);
    },
    read: async () => ({ ...authoritative }),
    send: async (packet) => {
      if (packet.kind !== 'profile') throw new Error('expected profile');
      return {
        ...authoritative,
        version: packet.body.expectedVersion + 1,
        displayName: packet.body.displayName,
        cityId: packet.body.cityId,
        areaKey: packet.body.areaKey,
        bio: packet.body.bio,
        level: packet.body.level,
      };
    },
  });
  await s.owner.load();
  // Only bio is dirty; name/city/area/level stay pristine against v1.
  s.owner.update({ bio: 'local dirty bio' });
  await s.owner.setDirectoryVisible(true);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');

  // During UNKNOWN another device changes pristine fields + version.
  phase = 'ack';
  authoritative = {
    ...serverV1, version: 5, directoryVisible: true, displayName: 'Alice Remote',
    cityId: city.id, areaKey: 'south', bio: 'remote bio', level: null,
  };
  await s.owner.reconcile();
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().profile?.version, 5);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'Alice Remote');
  assert.equal(s.owner.getSnapshot().profile?.areaKey, 'south');
  assert.equal(s.owner.getSnapshot().draft.bio, 'local dirty bio');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Alice Remote');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'south');
  assert.equal(s.owner.getSnapshot().draft.cityId, city.id);

  await s.owner.save();
  const saved = s.sent.find(x => x.packet.kind === 'profile')?.packet;
  if (!saved || saved.kind !== 'profile') throw new Error('expected profile save');
  assert.equal(saved.body.expectedVersion, 5);
  assert.equal(saved.body.displayName, 'Alice Remote');
  assert.equal(saved.body.areaKey, 'south');
  assert.equal(saved.body.bio, 'local dirty bio');
  assert.notEqual(saved.body.displayName, 'Alice');
  assert.notEqual(saved.body.areaKey, 'north');
  assert.notEqual(saved.body.bio, 'old bio');
});
