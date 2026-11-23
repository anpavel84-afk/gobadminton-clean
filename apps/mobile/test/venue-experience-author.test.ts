import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError } from '../src/postgame.ts';
import {
  VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS,
  buildVenueExperienceCreateBody,
  emptyVenueExperienceDraft,
  exactGameMaySubmitBasis,
  isVenueExperienceCreateReceipt,
  isVenueExperiencePacketKind,
  parseOwnVenueEligibility,
  parseVenueConsentPreview,
  parseVenueReviewMutationReceipt,
  venueEligibilityReasonCopy,
  venueExperienceIdempotencyExpired,
  venueExperienceReceiptSummary,
  venueReviewEligibilityHelp,
  postgameIdempotencyReplayBlocked,
} from '../src/venue-reviews.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gameId = '11111111-1111-4111-8111-111111111111';
const venueId = '22222222-2222-4222-8222-222222222222';
const actor = { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', generation: 1 };

const eligibilityBody = (admission: 'may_submit' | 'hold' | 'deny' = 'may_submit') => ({
  bases: [{
    gameId,
    gameTitle: 'Practice',
    admission,
    reason: admission === 'may_submit' ? null : 'window_closed',
    outcomeVersion: 1,
    attendanceVersion: 2,
    firstEligibleAt: '2026-01-01T12:00:00.000Z',
    helpHint: null,
  }],
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
    venueExperienceEligibility: async () => eligibilityBody(),
    venueExperienceConsentPreview: async () => ({
      consentProjectionHash: 'a'.repeat(64),
      authorLabel: 'Участник игры',
    }),
    ...overrides,
  };
}

const tick = () => new Promise(r => setImmediate(r));

test('parsers whitelist venue eligibility/preview/receipt; reject role-shaped extras', () => {
  const elig = parseOwnVenueEligibility(eligibilityBody());
  assert.equal(exactGameMaySubmitBasis(elig, gameId)?.attendanceVersion, 2);
  assert.equal(exactGameMaySubmitBasis(elig, '33333333-3333-4333-8333-333333333333'), null);
  assert.equal(exactGameMaySubmitBasis(parseOwnVenueEligibility(eligibilityBody('hold')), gameId), null);
  // Missing/invalid firstEligibleAt fail-closed — no invented may_submit rights.
  const missingAnchor = parseOwnVenueEligibility({
    bases: [{
      gameId,
      gameTitle: 'Practice',
      admission: 'may_submit',
      reason: null,
      outcomeVersion: 1,
      attendanceVersion: 2,
      firstEligibleAt: null,
      helpHint: null,
    }],
  });
  assert.equal(exactGameMaySubmitBasis(missingAnchor, gameId), null);

  const preview = parseVenueConsentPreview({
    consentProjectionHash: 'B'.repeat(64),
    authorLabel: 'Участник игры',
  });
  assert.equal(preview.consentProjectionHash, 'b'.repeat(64));
  assert.throws(() => parseVenueConsentPreview({ consentProjectionHash: 'c'.repeat(64), authorLabel: 'Организатор' }));

  const privateReceipt = parseVenueReviewMutationReceipt({
    id: '55555555-5555-4555-8555-555555555555',
    version: 1,
    status: 'self_draft',
    reviewHandle: 'd'.repeat(32),
    receiptToken: null,
    publicVisible: false,
    notBefore: null,
  });
  assert.equal(isVenueExperienceCreateReceipt(privateReceipt, 'self_draft'), true);
  assert.equal(isVenueExperienceCreateReceipt(privateReceipt, 'public_venue'), false);

  const publicReceipt = parseVenueReviewMutationReceipt({
    ...privateReceipt,
    status: 'submitted_waiting',
    receiptToken: 'intake-token',
  });
  assert.equal(isVenueExperienceCreateReceipt(publicReceipt, 'public_venue'), true);
  assert.equal(isVenueExperiencePacketKind('venue-experience-create'), true);
  assert.equal(isVenueExperiencePacketKind('public-role-create'), false);

  // Blank/whitespace-only public intake token is not a successful public receipt.
  assert.throws(() => parseVenueReviewMutationReceipt({
    ...privateReceipt,
    status: 'submitted_waiting',
    receiptToken: '   \t  ',
  }));
  assert.equal(isVenueExperienceCreateReceipt({
    ...publicReceipt,
    receiptToken: '   ',
  }, 'public_venue'), false);
});

test('deferred entry/consent: private default, public needs preview; no autosend on open/reauth', async () => {
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      send: async (packet) => {
        keys.push(packet.key);
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
  }, () => `key-${keys.length + 1}`);

  owner.setActor(actor);
  owner.probeVenueEligibility(gameId, venueId);
  await tick();
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId)?.admission, 'may_submit');
  assert.equal(keys.length, 0);

  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.audience, 'self_draft');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);

  owner.patchVenueDraft({ text: 'Точный опыт покрытия', topics: ['surface'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(keys.length, 1);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'self_draft');
  assert.equal(owner.getSnapshot().venueReceipt?.receiptToken, null);

  // Reauth same actor: no autosend; consent cleared.
  owner.setActor(null);
  owner.setActor({ ...actor, generation: 2 });
  await tick();
  assert.equal(keys.length, 1);
});

test('consent race + business retain + UNKNOWN recovery + 24h expiry blocks late POST', async () => {
  let mode: 'preview-stale' | 'business' | 'unknown' | 'ok' = 'preview-stale';
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceConsentPreview: async () => {
        if (mode === 'preview-stale') {
          await new Promise(r => setTimeout(r, 5));
        }
        return { consentProjectionHash: 'f'.repeat(64), authorLabel: 'Участник игры' };
      },
      send: async (packet) => {
        keys.push(packet.key);
        if (mode === 'business') throw new PostgameError('business', 422, 'VENUE_CONSENT_MISMATCH');
        if (mode === 'unknown') throw new PostgameError('network', 503);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: 'submitted_waiting',
          reviewHandle: 'a'.repeat(32),
          receiptToken: 'tok',
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `key-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст опыта', topics: ['lighting'] });
  const first = owner.ensureVenueConsentPreview();
  owner.patchVenueDraft({ text: 'Другой текст' });
  await first;
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);

  mode = 'ok';
  await owner.ensureVenueConsentPreview();
  assert.equal(owner.getSnapshot().venueConsentHash, 'f'.repeat(64));
  assert.equal(owner.getSnapshot().venueDraft?.consent, true);

  mode = 'business';
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Другой текст');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.match(owner.getSnapshot().venueNotice ?? '', /сохранён|недоступна/i);

  mode = 'unknown';
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст опыта', topics: ['lighting'], consent: false });
  await owner.ensureVenueConsentPreview();
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(isVenueExperiencePacketKind(owner.getSnapshot().command!.packet.kind), true);
  const unknownKey = owner.getSnapshot().command!.packet.key;
  const body = owner.getSnapshot().command!.packet.body;

  // Explicit recovery keeps original key/body.
  mode = 'ok';
  await owner.reconcileVenueExperience();
  await tick();
  assert.equal(keys.filter(k => k === unknownKey).length >= 1, true);
  assert.equal(owner.getSnapshot().command, null);

  // Fresh UNKNOWN then expire 24h — never late POST.
  mode = 'unknown';
  owner.closeVenueExperience();
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'self_draft', text: 'Ещё один текст', topics: ['amenities'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const cmd = owner.getSnapshot().command!;
  (cmd as { firstDispatchedAt: number }).firstDispatchedAt = Date.now() - VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS - 1;
  const before = keys.length;
  await owner.reconcileVenueExperience();
  assert.equal(keys.length, before);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.match(owner.getSnapshot().venueNotice ?? '', /неизвестен|недоступен|сайте/i);
  assert.equal(venueExperienceIdempotencyExpired(cmd.firstDispatchedAt!), true);
  assert.equal(postgameIdempotencyReplayBlocked(cmd.firstDispatchedAt!), true);
  void body;
});

test('venue business notice survives deferred automatic eligibility reread', async () => {
  let releaseElig!: () => void;
  const eligGate = new Promise<void>(r => { releaseElig = r; });
  let eligCalls = 0;
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        eligCalls += 1;
        // Open + submit prepare succeed immediately; post-business automatic reread waits.
        if (eligCalls >= 3) await eligGate;
        return eligibilityBody();
      },
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('business', 422, 'VENUE_CONSENT_MISMATCH');
      },
    }),
  }, () => `preserve-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Сохранённый публичный текст', topics: ['lighting'] });
  await owner.ensureVenueConsentPreview();
  assert.equal(owner.getSnapshot().venueDraft?.consent, true);

  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command, null);
  assert.match(owner.getSnapshot().venueNotice ?? '', /сохранён|недоступна/i);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Сохранённый публичный текст');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  const noticeDuringReread = owner.getSnapshot().venueNotice;

  releaseElig();
  await tick();
  assert.equal(owner.getSnapshot().venueNotice, noticeDuringReread);
  assert.match(owner.getSnapshot().venueNotice ?? '', /сохранён|недоступна/i);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Сохранённый публичный текст');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'ready');
  assert.equal(keys.length, 1);
});

test('buildVenueExperienceCreateBody fences public hash and private no-hash', () => {
  const basis = parseOwnVenueEligibility(eligibilityBody()).bases[0]!;
  const privateBody = buildVenueExperienceCreateBody({
    venueId, basis, audience: 'self_draft', text: 'Личный опыт', topics: ['surface'],
  });
  assert.equal('consentProjectionHash' in privateBody, false);
  assert.throws(() => buildVenueExperienceCreateBody({
    venueId, basis, audience: 'self_draft', text: 'Личный опыт', topics: ['surface'],
    consentProjectionHash: '1'.repeat(64),
  }));
  const publicBody = buildVenueExperienceCreateBody({
    venueId, basis, audience: 'public_venue', text: 'Публичный опыт', topics: ['surface'],
    consentProjectionHash: '2'.repeat(64),
  });
  assert.equal(publicBody.consentProjectionHash, '2'.repeat(64));
  assert.deepEqual(emptyVenueExperienceDraft().topics, ['surface']);
});

test('deferred prepare ownership: one fresh POST; stale draft/consent invalidates; close hides UNKNOWN', async () => {
  const keys: string[] = [];
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>(r => { releaseSecond = r; });
  let eligCalls = 0;
  const racing = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        eligCalls += 1;
        if (eligCalls >= 2) await secondGate;
        return eligibilityBody();
      },
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `race-${keys.length + 1}`);
  racing.setActor(actor);
  racing.openVenueExperience(gameId, venueId);
  await tick();
  racing.patchVenueDraft({ text: 'Первый текст покрытия', topics: ['surface'] });

  const first = racing.submitVenueExperience();
  const second = racing.submitVenueExperience();
  await tick();
  releaseSecond();
  await Promise.all([first, second]);
  await tick();
  assert.equal(keys.length, 1);
  assert.equal(racing.getSnapshot().command?.status, 'unknown');
  const unknownKey = racing.getSnapshot().command!.packet.key;
  const age = racing.getSnapshot().command!.firstDispatchedAt;

  // Close hides surface; journal packet/key/age immutable.
  racing.closeVenueExperience();
  assert.equal(racing.getSnapshot().venueExperience, null);
  assert.equal(racing.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(racing.getSnapshot().command?.firstDispatchedAt, age);

  // Same-origin reopen recovers read-only pending; no auto POST / key rotate.
  const beforeReopen = keys.length;
  racing.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(!!racing.getSnapshot().venueExperience, true);
  assert.equal(racing.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(keys.length, beforeReopen);

  // Stale draft during prepare: edit after eligibility await starts → no overwrite POST.
  const staleKeys: string[] = [];
  let releaseStale!: () => void;
  const staleGate = new Promise<void>(r => { releaseStale = r; });
  let staleElig = 0;
  const stale = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        staleElig += 1;
        if (staleElig >= 2) await staleGate;
        return eligibilityBody();
      },
      send: async (packet) => {
        staleKeys.push(packet.body.text);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: 'self_draft',
          reviewHandle: 'e'.repeat(32),
          receiptToken: null,
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `stale-${staleKeys.length + 1}`);
  stale.setActor(actor);
  stale.openVenueExperience(gameId, venueId);
  await tick();
  stale.patchVenueDraft({ text: 'Старый захваченный текст', topics: ['surface'] });
  const pending = stale.submitVenueExperience();
  await tick();
  stale.patchVenueDraft({ text: 'Новый черновик пользователя', topics: ['lighting'] });
  releaseStale();
  await pending;
  await tick();
  assert.equal(staleKeys.length, 0);
  assert.equal(stale.getSnapshot().venueDraft?.text, 'Новый черновик пользователя');
  assert.equal(stale.getSnapshot().command, null);
});

test('private vs public receipt summary + closed eligibility reason copy', () => {
  const base = {
    id: '55555555-5555-4555-8555-555555555555',
    version: 2,
    reviewHandle: 'd'.repeat(32),
    publicVisible: false,
    notBefore: null,
  };
  const privateRevision = venueExperienceReceiptSummary({
    ...base,
    status: 'revision_waiting',
    receiptToken: null,
  }, 'self_draft');
  assert.match(privateRevision.primary, /только вам/i);
  assert.match(privateRevision.visibility, /ранее опубликованная|только вам/i);
  assert.doesNotMatch(privateRevision.primary, /проверк|модерац/i);
  assert.doesNotMatch(privateRevision.visibility, /проверк|модерац|ожидает/i);

  const publicRevision = venueExperienceReceiptSummary({
    ...base,
    status: 'revision_waiting',
    receiptToken: 'intake-token',
  }, 'public_venue');
  assert.match(publicRevision.primary, /проверк/i);
  assert.match(publicRevision.visibility, /Более ранняя опубликованная версия|не опубликована/i);

  const publicNew = venueExperienceReceiptSummary({
    ...base,
    status: 'submitted_waiting',
    receiptToken: 'intake-token',
  }, 'public_venue');
  assert.match(publicNew.primary, /отправлена и ожидает проверки/i);

  assert.equal(isVenueExperienceCreateReceipt({
    ...base, status: 'revision_waiting', receiptToken: null,
  }, 'self_draft'), true);

  assert.equal(venueEligibilityReasonCopy('venue_affiliation')?.includes('venue_affiliation'), false);
  assert.match(venueEligibilityReasonCopy('venue_affiliation') ?? '', /организац/i);
  assert.match(venueEligibilityReasonCopy('lifecycle') ?? '', /недоступна/i);
  assert.match(venueEligibilityReasonCopy('outcome_unknown') ?? '', /исход/i);
  assert.match(venueEligibilityReasonCopy('outcome_dispute') ?? '', /уточнен/i);
  assert.equal(venueEligibilityReasonCopy('totally_unknown_code_xyz'), null);

  const help = venueReviewEligibilityHelp({
    gameId,
    gameTitle: 'Practice',
    admission: 'deny',
    reason: 'venue_affiliation',
    outcomeVersion: 1,
    attendanceVersion: 1,
    firstEligibleAt: null,
    helpHint: null,
  });
  assert.match(help ?? '', /нельзя оставить отзыв/i);
  assert.doesNotMatch(help ?? '', /venue_affiliation|Причина:/);
  const unknownHelp = venueReviewEligibilityHelp({
    gameId,
    gameTitle: null,
    admission: 'hold',
    reason: 'weird_raw_code',
    outcomeVersion: 0,
    attendanceVersion: 0,
    firstEligibleAt: null,
    helpHint: null,
  });
  assert.equal(unknownHelp, 'Сейчас нельзя оставить отзыв по этой игре.');
  assert.doesNotMatch(unknownHelp ?? '', /weird_raw_code/);
});

test('source wiring: results entry + dual-auth guards + APK37 pins', () => {
  const results = read('../app/my-games/[gameId]/results.tsx');
  assert.match(results, /VenueExperienceEntry/);
  assert.doesNotMatch(results, /canWriteHint/);

  const composer = read('../src/components/venue-experience-composer.tsx');
  assert.match(composer, /self_draft/);
  assert.match(composer, /public_venue/);
  assert.match(composer, /ensureVenueConsentPreview/);
  assert.match(composer, /Оставить отзыв о площадке/);
  assert.match(composer, /Посмотреть отправку/);
  assert.match(composer, /Повторить исходную отправку/);
  assert.match(composer, /Результат отправки неизвестен/);
  assert.match(composer, /venueExperienceReceiptSummary/);
  assert.match(composer, /recoveryVenueId|pendingCommand/);
  assert.match(composer, /onAccessibilityEscape/);
  assert.match(composer, /FocusContext/);
  assert.doesNotMatch(composer, /Публичный отзыв не виден/);

  const postgameUi = read('../src/components/postgame.tsx');
  assert.match(postgameUi, /isVenueExperiencePacketKind/);
  assert.match(postgameUi, /venueExperience/);
  assert.match(postgameUi, /showPrivatePendingCta|venuePendingOtherGame/);
  assert.match(postgameUi, /Посмотреть отправку/);

  const helpers = read('../src/venue-reviews.ts');
  assert.match(helpers, /Ранее опубликованная версия может оставаться видимой|Более ранняя опубликованная версия может оставаться видимой/);
  assert.match(helpers, /venueExperienceReceiptSummary/);
  assert.match(helpers, /venueEligibilityReasonCopy/);
  assert.doesNotMatch(helpers, /Причина: \$\{basis\.reason\}/);

  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(coordinator, /venue-experience-create/);
  assert.match(coordinator, /firstDispatchedAt/);
  assert.match(coordinator, /reconcileVenueExperience/);
  assert.match(coordinator, /postgameIdempotencyReplayBlocked|VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS|venueExperienceIdempotencyExpired/);
  assert.match(coordinator, /writePrepare|beginWritePrepare/);
  assert.match(coordinator, /mayDispatchRetention|dispatchPermit/);
  assert.match(coordinator, /Receipt card owns success copy|venueNotice: null/);

  const api = read('../src/native-api.ts');
  assert.match(api, /venueExperienceEligibility/);
  assert.match(api, /venueExperienceConsentPreview/);
  assert.match(api, /\/me\/venue-reviews\/eligibility/);
  assert.match(api, /\/me\/venue-reviews\/consent-preview/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /venueExperienceEligibility/);
  assert.match(auth, /venueExperienceConsentPreview/);
  assert.match(auth, /mayDispatchRetention|dispatchPermit|POSTGAME_RETENTION_EXPIRED/);

  const controller = read('../../api/src/venues/venue-reviews.controller.ts');
  assert.match(controller, /eligibility[\s\S]*requirePrincipal\(request\)/);
  assert.match(controller, /consentPreview[\s\S]*requirePrincipalMutation\(request\)/);
  assert.match(controller, /create\([\s\S]*requirePrincipalMutation\(request\)/);
  assert.match(controller, /listMine[\s\S]*requireSession\(request\)/);
  assert.match(controller, /ownCommand[\s\S]*requireCookieMutation\(request\)/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 37);
});
