import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  ProfileCoordinator, ProfileError, parseOwnProfile, moderationCodes, profileWireBody, createProfileDraft,
  resolveProfileLevelForSave, levelGuideChoiceFromProfile, ntrpHalfstepIds, ntrpSelfDeclaredLevel,
  pilotSocialLevel, shouldOfferPreservedLevel,
} from '../src/profile.ts';
import type { OwnProfile, ProfileBody, ProfileDraft, ProfileMutationPacket, ProfilePacket, ProfilePort } from '../src/profile.ts';
import { createNativeApi } from '../src/native-api.ts';
import { createPublicApi } from '../src/public-api.ts';
import type { Actor } from '../src/participation.ts';

export const emptyProfile: OwnProfile = { publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null,
  bio: null, directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true, trainer: false, lookingForGame: null,
  avatar: { uploadedUrl: null, providerUrl: null } };
const emptyDraft = createProfileDraft('', '');
function assertDraft(actual: ProfileDraft, expected: ProfileDraft) {
  assert.equal(actual.displayName, expected.displayName);
  assert.equal(actual.cityId, expected.cityId);
  assert.equal(actual.areaKey, expected.areaKey);
  assert.equal(actual.bio, expected.bio);
  assert.deepEqual(actual.levelChoice, expected.levelChoice);
}
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const city = { id: 'catalog-city', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function ackFrom(packet: ProfileMutationPacket, base: OwnProfile = emptyProfile): OwnProfile {
  if (packet.kind === 'contactPolicy') {
    return {
      ...base,
      version: packet.body.expectedVersion + 1,
      contactPolicy: packet.body.contactPolicy,
    };
  }
  return {
    ...base,
    version: packet.body.expectedVersion + 1,
    displayName: packet.body.displayName,
    cityId: packet.body.cityId,
    areaKey: packet.body.areaKey,
    bio: packet.body.bio,
    level: packet.body.level,
  };
}
function setup(overrides: Partial<ProfilePort> = {}) {
  const sent: { packet: ProfilePacket; authority: Actor }[] = []; let keys = 0;
  const owner = new ProfileCoordinator({ read: async () => ({ ...emptyProfile }), cities: async () => [city],
    ...overrides, send: async (packet, authority) => { sent.push({ packet, authority }); return overrides.send ? overrides.send(packet, authority)
      : ackFrom(packet); },
  }, () => `key-${++keys}`);
  owner.setActor(actor);
  return { owner, sent, get keyCount() { return keys; } };
}
async function edit(owner: ProfileCoordinator) { await owner.load(); owner.update({ displayName: '  Игрок  ', cityId: city.id }); }

test('genuine empty200 is editable without account identity or city defaults; malformed required own DTO is rejected', async () => {
  const api = createNativeApi(async () => new Response(JSON.stringify(emptyProfile)));
  const s = setup({ read: () => api.ownProfile('access') }); await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'ready'); assertDraft(s.owner.getSnapshot().draft, emptyDraft);
  assert.deepEqual({ displayName: s.owner.getSnapshot().draft.displayName, cityId: s.owner.getSnapshot().draft.cityId }, { displayName: '', cityId: '' });
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
  assert.deepEqual(s.sent.map(s => {
    assert.equal(s.packet.kind, 'profile');
    return { expectedVersion: s.packet.body.expectedVersion, displayName: s.packet.body.displayName, cityId: s.packet.body.cityId };
  }),
    [{ expectedVersion: 7, displayName: 'Игрок', cityId: city.id }, { expectedVersion: 8, displayName: 'Следующее', cityId: city.id }]);
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
  s.owner.cancel(); assertDraft(s.owner.getSnapshot().draft, emptyDraft); assert.equal(s.sent.length, 0);
  s.owner.update({ displayName: 'Игрок', cityId: city.id });
  const a = s.owner.save(), b = s.owner.save(); s.owner.cancel(); s.owner.update({ displayName: 'Changed' });
  assert.equal(s.sent.length, 1); assert.ok(Object.isFrozen(s.sent[0]?.packet.body)); assert.ok(Object.isFrozen(s.sent[0]?.packet.actor));
  gate.resolve(ackFrom(s.sent[0]!.packet)); await Promise.all([a,b]);
  assert.equal(s.owner.getSnapshot().profile?.displayName, 'Игрок');
});
test('UNKNOWN survives navigation/read and same-actor reauth: only explicit reconciliation sends same packet under new authority', async () => {
  let recovered = false;
  const s = setup({ send: async p => { if (!recovered) throw new ProfileError('network'); return ackFrom(p); } });
  await edit(s.owner); await s.owner.save(); const original = s.sent[0]!.packet;
  await s.owner.load(); await s.owner.save(); assert.equal(s.sent.length, 1);
  s.owner.setActor(null); assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().profile, null);
  assertDraft(s.owner.getSnapshot().draft, emptyDraft); await s.owner.reconcile(); assert.equal(s.sent.length, 1);
  const returned = { ...actor, sessionId: 'new-session', generation: 2 }; s.owner.setActor(returned);
  assert.equal(s.owner.getSnapshot().command?.packet.kind, 'profile');
  const pendingPacket = s.owner.getSnapshot().command?.packet;
  assert.equal(pendingPacket?.kind === 'profile' ? pendingPacket.cityName : undefined, city.nameRu);
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
    assertDraft(s.owner.getSnapshot().draft, emptyDraft);
  }
});
test('reauth while sending fences late original response after same-packet reconciliation', async () => {
  const gate = deferred<OwnProfile>();
  const s = setup({ send: p => {
    assert.equal(p.kind, 'profile');
    return s.sent.length === 1 ? gate.promise : Promise.resolve({
      ...emptyProfile, version: 2, displayName: p.body.displayName, cityId: p.body.cityId, areaKey: p.body.areaKey, bio: p.body.bio, level: p.body.level,
    });
  } });
  await edit(s.owner); const work = s.owner.save(); s.owner.setActor(null); s.owner.setActor({ ...actor, generation: 2 });
  await s.owner.reconcile(); gate.resolve({ ...emptyProfile, version: 99, displayName: 'Late', cityId: city.id }); await work;
  assert.equal(s.owner.getSnapshot().profile?.version, 2); assert.equal(s.sent.length, 2);
});
test('stale409 blocks editing/new save until explicit authoritative reread and deliberate new edit', async () => {
  let dto = emptyProfile, conflict = true;
  const s = setup({ read: async () => dto, send: async p => { if (conflict) throw new ProfileError('business',409,'VERSION_CONFLICT'); return ackFrom(p, { ...dto, version: 10 }); } });
  await edit(s.owner); await s.owner.save(); assert.equal(s.owner.getSnapshot().status, 'stale');
  assert.equal(s.owner.getSnapshot().readIntent, 'rebase');
  s.owner.update({ displayName: 'Silent rebase' }); await s.owner.save(); assert.equal(s.sent.length, 1);
  dto = { ...emptyProfile, version: 10, displayName: 'Новое на сервере', cityId: city.id };
  // Ordinary load still wipes draft (retryRead is the UI rebase path; load must not regress).
  await s.owner.load(); assert.equal(s.sent.length, 1); assert.equal(s.owner.getSnapshot().draft.displayName, dto.displayName);
  assert.equal(s.owner.getSnapshot().readIntent, null);
  conflict = false; s.owner.update({ displayName: 'Проверенное' }); await s.owner.save();
  assert.equal(s.sent[1]?.packet.kind, 'profile');
  assert.equal(s.sent[1]?.packet.body.expectedVersion, 10);
  assert.notEqual(s.sent[0]?.packet.key, s.sent[1]?.packet.key);
});
test('controlled moderation errors retain editable form; 5xx, malformed receipt and in-progress keep UNKNOWN', async () => {
  for (const code of [...moderationCodes,'COMMAND_IN_PROGRESS','UNKNOWN','malformed']) {
    const api = createNativeApi(async () => code === 'malformed' ? new Response('{}') : new Response(JSON.stringify({ code, detail: 'secret response' }), {
      status: code === 'PUBLIC_TEXT_CONTENT_REJECTED' ? 422 : code === 'MODERATION_RATE_LIMITED' ? 429 : code === 'COMMAND_IN_PROGRESS' ? 409 : 503,
    }));
    const s = setup({ send: p => api.saveOwnProfile('private-access', p) }); await edit(s.owner); await s.owner.save();
    assertDraft(s.owner.getSnapshot().draft, createProfileDraft('  Игрок  ', city.id));
    const controlled = code === 'PUBLIC_TEXT_CONTENT_REJECTED' || code === 'MODERATION_RATE_LIMITED';
    assert.equal(s.owner.getSnapshot().command?.status, controlled ? undefined : 'unknown');
    if (controlled) {
      assert.equal(s.owner.getSnapshot().status, 'ready');
      assert.match(s.owner.getSnapshot().notice!, /Проверьте публичный текст/);
      s.owner.update({ displayName: 'Исправленное' });
      assert.equal(s.owner.getSnapshot().draft.displayName, 'Исправленное');
    }
    assert.doesNotMatch(JSON.stringify(s.owner.getSnapshot()), /secret response|private-access/);
  }
});

for (const [status, code] of [[503, 'MODERATION_TEMPORARILY_UNAVAILABLE'], [503, 'MODERATION_POLICY_MISMATCH'], [502, 'PUBLIC_TEXT_CONTENT_REJECTED']] as const) {
  test(`real native ${status} ${code} stays UNKNOWN with exact wire packet through navigation, retry and same-owner reauth`, async () => {
    const calls: RequestInit[] = [], errors: unknown[] = [];
    let recovered = false;
    const api = createNativeApi(async (url, init) => {
      assert.equal(String(url), 'https://dev.gobadminton.ru/v1/me/social-profile');
      assert.equal(init?.method, 'PATCH'); calls.push(init!);
      return recovered ? new Response(JSON.stringify({ ...emptyProfile, version: 8, displayName: 'Игрок', cityId: city.id }))
        : new Response(JSON.stringify({ code }), { status });
    });
    const s = setup({ read: async () => ({ ...emptyProfile, version: 7 }), send: async (packet, authority) => {
      try { return await api.saveOwnProfile(authority.sessionId, packet); }
      catch (error) { errors.push(error); throw error; }
    } });
    await edit(s.owner); await s.owner.save();
    const original = s.sent[0]!.packet, wire = calls[0]!.body;
    assert.ok(errors[0] instanceof ProfileError);
    assert.equal(errors[0].kind, 'network'); assert.equal(errors[0].status, status); assert.equal(errors[0].code, code);
    assert.equal(wire, JSON.stringify({ expectedVersion: 7, displayName: 'Игрок', cityId: city.id }));
    assert.deepEqual(original.actor, actor); assert.ok(Object.isFrozen(original));
    assert.ok(Object.isFrozen(original.body)); assert.ok(Object.isFrozen(original.actor));
    assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
    const draft = s.owner.getSnapshot().draft;
    await s.owner.load(); s.owner.cancel(); s.owner.update({ displayName: 'Silent edit' }); await s.owner.save();
    assert.deepEqual(s.owner.getSnapshot().draft, draft); assert.equal(calls.length, 1);
    await s.owner.reconcile();
    assert.equal(calls.length, 2); assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
    s.owner.setActor(null); await s.owner.reconcile();
    assert.equal(s.owner.getSnapshot().command, undefined);
    assertDraft(s.owner.getSnapshot().draft, emptyDraft);
    const returned = { ...actor, sessionId: 'reauth-session', generation: 2 };
    s.owner.setActor(returned);
    assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
    assert.equal(original.kind, 'profile');
    assertDraft(s.owner.getSnapshot().draft, createProfileDraft(
      original.body.displayName, original.body.cityId, original.body.areaKey ?? '', original.body.bio ?? '', { kind: 'none' },
    ));
    await s.owner.load(); await s.owner.save();
    assert.equal(calls.length, 2); assert.equal(s.keyCount, 1);
    recovered = true; await s.owner.reconcile();
    assert.equal(calls.length, 3); assert.equal(s.keyCount, 1);
    for (const [i, call] of calls.entries()) {
      assert.strictEqual(s.sent[i]!.packet, original); assert.equal(call.body, wire);
      assert.equal((call.headers as Record<string, string>)['Idempotency-Key'], original.key);
      assert.equal((call.headers as Record<string, string>).Authorization, `Bearer ${i === 2 ? returned.sessionId : actor.sessionId}`);
    }
    assert.deepEqual(s.sent[2]!.authority, returned);
    assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().profile?.version, 8);
    await s.owner.load(); assert.equal(calls.length, 3);
  });
}

test('defensive coordinator keeps a misclassified business503 UNKNOWN with its original packet', async () => {
  const s = setup({ send: async () => { throw new ProfileError('business', 503, 'MODERATION_TEMPORARILY_UNAVAILABLE'); } });
  await edit(s.owner); await s.owner.save(); const original = s.sent[0]!.packet;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  s.owner.update({ displayName: 'Silent edit' }); await s.owner.save();
  assert.equal(s.sent.length, 1); assertDraft(s.owner.getSnapshot().draft, createProfileDraft('  Игрок  ', city.id));
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1]!.packet, original); assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
});

test('level keep vs explicit null vs supported selection; unknown scale/version untouched until change; NTRP half-steps exact', async () => {
  const foreign = { scaleId: 'future-scale', scaleVersion: 9, levelId: '3.5', provenance: 'self_declared' as const };
  assert.equal(shouldOfferPreservedLevel(foreign), true);
  assert.deepEqual(levelGuideChoiceFromProfile(foreign), { kind: 'keep', level: foreign });
  assert.equal(resolveProfileLevelForSave({ kind: 'keep', level: foreign }, foreign), foreign);
  assert.equal(resolveProfileLevelForSave({ kind: 'none' }, foreign), null);
  assert.deepEqual(resolveProfileLevelForSave({ kind: 'ntrp', levelId: '3.5' }, foreign), ntrpSelfDeclaredLevel('3.5'));
  assert.deepEqual(resolveProfileLevelForSave({ kind: 'pilot', levelId: 'beginner' }, null), pilotSocialLevel('beginner'));
  assert.equal(ntrpHalfstepIds().length, 13);
  assert.deepEqual(ntrpHalfstepIds(), ['1.0','1.5','2.0','2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0']);
  assert.equal(ntrpSelfDeclaredLevel('3.2'), null);
  assert.equal(ntrpSelfDeclaredLevel('3,0')?.levelId, '3.0');

  let stored: OwnProfile = { ...emptyProfile, version: 3, displayName: 'Игрок', cityId: city.id, level: foreign, areaKey: 'sokol', bio: 'Было' };
  const wires: unknown[] = [];
  const api = createNativeApi(async (_url, init) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>; wires.push(body);
      stored = {
        ...stored,
        version: stored.version + 1,
        displayName: String(body.displayName ?? stored.displayName),
        cityId: String(body.cityId ?? stored.cityId),
        ...(Object.hasOwn(body, 'level') ? { level: body.level as OwnProfile['level'] } : {}),
        ...(Object.hasOwn(body, 'areaKey') ? { areaKey: body.areaKey as string | null } : {}),
        ...(Object.hasOwn(body, 'bio') ? { bio: body.bio as string | null } : {}),
      };
    }
    return new Response(JSON.stringify(stored));
  });
  const s = setup({ read: () => api.ownProfile('access'), send: p => api.saveOwnProfile('access', p) });
  await s.owner.load();
  assert.deepEqual(s.owner.getSnapshot().draft.levelChoice, { kind: 'keep', level: foreign });
  s.owner.update({ displayName: 'Игрок' }); await s.owner.save();
  assert.deepEqual(Object.keys(wires[0] as object).sort(), ['cityId','displayName','expectedVersion']);
  assert.deepEqual(stored.level, foreign);

  s.owner.update({ levelChoice: { kind: 'none' } }); await s.owner.save();
  assert.equal((wires[1] as { level: null }).level, null); assert.equal(stored.level, null);

  s.owner.update({ levelChoice: { kind: 'ntrp', levelId: '4.5' } }); await s.owner.save();
  assert.deepEqual((wires[2] as { level: unknown }).level, ntrpSelfDeclaredLevel('4.5'));
  assert.deepEqual(stored.level, ntrpSelfDeclaredLevel('4.5'));

  s.owner.update({ levelChoice: { kind: 'pilot', levelId: 'intermediate' } }); await s.owner.save();
  assert.deepEqual((wires[3] as { level: unknown }).level, pilotSocialLevel('intermediate'));
});

test('area/bio omitted vs null vs empty vs limit; exact PATCH JSON; unrelated flags unchanged', async () => {
  let stored: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Игрок', cityId: city.id, areaKey: 'north', bio: 'Описание',
    directoryVisible: false, contactPolicy: 'closed', socialEligible: false, trainer: true,
    consentPolicyVersion: 'policy', radarConsented: true, radarConsentPolicyVersion: 'radar',
  };
  const beforeFlags = {
    directoryVisible: stored.directoryVisible, contactPolicy: stored.contactPolicy, socialEligible: stored.socialEligible,
    trainer: stored.trainer, consentPolicyVersion: stored.consentPolicyVersion, radarConsented: stored.radarConsented,
    radarConsentPolicyVersion: stored.radarConsentPolicyVersion,
  };
  const wires: Record<string, unknown>[] = [];
  const api = createNativeApi(async (_url, init) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      wires.push(body);
      stored = {
        ...stored,
        version: stored.version + 1,
        displayName: String(body.displayName ?? stored.displayName),
        cityId: String(body.cityId ?? stored.cityId),
        areaKey: Object.hasOwn(body, 'areaKey') ? body.areaKey as string | null : stored.areaKey,
        bio: Object.hasOwn(body, 'bio') ? body.bio as string | null : stored.bio,
        level: Object.hasOwn(body, 'level') ? body.level as OwnProfile['level'] : stored.level,
      };
    }
    return new Response(JSON.stringify(stored));
  });
  const s = setup({ read: () => api.ownProfile('access'), send: p => api.saveOwnProfile('access', p) });
  await s.owner.load();
  s.owner.update({ displayName: 'Игрок' }); await s.owner.save();
  assert.deepEqual(Object.keys(wires[0]!).sort(), ['cityId','displayName','expectedVersion']);

  s.owner.update({ areaKey: '  ', bio: '   ' }); await s.owner.save();
  assert.equal(wires[1]!.areaKey, null); assert.equal(wires[1]!.bio, null);
  assert.equal(stored.areaKey, null); assert.equal(stored.bio, null);

  s.owner.update({ areaKey: 'метро', bio: 'Новое' }); await s.owner.save();
  assert.equal(wires[2]!.areaKey, 'метро'); assert.equal(wires[2]!.bio, 'Новое');

  s.owner.update({ areaKey: 'x'.repeat(65) }); await s.owner.save();
  assert.equal(s.sent.length, 3); assert.match(s.owner.getSnapshot().notice!, /64/);
  s.owner.update({ areaKey: 'метро', bio: 'y'.repeat(501) }); await s.owner.save();
  assert.equal(s.sent.length, 3); assert.match(s.owner.getSnapshot().notice!, /500/);

  for (const key of Object.keys(beforeFlags) as (keyof typeof beforeFlags)[]) assert.equal(stored[key], beforeFlags[key]);
  assert.equal(Object.hasOwn(wires[2]!, 'directoryVisible'), false);
  assert.equal(Object.hasOwn(wires[2]!, 'contactPolicy'), false);
  assert.equal(Object.hasOwn(wires[2]!, 'socialEligible'), false);
  assert.equal(Object.hasOwn(wires[2]!, 'trainer'), false);
});

test('profileWireBody omits unchanged optional fields and includes explicit nulls', () => {
  const base: ProfileBody = {
    expectedVersion: 1, displayName: 'A', cityId: city.id, areaKey: null, bio: null, level: null,
    patch: { areaKey: false, bio: false, level: false },
  };
  assert.deepEqual(profileWireBody(base), { expectedVersion: 1, displayName: 'A', cityId: city.id });
  assert.deepEqual(profileWireBody({ ...base, patch: { areaKey: true, bio: true, level: true } }), {
    expectedVersion: 1, displayName: 'A', cityId: city.id, areaKey: null, bio: null, level: null,
  });
  const level = ntrpSelfDeclaredLevel('2.5')!;
  assert.deepEqual(profileWireBody({
    ...base, areaKey: 'sokol', bio: 'hi', level, patch: { areaKey: true, bio: true, level: true },
  }), { expectedVersion: 1, displayName: 'A', cityId: city.id, areaKey: 'sokol', bio: 'hi', level });
});

test('createProfileDraft is ordinary enumerable five-field state; spread keeps area/bio/levelChoice', () => {
  const draft = createProfileDraft('Имя', city.id, 'район', 'био', { kind: 'ntrp', levelId: '4.0' });
  assert.deepEqual(Object.keys(draft).sort(), ['areaKey', 'bio', 'cityId', 'displayName', 'levelChoice']);
  assert.deepEqual({ ...draft }, draft);
  assert.deepEqual(emptyDraft, { displayName: '', cityId: '', areaKey: '', bio: '', levelChoice: { kind: 'none' } });
});

test('save freezes cloned Level identity; caller/profile/draft aliases cannot mutate packet wire or exact retry', async () => {
  const foreign = { scaleId: 'future-scale', scaleVersion: 9, levelId: 'opaque-level', provenance: 'self_declared' as const };
  const stored: OwnProfile = {
    ...emptyProfile, version: 2, displayName: 'Игрок', cityId: city.id, level: foreign, areaKey: 'sokol', bio: 'было',
  };
  let recovered = false;
  const s = setup({
    read: async () => ({ ...stored, level: foreign }),
    send: async p => { if (!recovered) throw new ProfileError('network'); return ackFrom(p, stored); },
  });
  await s.owner.load();
  const draftLevel = s.owner.getSnapshot().draft.levelChoice;
  assert.equal(draftLevel.kind, 'keep');
  await s.owner.save();
  const original = s.sent[0]!.packet;
  assert.equal(original.kind, 'profile');
  const bodyLevel = original.body.level!;
  const wireBefore = JSON.stringify(profileWireBody(original.body));
  const keyBefore = original.key;
  assert.ok(Object.isFrozen(original));
  assert.ok(Object.isFrozen(original.body));
  assert.ok(Object.isFrozen(bodyLevel));
  assert.notStrictEqual(bodyLevel, foreign);
  assert.notStrictEqual(bodyLevel, s.owner.getSnapshot().profile?.level);
  assert.deepEqual(bodyLevel, { scaleId: 'future-scale', scaleVersion: 9, levelId: 'opaque-level', provenance: 'self_declared' });
  assert.equal(original.body.patch.level, false);

  foreign.levelId = 'mutated-caller';
  foreign.scaleId = 'mutated-scale';
  (s.owner.getSnapshot().profile!.level as { levelId: string }).levelId = 'mutated-profile';
  if (draftLevel.kind === 'keep') (draftLevel.level as { levelId: string }).levelId = 'mutated-draft';
  assert.throws(() => { (bodyLevel as { levelId: string }).levelId = 'mutated-packet'; });
  assert.deepEqual(bodyLevel, { scaleId: 'future-scale', scaleVersion: 9, levelId: 'opaque-level', provenance: 'self_declared' });
  assert.equal(JSON.stringify(profileWireBody(original.body)), wireBefore);
  assert.equal(original.key, keyBefore);

  recovered = true;
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1]!.packet, original);
  assert.equal(s.sent[1]!.packet.key, keyBefore);
  assert.equal(JSON.stringify(profileWireBody(s.sent[1]!.packet.body)), wireBefore);
  assert.equal(s.sent[1]!.packet.kind, 'profile');
  assert.deepEqual(s.sent[1]!.packet.body.level, {
    scaleId: 'future-scale', scaleVersion: 9, levelId: 'opaque-level', provenance: 'self_declared',
  });
});

test('explicit ntrp save freezes new Level; retained selection aliases cannot rewrite frozen wire', async () => {
  const s = setup();
  await edit(s.owner);
  s.owner.update({ levelChoice: { kind: 'ntrp', levelId: '4.5' } });
  const choice = s.owner.getSnapshot().draft.levelChoice;
  await s.owner.save();
  const packet = s.sent[0]!.packet;
  assert.equal(packet.kind, 'profile');
  const level = packet.body.level!;
  const wire = JSON.stringify(profileWireBody(packet.body));
  assert.ok(Object.isFrozen(level));
  assert.deepEqual(level, ntrpSelfDeclaredLevel('4.5'));
  assert.equal(packet.body.patch.level, true);
  if (choice.kind === 'ntrp') (choice as { levelId: string }).levelId = '1.0';
  assert.throws(() => { (level as { levelId: string }).levelId = '1.0'; });
  assert.deepEqual(level, ntrpSelfDeclaredLevel('4.5'));
  assert.equal(JSON.stringify(profileWireBody(packet.body)), wire);
});
