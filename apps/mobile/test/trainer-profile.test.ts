import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { ProfileError, type OwnProfile } from '../src/profile.ts';
import {
  TRAINER_BIO_MAX, TRAINER_NAME_MAX, TrainerProfileCoordinator, parseTrainerProfile,
  trainerActive, trainerDeactivateWire, trainerDraftFrom, trainerUpsertWire,
  type TrainerPacket, type TrainerProfile,
} from '../src/trainer-profile.ts';
import type { Actor } from '../src/participation.ts';
import { createNativeApi } from '../src/native-api.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const actor: Actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const dto = (n = 1, status: 'active' | 'inactive' = 'active'): TrainerProfile => Object.freeze({
  id: 'trainer-1', version: n, displayName: 'Тренер Анна', bio: 'Описание',
  declarationSource: 'self_declared', declaredAt: '2026-11-01T10:00:00.000Z', status,
});
const social = (trainer: boolean): OwnProfile => ({
  publicPlayerId: 'own', version: 3, displayName: 'Аккаунт', cityId: 'city', areaKey: null, level: null, bio: null,
  directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true,
  trainer, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(overrides: {
  read?: () => Promise<TrainerProfile | null>;
  send?: (packet: TrainerPacket, authority: Actor) => Promise<TrainerProfile>;
  refreshSocial?: (authority: Actor) => Promise<OwnProfile>;
  accountDisplayName?: () => string;
  isPeerBusy?: () => boolean;
  applySocial?: (fresh: OwnProfile) => void;
  invalidateGameTrainer?: () => void;
} = {}) {
  const sent: TrainerPacket[] = [];
  let keys = 0;
  let stored: TrainerProfile | null = null;
  const socialApplies: OwnProfile[] = [];
  const invalidations: number[] = [];
  const owner = new TrainerProfileCoordinator({
    read: async () => overrides.read ? overrides.read() : stored,
    send: async (packet, authority) => {
      sent.push(packet);
      if (overrides.send) return overrides.send(packet, authority);
      if (packet.kind === 'upsert') {
        const next = dto((stored?.version ?? 0) + 1, 'active');
        stored = Object.freeze({
          ...next,
          displayName: packet.body.displayName,
          bio: packet.body.bio,
          ...(packet.body.expectedVersion !== undefined ? { version: packet.body.expectedVersion + 1 } : {}),
        });
        return stored;
      }
      if (!stored) throw new ProfileError('business', 404, 'TRAINER_PROFILE_NOT_FOUND');
      stored = Object.freeze({ ...stored, status: 'inactive' as const, version: stored.version + 1 });
      return stored;
    },
    refreshSocial: async (authority) => {
      if (overrides.refreshSocial) return overrides.refreshSocial(authority);
      return social(stored?.status === 'active');
    },
  }, () => `trainer-key-${++keys}`, {
    isPeerBusy: overrides.isPeerBusy ?? (() => false),
    accountDisplayName: overrides.accountDisplayName ?? (() => 'Аккаунт'),
    applySocial: fresh => {
      socialApplies.push(fresh);
      overrides.applySocial?.(fresh);
    },
    invalidateGameTrainer: () => {
      invalidations.push(1);
      overrides.invalidateGameTrainer?.();
    },
  });
  owner.setActor(actor);
  return {
    owner, sent, socialApplies, invalidations,
    setStored: (v: TrainerProfile | null) => { stored = v; },
    get keyCount() { return keys; },
  };
}

test('parse/wire helpers: full DTO, create omits version, edit includes CAS; caps conservative', () => {
  const full = parseTrainerProfile(dto(2));
  assert.equal(full.version, 2);
  assert.equal(trainerActive(full), true);
  assert.equal(trainerActive(dto(1, 'inactive')), false);
  assert.throws(() => parseTrainerProfile({ ...dto(1), version: 0 }), ProfileError);
  assert.throws(() => parseTrainerProfile({ ...dto(1), declarationSource: 'other' }), ProfileError);
  assert.deepEqual(trainerUpsertWire({ selfDeclared: true, displayName: 'A', bio: null }), {
    selfDeclared: true, displayName: 'A', bio: null,
  });
  assert.deepEqual(trainerUpsertWire({ selfDeclared: true, displayName: 'A', bio: 'b', expectedVersion: 3 }), {
    selfDeclared: true, displayName: 'A', bio: 'b', expectedVersion: 3,
  });
  assert.deepEqual(trainerDeactivateWire(4), { expectedVersion: 4 });
  assert.equal(TRAINER_NAME_MAX, 80);
  assert.equal(TRAINER_BIO_MAX, 1000);
  assert.deepEqual(trainerDraftFrom(null, '  Аккаунт  '), { displayName: 'Аккаунт', bio: '' });
  assert.deepEqual(trainerDraftFrom(dto(1), 'ignored'), { displayName: 'Тренер Анна', bio: 'Описание' });
});

test('create/edit/deactivate/reactivate: CAS versions, social refresh, game-trainer invalidate; no auto write on load', async () => {
  const s = setup();
  await s.owner.load();
  assert.equal(s.sent.length, 0);
  assert.equal(s.owner.getSnapshot().trainer, null);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Аккаунт');

  await s.owner.save();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.kind, 'upsert');
  if (s.sent[0]!.kind === 'upsert') assert.equal(Object.hasOwn(s.sent[0]!.body, 'expectedVersion'), false);
  assert.equal(s.owner.getSnapshot().trainer?.status, 'active');
  assert.equal(s.socialApplies[0]?.trainer, true);
  assert.equal(s.invalidations.length, 1);

  const versionBeforeEdit = s.owner.getSnapshot().trainer!.version;
  s.owner.updateDraft({ displayName: 'Новое', bio: 'bio' });
  await s.owner.save();
  assert.equal(s.sent[1]!.kind, 'upsert');
  if (s.sent[1]!.kind === 'upsert') assert.equal(s.sent[1]!.body.expectedVersion, versionBeforeEdit);

  const versionBeforeOff = s.owner.getSnapshot().trainer!.version;
  await s.owner.deactivate();
  assert.equal(s.sent[2]!.kind, 'deactivate');
  if (s.sent[2]!.kind === 'deactivate') assert.equal(s.sent[2]!.body.expectedVersion, versionBeforeOff);
  assert.equal(s.owner.getSnapshot().trainer?.status, 'inactive');
  assert.equal(s.socialApplies.at(-1)?.trainer, false);

  const versionBeforeOn = s.owner.getSnapshot().trainer!.version;
  s.owner.updateDraft({ displayName: 'Снова', bio: '' });
  await s.owner.save();
  assert.equal(s.sent[3]!.kind, 'upsert');
  if (s.sent[3]!.kind === 'upsert') assert.equal(s.sent[3]!.body.expectedVersion, versionBeforeOn);
  assert.equal(s.owner.getSnapshot().trainer?.status, 'active');
});

test('UNKNOWN keeps original packet/key; same-actor reauth restores; different actor/logout wipe; no auto resend', async () => {
  let recovered = false;
  let current: TrainerProfile | null = null;
  const s = setup({
    read: async () => current,
    send: async (packet) => {
      if (!recovered) throw new ProfileError('network');
      if (packet.kind === 'upsert') {
        const ack = Object.freeze({
          ...dto(1, 'active'),
          displayName: packet.body.displayName,
          bio: packet.body.bio,
        });
        // Simulate committed write so post-ACK GET sees current truth.
        current = ack;
        return ack;
      }
      return dto(2, 'inactive');
    },
  });
  await s.owner.load();
  s.owner.updateDraft({ displayName: 'Черновик', bio: 'текст' });
  await s.owner.save();
  const original = s.sent[0]!;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик');
  assert.equal(s.owner.getSnapshot().draft.bio, 'текст');
  recovered = true;
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1], original);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Черновик');

  const gate = deferred<TrainerProfile>();
  const late = setup({ send: () => gate.promise });
  await late.owner.load();
  late.owner.updateDraft({ displayName: 'Поздний' });
  const work = late.owner.save();
  const packet = late.sent[0]!;
  late.owner.setActor({ ...actor, generation: 9 });
  gate.resolve(dto(1));
  await work;
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(late.owner.getSnapshot().command?.packet.key, packet.key);
  assert.equal(late.owner.getSnapshot().draft.displayName, 'Поздний');

  recovered = false;
  const wipe = setup({ send: async () => { throw new ProfileError('network'); } });
  await wipe.owner.load();
  wipe.owner.updateDraft({ displayName: 'X' });
  await wipe.owner.save();
  wipe.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(wipe.owner.getSnapshot().command, undefined);
  wipe.owner.setActor(null);
  assert.equal(wipe.owner.getSnapshot().command, undefined);
  assert.equal(wipe.owner.getSnapshot().trainer, null);
});

test('409 stale keeps dirty draft and requires authoritative refresh before new command', async () => {
  const s = setup({
    send: async () => { throw new ProfileError('business', 409, 'VERSION_CONFLICT'); },
    read: async () => dto(9),
  });
  await s.owner.load();
  s.owner.updateDraft({ displayName: 'Локальный текст', bio: 'сохранить' });
  await s.owner.save();
  assert.equal(s.owner.getSnapshot().status, 'stale');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локальный текст');
  assert.equal(s.owner.getSnapshot().command, undefined);
  await s.owner.save();
  assert.equal(s.sent.length, 1);
  await s.owner.refreshAuthoritative();
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().trainer?.version, 9);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локальный текст');
  assert.equal(s.owner.getSnapshot().draft.bio, 'сохранить');
});

test('genuine 404 is absent; other read failures unavailable; peer busy blocks mutations', async () => {
  const absent = setup({ read: async () => null });
  await absent.owner.load();
  assert.equal(absent.owner.getSnapshot().status, 'ready');
  assert.equal(absent.owner.getSnapshot().trainer, null);

  const fail = setup({ read: async () => { throw new ProfileError('network'); } });
  await fail.owner.load();
  assert.equal(fail.owner.getSnapshot().status, 'error');
  assert.match(fail.owner.getSnapshot().notice!, /Не удалось загрузить/);

  let busy = false;
  const blocked = setup({ isPeerBusy: () => busy });
  await blocked.owner.load();
  assert.equal(blocked.owner.getSnapshot().draft.displayName, 'Аккаунт');
  busy = true;
  blocked.owner.updateDraft({ displayName: 'blocked' });
  assert.equal(blocked.owner.getSnapshot().draft.displayName, 'Аккаунт');
  busy = false;
  blocked.owner.updateDraft({ displayName: 'ok' });
  assert.equal(blocked.owner.getSnapshot().draft.displayName, 'ok');
});

test('native API trainer ports: PUT/POST deactivate, 404→null, selfDeclared only on upsert wire', async () => {
  const wires: { path: string; method?: string; body?: unknown; key?: string }[] = [];
  const profile = dto(1);
  const api = createNativeApi(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const key = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'];
    wires.push({ path, method, body, key });
    if (path === '/me/trainer-profile' && method === 'GET') {
      return new Response(null, { status: 404 });
    }
    if (path === '/me/trainer-profile' && method === 'PUT') {
      return new Response(JSON.stringify({ ...profile, displayName: body.displayName, bio: body.bio ?? null, version: 2 }), { status: 201 });
    }
    if (path === '/me/trainer-profile/deactivate' && method === 'POST') {
      return new Response(JSON.stringify({ ...profile, status: 'inactive', version: 3 }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  });
  assert.equal(await api.ownTrainerProfile('tok'), null);
  const upsertPacket: TrainerPacket = Object.freeze({
    kind: 'upsert', actor: Object.freeze({ ...actor }), key: 'put-key-16chars!!',
    body: Object.freeze({ selfDeclared: true as const, displayName: 'Native', bio: null }),
  });
  const saved = await api.mutateOwnTrainer('tok', upsertPacket);
  assert.equal(saved.displayName, 'Native');
  assert.equal(wires[1]!.method, 'PUT');
  assert.equal(wires[1]!.path, '/me/trainer-profile');
  assert.deepEqual(wires[1]!.body, { selfDeclared: true, displayName: 'Native', bio: null });
  const offPacket: TrainerPacket = Object.freeze({
    kind: 'deactivate', actor: Object.freeze({ ...actor }), key: 'off-key-16chars!!',
    body: Object.freeze({ expectedVersion: 2 }),
  });
  const off = await api.mutateOwnTrainer('tok', offPacket);
  assert.equal(off.status, 'inactive');
  assert.equal(wires[2]!.path, '/me/trainer-profile/deactivate');
  assert.equal(wires[2]!.method, 'POST');
});

test('own-profile card + editor route copy and root trainer wiring', () => {
  const own = read('../src/components/own-profile.tsx');
  assert.match(own, /Опциональная информация игрока/);
  assert.match(own, /Тренерский профиль/);
  assert.match(own, /Я тренер/);
  assert.match(own, /Профиль тренера выключен/);
  assert.match(own, /Информация заполнена пользователем/);
  assert.match(own, /Редактировать профиль тренера/);
  assert.match(own, /После отключения вы по-прежнему сможете управлять созданными играми/);
  assert.match(own, /nativeAuth\.trainer/);
  assert.match(own, /\/profile\/trainer/);
  const idxMessages = own.indexOf('Личные сообщения');
  const idxTrainer = own.indexOf('Тренерский профиль');
  assert.ok(idxMessages >= 0 && idxTrainer > idxMessages);

  const editor = read('../src/components/trainer-profile-editor.tsx');
  assert.match(editor, /Сохранить и включить/);
  assert.match(editor, /Сохранение включает профиль тренера/);
  assert.match(editor, /Отключить профиль тренера/);
  assert.match(editor, /К профилю/);
  assert.match(editor, /Имя тренера/);
  assert.match(editor, /Коротко о себе/);
  assert.match(editor, /TRAINER_NAME_MAX/);
  assert.match(editor, /TRAINER_BIO_MAX/);

  const route = read('../app/profile/trainer.tsx');
  assert.match(route, /← Мой профиль/);
  assert.match(route, /TrainerProfileEditor/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /TrainerProfileCoordinator/);
  assert.match(auth, /this\.trainer\.setActor/);
  assert.match(auth, /this\.trainer\.forget/);
  assert.match(auth, /ownTrainerProfile/);
  assert.match(auth, /mutateOwnTrainer/);
  assert.match(auth, /refreshOwnTrainerContext/);

  const api = read('../src/native-api.ts');
  assert.match(api, /\/me\/trainer-profile\/deactivate/);
  assert.match(api, /ownTrainerProfile/);
  assert.match(api, /mutateOwnTrainer/);

  const controller = read('../../api/src/trainers/trainers.controller.ts');
  assert.equal([...controller.matchAll(/requirePrincipalMutation\(request\)/g)].length, 2);
  assert.doesNotMatch(controller, /requireCookieMutation\(request\)/);
});

test('#522 P2: historical ACK yields to post-ACK current GET; failed current read does not unlock', async () => {
  const historical = Object.freeze({
    ...dto(1, 'active'),
    displayName: 'Историческое имя',
    bio: 'старое',
  });
  const newer = Object.freeze({
    ...dto(3, 'inactive'),
    displayName: 'Актуальное имя',
    bio: 'новое после другой сессии',
  });
  let phase: 'net' | 'ack' = 'net';
  let authoritative: TrainerProfile | null = null;
  const s = setup({
    read: async () => authoritative,
    send: async (packet) => {
      if (phase === 'net') throw new ProfileError('network');
      assert.equal(packet.kind, 'upsert');
      return historical;
    },
  });
  await s.owner.load();
  s.owner.updateDraft({ displayName: 'Историческое имя', bio: 'старое' });
  await s.owner.save();
  const original = s.sent[0]!;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  phase = 'ack';
  authoritative = newer;
  await s.owner.reconcile();
  assert.strictEqual(s.sent[1], original);
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().trainer?.version, 3);
  assert.equal(s.owner.getSnapshot().trainer?.status, 'inactive');
  assert.equal(s.owner.getSnapshot().trainer?.displayName, 'Актуальное имя');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Актуальное имя');
  assert.equal(s.owner.getSnapshot().draft.bio, 'новое после другой сессии');

  // ACK succeeded but current GET fails → no false success / no historical unlock.
  let readAfterAck = false;
  const failGet = setup({
    read: async () => {
      if (!readAfterAck) return null;
      throw new ProfileError('network');
    },
    send: async (packet) => {
      if (packet.kind !== 'upsert') return dto(2, 'inactive');
      const ack = Object.freeze({
        ...dto(1, 'active'),
        displayName: packet.body.displayName,
        bio: packet.body.bio,
      });
      readAfterAck = true;
      return ack;
    },
  });
  await failGet.owner.load();
  failGet.owner.updateDraft({ displayName: 'Черновик', bio: 'b' });
  await failGet.owner.save();
  assert.equal(failGet.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(failGet.owner.getSnapshot().status, 'ready');
  assert.equal(failGet.owner.getSnapshot().trainer, null);
  assert.equal(failGet.owner.getSnapshot().draft.displayName, 'Черновик');
  assert.match(failGet.owner.getSnapshot().notice!, /не удалось подтвердить/i);
});

test('#522 P2 R2: deferred business 429 after validated ACK keeps original packet/key locked', async () => {
  // Post-ACK current/social business failures must not share the write-rejection unlock path.
  const gate = deferred<void>();
  let phase: 'seed' | 'postAckRead' | 'postAckSocial' = 'seed';
  const s = setup({
    read: async () => {
      if (phase === 'seed') return null;
      if (phase === 'postAckRead') {
        await gate.promise;
        throw new ProfileError('business', 429, 'MODERATION_RATE_LIMITED');
      }
      return Object.freeze({
        ...dto(1, 'active'),
        displayName: 'После ACK',
        bio: 'hold',
      });
    },
    send: async (packet) => {
      assert.equal(packet.kind, 'upsert');
      phase = 'postAckRead';
      return Object.freeze({
        ...dto(1, 'active'),
        displayName: packet.body.displayName,
        bio: packet.body.bio,
      });
    },
  });
  await s.owner.load();
  s.owner.updateDraft({ displayName: 'После ACK', bio: 'hold' });
  const work = s.owner.save();
  const original = s.sent[0]!;
  assert.equal(s.owner.getSnapshot().command?.status, 'sending');
  assert.equal(s.keyCount, 1);
  assert.equal(s.owner.blocksMutations(), true);
  // Still locked while deferred recovery read is in flight.
  await s.owner.save();
  assert.equal(s.sent.length, 1);
  gate.resolve();
  await work;
  assert.strictEqual(s.owner.getSnapshot().command?.packet, original);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().trainer, null);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'После ACK');
  assert.match(s.owner.getSnapshot().notice!, /не удалось подтвердить/i);
  assert.equal(s.owner.blocksMutations(), true);
  assert.equal(s.keyCount, 1);
  // Explicit original-key retry still allowed; no auto-write / no new key.
  await s.owner.save();
  assert.equal(s.sent.length, 1);
  assert.equal(s.keyCount, 1);

  // Same rule for social refresh business 429 after current GET succeeds.
  const socialGate = deferred<void>();
  phase = 'seed';
  const socialFail = setup({
    read: async () => {
      if (phase === 'seed') return null;
      return Object.freeze({
        ...dto(1, 'active'),
        displayName: 'Соцсбой',
        bio: 'x',
      });
    },
    send: async (packet) => {
      phase = 'postAckSocial';
      return Object.freeze({
        ...dto(1, 'active'),
        displayName: packet.body.displayName,
        bio: packet.body.bio,
      });
    },
    refreshSocial: async () => {
      await socialGate.promise;
      throw new ProfileError('business', 429, 'MODERATION_RATE_LIMITED');
    },
  });
  await socialFail.owner.load();
  socialFail.owner.updateDraft({ displayName: 'Соцсбой', bio: 'x' });
  const socialWork = socialFail.owner.save();
  const socialOriginal = socialFail.sent[0]!;
  assert.equal(socialFail.owner.getSnapshot().command?.status, 'sending');
  socialGate.resolve();
  await socialWork;
  assert.strictEqual(socialFail.owner.getSnapshot().command?.packet, socialOriginal);
  assert.equal(socialFail.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(socialFail.owner.blocksMutations(), true);
  assert.equal(socialFail.keyCount, 1);
  assert.equal(socialFail.socialApplies.length, 0);
});

test('#522 P2: initial read failure retry seeds saved trainer fields; dirty draft on error is kept', async () => {
  let fail = true;
  const saved = dto(2);
  const s = setup({
    read: async () => {
      if (fail) throw new ProfileError('network');
      return saved;
    },
  });
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'error');
  assert.equal(s.owner.getSnapshot().draft.displayName, '');
  assert.equal(s.owner.getSnapshot().draft.bio, '');
  fail = false;
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Тренер Анна');
  assert.equal(s.owner.getSnapshot().draft.bio, 'Описание');

  // After a real draft exists, a later read failure must not wipe it on retry.
  s.owner.updateDraft({ displayName: 'Локально', bio: 'dirty' });
  fail = true;
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'error');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локально');
  fail = false;
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().status, 'ready');
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Локально');
  assert.equal(s.owner.getSnapshot().draft.bio, 'dirty');
});

test('#522 P2 R2: same-actor reauth restores pending trainer while profile-null composition stays locked', async () => {
  let recovered = false;
  let current: TrainerProfile | null = null;
  const s = setup({
    read: async () => current,
    send: async (packet) => {
      if (!recovered) throw new ProfileError('network');
      if (packet.kind === 'upsert') {
        const ack = Object.freeze({
          ...dto(1, 'active'),
          displayName: packet.body.displayName,
          bio: packet.body.bio,
        });
        current = ack;
        return ack;
      }
      return dto(2, 'inactive');
    },
  });
  await s.owner.load();
  s.owner.updateDraft({ displayName: 'Reauth hold', bio: 'keep' });
  await s.owner.save();
  const original = s.sent[0]!;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  // Same-actor reauth: ProfileCoordinator would reset profile=null; trainer pending must survive.
  s.owner.setActor({ ...actor, sessionId: 'reauth', generation: 2 });
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet.key, original.key);
  assert.equal(s.owner.getSnapshot().draft.displayName, 'Reauth hold');
  assert.equal(s.owner.blocksMutations(), true);
  // load refuses while command exists — recovery must not depend on profile becoming available.
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(s.owner.getSnapshot().command?.packet.key, original.key);
  assert.equal(s.keyCount, 1);
  recovered = true;
  await s.owner.reconcile();
  assert.equal(s.sent[1]!.key, original.key);
  assert.equal(s.sent[1]!.kind, original.kind);
  assert.equal(s.sent[1]!.actor.sessionId, 'reauth');
  assert.equal(s.sent[1]!.actor.generation, 2);
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.keyCount, 1);
});

test('#522 P2: editor completion navigation fenced to mounted+focused same editor+actor', () => {
  const editor = read('../src/components/trainer-profile-editor.tsx');
  assert.match(editor, /useFocusEffect/);
  assert.match(editor, /mounted\.current/);
  assert.match(editor, /focused\.current/);
  assert.match(editor, /sameActor/);
  assert.match(editor, /canCompleteNav/);
  // Both save and deactivate completion paths must fence before replace.
  const saveIdx = editor.indexOf('await owner.save()');
  const deactIdx = editor.indexOf('await owner.deactivate()');
  assert.ok(saveIdx >= 0 && deactIdx > saveIdx);
  const afterSave = editor.slice(saveIdx, deactIdx);
  assert.match(afterSave, /canCompleteNav\(origin\)/);
  assert.match(afterSave, /router\.replace\('\/profile'\)/);
  const afterDeact = editor.slice(deactIdx);
  assert.match(afterDeact, /canCompleteNav\(origin\)/);
  assert.match(afterDeact, /router\.replace\('\/profile'\)/);
  // Do not disable back / global nav as the recovery strategy.
  assert.doesNotMatch(editor, /usePreventRemove/);
  assert.doesNotMatch(editor, /BackHandler/);
});
