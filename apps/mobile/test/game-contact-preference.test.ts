import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { GamePreferences } from '@gobadminton/contracts/game-types';
import { ParticipationError, type Actor } from '../src/participation.ts';
import { createNativeApi } from '../src/native-api.ts';
import {
  GAME_CONTACT_MAX, GameContactPreferenceCoordinator, canRemoveGameContact, canSaveGameContact,
  gameContactPreferenceWire, type GameContactPacket,
} from '../src/game-contact-preference.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const actor: Actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const prefs = (version: number, contact: string | null): GamePreferences =>
  Object.freeze({ version, defaultPublicGameContact: contact });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(overrides: {
  read?: () => Promise<GamePreferences>;
  send?: (packet: GameContactPacket, authority: Actor) => Promise<GamePreferences>;
} = {}) {
  const sent: GameContactPacket[] = [];
  let keys = 0;
  let stored: GamePreferences = prefs(0, null);
  const owner = new GameContactPreferenceCoordinator({
    read: async () => overrides.read ? overrides.read() : stored,
    send: async (packet, authority) => {
      sent.push(packet);
      if (overrides.send) return overrides.send(packet, authority);
      if (packet.body.expectedVersion !== stored.version) {
        throw new ParticipationError('business', 409, 'VERSION_CONFLICT');
      }
      stored = prefs(stored.version + 1, packet.body.defaultPublicGameContact);
      return stored;
    },
  }, () => `contact-key-${++keys}xxxxxxxx`);
  owner.setActor(actor);
  return {
    owner, sent,
    setStored: (v: GamePreferences) => { stored = v; },
    get keyCount() { return keys; },
  };
}

test('wire/helpers: max 320, empty draft never save, remove only when saved', () => {
  assert.equal(GAME_CONTACT_MAX, 320);
  assert.deepEqual(gameContactPreferenceWire({ expectedVersion: 2, defaultPublicGameContact: 'a' }), {
    expectedVersion: 2, defaultPublicGameContact: 'a',
  });
  assert.deepEqual(gameContactPreferenceWire({ expectedVersion: 1, defaultPublicGameContact: null }), {
    expectedVersion: 1, defaultPublicGameContact: null,
  });
  assert.equal(canSaveGameContact('', prefs(0, null)), false);
  assert.equal(canSaveGameContact('   ', prefs(0, null)), false);
  assert.equal(canSaveGameContact('@same', prefs(1, '@same')), false);
  assert.equal(canSaveGameContact(' @next ', prefs(1, '@same')), true);
  assert.equal(canSaveGameContact('x'.repeat(321), prefs(0, null)), false);
  assert.equal(canRemoveGameContact(prefs(0, null)), false);
  assert.equal(canRemoveGameContact(prefs(1, '@x')), true);
});

test('read→save/remove with authoritative receipt; no auto-write on load', async () => {
  const s = setup();
  await s.owner.load();
  assert.equal(s.sent.length, 0);
  assert.equal(s.owner.getSnapshot().preference?.version, 0);
  assert.equal(s.owner.getSnapshot().draft, '');

  s.owner.updateDraft('  telegram:@saved  ');
  await s.owner.save();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.body.expectedVersion, 0);
  assert.equal(s.sent[0]!.body.defaultPublicGameContact, 'telegram:@saved');
  assert.equal(s.owner.getSnapshot().preference?.version, 1);
  assert.equal(s.owner.getSnapshot().draft, 'telegram:@saved');
  assert.match(s.owner.getSnapshot().notice ?? '', /следующих игр/);

  // Unchanged / empty draft must not dispatch.
  await s.owner.save();
  s.owner.updateDraft('');
  await s.owner.save();
  assert.equal(s.sent.length, 1);

  await s.owner.remove();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1]!.body.defaultPublicGameContact, null);
  assert.equal(s.owner.getSnapshot().preference?.defaultPublicGameContact, null);
  assert.match(s.owner.getSnapshot().notice ?? '', /удалён/);
});

test('stale 409 keeps draft and requires explicit reread; empty draft never remove', async () => {
  let phase: 'conflict' | 'ok' = 'conflict';
  const s = setup({
    send: async (packet) => {
      if (phase === 'conflict') throw new ParticipationError('business', 409, 'VERSION_CONFLICT');
      return prefs(packet.body.expectedVersion + 1, packet.body.defaultPublicGameContact);
    },
  });
  s.setStored(prefs(1, '@old'));
  await s.owner.load();
  s.owner.updateDraft('@new');
  await s.owner.save();
  assert.equal(s.owner.getSnapshot().status, 'stale');
  assert.equal(s.owner.getSnapshot().draft, '@new');
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.match(s.owner.getSnapshot().notice ?? '', /Обновите данные/);

  // Locked while stale — draft edits and saves refuse until authoritative refresh.
  s.owner.updateDraft('@ignored');
  assert.equal(s.owner.getSnapshot().draft, '@new');
  await s.owner.save();
  assert.equal(s.sent.length, 1);

  s.setStored(prefs(4, '@newer'));
  await s.owner.refreshAuthoritative();
  assert.equal(s.owner.getSnapshot().preference?.version, 4);
  assert.equal(s.owner.getSnapshot().draft, '@new');
  assert.equal(s.owner.getSnapshot().status, 'ready');
  phase = 'ok';
  await s.owner.save();
  assert.equal(s.sent[1]!.body.expectedVersion, 4);
  assert.equal(s.owner.getSnapshot().preference?.defaultPublicGameContact, '@new');
});

test('response lost keeps exact packet/key; reconcile retries same body; actor/session fence late A→B', async () => {
  let recovered = false;
  const s = setup({
    send: async (packet) => {
      if (!recovered) throw new ParticipationError('network');
      return prefs(packet.body.expectedVersion + 1, packet.body.defaultPublicGameContact);
    },
  });
  await s.owner.load();
  s.owner.updateDraft('@draft');
  await s.owner.save();
  const original = s.sent[0]!;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().draft, '@draft');
  recovered = true;
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1], original);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().preference?.defaultPublicGameContact, '@draft');

  const gate = deferred<GamePreferences>();
  const late = setup({ send: () => gate.promise });
  await late.owner.load();
  late.owner.updateDraft('@late');
  const work = late.owner.save();
  const packet = late.sent[0]!;
  late.owner.setActor({ ...actor, generation: 9 });
  gate.resolve(prefs(1, '@late'));
  await work;
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(late.owner.getSnapshot().command?.packet.key, packet.key);
  assert.equal(late.owner.getSnapshot().draft, '@late');

  const wipe = setup({ send: async () => { throw new ParticipationError('network'); } });
  await wipe.owner.load();
  wipe.owner.updateDraft('@x');
  await wipe.owner.save();
  wipe.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(wipe.owner.getSnapshot().command, undefined);
  wipe.owner.forget();
  assert.equal(wipe.owner.getSnapshot().actor, null);
});

test('read error / cancel edits / guest-like missing actor refuses mutations', async () => {
  const s = setup({ read: async () => { throw new ParticipationError('network'); } });
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'error');
  s.owner.updateDraft('@no');
  await s.owner.save();
  assert.equal(s.sent.length, 0);

  const guest = new GameContactPreferenceCoordinator({
    read: async () => prefs(0, null),
    send: async () => prefs(1, '@x'),
  }, () => 'guest-key-16chars!');
  guest.updateDraft('@x');
  await guest.save();
  await guest.remove();
  assert.equal(guest.getSnapshot().command, undefined);
});

test('native transport: exact PATCH path/headers/body; guest path has no mutate without bearer', async () => {
  const wires: { path: string; method: string; body?: unknown; key?: string; auth?: string }[] = [];
  const api = createNativeApi(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/v1/, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    wires.push({
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      key: headers['Idempotency-Key'],
      auth: headers.Authorization,
    });
    if (path === '/me/game-preferences' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(prefs(0, null)), { status: 200 });
    }
    if (path === '/me/game-preferences' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { expectedVersion: number; defaultPublicGameContact: string | null };
      return new Response(JSON.stringify(prefs(body.expectedVersion + 1, body.defaultPublicGameContact)), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  });
  assert.deepEqual(await api.gamePreferences('access-token'), prefs(0, null));
  assert.equal(wires[0]!.method, 'GET');
  assert.equal(wires[0]!.path, '/me/game-preferences');
  assert.equal(wires[0]!.auth, 'Bearer access-token');
  assert.equal(wires[0]!.key, undefined);

  const packet: GameContactPacket = Object.freeze({
    actor: Object.freeze({ ...actor }),
    key: 'pref-key-16chars!!',
    body: Object.freeze({ expectedVersion: 0, defaultPublicGameContact: 'telegram:@wire' }),
  });
  const saved = await api.mutateGamePreferences('access-token', packet);
  assert.equal(saved.version, 1);
  assert.equal(wires[1]!.method, 'PATCH');
  assert.equal(wires[1]!.path, '/me/game-preferences');
  assert.deepEqual(wires[1]!.body, { expectedVersion: 0, defaultPublicGameContact: 'telegram:@wire' });
  assert.equal(wires[1]!.key, 'pref-key-16chars!!');
  assert.equal(wires[1]!.auth, 'Bearer access-token');
});

test('#522 same-account reauth: dirty draft (incl empty) survives load; clean takes server', async () => {
  const s = setup();
  s.setStored(prefs(1, '@server'));
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().draft, '@server');

  s.owner.updateDraft('@unsaved-user-draft');
  s.owner.setActor(null);
  s.owner.setActor({ actorId: 'A', sessionId: 'session-2', generation: 1 });
  assert.equal(s.owner.getSnapshot().draft, '@unsaved-user-draft');
  s.setStored(prefs(2, '@server-v2'));
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().preference?.version, 2);
  assert.equal(s.owner.getSnapshot().preference?.defaultPublicGameContact, '@server-v2');
  assert.equal(s.owner.getSnapshot().draft, '@unsaved-user-draft');

  // Deliberately cleared empty draft is still dirty and must not snap back to server text.
  s.owner.updateDraft('');
  s.owner.setActor(null);
  s.owner.setActor({ actorId: 'A', sessionId: 'session-3', generation: 1 });
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().draft, '');
  assert.equal(s.owner.getSnapshot().preference?.defaultPublicGameContact, '@server-v2');

  // Clean (no updateDraft) reauth must refresh draft from current server, not stale quarantine text.
  const clean = setup();
  clean.setStored(prefs(1, '@old-server'));
  await clean.owner.load();
  assert.equal(clean.owner.getSnapshot().draft, '@old-server');
  clean.owner.setActor(null);
  clean.owner.setActor({ actorId: 'A', sessionId: 'session-2', generation: 1 });
  clean.setStored(prefs(3, '@new-server'));
  await clean.owner.load();
  assert.equal(clean.owner.getSnapshot().draft, '@new-server');
  assert.equal(clean.owner.getSnapshot().preference?.version, 3);

  // Different account / forget must not leak private draft.
  const leak = setup();
  leak.setStored(prefs(1, '@a'));
  await leak.owner.load();
  leak.owner.updateDraft('@private-a');
  leak.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(leak.owner.getSnapshot().draft, '');
  assert.equal(leak.owner.getSnapshot().preference, null);
  leak.owner.forget();
  assert.equal(leak.owner.getSnapshot().actor, null);
  assert.equal(leak.owner.getSnapshot().draft, '');
});

test('#522 APK44 source wiring: profile card, coordinator, PATCH opt-in, counter 44', () => {
  const component = read('../src/components/game-contact-preference.tsx');
  assert.match(component, /Контакт для игр/);
  assert.match(component, /подставится при создании игры/);
  assert.match(component, /каталоге игроков не изменятся/);
  assert.match(component, /Сохранить контакт/);
  assert.match(component, /Удалить сохранённый контакт/);
  assert.match(component, /nativeAuth\.gameContactPreference/);
  assert.match(component, /GAME_CONTACT_MAX/);

  const profile = read('../app/profile.tsx');
  assert.match(profile, /GameContactPreferenceCard/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /GameContactPreferenceCoordinator/);
  assert.match(auth, /this\.gameContactPreference\.setActor/);
  assert.match(auth, /this\.gameContactPreference\.forget/);
  assert.match(auth, /mutateGamePreferences/);
  assert.doesNotMatch(auth, /gameManagement\.(update|loadContext).*gameContactPreference/);

  const api = read('../src/native-api.ts');
  assert.match(api, /mutateGamePreferences/);
  assert.match(api, /gameContactPreferenceWire/);

  const controller = read('../../api/src/profiles/me-game-preferences.controller.ts');
  assert.match(controller, /requirePrincipalMutation\(request\)/);
  assert.doesNotMatch(controller, /requireCookieMutation\(request\)/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 44);
});
