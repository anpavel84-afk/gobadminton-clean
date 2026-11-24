import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { Game } from '@gobadminton/contracts/game-types';
import { ParticipationError, type Actor, type ManagedGame } from '../src/participation.ts';
import {
  InvitationAuthoringCoordinator,
  invitationCreateWire,
  invitationEligibilityBlockReason,
  invitationEligibilityNotice,
  isGameOpenForInvitation,
  nextInvitationEligibilityBoundary,
  type InvitationCreatePacket,
} from '../src/invitation-authoring.ts';
import type { GameInvitation } from '../src/messages.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const actor: Actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const peer = 'peer-public-1';
const conversationId = 'dm-1';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function managed(partial: Partial<ManagedGame> & Pick<ManagedGame, 'id'>): ManagedGame {
  const starts = Date.parse(partial.startsAt ?? '2027-06-01T15:00:00.000Z');
  const base = {
    id: partial.id,
    version: partial.version ?? 3,
    title: partial.title ?? 'Evening doubles',
    status: partial.status ?? 'published',
    visibility: partial.visibility ?? 'public',
    organizer: { id: 'org', displayName: 'Host', publicContact: 'telegram:@h' },
    venue: { id: 'v', name: 'Court', address: 'Addr', cityId: 'city', timezone: 'Europe/Moscow' },
    startsAt: partial.startsAt ?? '2027-06-01T15:00:00.000Z',
    endsAt: partial.endsAt ?? new Date(starts + 7200000).toISOString(),
    applicationDeadlineAt: partial.applicationDeadlineAt ?? new Date(starts - 86400000).toISOString(),
    timezone: partial.timezone ?? 'Europe/Moscow',
    capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles',
    levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external' as const, purpose: 'no_trainer_fee' as const, priceMinor: null, currency: null, terms: 'Outside' },
    activityKind: 'regular' as const, trainingDescription: null, trainer: null,
    management: { role: 'owner' as const, createdByMe: true },
  };
  return { ...base, ...partial, management: partial.management ?? base.management } as ManagedGame;
}

function inviteReceipt(gameId: string, invitee = peer): GameInvitation {
  return {
    id: 'inv-1', gameId, status: 'pending', version: 1,
    inviterPublicPlayerId: 'public-a', inviteePublicPlayerId: invitee,
    expiresAt: null, participationId: null,
  };
}

function setup(overrides: {
  managed?: (cursor?: string) => Promise<{ items: ManagedGame[]; nextCursor: string | null }>;
  game?: (id: string) => Promise<Game>;
  send?: (packet: InvitationCreatePacket, authority: Actor) => Promise<GameInvitation>;
  held?: Set<string>;
  clock?: { now: number };
} = {}) {
  const sent: InvitationCreatePacket[] = [];
  let keys = 0;
  const held = overrides.held ?? new Set<string>();
  const clock = overrides.clock ?? { now: Date.parse('2026-11-24T10:00:00.000Z') };
  const games = [managed({ id: 'game-open' }), managed({ id: 'game-later', startsAt: '2027-07-01T15:00:00.000Z', applicationDeadlineAt: '2027-06-30T15:00:00.000Z', version: 2 })];
  const owner = new InvitationAuthoringCoordinator({
    managed: async cursor => overrides.managed ? overrides.managed(cursor) : ({ items: cursor ? [] : games, nextCursor: cursor ? null : 'c1' }),
    game: async id => {
      if (overrides.game) return overrides.game(id);
      const row = games.find(g => g.id === id) ?? managed({ id });
      return row;
    },
    send: async (packet, authority) => {
      sent.push(packet);
      if (overrides.send) return overrides.send(packet, authority);
      return inviteReceipt(packet.gameId, packet.peerId);
    },
    isPeerHeld: id => held.has(id),
  }, () => `invite-key-${++keys}xxxxxxxx`, () => clock.now);
  owner.setActor(actor);
  return { owner, sent, held, clock, get keyCount() { return keys; } };
}

test('eligibility helpers mirror accepted-web publish/start/deadline gates', () => {
  const now = Date.parse('2026-11-24T12:00:00.000Z');
  assert.equal(isGameOpenForInvitation({ status: 'published', startsAt: '2026-11-25T12:00:00.000Z', applicationDeadlineAt: '2026-11-24T18:00:00.000Z' }, now), true);
  assert.equal(invitationEligibilityBlockReason({ status: 'draft', startsAt: '2026-11-25T12:00:00.000Z', applicationDeadlineAt: '2026-11-24T18:00:00.000Z' }, now), 'unpublished');
  assert.equal(invitationEligibilityBlockReason({ status: 'published', startsAt: '2026-11-24T11:00:00.000Z', applicationDeadlineAt: '2026-11-24T10:00:00.000Z' }, now), 'started');
  assert.equal(invitationEligibilityBlockReason({ status: 'published', startsAt: '2026-11-25T12:00:00.000Z', applicationDeadlineAt: '2026-11-24T11:00:00.000Z' }, now), 'deadline');
  assert.equal(invitationEligibilityBlockReason({ status: 'published', startsAt: 'bad', applicationDeadlineAt: '2026-11-24T18:00:00.000Z' }, now), 'invalid');
  assert.match(invitationEligibilityNotice('deadline'), /закрыта/);
  assert.equal(nextInvitationEligibilityBoundary([
    { status: 'published', startsAt: '2026-11-25T12:00:00.000Z', applicationDeadlineAt: '2026-11-24T18:00:00.000Z' },
  ], now), Date.parse('2026-11-24T18:00:00.000Z') + 1);
  assert.deepEqual(invitationCreateWire({ inviteePublicPlayerId: peer, expectedGameVersion: 4 }), {
    inviteePublicPlayerId: peer, expectedGameVersion: 4,
  });
});

test('open→load→explicit invite with fresh version; cancel keeps draft surface clear; no auto-send', async () => {
  const s = setup();
  assert.equal(s.sent.length, 0);
  s.owner.open(conversationId, peer);
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().listStatus, 'ready');
  assert.equal(s.owner.getSnapshot().games.length, 2);
  assert.equal(s.owner.getSnapshot().nextCursor, 'c1');
  await s.owner.load(true);
  assert.equal(s.owner.getSnapshot().nextCursor, null);

  await s.owner.invite('game-open');
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.gameId, 'game-open');
  assert.equal(s.sent[0]!.peerId, peer);
  assert.equal(s.sent[0]!.conversationId, conversationId);
  assert.equal(s.sent[0]!.body.expectedGameVersion, 3);
  assert.equal(s.sent[0]!.body.inviteePublicPlayerId, peer);
  assert.equal(s.owner.getSnapshot().receipt?.id, 'inv-1');
  assert.equal(s.owner.getSnapshot().command, undefined);

  const taken = s.owner.takeReceiptForSurface(conversationId, peer);
  assert.equal(taken?.id, 'inv-1');
  assert.equal(s.owner.getSnapshot().receipt, null);

  s.owner.open(conversationId, peer);
  await s.owner.load();
  s.owner.close();
  assert.equal(s.owner.getSnapshot().surface, null);
  assert.equal(s.sent.length, 1);
});

test('safety-held peer cannot open/send; different peer ignores late receipt', async () => {
  const s = setup({ held: new Set([peer]) });
  s.owner.open(conversationId, peer);
  assert.match(s.owner.getSnapshot().notice ?? '', /недоступно/);
  assert.equal(s.owner.getSnapshot().surface, null);
  await s.owner.load();
  assert.equal(s.owner.getSnapshot().listStatus, 'idle');

  s.held.delete(peer);
  s.owner.open(conversationId, peer);
  await s.owner.load();
  s.held.add(peer);
  await s.owner.invite('game-open');
  assert.equal(s.sent.length, 0);
  assert.match(s.owner.getSnapshot().notice ?? '', /недоступно/);
});

test('interrupted GET/refresh and late receipt after surface close are ignored', async () => {
  const gate = deferred<Game>();
  const s = setup({
    game: async id => gate.promise.then(() => managed({ id, version: 9 })),
  });
  s.owner.open(conversationId, peer);
  await s.owner.load();
  const invite = s.owner.invite('game-open');
  s.owner.close();
  gate.resolve(managed({ id: 'game-open', version: 9 }));
  await invite;
  assert.equal(s.sent.length, 0);
  assert.equal(s.owner.getSnapshot().checking, false);
});

test('UNKNOWN exact retry same packet; terminal denial clears command; stale 409 refreshes without auto-resend', async () => {
  let phase: 'network' | 'stale' | 'ok' = 'network';
  const s = setup({
    send: async (packet) => {
      if (phase === 'network') throw new ParticipationError('network');
      if (phase === 'stale') throw new ParticipationError('business', 409, 'GAME_VERSION_CHANGED');
      return inviteReceipt(packet.gameId, packet.peerId);
    },
  });
  s.owner.open(conversationId, peer);
  await s.owner.load();
  await s.owner.invite('game-open');
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.sent.length, 1);
  const key = s.sent[0]!.key;
  const body = s.sent[0]!.body;

  phase = 'ok';
  await s.owner.retry();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1]!.key, key);
  assert.deepEqual(s.sent[1]!.body, body);
  assert.equal(s.owner.getSnapshot().receipt?.gameId, 'game-open');

  phase = 'stale';
  s.owner.open(conversationId, peer);
  await s.owner.load();
  await s.owner.invite('game-open');
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.match(s.owner.getSnapshot().notice ?? '', /изменилась/);
  assert.equal(s.sent.length, 3);
});

test('same-actor remount restores UNKNOWN; different actor clears private packet', async () => {
  const s = setup({
    send: async () => { throw new ParticipationError('network'); },
  });
  s.owner.open(conversationId, peer);
  await s.owner.load();
  await s.owner.invite('game-open');
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  const packet = s.owner.getSnapshot().command!.packet;

  s.owner.setActor({ actorId: 'A', sessionId: 'session-A', generation: 2 });
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(s.owner.getSnapshot().command?.packet.key, packet.key);
  assert.equal(s.owner.getSnapshot().command?.packet.actor.generation, 2);

  s.owner.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().games.length, 0);
  s.owner.forget();
  assert.equal(s.owner.getSnapshot().actor, null);
});

test('#522 APK45 source wiring: DM chooser, create opt-in, counter 45', () => {
  const authoring = read('../src/invitation-authoring.ts');
  assert.match(authoring, /InvitationAuthoringCoordinator/);
  assert.match(authoring, /isGameOpenForInvitation/);
  assert.match(authoring, /invitationCreateWire/);

  const chooser = read('../src/components/invitation-chooser.tsx');
  assert.match(chooser, /Пригласить на игру/);
  assert.match(chooser, /Приглашение не резервирует место/);
  assert.match(chooser, /Отправить приглашение/);
  assert.match(chooser, /Нет предстоящих игр, открытых для приглашений/);
  assert.match(chooser, /nativeAuth\.invitationAuthoring/);
  assert.match(chooser, /\+ Создать новую игру/);

  const messages = read('../src/components/messages.tsx');
  assert.match(messages, /InvitationChooser/);
  assert.match(messages, /Пригласить на игру/);
  assert.match(messages, /canInvite/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /InvitationAuthoringCoordinator/);
  assert.match(auth, /this\.invitationAuthoring\.setActor/);
  assert.match(auth, /this\.invitationAuthoring\.forget/);
  assert.match(auth, /createInvitation/);

  const api = read('../src/native-api.ts');
  assert.match(api, /createInvitation/);
  assert.match(api, /invitationCreateWire/);

  const controller = read('../../api/src/invitations/invitations.controller.ts');
  const createBlock = controller.slice(controller.indexOf('async create('), controller.indexOf('async listForGame('));
  assert.match(createBlock, /requirePrincipalMutation\(request\)/);
  assert.doesNotMatch(createBlock, /requireCookieMutation\(request\)/);
  assert.match(controller, /Outgoing GET game invitations and revoke remain cookie-only/);
  assert.match(controller, /async revoke\([\s\S]*requireCookieMutation\(request\)/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 45);
});
