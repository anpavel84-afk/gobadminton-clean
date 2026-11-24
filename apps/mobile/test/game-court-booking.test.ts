import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticipationError, type Actor, type ManagedGame } from '../src/participation.ts';
import { createNativeApi } from '../src/native-api.ts';
import {
  COURT_BOOKING_DISCLAIMER, COURT_BOOKING_LABELS, COURT_BOOKING_STATUSES,
  GameCourtBookingCoordinator, canSaveCourtBooking, courtBookingWire, parseGameCourtBooking,
  type CourtBookingPacket, type CourtBookingRenderedPermit, type GameCourtBooking,
} from '../src/game-court-booking.ts';
import type { Participation } from '@gobadminton/contracts/game-types';

const actor: Actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const gameId = '10000000-0000-4000-8000-000000000010';
const otherGame = '10000000-0000-4000-8000-000000000011';

function booking(partial: Partial<GameCourtBooking> & { canUpdate?: boolean } = {}): GameCourtBooking {
  const canUpdate = partial.canUpdate ?? partial.allowedActions?.canUpdate ?? true;
  const { canUpdate: _c, allowedActions: _a, ...rest } = partial;
  return Object.freeze({
    gameId,
    status: 'unspecified' as const,
    version: 0,
    updatedAt: null,
    declarationSource: 'organizer_declared' as const,
    ...rest,
    allowedActions: Object.freeze({ canUpdate }),
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(overrides: {
  parts?: Participation[] | null;
  managed?: ManagedGame[];
  managedPages?: Array<{ items: ManagedGame[]; nextCursor: string | null }>;
  membership?: boolean | null;
  read?: () => Promise<GameCourtBooking>;
  send?: (packet: CourtBookingPacket, authority: Actor, permit: () => boolean) => Promise<GameCourtBooking>;
  managedFail?: boolean;
} = {}) {
  const sent: CourtBookingPacket[] = [];
  const reads: string[] = [];
  const managedCalls: Array<{ cursor: string | undefined; permitted: boolean }> = [];
  let keys = 0;
  let stored = booking();
  let parts: Participation[] | null = overrides.parts === undefined ? [] : overrides.parts;
  let membership: boolean | null = overrides.membership === undefined ? true : overrides.membership;
  let pageIndex = 0;
  const owner = new GameCourtBookingCoordinator({
    detailParts: () => parts,
    managedMembership: () => membership,
    managed: async (cursor, permit) => {
      const permitted = permit();
      managedCalls.push({ cursor, permitted });
      if (!permitted) throw new ParticipationError('stale');
      if (overrides.managedFail) throw new ParticipationError('network');
      if (overrides.managedPages) {
        const page = overrides.managedPages[pageIndex] ?? { items: [], nextCursor: null };
        pageIndex++;
        return page;
      }
      return { items: overrides.managed ?? [], nextCursor: null };
    },
    read: async (id, permit) => {
      if (!permit()) throw new ParticipationError('stale');
      reads.push(id);
      if (overrides.read) return overrides.read();
      return parseGameCourtBooking({ ...stored, gameId: id }, id);
    },
    send: async (packet, authority, permit) => {
      sent.push(packet);
      if (!permit()) throw new ParticipationError('stale');
      if (overrides.send) return overrides.send(packet, authority, permit);
      if (packet.body.expectedVersion !== stored.version) {
        throw new ParticipationError('business', 409, 'VERSION_CONFLICT');
      }
      stored = booking({
        gameId: packet.gameId,
        status: packet.body.status,
        version: stored.version + 1,
        updatedAt: '2026-11-24T12:00:00.000Z',
        canUpdate: true,
      });
      return stored;
    },
  }, () => `court-key-${++keys}xxxxxxxx`);
  owner.setActor(actor);
  return {
    owner, sent, reads, managedCalls,
    setParts: (value: Participation[] | null) => { parts = value; },
    setMembership: (value: boolean | null) => { membership = value; },
    setStored: (value: GameCourtBooking) => { stored = value; },
    get keyCount() { return keys; },
  };
}

function capturePermit(owner: GameCourtBookingCoordinator): CourtBookingRenderedPermit {
  const permit = owner.renderedPermit();
  assert.ok(permit);
  return permit!;
}

test('dto/helpers: four statuses, disclaimer, canUpdate gates save', () => {
  assert.deepEqual([...COURT_BOOKING_STATUSES], ['unspecified', 'arranging', 'organizer_confirmed', 'not_arranged']);
  assert.equal(COURT_BOOKING_DISCLAIMER, 'Со слов организатора. Приложение не проверяет бронь.');
  assert.match(COURT_BOOKING_LABELS.arranging, /Договариваемся/);
  assert.deepEqual(courtBookingWire({ expectedVersion: 2, status: 'arranging' }), {
    expectedVersion: 2, status: 'arranging',
  });
  assert.equal(canSaveCourtBooking('arranging', booking({ status: 'unspecified', canUpdate: true })), true);
  assert.equal(canSaveCourtBooking('unspecified', booking({ status: 'unspecified', canUpdate: true })), false);
  assert.equal(canSaveCourtBooking('arranging', booking({ status: 'unspecified', canUpdate: false })), false);
  assert.throws(() => parseGameCourtBooking({ gameId, status: 'provider_confirmed', version: 0, updatedAt: null, declarationSource: 'organizer_declared', allowedActions: { canUpdate: true } }));
  assert.throws(() => parseGameCourtBooking({ ...booking(), gameId: otherGame }, gameId));
});

test('manager edit vs participant readonly; denied/failed eligibility skips private GET', async () => {
  const manager = setup({ managed: [{ id: gameId } as ManagedGame] });
  manager.setParts([]);
  manager.owner.focus(gameId, 'managed');
  await manager.owner.load();
  assert.equal(manager.reads.length, 1);
  assert.equal(manager.owner.getSnapshot().booking?.allowedActions.canUpdate, true);
  manager.owner.updateDraft('arranging');
  await manager.owner.save();
  assert.equal(manager.sent.length, 1);
  assert.equal(manager.owner.getSnapshot().booking?.status, 'arranging');

  const participant = setup({
    parts: [{ id: 'p1', gameId, userId: 'A', status: 'confirmed', version: 1, attemptNumber: 1, requestedAt: '2026-01-01T00:00:00.000Z' }],
    read: async () => booking({ canUpdate: false, status: 'arranging', version: 1 }),
  });
  participant.owner.focus(gameId, 'detail');
  await participant.owner.load();
  assert.equal(participant.reads.length, 1);
  assert.equal(participant.owner.getSnapshot().booking?.allowedActions.canUpdate, false);
  participant.owner.updateDraft('not_arranged');
  await participant.owner.save();
  assert.equal(participant.sent.length, 0);

  const denied = setup({ parts: [], managed: [], membership: false });
  denied.owner.focus(gameId, 'detail');
  await denied.owner.load();
  assert.equal(denied.reads.length, 0);
  assert.equal(denied.owner.getSnapshot().status, 'denied');

  const failed = setup({ parts: [], managedFail: true });
  failed.owner.focus(gameId, 'detail');
  await failed.owner.load();
  assert.equal(failed.reads.length, 0);
  assert.equal(failed.owner.getSnapshot().status, 'error');
});

test('versioned save, duplicate-tap lock, stale 409, UNKNOWN exact retry across route changes', async () => {
  const s = setup({ managed: [{ id: gameId } as ManagedGame] });
  s.owner.focus(gameId, 'managed');
  await s.owner.load();
  s.owner.updateDraft('arranging');
  const first = s.owner.save();
  const second = s.owner.save();
  await Promise.all([first, second]);
  assert.equal(s.sent.length, 1);
  assert.equal(s.owner.getSnapshot().booking?.version, 1);

  s.setStored(booking({ version: 5, status: 'arranging', canUpdate: true }));
  s.owner.updateDraft('organizer_confirmed');
  await s.owner.save();
  assert.equal(s.owner.getSnapshot().status, 'stale');
  assert.equal(s.owner.getSnapshot().command, undefined);
  s.owner.updateDraft('not_arranged');
  assert.equal(s.owner.getSnapshot().draft, 'organizer_confirmed');

  let recovered = false;
  const unknown = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: async (packet) => {
      if (!recovered) throw new ParticipationError('network');
      return booking({ gameId: packet.gameId, status: packet.body.status, version: packet.body.expectedVersion + 1, canUpdate: true });
    },
  });
  unknown.owner.focus(gameId, 'managed');
  await unknown.owner.load();
  unknown.owner.updateDraft('arranging');
  await unknown.owner.save();
  const original = unknown.sent[0]!;
  assert.equal(unknown.owner.getSnapshot().command?.status, 'unknown');
  const release = unknown.owner.focus(gameId, 'managed');
  assert.equal(unknown.owner.getSnapshot().command?.packet.key, original.key);
  release();
  unknown.owner.focus(gameId, 'managed');
  recovered = true;
  await unknown.owner.reconcile();
  assert.strictEqual(unknown.sent[1], original);
  assert.equal(unknown.owner.getSnapshot().command, undefined);
  assert.equal(unknown.owner.getSnapshot().booking?.status, 'arranging');
});

test('delayed responses after game/actor/focus/foreground changes do not repaint or dispatch', async () => {
  const gate = deferred<GameCourtBooking>();
  const late = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: () => gate.promise,
  });
  late.owner.focus(gameId, 'managed');
  await late.owner.load();
  late.owner.updateDraft('arranging');
  const work = late.owner.save();
  const packet = late.sent[0]!;
  late.owner.focus(otherGame, 'managed');
  gate.resolve(booking({ gameId, status: 'arranging', version: 1, canUpdate: true }));
  await work;
  assert.equal(late.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(late.owner.getSnapshot().command?.packet.key, packet.key);
  assert.notEqual(late.owner.getSnapshot().focus?.gameId, gameId);

  const bg = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: async () => { throw new ParticipationError('network'); },
  });
  bg.owner.focus(gameId, 'managed');
  await bg.owner.load();
  bg.owner.updateDraft('arranging');
  await bg.owner.save();
  bg.owner.setForeground(false);
  await bg.owner.reconcile();
  assert.equal(bg.sent.length, 1);

  const actorFence = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: async () => { throw new ParticipationError('network'); },
  });
  actorFence.owner.focus(gameId, 'managed');
  await actorFence.owner.load();
  actorFence.owner.updateDraft('arranging');
  await actorFence.owner.save();
  actorFence.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 1 });
  assert.equal(actorFence.owner.getSnapshot().command, undefined);
  actorFence.owner.forget();
  assert.equal(actorFence.owner.getSnapshot().actor, null);
});

test('native transport: exact GET/PUT URL, bearer/no cookies, immutable payload/key, parser rejection', async () => {
  const wires: { path: string; method: string; body?: unknown; key?: string; auth?: string; credentials?: RequestCredentials }[] = [];
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
      credentials: init?.credentials,
    });
    if (path === `/games/${gameId}/court-booking` && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(booking()), { status: 200 });
    }
    if (path === `/games/${gameId}/court-booking` && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { expectedVersion: number; status: string };
      return new Response(JSON.stringify(booking({
        status: body.status as GameCourtBooking['status'],
        version: body.expectedVersion + 1,
        updatedAt: '2026-11-24T12:00:00.000Z',
      })), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  });
  assert.deepEqual(await api.gameCourtBooking('access-token', gameId), booking());
  assert.equal(wires[0]!.method, 'GET');
  assert.equal(wires[0]!.path, `/games/${gameId}/court-booking`);
  assert.equal(wires[0]!.auth, 'Bearer access-token');
  assert.equal(wires[0]!.key, undefined);
  assert.equal(wires[0]!.credentials, 'omit');

  const packet: CourtBookingPacket = Object.freeze({
    actor: Object.freeze({ ...actor }),
    key: 'court-key-16chars!',
    gameId,
    body: Object.freeze({ expectedVersion: 0, status: 'arranging' as const }),
  });
  const saved = await api.mutateGameCourtBooking('access-token', packet);
  assert.equal(saved.version, 1);
  assert.equal(wires[1]!.method, 'PUT');
  assert.equal(wires[1]!.path, `/games/${gameId}/court-booking`);
  assert.deepEqual(wires[1]!.body, { expectedVersion: 0, status: 'arranging' });
  assert.equal(wires[1]!.key, 'court-key-16chars!');
  assert.equal(wires[1]!.auth, 'Bearer access-token');
  assert.equal(wires[1]!.credentials, 'omit');

  const bad = createNativeApi(async () => new Response(JSON.stringify({
    gameId, status: 'arranging', version: 1, updatedAt: null,
    declarationSource: 'provider', allowedActions: { canUpdate: true },
  }), { status: 200 }));
  await assert.rejects(() => bad.gameCourtBooking('access-token', gameId));
});

test('focus/foreground ABA: covered lease, captured callbacks, loading recovery, delayed PUT', async () => {
  // Covered/unfocused lease: old release cannot retire a newer focus; unfocused screen does not read.
  const covered = setup({ managed: [{ id: gameId } as ManagedGame] });
  const releaseA = covered.owner.focus(gameId, 'managed');
  const viewA = covered.owner.getSnapshot().focus!.viewGen;
  await covered.owner.load();
  assert.equal(covered.reads.length, 1);
  const releaseB = covered.owner.focus(otherGame, 'managed');
  const viewB = covered.owner.getSnapshot().focus!.viewGen;
  assert.notEqual(viewA, viewB);
  releaseA();
  assert.equal(covered.owner.getSnapshot().focus?.viewGen, viewB);
  assert.equal(covered.owner.getSnapshot().focus?.gameId, otherGame);
  const readsAfterUnfocus = covered.reads.length;
  await covered.owner.load();
  // otherGame still focused — load may read; release B then no further reads from stale A permit.
  releaseB();
  const stalePermit: CourtBookingRenderedPermit = Object.freeze({
    actor: Object.freeze({ ...actor }),
    gameId,
    viewGen: viewA,
    foregroundGen: covered.owner.getSnapshot().foregroundGen,
  });
  await covered.owner.load(stalePermit);
  covered.owner.updateDraft('arranging', stalePermit);
  await covered.owner.save(stalePermit);
  assert.equal(covered.sent.length, 0);
  assert.equal(covered.reads.length, readsAfterUnfocus + 1);

  // Captured callback A after A→B→A / foreground return: no draft/POST on old permit.
  const aba = setup({ managed: [{ id: gameId } as ManagedGame] });
  aba.owner.focus(gameId, 'managed');
  await aba.owner.load();
  const permitA1 = capturePermit(aba.owner);
  aba.owner.focus(otherGame, 'managed');
  aba.owner.focus(gameId, 'managed');
  await aba.owner.load();
  assert.equal(aba.owner.getSnapshot().focus?.viewGen !== permitA1.viewGen, true);
  aba.owner.updateDraft('arranging', permitA1);
  assert.equal(aba.owner.getSnapshot().draft, 'unspecified');
  await aba.owner.save(permitA1);
  assert.equal(aba.sent.length, 0);

  // Background during GET then return recovers with a fresh read (not stuck loading).
  const gateGet = deferred<GameCourtBooking>();
  const recover = setup({
    managed: [{ id: gameId } as ManagedGame],
    read: () => gateGet.promise,
  });
  recover.owner.focus(gameId, 'managed');
  const loading = recover.owner.load();
  assert.equal(recover.owner.getSnapshot().status, 'loading');
  recover.owner.setForeground(false);
  assert.equal(recover.owner.getSnapshot().status, 'idle');
  assert.equal(recover.owner.getSnapshot().booking, null);
  gateGet.resolve(booking());
  await loading;
  assert.equal(recover.owner.getSnapshot().status, 'idle');
  assert.equal(recover.owner.getSnapshot().booking, null);
  const readsBeforeReturn = recover.reads.length;
  recover.owner.setForeground(true);
  await new Promise(r => setImmediate(r));
  assert.ok(recover.reads.length > readsBeforeReturn);
  assert.equal(recover.owner.getSnapshot().status, 'ready');

  // Delayed PUT ack across focus/foreground ABA never settles a new view; retires to UNKNOWN.
  const gatePut = deferred<GameCourtBooking>();
  const putAba = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: () => gatePut.promise,
  });
  putAba.owner.focus(gameId, 'managed');
  await putAba.owner.load();
  putAba.owner.updateDraft('arranging');
  const putWork = putAba.owner.save();
  const putPacket = putAba.sent[0]!;
  putAba.owner.setForeground(false);
  assert.equal(putAba.owner.getSnapshot().command?.status, 'unknown');
  putAba.owner.setForeground(true);
  putAba.owner.focus(gameId, 'managed');
  gatePut.resolve(booking({ status: 'arranging', version: 1 }));
  await putWork;
  assert.equal(putAba.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(putAba.owner.getSnapshot().command?.packet.key, putPacket.key);
  assert.notEqual(putAba.owner.getSnapshot().booking?.status, 'arranging');
});

test('pagination cursor bound, denied refresh clears private, exact UNKNOWN survives return', async () => {
  // Cyclic empty cursor pages stay bounded; error is not false-proof of absence.
  const cyclic = setup({
    parts: [],
    managedPages: [
      { items: [], nextCursor: 'c1' },
      { items: [], nextCursor: 'c1' },
    ],
  });
  cyclic.owner.focus(gameId, 'detail');
  await cyclic.owner.load();
  assert.equal(cyclic.reads.length, 0);
  assert.equal(cyclic.owner.getSnapshot().status, 'denied');
  assert.ok(cyclic.managedCalls.length <= 3);

  // Denied refreshAuthoritative clears private booking/editing (no stale retain).
  let denyNext = false;
  const refreshDenied = setup({
    managed: [{ id: gameId } as ManagedGame],
    read: async () => {
      if (denyNext) throw new ParticipationError('business', 401, 'UNAUTHORIZED');
      return booking({ status: 'arranging', version: 1, canUpdate: true });
    },
  });
  refreshDenied.owner.focus(gameId, 'managed');
  await refreshDenied.owner.load();
  refreshDenied.owner.updateDraft('not_arranged');
  refreshDenied.setStored(booking({ version: 9, status: 'arranging', canUpdate: true }));
  await refreshDenied.owner.save();
  assert.equal(refreshDenied.owner.getSnapshot().status, 'stale');
  denyNext = true;
  await refreshDenied.owner.refreshAuthoritative();
  assert.equal(refreshDenied.owner.getSnapshot().status, 'denied');
  assert.equal(refreshDenied.owner.getSnapshot().booking, null);
  assert.equal(refreshDenied.owner.getSnapshot().draft, 'unspecified');

  // Permission-denial PUT clears stale editing; UNKNOWN packet retained separately.
  const putDenied = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: async () => { throw new ParticipationError('business', 403, 'FORBIDDEN'); },
  });
  putDenied.owner.focus(gameId, 'managed');
  await putDenied.owner.load();
  putDenied.owner.updateDraft('arranging');
  await putDenied.owner.save();
  assert.equal(putDenied.owner.getSnapshot().status, 'denied');
  assert.equal(putDenied.owner.getSnapshot().booking, null);
  assert.equal(putDenied.owner.getSnapshot().command, undefined);

  // Exact UNKNOWN same packet after background return — no auto-retry.
  let fail = true;
  const unk = setup({
    managed: [{ id: gameId } as ManagedGame],
    send: async (packet) => {
      if (fail) throw new ParticipationError('network');
      return booking({ status: packet.body.status, version: packet.body.expectedVersion + 1 });
    },
  });
  unk.owner.focus(gameId, 'managed');
  await unk.owner.load();
  unk.owner.updateDraft('arranging');
  await unk.owner.save();
  const exact = unk.owner.getSnapshot().command!.packet;
  assert.equal(unk.owner.getSnapshot().command?.status, 'unknown');
  unk.owner.setForeground(false);
  unk.owner.setForeground(true);
  assert.equal(unk.owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(unk.owner.getSnapshot().command?.packet, exact);
  assert.equal(unk.sent.length, 1);
  fail = false;
  await unk.owner.reconcile();
  assert.strictEqual(unk.sent[1], exact);
});

test('managed membership pending/false; stale 409 refresh rechecks eligibility before reuse', async () => {
  const pending = setup({ membership: null });
  pending.owner.focus(gameId, 'managed');
  await pending.owner.load();
  assert.equal(pending.reads.length, 0);
  assert.equal(pending.owner.getSnapshot().status, 'idle');

  const revoked = setup({ membership: false });
  revoked.owner.focus(gameId, 'managed');
  await revoked.owner.load();
  assert.equal(revoked.reads.length, 0);
  assert.equal(revoked.owner.getSnapshot().status, 'denied');

  const recheck = setup({ membership: true });
  recheck.owner.focus(gameId, 'managed');
  await recheck.owner.load();
  recheck.owner.updateDraft('arranging');
  recheck.setStored(booking({ version: 5, status: 'unspecified', canUpdate: true }));
  await recheck.owner.save();
  assert.equal(recheck.owner.getSnapshot().status, 'stale');
  assert.equal(recheck.sent.length, 1);
  recheck.setMembership(false);
  await recheck.owner.refreshAuthoritative();
  assert.equal(recheck.owner.getSnapshot().status, 'denied');
  assert.equal(recheck.owner.getSnapshot().booking, null);
  await recheck.owner.save();
  assert.equal(recheck.sent.length, 1);
});
