import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  ProfileCoordinator, ProfileError, profileWireBody, createProfileDraft,
} from '../src/profile.ts';
import type { OwnProfile, ProfilePacket, ProfilePort } from '../src/profile.ts';
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

function ackPolicy(packet: ProfilePacket, base: OwnProfile): OwnProfile {
  assert.equal(packet.kind, 'contactPolicy');
  return { ...base, version: packet.body.expectedVersion + 1, contactPolicy: packet.body.contactPolicy };
}

function setup(base: OwnProfile, overrides: Partial<ProfilePort> = {}, peerBusy: () => boolean = () => false) {
  const sent: { packet: ProfilePacket; authority: Actor }[] = [];
  let keys = 0;
  const owner = new ProfileCoordinator({
    read: async () => ({ ...base }),
    cities: async () => [city],
    ...overrides,
    send: async (packet, authority) => {
      sent.push({ packet, authority });
      return overrides.send ? overrides.send(packet, authority) : ackPolicy(packet, base);
    },
  }, () => `policy-key-${++keys}`, peerBusy);
  owner.setActor(actor);
  return { owner, sent, get keyCount() { return keys; } };
}

test('policy-only wire is exactly expectedVersion+contactPolicy; no incidental name/city/bio/consent', async () => {
  let stored: OwnProfile = {
    ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, areaKey: 'sokol', bio: 'описание',
    contactPolicy: 'requests', directoryVisible: false, socialEligible: false, trainer: true,
    consentPolicyVersion: 'policy-v', radarConsented: true, radarConsentPolicyVersion: 'radar-v',
  };
  const before = { ...stored };
  const wires: Record<string, unknown>[] = [];
  const api = createNativeApi(async (_url, init) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      wires.push(body);
      assert.deepEqual(Object.keys(body).sort(), ['contactPolicy', 'expectedVersion']);
      assert.equal(Object.hasOwn(body, 'displayName'), false);
      assert.equal(Object.hasOwn(body, 'cityId'), false);
      assert.equal(Object.hasOwn(body, 'areaKey'), false);
      assert.equal(Object.hasOwn(body, 'bio'), false);
      assert.equal(Object.hasOwn(body, 'level'), false);
      assert.equal(Object.hasOwn(body, 'directoryVisible'), false);
      stored = { ...stored, version: stored.version + 1, contactPolicy: body.contactPolicy as OwnProfile['contactPolicy'] };
    }
    return new Response(JSON.stringify(stored));
  });
  const s = setup(stored, { read: () => api.ownProfile('access'), send: p => api.saveOwnProfile('access', p) });
  await s.owner.load();
  s.owner.update({ displayName: 'Черновик имени', bio: 'локальный черновик', areaKey: 'метро' });
  await s.owner.setContactPolicy('closed');
  assert.equal(wires.length, 1);
  assert.deepEqual(wires[0], { expectedVersion: 3, contactPolicy: 'closed' });
  assert.equal(s.owner.getSnapshot().profile?.contactPolicy, 'closed');
  assert.equal(s.owner.getSnapshot().profile?.version, 4);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик имени');
  assert.equal(s.owner.getSnapshot().draft.bio, 'локальный черновик');
  assert.equal(s.owner.getSnapshot().draft.areaKey, 'метро');
  for (const key of ['displayName', 'cityId', 'areaKey', 'bio', 'directoryVisible', 'socialEligible', 'trainer',
    'consentPolicyVersion', 'radarConsented', 'radarConsentPolicyVersion'] as const) {
    assert.equal(stored[key], before[key]);
  }
  await s.owner.setContactPolicy('requests');
  assert.deepEqual(wires[1], { expectedVersion: 4, contactPolicy: 'requests' });
  assert.equal(s.owner.getSnapshot().profile?.contactPolicy, 'requests');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик имени');
});

test('version0 cannot fake policy; ready version>=1 toggles; same value is no-op', async () => {
  const zero = setup({ ...emptyProfile, version: 0, displayName: '', cityId: null });
  await zero.owner.load();
  await zero.owner.setContactPolicy('closed');
  assert.equal(zero.sent.length, 0);
  assert.match(zero.owner.getSnapshot().notice!, /Сначала сохраните/);

  const ready = setup({ ...emptyProfile, version: 2, displayName: 'Игрок', cityId: city.id, contactPolicy: 'closed' });
  await ready.owner.load();
  await ready.owner.setContactPolicy('closed');
  assert.equal(ready.sent.length, 0);
  await ready.owner.setContactPolicy('requests');
  assert.equal(ready.sent.length, 1);
  assert.equal(ready.sent[0]!.packet.kind, 'contactPolicy');
  assert.deepEqual(ready.sent[0]!.packet.body, { expectedVersion: 2, contactPolicy: 'requests' });
});

test('shared writer locks: peer busy and pending profile save block policy; policy blocks profile save', async () => {
  let busy = false;
  const base = { ...emptyProfile, version: 5, displayName: 'Игрок', cityId: city.id, contactPolicy: 'requests' };
  const gate = deferred<OwnProfile>();
  const s = setup(base, { send: () => gate.promise }, () => busy);
  await s.owner.load();
  busy = true;
  await s.owner.setContactPolicy('closed');
  assert.equal(s.sent.length, 0);
  busy = false;

  s.owner.update({ displayName: 'Игрок', cityId: city.id });
  const save = s.owner.save();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.packet.kind, 'profile');
  await s.owner.setContactPolicy('closed');
  assert.equal(s.sent.length, 1);
  gate.resolve({ ...base, version: 6, displayName: 'Игрок', cityId: city.id });
  await save;

  const gate2 = deferred<OwnProfile>();
  const sent: { packet: ProfilePacket; authority: Actor }[] = [];
  let keys = 0;
  const owner = new ProfileCoordinator({
    read: async () => ({ ...base }),
    cities: async () => [city],
    send: async (packet, authority) => {
      sent.push({ packet, authority });
      if (packet.kind === 'contactPolicy') return gate2.promise;
      return {
        ...base, version: packet.body.expectedVersion + 1, displayName: packet.body.displayName, cityId: packet.body.cityId,
        areaKey: packet.body.areaKey, bio: packet.body.bio, level: packet.body.level,
      };
    },
  }, () => `k-${++keys}`);
  owner.setActor(actor);
  await owner.load();
  const policyWork = owner.setContactPolicy('closed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.packet.kind, 'contactPolicy');
  owner.update({ displayName: 'Blocked' });
  assert.equal(owner.getSnapshot().draft.displayName, 'Игрок');
  await owner.save();
  assert.equal(sent.length, 1);
  gate2.resolve(ackPolicy(sent[0]!.packet, base));
  await policyWork;
  assert.equal(owner.getSnapshot().profile?.contactPolicy, 'closed');
  assert.equal(owner.getSnapshot().draft.displayName, 'Игрок');
});

test('policy 409/401/network UNKNOWN with exact packet retry; late actor ACK ignored', async () => {
  const base = { ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, contactPolicy: 'requests' };
  const conflict = setup(base, {
    send: async () => { throw new ProfileError('business', 409, 'VERSION_CONFLICT'); },
  });
  await conflict.owner.load();
  conflict.owner.update({ bio: 'грязный черновик' });
  await conflict.owner.setContactPolicy('closed');
  assert.equal(conflict.owner.getSnapshot().status, 'stale');
  assert.equal(conflict.owner.getSnapshot().command, undefined);
  assert.equal(conflict.owner.getSnapshot().draft.bio, 'грязный черновик');
  assert.equal(conflict.owner.getSnapshot().profile?.contactPolicy, 'requests');

  let recovered = false;
  const unknown = setup(base, {
    send: async (p) => {
      if (!recovered) throw new ProfileError('network');
      return ackPolicy(p, base);
    },
  });
  await unknown.owner.load();
  unknown.owner.update({ displayName: 'Локальное' });
  await unknown.owner.setContactPolicy('closed');
  const original = unknown.sent[0]!.packet;
  assert.equal(original.kind, 'contactPolicy');
  assert.equal(unknown.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(unknown.owner.getSnapshot().draft.displayName, 'Локальное');
  assert.deepEqual(profileWireBody(original.body), { expectedVersion: 4, contactPolicy: 'closed' });
  recovered = true;
  await unknown.owner.reconcile();
  assert.strictEqual(unknown.sent[1]!.packet, original);
  assert.equal(unknown.owner.getSnapshot().profile?.contactPolicy, 'closed');
  assert.equal(unknown.owner.getSnapshot().draft.displayName, 'Локальное');

  const gate = deferred<OwnProfile>();
  const late = setup(base, { send: () => gate.promise });
  await late.owner.load();
  const work = late.owner.setContactPolicy('closed');
  const packet = late.sent[0]!.packet;
  // Generation change of same actor quarantines UNKNOWN for reauth; late ACK must not paint.
  late.owner.setActor({ ...actor, generation: 9 });
  gate.resolve(ackPolicy(packet, base));
  await work;
  assert.equal(late.owner.getSnapshot().profile, null);
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(late.owner.getSnapshot().command?.packet, packet);
  assert.notEqual(late.owner.getSnapshot().profile?.contactPolicy, 'closed');
});

test('same-actor reauth restores policy UNKNOWN; account B and logout wipe; no auto re-toggle', async () => {
  const base = { ...emptyProfile, version: 6, displayName: 'Игрок', cityId: city.id, contactPolicy: 'requests' };
  let recovered = false;
  const s = setup(base, {
    send: async (p) => {
      if (!recovered) throw new ProfileError('network');
      return ackPolicy(p, base);
    },
  });
  await s.owner.load();
  await s.owner.setContactPolicy('closed');
  const original = s.sent[0]!.packet;
  s.owner.setActor(null);
  assert.equal(s.owner.getSnapshot().command, undefined);
  const returned = { ...actor, sessionId: 'reauth', generation: 2 };
  s.owner.setActor(returned);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
  assert.deepEqual(s.owner.getSnapshot().draft, createProfileDraft('', ''));
  recovered = true;
  await s.owner.reconcile();
  assert.equal(s.sent[1]!.authority.sessionId, 'reauth');
  assert.equal(s.owner.getSnapshot().profile?.contactPolicy, 'closed');

  recovered = false;
  const wipe = setup(base, { send: async () => { throw new ProfileError('network'); } });
  await wipe.owner.load();
  await wipe.owner.setContactPolicy('closed');
  wipe.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(wipe.owner.getSnapshot().command, undefined);
  wipe.owner.forget();
  assert.equal(wipe.owner.getSnapshot().command, undefined);
});

test('own-profile Switch and profile-editor pending copy reference contactPolicy command', () => {
  const own = readFileSync(new URL('../src/components/own-profile.tsx', import.meta.url), 'utf8');
  assert.match(own, /Разрешать личные сообщения/);
  assert.match(own, /setContactPolicy/);
  assert.match(own, /accessibilityRole="switch"/);
  assert.match(own, /profile\.version < 1/);
  const policyBlock = own.slice(own.indexOf('Настройки сообщений'));
  assert.doesNotMatch(policyBlock, /directoryVisible|setDirectory|radarConsent/);
  assert.match(policyBlock, /setContactPolicy\(allow \? 'requests' : 'closed'\)/);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /kind === 'contactPolicy'/);
  assert.match(editor, /Сохранение настройки личных сообщений/);
  assert.match(editor, /Повторить прежнюю настройку личных сообщений/);
});
