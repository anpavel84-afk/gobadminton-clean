import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, validateReceipt, wire } from '../src/postgame.ts';
import {
  buildVenueExperienceSubmitRevisionBody,
  buildVenueExperienceWithdrawBody,
  isSelectedOwnVenueReview,
  isSubmitVenueReviewReceipt,
  isVenueExperienceCommandPacket,
  isVenueExperienceCreatePacket,
  isVenueExperiencePacketKind,
  isWithdrawVenueReviewReceipt,
  mayEditOwnVenue,
  mayWithdrawOwnVenue,
  ownVenueStatusLabel,
  ownVenueWithdrawConfirmFlags,
  parseOwnVenueReviewsPage,
  parseSelectedOwnVenueReview,
  postgameIdempotencyReplayBlocked,
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

test('source wiring: Profile entry + controller bearer + APK38 + fixture owner coverage', () => {
  const profile = read('../app/profile.tsx');
  assert.match(profile, /OwnVenueReviewsEntry/);
  assert.match(profile, /OwnVenueReviewsHost/);
  assert.match(profile, /openOwnVenueHistory/);
  assert.match(profile, /Отзывы о площадках/);
  assert.match(profile, /Этот список видите только вы\./);

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
  assert.doesNotMatch(host, /game.?picker|новый выбор игры/i);
  assert.doesNotMatch(host, /Ожидает обработки|модерац/i);

  const venueReviews = read('../src/venue-reviews.ts');
  assert.match(venueReviews, /export function ownVenueWithdrawConfirmFlags/);
  assert.match(venueReviews, /Личный черновик/);
  assert.match(venueReviews, /На проверке/);

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

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 38);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /venueExperienceOwnList/);
  assert.match(auth, /venueExperienceOwnDetail/);
  const api = read('../src/native-api.ts');
  assert.match(api, /\/me\/venue-reviews\/\$\{/);
  assert.match(api, /venueExperienceOwnList/);
});
