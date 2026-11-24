import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, validateReceipt, wire } from '../src/postgame.ts';
import {
  buildVenueExperienceSubmitRevisionBody,
  buildVenueExperienceWithdrawBody,
  captureOwnVenueHistoryRouteOwner,
  isSelectedOwnVenueReview,
  isSubmitVenueReviewReceipt,
  isVenueExperienceCommandPacket,
  isVenueExperienceCreatePacket,
  isVenueExperiencePacketKind,
  isWithdrawVenueReviewReceipt,
  mayEditOwnVenue,
  mayWithdrawOwnVenue,
  noteOwnVenueHistoryRouteOwner,
  ownVenueSelectedMatchesRequest,
  ownVenueStatusLabel,
  ownVenueWithdrawConfirmFlags,
  parseOwnVenueReviewsPage,
  parseSelectedOwnVenueReview,
  postgameIdempotencyReplayBlocked,
  venueExperiencePendingRecoveryTarget,
  type OwnVenueReview,
  type SelectedOwnVenueReview,
} from '../src/venue-reviews.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gameId = '11111111-1111-4111-8111-111111111111';
const venueId = '22222222-2222-4222-8222-222222222222';
const reviewId = '55555555-5555-4555-8555-555555555555';
const handle = 'abcdef0123456789abcdef0123456789';
const actor = {
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  generation: 1,
};

const ownRow = (version = 1): OwnVenueReview => ({
  id: reviewId,
  reviewHandle: handle,
  venueId,
  status: 'self_draft',
  version,
  audience: 'self_draft',
  text: 'Покрытие удобное',
  topics: ['surface'],
  pendingRevision: null,
  approvedRevision: 1,
  publicVisible: false,
  notBefore: null,
  firstEligibleAt: '2026-01-01T12:00:00.000Z',
  receiptToken: null,
});

const selected = (version = 1): SelectedOwnVenueReview => ({
  ...ownRow(version),
  editContext: {
    revisionId: '33333333-3333-4333-8333-333333333333',
    resourceVersion: 1,
    gameId,
    basis: {
      gameId,
      gameTitle: 'Practice',
      admission: 'may_submit',
      reason: null,
      outcomeVersion: 1,
      attendanceVersion: 1,
      firstEligibleAt: '2026-01-01T12:00:00.000Z',
      helpHint: null,
    },
  },
  editUnavailableReason: null,
});

function idlePort(overrides: Partial<ConstructorParameters<typeof PostgameCoordinator>[0]> = {}) {
  return {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], writesEnabled: true, installed: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => ({
      gameId,
      outcome: { value: 'held' as const, version: 1, reason: null, provenance: null },
      allowedActions: { canRecordOutcome: false },
    }),
    send: async () => { throw new PostgameError('network'); },
    venueExperienceOwnList: async () => ({ items: [ownRow()] }),
    venueExperienceOwnDetail: async () => selected(),
    venueExperienceEligibility: async () => ({ bases: [] }),
    venueExperienceConsentPreview: async () => ({
      consentProjectionHash: 'a'.repeat(64),
      authorLabel: 'Участник игры',
    }),
    ...overrides,
  };
}

const tick = () => new Promise(r => setImmediate(r));

test('parsers: own list/selected/withdraw/revision receipts; create packet remains distinct', () => {
  const page = parseOwnVenueReviewsPage({ items: [ownRow()] });
  assert.equal(page.items.length, 1);
  assert.equal(mayWithdrawOwnVenue(page.items[0]!), true);
  const detail = parseSelectedOwnVenueReview(selected());
  assert.equal(isSelectedOwnVenueReview(detail, ownRow()), true);
  assert.equal(mayEditOwnVenue(detail), true);
  assert.equal(isVenueExperiencePacketKind('venue-experience-command'), true);
  assert.equal(isVenueExperienceCreatePacket({ kind: 'venue-experience-command' }), false);
  assert.equal(isVenueExperienceCommandPacket({ kind: 'venue-experience-command' }), true);
  // Non-pending private self_draft tip — not “Не опубликован”.
  assert.equal(ownVenueStatusLabel(ownRow()), 'Личный черновик');
  assert.equal(ownVenueStatusLabel({
    ...ownRow(),
    pendingRevision: 2,
    audience: 'self_draft',
    status: 'self_draft',
  }), 'Личный черновик');
  // Private pending over published tip (revision_waiting + null token).
  assert.equal(ownVenueStatusLabel({
    ...ownRow(),
    audience: null,
    status: 'revision_waiting',
    pendingRevision: 2,
    receiptToken: null,
    publicVisible: true,
  }), 'Личный черновик');
  // Withdrawn precedes private/public labels.
  assert.equal(ownVenueStatusLabel({
    ...ownRow(),
    status: 'withdrawn',
    audience: 'self_draft',
    pendingRevision: 2,
  }), 'Отозван');
  // Public pending stays separate from private draft copy.
  assert.equal(ownVenueStatusLabel({
    ...ownRow(),
    audience: 'public_venue',
    status: 'revision_waiting',
    pendingRevision: 2,
    receiptToken: 'intake-token',
  }), 'На проверке');
  assert.equal(ownVenueStatusLabel({
    ...ownRow(),
    audience: 'public_venue',
    status: 'published',
    pendingRevision: null,
    receiptToken: null,
    publicVisible: true,
  }), 'Опубликован');

  const withdrawBody = buildVenueExperienceWithdrawBody(ownRow(3));
  assert.deepEqual(withdrawBody, { action: 'withdraw', expectedVersion: 3 });
  assert.equal(isWithdrawVenueReviewReceipt({
    id: reviewId,
    version: 4,
    status: 'withdrawn',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  }, { id: reviewId, reviewHandle: handle, version: 3 }), true);

  const reviseBody = buildVenueExperienceSubmitRevisionBody({
    own: detail,
    audience: 'self_draft',
    text: 'Новая редакция',
    topics: ['lighting'],
  });
  assert.equal(reviseBody.action, 'submit_revision');
  assert.equal(reviseBody.expectedVersion, 1);
  assert.equal(isSubmitVenueReviewReceipt({
    id: reviewId,
    version: 2,
    status: 'revision_waiting',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  }, { id: reviewId, reviewHandle: handle, version: 1 }, 'self_draft'), true);

  const withdrawWire = wire({
    kind: 'venue-experience-command',
    gameId: 'own-venue',
    venueId,
    reviewId,
    reviewHandle: handle,
    body: withdrawBody,
  });
  assert.equal(withdrawWire.path, `/me/venue-reviews/${reviewId}/commands`);
  assert.deepEqual(Object.keys(withdrawWire.body as object).sort(), ['action', 'expectedVersion']);
  // Local expected handle is ACK metadata only — absent from wire body keys.
  assert.equal('reviewHandle' in (withdrawWire.body as object), false);
});

test('Profile history → selected edit/withdraw; conflict fences; create competition blocked', async () => {
  const posts: Array<{ kind: string; path: string; body: unknown; key: string }> = [];
  let detailVersion = 1;
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnDetail: async () => selected(detailVersion),
      send: async (packet) => {
        posts.push({
          kind: packet.kind,
          path: packet.path,
          body: packet.body,
          key: packet.key,
        });
        if (!isVenueExperienceCommandPacket(packet)) {
          throw new Error(`expected venue-experience-command, got ${packet.kind}`);
        }
        if (packet.body.action === 'withdraw') {
          return {
            id: reviewId,
            version: packet.body.expectedVersion + 1,
            status: 'withdrawn',
            reviewHandle: handle,
            receiptToken: null,
            publicVisible: false,
            notBefore: null,
          };
        }
        return {
          id: reviewId,
          version: packet.body.expectedVersion + 1,
          status: 'revision_waiting',
          reviewHandle: handle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `own-key-${posts.length + 1}`);

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueSurface?.mode, 'history');
  assert.equal(owner.getSnapshot().ownVenue.status, 'ready');
  assert.equal(owner.getSnapshot().ownVenue.data?.items[0]?.id, reviewId);

  // Competing exact-game create surface blocks edit replace; withdraw confirm still possible.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ text: 'Создать параллельно', topics: ['surface'] });
  owner.openOwnVenueEdit(ownRow());
  await tick();
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, undefined);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Создать параллельно');
  owner.beginOwnVenueWithdraw(ownRow());
  assert.equal(owner.getSnapshot().ownVenueWithdraw?.id, reviewId);
  owner.cancelOwnVenueWithdraw();
  owner.closeVenueExperience();

  owner.openOwnVenueEdit(ownRow());
  await tick();
  const editSurface = owner.getSnapshot().venueExperience;
  assert.equal(editSurface?.reviewId, reviewId);
  assert.equal(editSurface?.gameId, gameId);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Покрытие удобное');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);

  owner.patchVenueDraft({ text: 'Обновлённый личный текст', topics: ['surface'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.kind, 'venue-experience-command');
  assert.match(posts[0]!.path, /\/me\/venue-reviews\/55555555.*\/commands/);
  const reviseBody = posts[0]!.body as { action: string; consentProjectionHash?: string };
  assert.equal(reviseBody.action, 'submit_revision');
  assert.equal(reviseBody.consentProjectionHash, undefined);
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'revision_waiting');

  // Conflict: selected version moved under fresh dispatch.
  owner.closeVenueExperience();
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, false);
  detailVersion = 2;
  owner.openOwnVenueEdit(ownRow(1));
  await tick();
  // After forEdit load, selected is v2; patch then force newer on submit recheck.
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);
  owner.patchVenueDraft({ text: 'Ещё одна редакция', topics: ['lighting'] });
  detailVersion = 3;
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(posts.length, 1); // no second POST

  // Withdraw needs no game admission — sentinel gameId own-venue.
  const withdrawOwner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => ({ items: [ownRow(3)] }),
      send: async (packet) => {
        posts.push({ kind: packet.kind, path: packet.path, body: packet.body, key: packet.key });
        assert.equal(isVenueExperienceCommandPacket(packet), true);
        assert.equal(packet.gameId, 'own-venue');
        return {
          id: reviewId,
          version: 4,
          status: 'withdrawn',
          reviewHandle: handle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `wd-${posts.length + 1}`);
  withdrawOwner.setActor(actor);
  withdrawOwner.openOwnVenueHistory();
  await tick();
  withdrawOwner.beginOwnVenueWithdraw(ownRow(3));
  await withdrawOwner.confirmOwnVenueWithdraw();
  await tick();
  const withdrawPost = posts[posts.length - 1]!;
  assert.equal(withdrawPost.kind, 'venue-experience-command');
  assert.deepEqual(withdrawPost.body, { action: 'withdraw', expectedVersion: 3 });
  assert.equal(withdrawOwner.getSnapshot().venueNotice?.includes('отозван'), true);
});

test('24h UNKNOWN owner packet: retention blocks replay; GET does not settle', async () => {
  const now = 1_000_000;
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async () => { throw new PostgameError('network', 503); },
    }),
  }, () => 'unknown-own-key');
  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.beginOwnVenueWithdraw(ownRow());
  await owner.confirmOwnVenueWithdraw();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(isVenueExperienceCommandPacket(owner.getSnapshot().command!.packet), true);
  const first = owner.getSnapshot().command!.firstDispatchedAt;
  assert.equal(typeof first, 'number');

  // List refresh must not clear UNKNOWN.
  await owner.loadOwnVenueReviews();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, 'unknown-own-key');

  assert.equal(postgameIdempotencyReplayBlocked(first, first! + 24 * 60 * 60 * 1000), true);
  // Controllable clock via blocked helper — coordinator uses Date.now; stamp age manually for fence unit.
  assert.equal(postgameIdempotencyReplayBlocked(now, now + 23 * 60 * 60 * 1000), false);
});

test('owner ACK expected handle from packet metadata; wrong-handle leaves UNKNOWN', async () => {
  const wrongHandle = 'ffffffffffffffffffffffffffffffff';
  const owner = new PostgameCoordinator({
    ...idlePort({
      // List must return the user-confirmed row (v2) so matching-version guard admits withdraw.
      venueExperienceOwnList: async () => ({ items: [ownRow(2)] }),
      send: async (packet) => {
        if (!isVenueExperienceCommandPacket(packet)) {
          throw assert.fail('expected venue-experience-command packet');
        }
        assert.equal(packet.reviewHandle, handle);
        if (packet.body.action === 'withdraw') {
          return {
            id: reviewId,
            version: packet.body.expectedVersion + 1,
            status: 'withdrawn',
            reviewHandle: wrongHandle,
            receiptToken: null,
            publicVisible: false,
            notBefore: null,
          };
        }
        return {
          id: reviewId,
          version: packet.body.expectedVersion + 1,
          status: 'revision_waiting',
          reviewHandle: wrongHandle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => 'wrong-handle-key');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.beginOwnVenueWithdraw(ownRow(2));
  await owner.confirmOwnVenueWithdraw();
  await tick();
  const cmd = owner.getSnapshot().command;
  assert.equal(cmd?.status, 'unknown');
  assert.equal(cmd?.packet.key, 'wrong-handle-key');
  if (!cmd || !isVenueExperienceCommandPacket(cmd.packet)) {
    throw assert.fail('expected venue-experience-command UNKNOWN journal');
  }
  assert.equal(cmd.packet.reviewHandle, handle);
  assert.deepEqual(cmd.packet.body, { action: 'withdraw', expectedVersion: 2 });
  const first = cmd.firstDispatchedAt;
  assert.equal(typeof first, 'number');

  // Packet-level validateReceipt rejects tautology-safe wrong handle; private null-token shape alone is insufficient.
  assert.throws(() => validateReceipt({
    id: reviewId,
    version: 3,
    status: 'withdrawn',
    reviewHandle: wrongHandle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  }, cmd.packet));
  assert.doesNotThrow(() => validateReceipt({
    id: reviewId,
    version: 3,
    status: 'withdrawn',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  }, cmd.packet));

  // Closing/hiding withdraw confirm must not discard UNKNOWN journal.
  owner.cancelOwnVenueWithdraw();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, 'wrong-handle-key');
  assert.equal(owner.getSnapshot().command?.firstDispatchedAt, first);

  // submit_revision wrong-handle likewise retains original key/body/age.
  const reviseOwner = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        if (!isVenueExperienceCommandPacket(packet)) {
          throw assert.fail('expected venue-experience-command packet');
        }
        return {
          id: reviewId,
          version: packet.body.expectedVersion + 1,
          status: 'revision_waiting',
          reviewHandle: wrongHandle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => 'wrong-revise-key');
  reviseOwner.setActor(actor);
  reviseOwner.openOwnVenueHistory();
  await tick();
  reviseOwner.openOwnVenueEdit(ownRow());
  await tick();
  reviseOwner.patchVenueDraft({ text: 'Редакция с неверным ACK handle', topics: ['surface'] });
  await reviseOwner.submitVenueExperience();
  await tick();
  const reviseCmd = reviseOwner.getSnapshot().command;
  assert.equal(reviseCmd?.status, 'unknown');
  assert.equal(reviseCmd?.packet.key, 'wrong-revise-key');
  if (!reviseCmd || !isVenueExperienceCommandPacket(reviseCmd.packet)) {
    throw assert.fail('expected venue-experience-command UNKNOWN journal');
  }
  assert.equal(reviseCmd.packet.reviewHandle, handle);
  assert.equal(reviseCmd.packet.body.action, 'submit_revision');
  const reviseFirst = reviseCmd.firstDispatchedAt;
  const ownerPacket = reviseCmd.packet;
  reviseOwner.closeVenueExperience();
  assert.equal(reviseOwner.getSnapshot().command?.status, 'unknown');
  assert.equal(reviseOwner.getSnapshot().command?.packet.key, 'wrong-revise-key');
  assert.equal(reviseOwner.getSnapshot().command?.firstDispatchedAt, reviseFirst);

  // Correct private revision_waiting + null token still validates against expected packet handle.
  assert.equal(ownerPacket.body.action, 'submit_revision');
  assert.equal(ownerPacket.body.expectedVersion, 1);
  assert.doesNotThrow(() => validateReceipt({
    id: reviewId,
    version: ownerPacket.body.expectedVersion + 1,
    status: 'revision_waiting',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  }, ownerPacket));
});

test('WithdrawConfirm: UNKNOWN is pending not busy; Retry actionable; hide preserves journal', async () => {
  let attempts = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        attempts += 1;
        if (attempts === 1) throw new PostgameError('network', 503);
        assert.equal(packet.key, 'withdraw-retry-key');
        assert.deepEqual(packet.body, { action: 'withdraw', expectedVersion: 1 });
        return {
          id: reviewId,
          version: 2,
          status: 'withdrawn',
          reviewHandle: handle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => 'withdraw-retry-key');
  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.beginOwnVenueWithdraw(ownRow());
  await owner.confirmOwnVenueWithdraw();
  await tick();
  const cmd = owner.getSnapshot().command;
  assert.equal(cmd?.status, 'unknown');
  assert.equal(attempts, 1);
  const flags = ownVenueWithdrawConfirmFlags({ command: cmd });
  assert.equal(flags.busy, false);
  assert.equal(flags.pending, true);
  assert.equal(flags.hideWindow, true);
  assert.deepEqual(
    ownVenueWithdrawConfirmFlags({
      command: { status: 'sending', packet: cmd!.packet },
    }),
    { busy: true, pending: false, hideWindow: true },
  );

  const frozenKey = cmd!.packet.key;
  const frozenBody = { ...cmd!.packet.body };
  const frozenAge = cmd!.firstDispatchedAt;
  owner.cancelOwnVenueWithdraw();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, frozenKey);
  assert.equal(owner.getSnapshot().command?.firstDispatchedAt, frozenAge);

  await owner.reconcileVenueExperience();
  await tick();
  assert.equal(attempts, 2);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueNotice?.includes('отозван'), true);
  assert.deepEqual(frozenBody, { action: 'withdraw', expectedVersion: 1 });
  assert.equal(typeof frozenAge, 'number');
});

test('edit 409 → explicit selected GET preserves draft/reconsent; selected-read error stays fenced', async () => {
  let detailVersion = 1;
  let detailFail = false;
  const posts: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnDetail: async () => {
        if (detailFail) throw new PostgameError('network', 503);
        return selected(detailVersion);
      },
      send: async (packet) => {
        posts.push(packet.key);
        throw new PostgameError('business', 409, 'VERSION_CONFLICT');
      },
    }),
  }, () => `edit409-${posts.length + 1}`);

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit(ownRow());
  await tick();
  owner.patchVenueDraft({
    text: 'Неотправленный конфликтный черновик',
    topics: ['lighting'],
    audience: 'self_draft',
  });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Неотправленный конфликтный черновик');
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, ['lighting']);
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  // No auto-authorize: selected version still the pre-conflict open (v1) until explicit reread.
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, 1);

  detailVersion = 3;
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, false);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, 3);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Неотправленный конфликтный черновик');
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, ['lighting']);
  assert.equal(owner.getSnapshot().venueDraft?.audience, 'self_draft');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);

  // Selected-read error after fence remains fenced — does not clear readRequired falsely.
  owner.patchVenueDraft({ text: 'Ещё правка', topics: ['amenities'] });
  detailVersion = 4;
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  detailFail = true;
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Ещё правка');
});

test('address5: create recovery unchanged; owner withdraw sentinel never game URL; intent zero POST', async () => {
  const createPacket = {
    kind: 'venue-experience-create' as const,
    gameId,
    venueId,
  };
  const withdrawPacket = {
    kind: 'venue-experience-command' as const,
    gameId: 'own-venue',
    venueId,
    reviewId,
    reviewHandle: handle,
    body: { action: 'withdraw' as const, expectedVersion: 1 },
  };
  const revisePacket = {
    kind: 'venue-experience-command' as const,
    gameId,
    venueId,
    reviewId,
    reviewHandle: handle,
    body: { action: 'submit_revision' as const, expectedVersion: 1 },
  };
  assert.deepEqual(venueExperiencePendingRecoveryTarget(createPacket), {
    kind: 'create-results',
    gameId,
  });
  assert.deepEqual(venueExperiencePendingRecoveryTarget(withdrawPacket), {
    kind: 'owner-history',
  });
  assert.deepEqual(venueExperiencePendingRecoveryTarget(revisePacket), {
    kind: 'owner-history',
  });
  assert.equal(venueExperiencePendingRecoveryTarget({ kind: 'later', gameId }), null);

  const posts: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        posts.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => 'owner-intent-key');
  owner.setActor(actor);
  // Nav intent alone must not POST or open history — Profile focus consumes it.
  owner.requestOwnVenueHistoryNavIntent();
  assert.equal(owner.getSnapshot().ownVenueSurface, null);
  assert.equal(posts.length, 0);
  assert.equal(owner.consumeOwnVenueHistoryNavIntent(), true);
  assert.equal(owner.getSnapshot().ownVenueSurface, null);
  assert.equal(posts.length, 0);

  // Owner UNKNOWN journal unchanged across view-only history open (zero automatic POST).
  owner.openOwnVenueHistory();
  await tick();
  owner.beginOwnVenueWithdraw(ownRow());
  await owner.confirmOwnVenueWithdraw();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const frozenKey = owner.getSnapshot().command!.packet.key;
  const frozenAge = owner.getSnapshot().command!.firstDispatchedAt;
  assert.equal(isVenueExperienceCommandPacket(owner.getSnapshot().command!.packet), true);
  assert.equal(owner.getSnapshot().command!.packet.gameId, 'own-venue');
  owner.closeOwnVenueHistory();
  owner.requestOwnVenueHistoryNavIntent();
  assert.equal(owner.consumeOwnVenueHistoryNavIntent(), true);
  owner.openOwnVenueHistory();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, frozenKey);
  assert.equal(owner.getSnapshot().command?.firstDispatchedAt, frozenAge);
  assert.equal(posts.length, 1);
});

test('address5: edit409 + list GET keeps selected-read fence until matching selected GET', async () => {
  let detailVersion = 1;
  let listCalls = 0;
  let detailCalls = 0;
  const posts: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => {
        listCalls += 1;
        return { items: [ownRow(detailVersion)] };
      },
      venueExperienceOwnDetail: async (_actor, id) => {
        detailCalls += 1;
        assert.equal(id, reviewId);
        return selected(detailVersion);
      },
      send: async (packet) => {
        posts.push(packet.key);
        throw new PostgameError('business', 409, 'VERSION_CONFLICT');
      },
    }),
  }, () => `fence-list-${posts.length + 1}`);

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit(ownRow());
  await tick();
  owner.patchVenueDraft({ text: 'Черновик под selected fence', topics: ['surface'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Черновик под selected fence');
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);

  const listsBefore = listCalls;
  await owner.loadOwnVenueReviews();
  await tick();
  assert.equal(listCalls, listsBefore + 1);
  // List success must not authorize selected editor — fence + unsent draft stay.
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Черновик под selected fence');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(posts.length, 1);

  detailVersion = 4;
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.ok(detailCalls >= 2);
  assert.equal(owner.getSnapshot().ownVenueReadRequired, false);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, 4);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Черновик под selected fence');
  assert.equal(posts.length, 1);
});

test('address5: open history while sending → settle → one deferred GET; close/switch → zero late GET', async () => {
  let listCalls = 0;
  let releaseSend!: (value: unknown) => void;
  const sendGate = new Promise<unknown>(resolve => { releaseSend = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => {
        listCalls += 1;
        return { items: [ownRow()] };
      },
      send: async () => sendGate,
    }),
  }, () => 'deferred-hist-key');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  const listsAfterOpen = listCalls;
  assert.ok(listsAfterOpen >= 1);
  owner.beginOwnVenueWithdraw(ownRow());
  const pending = owner.confirmOwnVenueWithdraw();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');

  // Open (or re-open) history while inFlight — stays idle; no extra GET yet.
  owner.openOwnVenueHistory();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueSurface?.mode, 'history');
  assert.equal(owner.getSnapshot().ownVenue.status, 'idle');
  assert.equal(listCalls, listsAfterOpen);

  releaseSend!({
    id: reviewId,
    version: 2,
    status: 'withdrawn',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  });
  await pending;
  await tick();
  // One deferred GET after inFlight cleanup for the still-current history demand.
  assert.equal(owner.getSnapshot().ownVenue.status, 'ready');
  assert.equal(listCalls, listsAfterOpen + 1);
  assert.equal(owner.getSnapshot().command, null);

  // Close then account switch: deferred must not fire a late GET.
  const listsReady = listCalls;
  owner.closeOwnVenueHistory();
  owner.setActor({
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    generation: 1,
  });
  await tick();
  assert.equal(listCalls, listsReady);
  assert.equal(owner.getSnapshot().ownVenueSurface, null);
});

test('address5: Profile history lifetime — stale retire cannot close newer gen; nav intent actor-fenced', async () => {
  let listCalls = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => {
        listCalls += 1;
        return { items: [ownRow()] };
      },
    }),
  }, () => 'lifetime-key');
  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  const first = captureOwnVenueHistoryRouteOwner({
    actor,
    surface: owner.getSnapshot().ownVenueSurface,
  });
  assert.ok(first);
  const noted = noteOwnVenueHistoryRouteOwner(null, first);
  assert.equal(noted?.gen, first!.gen);

  owner.openOwnVenueHistory();
  await tick();
  const second = captureOwnVenueHistoryRouteOwner({
    actor,
    surface: owner.getSnapshot().ownVenueSurface,
  });
  assert.ok(second);
  assert.notEqual(second!.gen, first!.gen);
  // Stale cleanup of the first generation must not close the newer surface.
  owner.retireOwnVenueHistorySurface(first!);
  assert.equal(owner.getSnapshot().ownVenueSurface?.gen, second!.gen);
  assert.equal(owner.getSnapshot().ownVenue.status, 'ready');

  owner.requestOwnVenueHistoryNavIntent();
  // Wrong actor discards intent without opening.
  owner.setActor({
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    generation: 1,
  });
  assert.equal(owner.consumeOwnVenueHistoryNavIntent(), false);
  assert.equal(owner.getSnapshot().ownVenueSurface, null);

  owner.setActor(actor);
  owner.requestOwnVenueHistoryNavIntent();
  assert.equal(owner.consumeOwnVenueHistoryNavIntent(), true);
  // Second consume is empty — at-most-once.
  assert.equal(owner.consumeOwnVenueHistoryNavIntent(), false);
  assert.equal(listCalls >= 2, true);
});

test('address5: selected GET wrong id/handle/venue fails closed; zero POST; fence kept', async () => {
  const otherId = '66666666-6666-4666-8666-666666666666';
  const otherHandle = 'ffffffffffffffffffffffffffffffff';
  const otherVenue = '33333333-3333-4333-8333-333333333333';
  let detailMode: 'ok' | 'wrong-id' | 'wrong-handle' | 'wrong-venue' = 'ok';
  const posts: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnDetail: async (_actor, id) => {
        if (detailMode === 'wrong-id') {
          return { ...selected(2), id: otherId };
        }
        if (detailMode === 'wrong-handle') {
          return { ...selected(2), reviewHandle: otherHandle };
        }
        if (detailMode === 'wrong-venue') {
          return { ...selected(2), venueId: otherVenue };
        }
        assert.equal(id, reviewId);
        return selected(2);
      },
      send: async (packet) => {
        posts.push(packet.key);
        throw new PostgameError('business', 409, 'VERSION_CONFLICT');
      },
    }),
  }, () => `bind-${posts.length + 1}`);

  assert.equal(ownVenueSelectedMatchesRequest(selected(), {
    id: reviewId,
    venueId,
    reviewHandle: handle,
  }), true);
  assert.equal(ownVenueSelectedMatchesRequest(selected(), {
    id: otherId,
    venueId,
    reviewHandle: handle,
  }), false);
  assert.equal(ownVenueSelectedMatchesRequest({ ...selected(), reviewHandle: otherHandle }, {
    id: reviewId,
    venueId,
    reviewHandle: handle,
  }), false);
  assert.equal(ownVenueSelectedMatchesRequest({ ...selected(), venueId: otherVenue }, {
    id: reviewId,
    venueId,
    reviewHandle: handle,
  }), false);

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit(ownRow());
  await tick();
  owner.patchVenueDraft({ text: 'Не менять таргет', topics: ['lighting'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(posts.length, 1);

  // Fixture open returns selected(2); capture exact prior selected before wrong responses.
  const priorSelected = owner.getSnapshot().ownVenueSelected;
  assert.ok(priorSelected);
  assert.equal(priorSelected.version, 2);
  assert.equal(priorSelected.id, reviewId);

  detailMode = 'wrong-id';
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);
  assert.equal(owner.getSnapshot().ownVenueSelected, priorSelected);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, priorSelected.version);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Не менять таргет');
  assert.equal(posts.length, 1);

  detailMode = 'wrong-handle';
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);
  assert.equal(owner.getSnapshot().ownVenueSelected, priorSelected);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, priorSelected.version);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Не менять таргет');
  assert.equal(posts.length, 1);

  detailMode = 'wrong-venue';
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);
  assert.equal(owner.getSnapshot().ownVenueSelected, priorSelected);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, priorSelected.version);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Не менять таргет');
  assert.equal(posts.length, 1);

  detailMode = 'ok';
  await owner.loadOwnVenueSelected(reviewId, { clearConflict: true });
  await tick();
  assert.equal(owner.getSnapshot().ownVenueReadRequired, false);
  assert.equal(owner.getSnapshot().ownVenueSelected?.version, 2);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Не менять таргет');
  assert.equal(posts.length, 1);

  // Native adapter id binding via injected fetch — not source-regex-only.
  const wrongIdBody = { ...selected(2), id: otherId };
  const wrongIdApi = createNativeApi(async () => new Response(JSON.stringify(wrongIdBody)));
  await assert.rejects(
    () => wrongIdApi.venueExperienceOwnDetail('access', reviewId),
    (error: unknown) => error instanceof PostgameError && error.kind === 'invalid',
  );
  const okApi = createNativeApi(async () => new Response(JSON.stringify(selected(2))));
  const bound = await okApi.venueExperienceOwnDetail('access', reviewId);
  assert.equal(bound.id, reviewId);
  assert.equal(bound.version, 2);
});

test('address8: deferred selected GET → withdraw dispatch/ACK cannot restore old text/editor/row', async () => {
  let releaseDetail!: (value: SelectedOwnVenueReview) => void;
  const detailGate = new Promise<SelectedOwnVenueReview>(resolve => { releaseDetail = resolve; });
  let releaseSend!: (value: unknown) => void;
  const sendGate = new Promise<unknown>(resolve => { releaseSend = resolve; });
  let detailCalls = 0;
  // Truthful owned list: start v1; flip to withdrawn v2 only at ACK (idlePort ownRow() is obsolete after withdraw).
  let listItems: OwnVenueReview[] = [ownRow(1)];
  const posts: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => ({
        items: listItems.map(row => ({ ...row, topics: [...row.topics] })),
      }),
      venueExperienceOwnDetail: async () => {
        detailCalls += 1;
        if (detailCalls === 1) return detailGate;
        // Late / post-ACK selected still returns pre-withdraw detail — production must fence.
        return selected(1);
      },
      send: async (packet) => {
        if (!isVenueExperienceCommandPacket(packet)) {
          throw assert.fail('expected venue-experience-command packet');
        }
        assert.equal(packet.body.action, 'withdraw');
        posts.push(packet.key);
        return sendGate;
      },
    }),
  }, () => 'addr8-wd-race-key');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  // Tap Edit — selected GET stays pending.
  owner.openOwnVenueEdit(ownRow(1));
  await tick();
  assert.equal(detailCalls, 1);
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, undefined);

  owner.beginOwnVenueWithdraw(ownRow(1));
  const pendingWithdraw = owner.confirmOwnVenueWithdraw();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  assert.equal(posts.length, 1);

  // Late pre-ACK detail must not open composer or replace the row after mutation begins.
  releaseDetail!(selected(1));
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, undefined);
  assert.equal(owner.getSnapshot().venueDraft, null);
  assert.notEqual(owner.getSnapshot().ownVenueSelected?.status, 'withdrawn');
  assert.equal(posts.length, 1);

  // Update synthetic server list at ACK, then release — follow-up GET must see withdrawn v2.
  listItems = [{
    ...ownRow(2),
    status: 'withdrawn',
    text: null,
    topics: [],
    pendingRevision: null,
    audience: null,
    publicVisible: false,
    receiptToken: null,
  }];
  releaseSend!({
    id: reviewId,
    version: 2,
    status: 'withdrawn',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  });
  await pendingWithdraw;
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueNotice?.includes('отозван'), true);
  const withdrawn = owner.getSnapshot().ownVenue.data?.items.find(row => row.id === reviewId);
  assert.equal(withdrawn?.status, 'withdrawn');
  assert.equal(withdrawn?.version, 2);
  assert.equal(withdrawn?.text, null);
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(owner.getSnapshot().venueDraft, null);
  assert.equal(posts.length, 1);

  // Post-ACK late selected of pre-withdraw detail — two bounded option cases; no restore, zero extra POST.
  for (const opts of [{ forEdit: true }, { clearConflict: true }] as const) {
    await owner.loadOwnVenueSelected(reviewId, opts);
    await tick();
    assert.equal(owner.getSnapshot().venueExperience?.reviewId, undefined);
    assert.equal(owner.getSnapshot().venueDraft, null);
    assert.equal(owner.getSnapshot().ownVenue.data?.items.find(row => row.id === reviewId)?.status, 'withdrawn');
    assert.equal(owner.getSnapshot().ownVenue.data?.items.find(row => row.id === reviewId)?.text, null);
    assert.equal(owner.getSnapshot().ownVenue.data?.items.find(row => row.id === reviewId)?.version, 2);
    assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
    assert.equal(posts.length, 1);
  }
});

test('address8: successful revision + open history during send → exactly one follow-up GET after reservation cleanup', async () => {
  let listCalls = 0;
  let releaseSend!: (value: unknown) => void;
  const sendGate = new Promise<unknown>(resolve => { releaseSend = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => {
        listCalls += 1;
        return { items: [ownRow(listCalls === 1 ? 1 : 2)] };
      },
      send: async (packet) => {
        if (!isVenueExperienceCommandPacket(packet)) {
          throw assert.fail('expected venue-experience-command packet');
        }
        assert.equal(packet.body.action, 'submit_revision');
        return sendGate;
      },
    }),
  }, () => 'addr8-rev-defer-key');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  const listsAfterOpen = listCalls;
  assert.ok(listsAfterOpen >= 1);
  owner.openOwnVenueEdit(ownRow(1));
  await tick();
  owner.patchVenueDraft({ text: 'Редакция во время отправки', topics: ['surface'] });
  const pending = owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'sending');

  // Re-open history while revision sending — demand is deferred; no extra GET yet.
  owner.openOwnVenueHistory();
  await tick();
  assert.equal(owner.getSnapshot().ownVenueSurface?.mode, 'history');
  assert.equal(owner.getSnapshot().ownVenue.status, 'idle');
  assert.equal(listCalls, listsAfterOpen);

  releaseSend!({
    id: reviewId,
    version: 2,
    status: 'revision_waiting',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  });
  await pending;
  await tick();
  // Exactly one deferred GET after writePrepare release — not stuck idle forever.
  assert.equal(listCalls, listsAfterOpen + 1);
  assert.equal(owner.getSnapshot().ownVenue.status, 'ready');
  assert.equal(owner.getSnapshot().ownVenue.data?.items[0]?.version, 2);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().ownVenueReadRequired, true);
});

test('address8: history sheet close during sending retains immutable journal key/body/age', async () => {
  let releaseSend!: (value: unknown) => void;
  const sendGate = new Promise<unknown>(resolve => { releaseSend = resolve; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async () => sendGate,
    }),
  }, () => 'addr8-close-send-key');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.beginOwnVenueWithdraw(ownRow());
  const pending = owner.confirmOwnVenueWithdraw();
  await tick();
  const cmd = owner.getSnapshot().command;
  assert.equal(cmd?.status, 'sending');
  assert.equal(isVenueExperienceCommandPacket(cmd!.packet), true);
  const frozenKey = cmd!.packet.key;
  const frozenBody = { ...cmd!.packet.body };
  const frozenAge = cmd!.firstDispatchedAt;
  assert.equal(typeof frozenAge, 'number');

  // Hide withdraw confirm, then close history while still sending — journal must survive.
  owner.cancelOwnVenueWithdraw();
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  assert.equal(owner.getSnapshot().command?.packet.key, frozenKey);
  owner.closeOwnVenueHistory();
  assert.equal(owner.getSnapshot().ownVenueSurface, null);
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  assert.equal(owner.getSnapshot().command?.packet.key, frozenKey);
  assert.deepEqual(owner.getSnapshot().command?.packet.body, frozenBody);
  assert.equal(owner.getSnapshot().command?.firstDispatchedAt, frozenAge);

  releaseSend!({
    id: reviewId,
    version: 2,
    status: 'withdrawn',
    reviewHandle: handle,
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  });
  await pending;
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueNotice?.includes('отозван'), true);
});

test('#522 address10: selected empty topics preserved; last-topic removal stays empty; create default surface retained', async () => {
  const emptySelected = (): SelectedOwnVenueReview => ({
    ...selected(),
    text: 'Текст без тем',
    topics: [],
  });
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => ({ items: [{ ...ownRow(), text: 'Текст без тем', topics: [] }] }),
      venueExperienceOwnDetail: async () => emptySelected(),
    }),
  }, () => 'addr10-empty-prefill');

  owner.setActor(actor);
  // Fresh create still defaults to surface — edit path must not rewrite that helper.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, ['surface']);
  owner.closeVenueExperience();

  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit({ ...ownRow(), text: 'Текст без тем', topics: [] });
  await tick();
  assert.equal(owner.getSnapshot().venueExperience?.reviewId, reviewId);
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, []);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Текст без тем');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);

  // Deliberate last-topic removal (composer patch after deselect) must stay empty — no silent surface.
  owner.patchVenueDraft({ topics: ['surface'] });
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, ['surface']);
  owner.patchVenueDraft({ topics: [] });
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, []);
});

test('#522 address10: private revision body transmits empty topics; no silent surface replacement', async () => {
  const posts: Array<{ body: Record<string, unknown> }> = [];
  const emptySelected = (): SelectedOwnVenueReview => ({
    ...selected(),
    text: 'Личный текст без тем',
    topics: [],
  });
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => ({
        items: [{ ...ownRow(), text: 'Личный текст без тем', topics: [] }],
      }),
      venueExperienceOwnDetail: async () => emptySelected(),
      send: async (packet) => {
        assert.equal(isVenueExperienceCommandPacket(packet), true);
        posts.push({ body: packet.body as Record<string, unknown> });
        return {
          id: reviewId,
          version: 2,
          status: 'revision_waiting',
          reviewHandle: handle,
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => 'addr10-private-empty');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit({ ...ownRow(), text: 'Личный текст без тем', topics: [] });
  await tick();
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, []);

  owner.patchVenueDraft({ text: 'Обновлённый личный без тем', topics: [] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.body.action, 'submit_revision');
  assert.deepEqual(posts[0]!.body.topics, []);
  assert.equal(posts[0]!.body.consentProjectionHash, undefined);
  assert.equal(posts[0]!.body.audience, 'self_draft');
});

test('#522 address10: public empty topics — fresh explicit consent; preview/transmit empty; no autoPOST', async () => {
  const posts: Array<{ body: Record<string, unknown> }> = [];
  const previewCalls: Array<{ topics: string[]; text: string }> = [];
  const emptySelected = (): SelectedOwnVenueReview => ({
    ...selected(),
    text: 'Публичный текст без тем',
    topics: [],
    audience: 'self_draft',
  });
  const consentHash = 'b'.repeat(64);
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceOwnList: async () => ({
        items: [{ ...ownRow(), text: 'Публичный текст без тем', topics: [] }],
      }),
      venueExperienceOwnDetail: async () => emptySelected(),
      venueExperienceConsentPreview: async (_actor, args) => {
        previewCalls.push({ topics: [...args.topics], text: args.text });
        return { consentProjectionHash: consentHash, authorLabel: 'Участник игры' };
      },
      send: async (packet) => {
        assert.equal(isVenueExperienceCommandPacket(packet), true);
        posts.push({ body: packet.body as Record<string, unknown> });
        return {
          id: reviewId,
          version: 2,
          status: 'revision_waiting',
          reviewHandle: handle,
          receiptToken: 'intake-token',
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => 'addr10-public-empty');

  owner.setActor(actor);
  owner.openOwnVenueHistory();
  await tick();
  owner.openOwnVenueEdit({ ...ownRow(), text: 'Публичный текст без тем', topics: [] });
  await tick();
  assert.deepEqual(owner.getSnapshot().venueDraft?.topics, []);
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(posts.length, 0);
  assert.equal(previewCalls.length, 0);

  // Audience flip alone must not auto-preview or auto-POST.
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст без тем', topics: [] });
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(previewCalls.length, 0);
  assert.equal(posts.length, 0);

  // Submit without consent blocked — still zero POST.
  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 0);
  assert.match(owner.getSnapshot().venueNotice ?? '', /согласие/i);

  await owner.ensureVenueConsentPreview();
  assert.equal(previewCalls.length, 1);
  assert.deepEqual(previewCalls[0]!.topics, []);
  assert.equal(owner.getSnapshot().venueConsentHash, consentHash);
  assert.equal(owner.getSnapshot().venueDraft?.consent, true);
  assert.equal(posts.length, 0);

  await owner.submitVenueExperience();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.body.action, 'submit_revision');
  assert.equal(posts[0]!.body.audience, 'public_venue');
  assert.deepEqual(posts[0]!.body.topics, []);
  assert.equal(posts[0]!.body.consentProjectionHash, consentHash);
});

test('source wiring: Profile entry + controller bearer + APK38 + fixture owner coverage', () => {
  const profile = read('../app/profile.tsx');
  assert.match(profile, /OwnVenueReviewsEntry/);
  assert.match(profile, /OwnVenueReviewsHost/);
  assert.match(profile, /openOwnVenueHistory/);
  assert.match(profile, /Отзывы о площадках/);
  assert.match(profile, /Этот список видите только вы\./);
  // Host mounted outside editing gate so Profile edit toggle does not retire history.
  assert.match(profile, /retire only on route blur\/unmount/);

  const host = read('../src/components/own-venue-reviews.tsx');
  assert.match(host, /Перечитать выбранный отзыв/);
  assert.match(host, /Отозвать отзыв/);
  assert.match(host, /experienceReviews/);
  assert.match(host, /ownVenueWithdrawConfirmFlags/);
  assert.match(host, /Скрыть окно/);
  assert.match(host, /Открыть отзывы/);
  assert.match(host, /Эту версию видите только вы\./);
  assert.match(host, /Повторить запрос на снятие/);
  assert.match(host, /Повторить сохранение/);
  assert.match(host, /Отозвать отзыв можно и после окончания срока редактирования\./);
  assert.match(host, /useFocusEffect/);
  assert.match(host, /captureOwnVenueHistoryRouteOwner/);
  assert.match(host, /retireOwnVenueHistorySurface/);
  assert.match(host, /consumeOwnVenueHistoryNavIntent/);
  assert.match(host, /const expected = ownedRouteRef\.current/);
  // History Close/Back/escape usable while sending — journal retained (composer/WithdrawConfirm parity).
  assert.match(host, /immutable sending\/UNKNOWN journal stays/);
  assert.doesNotMatch(host, /if \(s\.command\?\.status === 'sending'\) return/);
  assert.doesNotMatch(host, /return \(\) => \{[\s\S]*getSnapshot\(\)[\s\S]*retireOwnVenueHistorySurface/);
  assert.doesNotMatch(host, /game.?picker|новый выбор игры/i);
  assert.doesNotMatch(host, /Ожидает обработки|модерац/i);

  const postgameUi = read('../src/components/postgame.tsx');
  assert.match(postgameUi, /venueExperiencePendingRecoveryTarget/);
  assert.match(postgameUi, /requestOwnVenueHistoryNavIntent/);
  assert.match(postgameUi, /venuePendingOtherGame/);
  assert.match(postgameUi, /Посмотреть отправку/);
  assert.match(postgameUi, /router\.push\('\/profile'\)/);
  assert.doesNotMatch(postgameUi, /params:\s*\{\s*gameId:\s*command\.packet\.gameId\s*\}/);

  const venueReviews = read('../src/venue-reviews.ts');
  assert.match(venueReviews, /export function ownVenueWithdrawConfirmFlags/);
  assert.match(venueReviews, /export function venueExperiencePendingRecoveryTarget/);
  assert.match(venueReviews, /export function ownVenueSelectedMatchesRequest/);
  assert.match(venueReviews, /export function captureOwnVenueHistoryRouteOwner/);
  assert.match(venueReviews, /Личный черновик/);
  assert.match(venueReviews, /На проверке/);

  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(coordinator, /flushDeferredOwnVenueList/);
  assert.match(coordinator, /keepSelectedReadFence/);
  assert.match(coordinator, /ownVenueSelectedMatchesRequest/);
  assert.match(coordinator, /retireOwnVenueHistorySurface/);
  assert.match(coordinator, /requestOwnVenueHistoryNavIntent/);
  // address8: mutation begin+ACK fence selected reads; prepare release flushes deferred list.
  assert.match(coordinator, /Fence outstanding selected GETs at mutation begin/);
  assert.match(coordinator, /ACK invalidates outstanding selected reads/);
  assert.match(coordinator, /dispatch\.finally can run before this release/);
  assert.match(coordinator, /mutationAhead/);

  const composer = read('../src/components/venue-experience-composer.tsx');
  assert.match(composer, /showSelectedReread/);
  assert.match(composer, /Эти изменения увидите только вы\./);
  assert.match(composer, /Чтобы отправить изменения на публикацию, подтвердите согласие ещё раз\./);
  assert.match(composer, /Отзыв относится к той же игре\./);
  assert.match(composer, /Загружаем отзыв…/);
  assert.match(composer, /По умолчанию текст только вам\. Публичный отзыв/);

  const controller = read('../../api/src/venues/venue-reviews.controller.ts');
  assert.match(controller, /listMine[\s\S]*requirePrincipal/);
  assert.match(controller, /getMine[\s\S]*requirePrincipal/);
  assert.match(controller, /submit_revision[\s\S]*withdraw/);
  assert.match(controller, /requirePrincipalMutation/);
  assert.match(controller, /requireCookieMutation/);

  const fixture = read('../../api/test/integration/venue-reviews.disposable.test.ts');
  assert.match(fixture, /genuine native owner venue history/);
  assert.match(fixture, /Narrow auth update: owner list\/detail admitted/);
  assert.match(fixture, /Native appeal остаётся cookie-only/);
  assert.doesNotMatch(fixture, /Cookie-only siblings: listMine\/getMine/);

  const openapi = read('../../../packages/contracts/openapi.json');
  assert.match(openapi, /"operationId": "listOwnVenueReviews"[\s\S]*"NativeBearer"/);
  assert.match(openapi, /"operationId": "getOwnVenueReview"[\s\S]*"NativeBearer"/);
  assert.match(openapi, /"operationId": "ownVenueReviewCommand"[\s\S]*"NativeBearer"/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 43);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /venueExperienceOwnList/);
  assert.match(auth, /venueExperienceOwnDetail/);
  const api = read('../src/native-api.ts');
  assert.match(api, /\/me\/venue-reviews\/\$\{/);
  assert.match(api, /venueExperienceOwnList/);
});
