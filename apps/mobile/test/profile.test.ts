import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProfileCoordinator, ProfileError, parseOwnProfile, moderationCodes } from '../src/profile.ts';
import type { OwnProfile, ProfilePacket, ProfilePort } from '../src/profile.ts';
import { createNativeApi } from '../src/native-api.ts';
import { createPublicApi } from '../src/public-api.ts';
import type { Actor } from '../src/participation.ts';

export const emptyProfile: OwnProfile = { publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null,
  bio: null, directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true, trainer: false, lookingForGame: null };
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const city = { id: 'catalog-city', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides: Partial<ProfilePort> = {}) {
  const sent: { packet: ProfilePacket; authority: Actor }[] = []; let keys = 0;
  const owner = new ProfileCoordinator({ read: async () => ({ ...emptyProfile }), cities: async () => [city],
    ...overrides, send: async (packet, authority) => { sent.push({ packet, authority }); return overrides.send ? overrides.send(packet, authority)
      : { ...emptyProfile, version: packet.body.expectedVersion + 1, displayName: packet.body.displayName, cityId: packet.body.cityId }; },
  }, () => `key-${++keys}`);
  owner.setActor(actor);
  return { owner, sent };
}
async function edit(owner: ProfileCoordinator) { await owner.load(); owner.update({ displayName: '  Игрок  ', cityId: city.id }); }

test('genuine empty200 is editable without account identity or city defaults; malformed required own DTO is rejected', async () => {
  const api = createNativeApi(async () => new Response(JSON.stringify(emptyProfile)));
  const s = setup({ read: () => api.ownProfile('access') }); await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'ready'); assert.deepEqual(s.owner.getSnapshot().draft, { displayName: '', cityId: '' });
  await s.owner.save(); assert.equal(s.sent.length, 0);
  for (const bad of [{}, { ...emptyProfile, version: '0' }, { ...emptyProfile, version: -1 }, { ...emptyProfile, version: 1.5 },
    { ...emptyProfile, version: Number.MAX_SAFE_INTEGER + 1 }, { ...emptyProfile, directoryVisible: 'true' }, { ...emptyProfile, level: {} },
    { ...emptyProfile, cityId: 0 }, { ...emptyProfile, displayName: null }, { ...emptyProfile, contactPolicy: ['requests'] }, { ...emptyProfile, radarConsentPolicyVersion: undefined }]) {
    assert.throws(() => parseOwnProfile(bad), ProfileError);
  }
  const route = readFileSync(new URL('../app/profile.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /auth\.me\.displayName|auth\.me\.email/);
  assert.match(route, /<ProfileEditor/);
});
test('actual public catalog uses credential-free client; no automatic selection or search-city write', async () => {
  const calls: RequestInit[] = [];
  const catalog = createPublicApi(async (url, init) => {
    assert.equal(String(url), 'https://dev.gobadminton.ru/v1/cities'); calls.push(init!);
    return new Response(JSON.stringify({ items: [city] }));
  });
  const s = setup({ cities: () => catalog.cities() }); await s.owner.load();
  assert.equal(s.owner.getSnapshot().draft.cityId, '');
  s.owner.update({ cityId: 'not-in-catalog' }); assert.equal(s.owner.getSnapshot().draft.cityId, '');
  s.owner.update({ cityId: city.id }); assert.equal(s.owner.getSnapshot().draft.cityId, city.id);
  assert.equal(calls[0]?.credentials, 'omit'); assert.deepEqual(calls[0]?.headers, { Accept: 'application/json' });
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(editor, /usePreferences|setPreferences|geolocation|auth\.me/);
});
test('frozen name/city-only save uses returned versions on repeated edits and leaves unknown levels and consent server-authoritative', async () => {
  let stored: OwnProfile = { ...emptyProfile, version: 7, displayName: 'Старое', cityId: city.id, directoryVisible: false, socialEligible: false,
    contactPolicy: 'closed', level: { scaleId: 'future-scale', scaleVersion: 9, levelId: 'opaque-level', provenance: 'self_declared' },
    areaKey: 'retained', bio: 'Прежнее описание', consentPolicyVersion: 'old-policy', radarConsentPolicyVersion: 'radar-policy' };
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createNativeApi(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string); assert.deepEqual(Object.keys(body).sort(), ['cityId','displayName','expectedVersion']);
      assert.equal(body.expectedVersion, stored.version);
      stored = { ...stored, displayName: body.displayName, cityId: body.cityId, version: stored.version + 1 };
    }
    return new Response(JSON.stringify({ ...stored, email: 'private-must-be-stripped' }));
  });
  const before = { ...stored };
  const s = setup({ read: () => api.ownProfile('private-access'), send: p => api.saveOwnProfile('private-access', p) });
  await edit(s.owner); await s.owner.save(); s.owner.update({ displayName: 'Следующее' }); await s.owner.save();
  assert.deepEqual(s.sent.map(s => s.packet.body), [{ expectedVersion: 7, displayName: 'Игрок', cityId: city.id }, { expectedVersion: 8, displayName: 'Следующее', cityId: city.id }]);
  assert.equal(s.owner.getSnapshot().profile?.version, 9);
  for (const key of ['level','bio','areaKey','directoryVisible','socialEligible','contactPolicy','consentPolicyVersion','radarConsented','radarConsentPolicyVersion'] as const) assert.deepEqual(stored[key], before[key]);
  assert.equal(Object.hasOwn(s.owner.getSnapshot().profile!, 'email'), false);
  for (const { url, init } of calls) {
    assert.equal(url, 'https://dev.gobadminton.ru/v1/me/social-profile'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer private-access'); assert.equal(headers.Cookie, undefined); assert.equal(headers.Origin, undefined);
  }
});
test('double tap sends one immutable packet; cancel restores values and does not save', async () => {
  const gate = deferred<OwnProfile>(), s = setup({ send: () => gate.promise }); await edit(s.owner);
  s.owner.cancel(); assert.deepEqual(s.owner.getSnapshot().draft, { displayName: '', cityId: '' }); assert.equal(s.sent.length, 0);
  s.owner.update({ displayName: 'Игрок', cityId: city.id });
  const a = s.owner.save(), b = s.owner.save(); s.owner.cancel(); s.owner.update({ displayName: 'Changed' });
  assert.equal(s.sent.length, 1); assert.ok(Object.isFrozen(s.sent[0]?.packet.body)); assert.ok(Object.isFrozen(s.sent[0]?.packet.actor));
  gate.resolve({ ...emptyProfile, version: 1, displayName: 'Игрок', cityId: city.id }); await Promise.all([a,b]);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'Игрок');
});
test('UNKNOWN survives navigation/read and same-actor reauth: only explicit reconciliation sends same packet under new authority', async () => {
  let recovered = false;
  const s = setup({ send: async p => { if (!recovered) throw new ProfileError('network'); return { ...emptyProfile, ...p.body, version: 1 }; } });
  await edit(s.owner); await s.owner.save(); const original = s.sent[0]!.packet;
  await s.owner.load(); await s.owner.save(); assert.equal(s.sent.length, 1);
  s.owner.setActor(null); assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().profile, null);
  assert.deepEqual(s.owner.getSnapshot().draft, { displayName: '', cityId: '' }); await s.owner.reconcile(); assert.equal(s.sent.length, 1);
  const returned = { ...actor, sessionId: 'new-session', generation: 2 }; s.owner.setActor(returned);
  assert.equal(s.owner.getSnapshot().command?.packet.cityName, city.nameRu);
  await s.owner.load(); await s.owner.save(); assert.equal(s.sent.length, 1); recovered = true;
  await s.owner.reconcile(); assert.strictEqual(s.sent[1]?.packet, original); assert.deepEqual(s.sent[1]?.authority, returned);
  assert.equal(s.owner.getSnapshot().profile?.version, 1);
});
test('logout and account B wipe private pending; old A→B→A completion cannot reappear or write', async () => {
  for (const clear of ['logout','account-B'] as const) {
    const gate = deferred<OwnProfile>(), s = setup({ send: () => gate.promise }); await edit(s.owner); const work = s.owner.save();
    s.owner.setActor(null);
    if (clear === 'logout') s.owner.forget();
    else s.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 2 });
    s.owner.setActor(null); s.owner.setActor({ ...actor, generation: 3 });
    gate.resolve({ ...emptyProfile, version: 1, displayName: 'Игрок', cityId: city.id }); await work; await s.owner.reconcile();
    assert.equal(s.sent.length, 1); assert.equal(s.owner.getSnapshot().profile, null); assert.equal(s.owner.getSnapshot().command, undefined);
    assert.deepEqual(s.owner.getSnapshot().draft, { displayName: '', cityId: '' });
  }
});
test('reauth while sending fences late original response after same-packet reconciliation', async () => {
  const gate = deferred<OwnProfile>();
  const s = setup({ send: p => s.sent.length === 1 ? gate.promise : Promise.resolve({ ...emptyProfile, ...p.body, version: 2 }) });
  await edit(s.owner); const work = s.owner.save(); s.owner.setActor(null); s.owner.setActor({ ...actor, generation: 2 });
  await s.owner.reconcile(); gate.resolve({ ...emptyProfile, version: 99, displayName: 'Late', cityId: city.id }); await work;
  assert.equal(s.owner.getSnapshot().profile?.version, 2); assert.equal(s.sent.length, 2);
});
test('stale409 blocks editing/new save until explicit authoritative reread and deliberate new edit', async () => {
  let dto = emptyProfile, conflict = true;
  const s = setup({ read: async () => dto, send: async p => { if (conflict) throw new ProfileError('business',409,'VERSION_CONFLICT'); return { ...dto, ...p.body, version: 11 }; } });
  await edit(s.owner); await s.owner.save(); assert.equal(s.owner.getSnapshot().status, 'stale');
  s.owner.update({ displayName: 'Silent rebase' }); await s.owner.save(); assert.equal(s.sent.length, 1);
  dto = { ...emptyProfile, version: 10, displayName: 'Новое на сервере', cityId: city.id };
  await s.owner.load(); assert.equal(s.sent.length, 1); assert.equal(s.owner.getSnapshot().draft.displayName, dto.displayName);
  conflict = false; s.owner.update({ displayName: 'Проверенное' }); await s.owner.save(); assert.equal(s.sent[1]?.packet.body.expectedVersion, 10);
  assert.notEqual(s.sent[0]?.packet.key, s.sent[1]?.packet.key);
});
test('controlled moderation errors retain editable form; 5xx, malformed receipt and in-progress keep UNKNOWN', async () => {
  for (const code of [...moderationCodes,'COMMAND_IN_PROGRESS','UNKNOWN','malformed']) {
    const api = createNativeApi(async () => code === 'malformed' ? new Response('{}') : new Response(JSON.stringify({ code, detail: 'secret response' }), {
      status: code === 'PUBLIC_TEXT_CONTENT_REJECTED' ? 422 : code === 'MODERATION_RATE_LIMITED' ? 429 : code === 'COMMAND_IN_PROGRESS' ? 409 : 503,
    }));
    const s = setup({ send: p => api.saveOwnProfile('private-access', p) }); await edit(s.owner); await s.owner.save();
    assert.deepEqual(s.owner.getSnapshot().draft, { displayName: '  Игрок  ', cityId: city.id });
    assert.equal(s.owner.getSnapshot().command?.status, moderationCodes.includes(code) ? undefined : 'unknown');
    assert.doesNotMatch(JSON.stringify(s.owner.getSnapshot()), /secret response|private-access/);
  }
});
