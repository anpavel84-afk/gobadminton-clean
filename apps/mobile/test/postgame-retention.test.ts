import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthCoordinator } from '../src/auth-coordinator.ts';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError } from '../src/postgame.ts';
import { SECURE_AUTH_KEY } from '../src/native-auth-protocol.ts';
import {
  POSTGAME_IDEMPOTENCY_TTL_MS,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
  VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS,
  postgameIdempotencyReplayBlocked,
} from '../src/venue-reviews.ts';

const gameId = '11111111-1111-4111-8111-111111111111';
const venueId = '22222222-2222-4222-8222-222222222222';
const handle = 'a'.repeat(32);
const actor = {
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  generation: 1,
};
const date = '2026-11-14T10:00:00.000Z';

const tick = () => new Promise(r => setImmediate(r));

assert.equal(POSTGAME_IDEMPOTENCY_TTL_MS, VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS);

function controllableClock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    set: (value: number) => { now = value; },
    advance: (ms: number) => { now += ms; },
  };
}

function idlePort(overrides: Partial<ConstructorParameters<typeof PostgameCoordinator>[0]> = {}) {
  return {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], writesEnabled: true, installed: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => ({
      gameId,
      outcome: { value: 'held' as const, version: 1, reason: null, provenance: null },
      allowedActions: { canRecordOutcome: true },
      attendance: {
        installed: true,
        writesEnabled: true,
        myAttendance: {
          contextId: 'context-a',
          value: 'present' as const,
          version: 1,
          late: false,
          assertion: { actorDisplay: 'Org', source: 'manager_explicit' as const, at: date },
          acknowledgedVersion: null,
          dispute: null,
          displayName: 'Игрок',
          allowedActions: {
            canSetAttendance: true,
            canAcknowledge: true,
            canDispute: true,
            canWithdrawDispute: false,
            canRespondDispute: false,
            canRequestHelp: false,
          },
        },
        roster: null,
        rosterNextCursor: null,
        summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
        allowedActions: { canRecordAttendance: true, canBulkPresent: false },
      },
    }),
    send: async () => { throw new PostgameError('network', 503); },
    publicEligibility: async () => ({
      roleHandle: handle,
      role: 'organization',
      bases: [{
        gameId,
        role: 'organization',
        endsAt: date,
        proofVersion: 2,
        outcomeVersion: 1,
        attendanceVersion: 1,
        projectionHashPreview: null,
        admission: 'may_submit',
        reason: null,
      }],
    }),
    publicConsentPreview: async () => ({
      consentProjectionHash: 'c'.repeat(64),
    }),
    publicOwnReviews: async () => ({
      items: [{
        id: '44444444-4444-4444-8444-444444444444',
        reviewHandle: 'c'.repeat(32),
        role: 'organization' as const,
        roleHandle: handle,
        subjectDisplayName: 'Org',
        status: 'submitted',
        version: 2,
        text: 'Текст',
        topics: ['agreements'],
        receiptToken: 'r',
        pendingIntakeStatus: 'waiting_intake' as const,
        approvedRevision: null,
        pendingRevision: 1,
      }],
    }),
    venueExperienceEligibility: async () => ({
      bases: [{
        gameId,
        gameTitle: 'Practice',
        admission: 'may_submit',
        reason: null,
        outcomeVersion: 1,
        attendanceVersion: 2,
        firstEligibleAt: date,
        helpHint: null,
      }],
    }),
    venueExperienceConsentPreview: async () => ({
      consentProjectionHash: 'f'.repeat(64),
      authorLabel: 'Участник игры',
    }),
    ...overrides,
  };
}

test('helper fail-closed: missing/invalid/backwards/boundary/after; within TTL open', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(postgameIdempotencyReplayBlocked(undefined, t0), true);
  assert.equal(postgameIdempotencyReplayBlocked(Number.NaN, t0), true);
  assert.equal(postgameIdempotencyReplayBlocked(t0 + 1, t0), true);
  assert.equal(postgameIdempotencyReplayBlocked(t0, t0 + POSTGAME_IDEMPOTENCY_TTL_MS - 1), false);
  assert.equal(postgameIdempotencyReplayBlocked(t0, t0 + POSTGAME_IDEMPOTENCY_TTL_MS), true);
  assert.equal(postgameIdempotencyReplayBlocked(t0, t0 + POSTGAME_IDEMPOTENCY_TTL_MS + 1), true);
});

test('private UNKNOWN: age stamped once; TTL-1 may retry; boundary/after/missing hold; retry does not extend', async () => {
  const clock = controllableClock();
  const realNow = Date.now;
  Date.now = clock.now;
  const sent: Array<{ key: string; kind: string }> = [];
  let mode: 'unknown' | 'ok' | 'late' = 'unknown';
  try {
    const owner = new PostgameCoordinator({
      ...idlePort({
        send: async (packet) => {
          sent.push({ key: packet.key, kind: packet.kind });
          if (mode === 'unknown') throw new PostgameError('network', 503);
          if (mode === 'late') {
            await new Promise(r => setTimeout(r, 5));
            throw new PostgameError('network', 503);
          }
          return {
            contextId: 'context-a',
            value: 'present',
            version: 1,
            late: false,
            assertion: { actorDisplay: 'Org', source: 'manager_explicit', at: date },
            acknowledgedVersion: 1,
            dispute: null,
            displayName: 'Игрок',
            allowedActions: {
              canSetAttendance: true,
              canAcknowledge: false,
              canDispute: true,
              canWithdrawDispute: false,
              canRespondDispute: false,
              canRequestHelp: false,
            },
          };
        },
      }),
    }, () => `priv-${sent.length + 1}`);

    owner.setActor(actor);
    await owner.loadResults(gameId);
    await tick();
    owner.review({
      kind: 'ack',
      gameId,
      contextId: 'context-a',
      body: { attendanceVersion: 1 },
    });
    await owner.confirm();
    await tick();
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    const age = owner.getSnapshot().command!.firstDispatchedAt;
    assert.equal(typeof age, 'number');
    const key = owner.getSnapshot().command!.packet.key;
    assert.equal(sent.length, 1);

    clock.advance(POSTGAME_IDEMPOTENCY_TTL_MS - 1);
    mode = 'unknown';
    await owner.reconcile(gameId);
    await tick();
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.key, key);
    assert.equal(owner.getSnapshot().command!.firstDispatchedAt, age);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');

    clock.advance(1);
    const beforeBoundary = sent.length;
    await owner.reconcile(gameId);
    assert.equal(sent.length, beforeBoundary);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().command!.firstDispatchedAt, age);
    assert.equal(owner.getSnapshot().notice, POSTGAME_RETENTION_EXPIRED_NOTICE);

    clock.advance(1);
    await owner.reconcile(gameId);
    assert.equal(sent.length, beforeBoundary);
    assert.equal(owner.getSnapshot().command!.packet.key, key);

    // Same-actor reauth / surface read must not reset age or autosend.
    const ageBeforeReauth = owner.getSnapshot().command!.firstDispatchedAt;
    owner.setActor(null);
    owner.setActor({ ...actor, generation: 2 });
    await tick();
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().command!.firstDispatchedAt, ageBeforeReauth);
    assert.equal(sent.length, beforeBoundary);

    // Missing age fail-closed.
    delete (owner.getSnapshot().command as { firstDispatchedAt?: number }).firstDispatchedAt;
    await owner.reconcile(gameId);
    assert.equal(sent.length, beforeBoundary);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
  } finally {
    Date.now = realNow;
  }
});

test('public withdraw UNKNOWN: TTL-1 original packet; after TTL no POST; no key rotation', async () => {
  const clock = controllableClock();
  const realNow = Date.now;
  Date.now = clock.now;
  const keys: string[] = [];
  const mode: 'unknown' | 'ok' = 'unknown';
  const item = {
    id: '44444444-4444-4444-8444-444444444444',
    reviewHandle: 'c'.repeat(32),
    role: 'organization' as const,
    roleHandle: handle,
    subjectDisplayName: 'Org',
    status: 'submitted',
    version: 2,
    text: 'Текст',
    topics: ['agreements' as const],
    receiptToken: 'r',
    pendingIntakeStatus: 'waiting_intake' as const,
    approvedRevision: null,
    pendingRevision: 1,
  };
  try {
    const owner = new PostgameCoordinator({
      ...idlePort({
        publicOwnReviews: async () => ({ items: [item] }),
        send: async (packet) => {
          keys.push(packet.key);
          if (mode === 'unknown') throw new PostgameError('network', 503);
          return {
            id: item.id,
            reviewHandle: item.reviewHandle,
            version: 3,
            status: 'withdrawn',
            receiptToken: 'withdraw-receipt',
            pendingIntakeStatus: 'waiting_intake',
          };
        },
      }),
    }, () => `pub-${keys.length + 1}`);

    owner.setActor(actor);
    owner.openOwnPublicHistory();
    await tick();
    await owner.withdrawOwnPublic(item, actor, owner.getSnapshot().publicSurface!.gen);
    await tick();
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().command?.packet.kind, 'public-role-command');
    const age = owner.getSnapshot().command!.firstDispatchedAt;
    const key = owner.getSnapshot().command!.packet.key;
    assert.equal(typeof age, 'number');
    assert.equal(keys.length, 1);

    clock.advance(POSTGAME_IDEMPOTENCY_TTL_MS - 1);
    await owner.reconcilePublic();
    await tick();
    assert.equal(keys.length, 2);
    assert.equal(keys[1], key);
    assert.equal(owner.getSnapshot().command!.firstDispatchedAt, age);

    clock.advance(2);
    await owner.reconcilePublic();
    assert.equal(keys.length, 2);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().publicNotice, POSTGAME_RETENTION_EXPIRED_NOTICE);
    assert.equal(owner.getSnapshot().command!.packet.key, key);
  } finally {
    Date.now = realNow;
  }
});

test('auth-adapter local retention: deferred token after TTL keeps UNKNOWN + expired notice; no wire metadata', async () => {
  const clock = controllableClock();
  const realNow = Date.now;
  Date.now = clock.now;
  const sent: string[] = [];
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>(r => { releaseToken = r; });
  try {
    const owner = new PostgameCoordinator({
      ...idlePort({
        send: async (packet) => {
          // Simulate AuthCoordinator: capture permit, await token, recheck age, then API.
          const permit = owner.dispatchPermit(packet);
          await tokenGate;
          if (!owner.mayDispatchRetention(packet, permit)) {
            throw new PostgameError(
              'network',
              503,
              owner.retentionExpiredFor(packet) ? 'POSTGAME_RETENTION_EXPIRED' : 'POSTGAME_DISPATCH_STALE',
            );
          }
          sent.push(packet.key);
          throw new PostgameError('network', 503);
        },
      }),
    }, () => `ret-${sent.length + 1}`);

    owner.setActor(actor);
    await owner.loadResults(gameId);
    await tick();
    owner.review({
      kind: 'ack',
      gameId,
      contextId: 'context-a',
      body: { attendanceVersion: 1 },
    });
    const first = owner.confirm();
    await tick();
    assert.equal(owner.getSnapshot().command?.status, 'sending');
    const key = owner.getSnapshot().command!.packet.key;
    const age = owner.getSnapshot().command!.firstDispatchedAt!;
    clock.set(age + POSTGAME_IDEMPOTENCY_TTL_MS);
    releaseToken();
    await first;
    await tick();
    assert.equal(sent.length, 0);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    assert.equal(owner.getSnapshot().command!.packet.key, key);
    assert.equal(owner.getSnapshot().command!.firstDispatchedAt, age);
    assert.equal(owner.getSnapshot().notice, POSTGAME_RETENTION_EXPIRED_NOTICE);
  } finally {
    Date.now = realNow;
  }
});

test('venue create UNKNOWN: same journal fence; missing/backwards hold; legitimate fresh create still allowed after settle', async () => {
  const clock = controllableClock();
  const realNow = Date.now;
  Date.now = clock.now;
  const keys: string[] = [];
  let mode: 'unknown' | 'ok' = 'unknown';
  try {
    const owner = new PostgameCoordinator({
      ...idlePort({
        send: async (packet) => {
          keys.push(packet.key);
          if (mode === 'unknown') throw new PostgameError('network', 503);
          return {
            id: '55555555-5555-4555-8555-555555555555',
            version: 1,
            status: 'self_draft',
            reviewHandle: 'd'.repeat(32),
            receiptToken: null,
            publicVisible: false,
            notBefore: null,
          };
        },
      }),
    }, () => `ven-${keys.length + 1}`);

    owner.setActor(actor);
    owner.openVenueExperience(gameId, venueId);
    await tick();
    owner.patchVenueDraft({ audience: 'self_draft', text: 'Опыт покрытия', topics: ['surface'] });
    await owner.submitVenueExperience();
    await tick();
    assert.equal(owner.getSnapshot().command?.status, 'unknown');
    const age = owner.getSnapshot().command!.firstDispatchedAt!;
    const key = owner.getSnapshot().command!.packet.key;

    clock.set(age - 1);
    const beforeBackwards = keys.length;
    await owner.reconcileVenueExperience();
    assert.equal(keys.length, beforeBackwards);
    assert.equal(owner.getSnapshot().venueNotice, POSTGAME_RETENTION_EXPIRED_NOTICE);

    clock.set(age);
    delete (owner.getSnapshot().command as { firstDispatchedAt?: number }).firstDispatchedAt;
    await owner.reconcileVenueExperience();
    assert.equal(keys.length, beforeBackwards);
    assert.equal(owner.getSnapshot().command?.status, 'unknown');

    // Restore age within TTL — original packet may retry.
    (owner.getSnapshot().command as { firstDispatchedAt: number }).firstDispatchedAt = age;
    clock.set(age + POSTGAME_IDEMPOTENCY_TTL_MS - 1);
    mode = 'ok';
    await owner.reconcileVenueExperience();
    await tick();
    assert.equal(keys.filter(k => k === key).length >= 2, true);
    assert.equal(owner.getSnapshot().command, null);

    // Fresh legitimate create under same gates still allowed.
    mode = 'ok';
    owner.closeVenueExperience();
    owner.openVenueExperience(gameId, venueId);
    await tick();
    owner.patchVenueDraft({ audience: 'self_draft', text: 'Новый опыт', topics: ['lighting'] });
    const beforeFresh = keys.length;
    await owner.submitVenueExperience();
    await tick();
    assert.equal(keys.length, beforeFresh + 1);
    assert.equal(owner.getSnapshot().command, null);
    assert.equal(owner.getSnapshot().venueReceipt?.status, 'self_draft');
  } finally {
    Date.now = realNow;
  }
});

test('#522 address10: deferred token + route retire → 0 POST; auth quarantine → 0 autoPOST; explicit UNKNOWN retry → 1 POST', async () => {
  // (a) Fresh private venue → token held → close/retire → release => 0 API POST + UNKNOWN packet/key/body/age.
  const retireSent: string[] = [];
  let releaseRetire!: () => void;
  const retireGate = new Promise<void>(r => { releaseRetire = r; });
  const retiring = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        const permit = retiring.dispatchPermit(packet);
        assert.ok(permit.freshVenue, 'fresh venue bind captured in permit');
        await retireGate;
        if (!retiring.mayDispatchRetention(packet, permit)) {
          throw new PostgameError(
            'network',
            503,
            retiring.retentionExpiredFor(packet) ? 'POSTGAME_RETENTION_EXPIRED' : 'POSTGAME_DISPATCH_STALE',
          );
        }
        retireSent.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `retire-${retireSent.length + 1}`);

  retiring.setActor(actor);
  retiring.openVenueExperience(gameId, venueId);
  await tick();
  retiring.patchVenueDraft({ audience: 'self_draft', text: 'Текст до ухода при токене', topics: ['surface'] });
  const retirePending = retiring.submitVenueExperience();
  await tick();
  assert.equal(retiring.getSnapshot().command?.status, 'sending');
  const retireKey = retiring.getSnapshot().command!.packet.key;
  const retireBody = structuredClone(retiring.getSnapshot().command!.packet.body);
  const retireAge = retiring.getSnapshot().command!.firstDispatchedAt!;
  const retireGen = retiring.getSnapshot().venueExperience!.gen;
  retiring.retireVenueExperienceSurface({
    gen: retireGen,
    gameId,
    venueId,
    actorId: actor.actorId,
    sessionId: actor.sessionId,
  });
  assert.equal(retiring.getSnapshot().venueExperience, null);
  releaseRetire();
  await retirePending;
  await tick();
  assert.equal(retireSent.length, 0);
  assert.equal(retiring.getSnapshot().command?.status, 'unknown');
  assert.equal(retiring.getSnapshot().command!.packet.key, retireKey);
  assert.deepEqual(retiring.getSnapshot().command!.packet.body, retireBody);
  assert.equal(retiring.getSnapshot().command!.firstDispatchedAt, retireAge);

  // Public audience path: close while token held — same zeroPOST fence.
  const closeSent: string[] = [];
  let releaseClose!: () => void;
  const closeGate = new Promise<void>(r => { releaseClose = r; });
  const closing = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        const permit = closing.dispatchPermit(packet);
        assert.ok(permit.freshVenue);
        await closeGate;
        if (!closing.mayDispatchRetention(packet, permit)) {
          throw new PostgameError('network', 503, 'POSTGAME_DISPATCH_STALE');
        }
        closeSent.push(packet.key);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: 'submitted_waiting',
          reviewHandle: 'd'.repeat(32),
          receiptToken: 'tok',
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `close-${closeSent.length + 1}`);
  closing.setActor(actor);
  closing.openVenueExperience(gameId, venueId);
  await tick();
  closing.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст при токене', topics: ['lighting'] });
  await closing.ensureVenueConsentPreview();
  const closePending = closing.submitVenueExperience();
  await tick();
  assert.equal(closing.getSnapshot().command?.status, 'sending');
  const closeKey = closing.getSnapshot().command!.packet.key;
  const closeAge = closing.getSnapshot().command!.firstDispatchedAt!;
  closing.closeVenueExperience();
  releaseClose();
  await closePending;
  await tick();
  assert.equal(closeSent.length, 0);
  assert.equal(closing.getSnapshot().command?.status, 'unknown');
  assert.equal(closing.getSnapshot().command!.packet.key, closeKey);
  assert.equal(closing.getSnapshot().command!.firstDispatchedAt, closeAge);

  // (b) Same-account auth quarantine/restore while token held → 0 autoPOST / consent false;
  //     explicit original retry after stable auth inside TTL → 1 POST same packet/key/body.
  const authSent: Array<{ key: string; body: unknown }> = [];
  let releaseAuth!: () => void;
  const authGate = new Promise<void>(r => { releaseAuth = r; });
  let authMode: 'stale' | 'ok' = 'stale';
  const quarantined = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        const permit = quarantined.dispatchPermit(packet);
        await authGate;
        if (!quarantined.mayDispatchRetention(packet, permit)) {
          throw new PostgameError(
            'network',
            503,
            quarantined.retentionExpiredFor(packet) ? 'POSTGAME_RETENTION_EXPIRED' : 'POSTGAME_DISPATCH_STALE',
          );
        }
        authSent.push({ key: packet.key, body: structuredClone(packet.body) });
        if (authMode === 'stale') throw new PostgameError('network', 503);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: 'self_draft',
          reviewHandle: 'd'.repeat(32),
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `auth-${authSent.length + 1}`);

  quarantined.setActor(actor);
  quarantined.openVenueExperience(gameId, venueId);
  await tick();
  quarantined.patchVenueDraft({ audience: 'public_venue', text: 'Согласие до гидрации', topics: ['surface'] });
  await quarantined.ensureVenueConsentPreview();
  assert.equal(quarantined.getSnapshot().venueDraft?.consent, true);
  const authPending = quarantined.submitVenueExperience();
  await tick();
  assert.equal(quarantined.getSnapshot().command?.status, 'sending');
  const authKey = quarantined.getSnapshot().command!.packet.key;
  const authBody = structuredClone(quarantined.getSnapshot().command!.packet.body);
  const authAge = quarantined.getSnapshot().command!.firstDispatchedAt!;
  // Production AuthCoordinator.refresh(): show(hydrating) → postgame.setActor(null), then accept → setActor(same).
  quarantined.setActor(null);
  quarantined.setActor({ ...actor, sessionId: actor.sessionId, generation: 2 });
  await tick();
  assert.equal(quarantined.getSnapshot().command?.status, 'unknown');
  assert.equal(quarantined.getSnapshot().venueDraft?.consent, false);
  assert.equal(quarantined.getSnapshot().venueConsentHash, null);
  releaseAuth();
  await authPending;
  await tick();
  assert.equal(authSent.length, 0, 'no autoPOST after same-account restore while token held');
  assert.equal(quarantined.getSnapshot().command?.status, 'unknown');
  assert.equal(quarantined.getSnapshot().command!.packet.key, authKey);
  assert.deepEqual(quarantined.getSnapshot().command!.packet.body, authBody);
  assert.equal(quarantined.getSnapshot().command!.firstDispatchedAt, authAge);

  authMode = 'ok';
  await quarantined.reconcileVenueExperience();
  await tick();
  assert.equal(authSent.length, 1);
  assert.equal(authSent[0]!.key, authKey);
  assert.deepEqual(authSent[0]!.body, authBody);
  assert.equal(quarantined.getSnapshot().command, null);

  // (c) Unchanged legitimate fresh private/public dispatch still works with post-token fence.
  const legitKeys: string[] = [];
  const legit = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        const permit = legit.dispatchPermit(packet);
        assert.ok(permit.freshVenue);
        assert.equal(legit.mayDispatchRetention(packet, permit), true);
        legitKeys.push(packet.key);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: packet.body.audience === 'self_draft' ? 'self_draft' : 'submitted_waiting',
          reviewHandle: 'e'.repeat(32),
          receiptToken: packet.body.audience === 'self_draft' ? null : 'tok',
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `legit-${legitKeys.length + 1}`);
  legit.setActor(actor);
  legit.openVenueExperience(gameId, venueId);
  await tick();
  legit.patchVenueDraft({ audience: 'self_draft', text: 'Легитимный личный опыт', topics: ['amenities'] });
  await legit.submitVenueExperience();
  await tick();
  assert.equal(legitKeys.length, 1);
  assert.equal(legit.getSnapshot().command, null);
  assert.equal(legit.getSnapshot().venueReceipt?.status, 'self_draft');

  legit.closeVenueExperience();
  legit.openVenueExperience(gameId, venueId);
  await tick();
  legit.patchVenueDraft({ audience: 'public_venue', text: 'Легитимный публичный опыт', topics: ['surface'] });
  await legit.ensureVenueConsentPreview();
  await legit.submitVenueExperience();
  await tick();
  assert.equal(legitKeys.length, 2);
  assert.equal(legit.getSnapshot().command, null);
  assert.equal(legit.getSnapshot().venueReceipt?.status, 'submitted_waiting');
});

test('#522 address10: real AuthCoordinator+PostgameCoordinator deferred token authority fence', async () => {
  const now0 = Date.parse('2026-11-14T00:00:00Z');
  let nowMs = now0;
  const token = (s: string) => s.repeat(43);
  const me = {
    id: actor.actorId,
    displayName: 'Игрок',
    locale: 'ru',
    linkedProviders: ['vk'],
    session: { id: actor.sessionId, audience: 'consumer_native', transport: 'bearer' },
  };
  const credentials = {
    accessToken: token('a'),
    refreshToken: token('b'),
    tokenType: 'Bearer',
    expiresIn: 600,
    refreshExpiresAt: new Date(now0 + 604800_000).toISOString(),
    refreshAbsoluteExpiresAt: new Date(now0 + 2592000_000).toISOString(),
    sessionId: actor.sessionId,
  };
  const saved = {
    version: 1,
    generation: token('g'),
    returnPath: null,
    session: {
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      refreshToken: credentials.refreshToken,
      refreshExpiresAt: credentials.refreshExpiresAt,
      refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt,
    },
  };
  const elig = {
    bases: [{
      gameId,
      gameTitle: 'Practice',
      admission: 'may_submit',
      reason: null,
      outcomeVersion: 1,
      attendanceVersion: 2,
      firstEligibleAt: '2026-11-14T10:00:00.000Z',
      helpHint: null,
    }],
  };
  const privateReceipt = {
    id: '55555555-5555-4555-8555-555555555555',
    version: 1,
    status: 'self_draft',
    reviewHandle: 'd'.repeat(32),
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  };
  const publicReceipt = {
    ...privateReceipt,
    status: 'submitted_waiting',
    receiptToken: 'intake-token',
  };

  let eligCalls = 0;
  let mutationPosts = 0;
  let releaseRefresh!: (value: unknown) => void;
  let refreshGate = new Promise<unknown>(r => { releaseRefresh = r; });
  let refreshHeld = false;
  /** Expire access only after submit eligibility returns so refresh awaits inside mutation send. */
  let expireAfterSubmitElig = false;
  let serial = 0;
  let stored: string | null = JSON.stringify(saved);

  const api = createNativeApi(async (url, init) => {
    const path = String(url).replace('https://dev.gobadminton.ru/v1', '');
    if (path === '/auth/native/refresh') {
      if (refreshHeld) return new Response(JSON.stringify(await refreshGate));
      return new Response(JSON.stringify(credentials));
    }
    if (path === '/me') return new Response(JSON.stringify(me));
    if (path.startsWith('/me/venue-reviews/eligibility')) {
      eligCalls += 1;
      // Open (call 1) keeps access valid; submit recheck (call ≥2) expires so mutation token awaits refresh.
      if (eligCalls >= 2 && expireAfterSubmitElig) nowMs = now0 + 570_000 + 1;
      return new Response(JSON.stringify(elig));
    }
    if (path === '/me/venue-reviews/consent-preview') {
      return new Response(JSON.stringify({
        consentProjectionHash: 'f'.repeat(64),
        authorLabel: 'Участник игры',
      }));
    }
    if (path === '/me/venue-reviews') {
      mutationPosts += 1;
      let audience: string | undefined;
      try {
        audience = JSON.parse(String(init?.body ?? '{}')).audience;
      } catch { /* synthetic */ }
      return new Response(JSON.stringify(
        audience === 'public_venue' ? publicReceipt : privateReceipt,
      ), { status: 201 });
    }
    return new Response(JSON.stringify(credentials));
  });

  const auth = new AuthCoordinator({
    api,
    store: {
      getItem: async (key: string) => { assert.equal(key, SECURE_AUTH_KEY); return stored; },
      setItem: async (key: string, value: string) => { assert.equal(key, SECURE_AUTH_KEY); stored = value; },
    },
    random: () => String.fromCharCode(65 + (serial++ % 26)).repeat(43),
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'),
    now: () => nowMs,
  });
  await auth.hydrate();
  const owner = auth.postgame;

  // Real AuthCoordinator send adapter: access expires after eligibility; deferred refresh
  // hydrates null→same account while token held → 0 autoPOST; consent false; UNKNOWN
  // packet/key/body/age preserved; close/reopen alone never retries; explicit original
  // retry after stable auth → 1 POST. Route retire/close covered by simulated adapter above
  // using the same dispatchPermit/mayDispatchRetention fence.
  expireAfterSubmitElig = true;
  refreshHeld = true;
  refreshGate = new Promise<unknown>(r => { releaseRefresh = r; });
  nowMs = now0;
  eligCalls = 0;
  mutationPosts = 0;
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Реальный адаптер согласие', topics: ['lighting'] });
  await owner.ensureVenueConsentPreview();
  assert.equal(owner.getSnapshot().venueDraft?.consent, true);
  const quarantinePending = owner.submitVenueExperience();
  await tick();
  releaseRefresh(credentials);
  await quarantinePending;
  await tick();
  assert.equal(mutationPosts, 0, 'same-account restore must not autoPOST fresh venue');
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const keyB = owner.getSnapshot().command!.packet.key;
  const bodyB = structuredClone(owner.getSnapshot().command!.packet.body);
  const ageB = owner.getSnapshot().command!.firstDispatchedAt!;
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);

  const beforeClose = mutationPosts;
  owner.closeVenueExperience();
  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(mutationPosts, beforeClose);
  assert.equal(owner.getSnapshot().command!.packet.key, keyB);
  assert.deepEqual(owner.getSnapshot().command!.packet.body, bodyB);
  assert.equal(owner.getSnapshot().command!.firstDispatchedAt, ageB);

  expireAfterSubmitElig = false;
  refreshHeld = false;
  nowMs = now0 + 570_000 + 1;
  await owner.reconcileVenueExperience();
  await tick();
  assert.equal(mutationPosts, 1);
  assert.equal(owner.getSnapshot().command, null);

  // Legitimate fresh private/public dispatch through real adapter still posts.
  expireAfterSubmitElig = false;
  refreshHeld = false;
  nowMs = now0 + 570_000 + 1;
  eligCalls = 0;
  mutationPosts = 0;
  owner.closeVenueExperience();
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'self_draft', text: 'Легитимный через AuthCoordinator', topics: ['amenities'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(mutationPosts, 1);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'self_draft');

  owner.closeVenueExperience();
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Легитимный публичный Auth', topics: ['surface'] });
  await owner.ensureVenueConsentPreview();
  await owner.submitVenueExperience();
  await tick();
  assert.equal(mutationPosts, 2);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'submitted_waiting');
});
