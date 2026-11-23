import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError } from '../src/postgame.ts';
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
  let mode: 'unknown' | 'ok' = 'unknown';
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
