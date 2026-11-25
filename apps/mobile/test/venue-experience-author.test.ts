import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError } from '../src/postgame.ts';
import {
  VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS,
  buildVenueExperienceCreateBody,
  captureVenueExperienceRouteOwner,
  emptyVenueExperienceDraft,
  exactGameMaySubmitBasis,
  isVenueExperienceCreatePacket,
  isVenueExperienceCreateReceipt,
  isVenueExperiencePacketKind,
  noteVenueExperienceRouteOwner,
  parseOwnVenueEligibility,
  parseVenueConsentPreview,
  parseVenueReviewMutationReceipt,
  venueEligibilityReasonCopy,
  venueExperienceBasisAuthority,
  venueExperienceEntryProbeTarget,
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
        assert.equal(isVenueExperienceCreatePacket(packet), true);
        if (!isVenueExperienceCreatePacket(packet)) {
          throw new Error(`expected venue-experience-create, got ${packet.kind}`);
        }
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
        assert.equal(isVenueExperienceCreatePacket(packet), true);
        if (!isVenueExperienceCreatePacket(packet)) {
          throw new Error(`expected venue-experience-create, got ${packet.kind}`);
        }
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
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(venueEligibilityReasonCopy(key), null, key);
    assert.equal(typeof venueEligibilityReasonCopy(key), 'object');
  }

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

test('#522 address7 P1: deferred eligibility → route retire → zeroPOST; stale cleanup spares newer surface', async () => {
  const keys: string[] = [];
  let releaseElig!: () => void;
  const eligGate = new Promise<void>(r => { releaseElig = r; });
  let eligCalls = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        eligCalls += 1;
        // Open resolves immediately; submit prepare eligibility waits across departure.
        if (eligCalls >= 2) await eligGate;
        return eligibilityBody();
      },
      send: async (packet) => {
        keys.push(packet.key);
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
  }, () => `depart-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ text: 'Текст до ухода с маршрута', topics: ['surface'] });
  const departedGen = owner.getSnapshot().venueExperience!.gen;
  const pending = owner.submitVenueExperience();
  await tick();
  assert.equal(!!owner.getSnapshot().venueExperience, true);

  owner.retireVenueExperienceSurface({
    gen: departedGen,
    gameId,
    venueId,
    actorId: actor.actorId,
    sessionId: actor.sessionId,
  });
  assert.equal(owner.getSnapshot().venueExperience, null);

  releaseElig();
  await pending;
  await tick();
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().command, null);

  // Deliberate same-origin reopen after departure — no autosend.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  const newerGen = owner.getSnapshot().venueExperience!.gen;
  assert.notEqual(newerGen, departedGen);
  owner.patchVenueDraft({ text: 'Новая поверхность после возврата', topics: ['lighting'] });

  // Stale blur cleanup for the old gen must not close the newer surface.
  owner.retireVenueExperienceSurface({
    gen: departedGen,
    gameId,
    venueId,
    actorId: actor.actorId,
    sessionId: actor.sessionId,
  });
  assert.equal(owner.getSnapshot().venueExperience?.gen, newerGen);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Новая поверхность после возврата');
  assert.equal(keys.length, 0);
});

test('#522 address7 P2: basis authority change invalidates consent; deferred preview cannot restore', async () => {
  let eligMode: 'v1' | 'v2' | 'deny' | 'missing' = 'v1';
  let deferPreview = false;
  let releasePreview!: () => void;
  const previewGate = new Promise<void>(r => { releasePreview = r; });
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        if (eligMode === 'missing') return { bases: [] };
        if (eligMode === 'deny') return eligibilityBody('deny');
        if (eligMode === 'v2') {
          const body = eligibilityBody();
          return {
            bases: [{ ...body.bases[0]!, outcomeVersion: 2, attendanceVersion: 3 }],
          };
        }
        return eligibilityBody();
      },
      venueExperienceConsentPreview: async () => {
        if (deferPreview) await previewGate;
        return { consentProjectionHash: 'c'.repeat(64), authorLabel: 'Участник игры' };
      },
      send: async () => {
        throw new Error('zeroPOST expected');
      },
    }),
  }, () => 'consent-auth');

  owner.setActor(actor);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст согласия', topics: ['surface'] });
  await owner.ensureVenueConsentPreview();
  assert.equal(owner.getSnapshot().venueDraft?.consent, true);
  assert.equal(owner.getSnapshot().venueConsentHash, 'c'.repeat(64));
  const v1 = venueExperienceBasisAuthority(owner.getSnapshot().venueEligibility.data!, gameId);
  assert.ok(v1);

  eligMode = 'v2';
  await owner.loadVenueEligibility();
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Публичный текст согласия');
  assert.equal(owner.getSnapshot().venueDraft?.audience, 'public_venue');
  assert.equal(owner.getSnapshot().venueDraft?.topics?.join(','), 'surface');
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  const v2 = venueExperienceBasisAuthority(owner.getSnapshot().venueEligibility.data!, gameId);
  assert.notEqual(v2, v1);

  // Deferred preview started before deny reread must not restore hash/consent afterward.
  deferPreview = true;
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный текст согласия', topics: ['surface'] });
  const stalePreview = owner.ensureVenueConsentPreview();
  await tick();
  eligMode = 'deny';
  await owner.loadVenueEligibility();
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  releasePreview();
  await stalePreview;
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Публичный текст согласия');
  assert.equal(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId), null);

  eligMode = 'missing';
  await owner.loadVenueEligibility();
  await tick();
  assert.equal(owner.getSnapshot().venueDraft?.consent, false);
  assert.equal(owner.getSnapshot().venueConsentHash, null);
  assert.equal(venueExperienceBasisAuthority(owner.getSnapshot().venueEligibility.data!, gameId), null);

  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command, null);
});

test('#522 address7 P3: stale submit eligibility cannot overwrite newer load or POST', async () => {
  const keys: string[] = [];
  let releaseSubmitElig!: () => void;
  const submitGate = new Promise<void>(r => { releaseSubmitElig = r; });
  let eligCalls = 0;
  let noticeMarker = '';
  const eligByCall: Array<'allow' | 'deny' | undefined> = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        // Per-call ordinal — after newer deny starts, deferred call 2 must still be original allow.
        const call = ++eligCalls;
        if (call === 2) await submitGate;
        if (call >= 3) {
          noticeMarker = 'deny-painted';
          eligByCall[call] = 'deny';
          return eligibilityBody('deny');
        }
        eligByCall[call] = 'allow';
        return eligibilityBody();
      },
      send: async (packet) => {
        keys.push(packet.key);
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
  }, () => `fence-${keys.length + 1}`);

  owner.setActor(actor);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ text: 'Текст при гонке допуска', topics: ['surface'] });
  const pending = owner.submitVenueExperience();
  await tick();

  await owner.loadVenueEligibility();
  await tick();
  assert.equal(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId), null);
  assert.equal(noticeMarker, 'deny-painted');
  const denyNotice = owner.getSnapshot().venueNotice;

  releaseSubmitElig();
  await pending;
  await tick();
  assert.equal(eligByCall[2], 'allow');
  assert.equal(eligByCall[3], 'deny');
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId), null);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Текст при гонке допуска');
  assert.equal(owner.getSnapshot().venueNotice, denyNotice);

  // Older ordinary load resolving after the latest submit/current read must not repaint authority.
  let releaseOldLoad!: () => void;
  const oldGate = new Promise<void>(r => { releaseOldLoad = r; });
  let loadPhase: 'hold-old' | 'allow-new' = 'hold-old';
  const ordered = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        if (loadPhase === 'hold-old') {
          await oldGate;
          return eligibilityBody('hold');
        }
        return eligibilityBody();
      },
    }),
  }, () => 'order');
  ordered.setActor(actor);
  ordered.openVenueExperience(gameId, venueId);
  // First open load is held; start it then supersede with a newer allow read.
  const openPending = ordered.loadVenueEligibility();
  await tick();
  loadPhase = 'allow-new';
  await ordered.loadVenueEligibility();
  await tick();
  assert.equal(exactGameMaySubmitBasis(ordered.getSnapshot().venueEligibility.data!, gameId)?.admission, 'may_submit');
  releaseOldLoad();
  await openPending;
  await tick();
  assert.equal(exactGameMaySubmitBasis(ordered.getSnapshot().venueEligibility.data!, gameId)?.admission, 'may_submit');

  // Changed-version: deferred original v1 allow after newer v2 must not repaint or POST.
  const versionKeys: string[] = [];
  let releaseVersionSubmit!: () => void;
  const versionGate = new Promise<void>(r => { releaseVersionSubmit = r; });
  let versionCalls = 0;
  const versioned = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        const call = ++versionCalls;
        if (call === 2) await versionGate;
        if (call >= 3) {
          const body = eligibilityBody();
          return {
            bases: [{ ...body.bases[0]!, outcomeVersion: 2, attendanceVersion: 3 }],
          };
        }
        return eligibilityBody();
      },
      send: async (packet) => {
        versionKeys.push(packet.key);
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
  }, () => `ver-${versionKeys.length + 1}`);
  versioned.setActor(actor);
  versioned.openVenueExperience(gameId, venueId);
  await tick();
  versioned.patchVenueDraft({ text: 'Текст при смене версий', topics: ['lighting'] });
  const versionPending = versioned.submitVenueExperience();
  await tick();
  await versioned.loadVenueEligibility();
  await tick();
  const v2 = venueExperienceBasisAuthority(versioned.getSnapshot().venueEligibility.data!, gameId);
  assert.ok(v2);
  assert.deepEqual(v2.split('\u0001').slice(2, 4), ['2', '3']);
  releaseVersionSubmit();
  await versionPending;
  await tick();
  assert.equal(versionKeys.length, 0);
  assert.equal(versioned.getSnapshot().command, null);
  assert.equal(venueExperienceBasisAuthority(versioned.getSnapshot().venueEligibility.data!, gameId), v2);
  assert.equal(exactGameMaySubmitBasis(versioned.getSnapshot().venueEligibility.data!, gameId)?.outcomeVersion, 2);
});

test('#522 address8: production route lifecycle capture retires THIS owner only', async () => {
  const keys: string[] = [];
  let releaseElig!: () => void;
  const eligGate = new Promise<void>(r => { releaseElig = r; });
  let eligCalls = 0;
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        const call = ++eligCalls;
        if (call >= 2) await eligGate;
        return eligibilityBody();
      },
      send: async (packet) => {
        keys.push(packet.key);
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
  }, () => `life-${keys.length + 1}`);

  owner.setActor(actor);
  // Focused route with no surface yet — capture stays null (no retire on ordinary idle).
  let owned = noteVenueExperienceRouteOwner(
    null,
    captureVenueExperienceRouteOwner({
      gameId,
      actor: owner.getSnapshot().actor,
      surface: owner.getSnapshot().venueExperience,
    }),
  );
  assert.equal(owned, null);

  owner.openVenueExperience(gameId, venueId);
  await tick();
  // Open after initial focus — capture THIS lifetime owner (not a later live snapshot).
  owned = noteVenueExperienceRouteOwner(
    owned,
    captureVenueExperienceRouteOwner({
      gameId,
      actor: owner.getSnapshot().actor,
      surface: owner.getSnapshot().venueExperience,
    }),
  );
  assert.ok(owned);
  assert.equal(owned!.gen, owner.getSnapshot().venueExperience!.gen);
  owner.patchVenueDraft({ text: 'Текст до ухода с маршрута', topics: ['surface'] });
  const departedGen = owned!.gen;
  const pending = owner.submitVenueExperience();
  await tick();

  // Departure cleanup uses captured owner — retires pending fresh prepare.
  owner.retireVenueExperienceSurface(owned!);
  assert.equal(owner.getSnapshot().venueExperience, null);
  releaseElig();
  await pending;
  await tick();
  assert.equal(keys.length, 0);
  assert.equal(owner.getSnapshot().command, null);

  // Deliberate reopen within a new focused lifetime — capture advances to newer gen.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  const newerOwned = noteVenueExperienceRouteOwner(
    null,
    captureVenueExperienceRouteOwner({
      gameId,
      actor: owner.getSnapshot().actor,
      surface: owner.getSnapshot().venueExperience,
    }),
  );
  assert.ok(newerOwned);
  assert.notEqual(newerOwned!.gen, departedGen);
  owner.patchVenueDraft({ text: 'Новая поверхность', topics: ['lighting'] });

  // Stale cleanup for the OLD captured owner must not close the newer same-game surface.
  // (Bug was cleanup reading live getSnapshot gen — which would wrongly equal newerOwned.gen.)
  const liveAtStaleCleanup = owner.getSnapshot().venueExperience!;
  assert.equal(liveAtStaleCleanup.gen, newerOwned!.gen);
  assert.notEqual(owned!.gen, liveAtStaleCleanup.gen);
  owner.retireVenueExperienceSurface(owned!);
  assert.equal(owner.getSnapshot().venueExperience?.gen, newerOwned!.gen);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Новая поверхность');

  // Close + reopen within same focused route: note keeps prior until next capture, then advances.
  const beforeClose = newerOwned!;
  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().venueExperience, null);
  const afterClose = noteVenueExperienceRouteOwner(
    beforeClose,
    captureVenueExperienceRouteOwner({
      gameId,
      actor: owner.getSnapshot().actor,
      surface: owner.getSnapshot().venueExperience,
    }),
  );
  assert.equal(afterClose?.gen, beforeClose.gen);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  const reopened = noteVenueExperienceRouteOwner(
    afterClose,
    captureVenueExperienceRouteOwner({
      gameId,
      actor: owner.getSnapshot().actor,
      surface: owner.getSnapshot().venueExperience,
    }),
  );
  assert.ok(reopened);
  assert.notEqual(reopened!.gen, beforeClose.gen);

  // Actor replacement: stale prior capture must not retire the restored actor's surface.
  const other = {
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    generation: 2,
  };
  owner.setActor(other);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  const otherOwned = captureVenueExperienceRouteOwner({
    gameId,
    actor: owner.getSnapshot().actor,
    surface: owner.getSnapshot().venueExperience,
  });
  assert.ok(otherOwned);
  assert.equal(otherOwned!.actorId, other.actorId);
  owner.retireVenueExperienceSurface(reopened!);
  assert.equal(owner.getSnapshot().venueExperience?.gen, otherOwned!.gen);
  owner.retireVenueExperienceSurface(otherOwned!);
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(keys.length, 0);
});

test('#522 address13 P2: close cancels opening eligibility → idle; stale response fenced; Entry reprobe; UNKNOWN preserved', async () => {
  let releaseOpen!: () => void;
  const openGate = new Promise<void>(r => { releaseOpen = r; });
  let eligCalls = 0;
  const seen: Array<{ call: number; venueId: string }> = [];
  const keys: string[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async (_actor, venue) => {
        const call = ++eligCalls;
        seen.push({ call, venueId: venue });
        if (call === 1) await openGate;
        return eligibilityBody(call === 1 ? 'deny' : 'may_submit');
      },
      send: async (packet) => {
        keys.push(packet.key);
        throw new PostgameError('network', 503);
      },
    }),
  }, () => `addr13-${keys.length + 1}`);

  owner.setActor(actor);
  // Opening eligibility GET starts unresolved.
  owner.openVenueExperience(gameId, venueId);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'loading');
  assert.equal(owner.getSnapshot().venueProbe?.venueId, venueId);
  const openGen = owner.getSnapshot().venueExperience!.gen;

  // Close immediately — cancelled read must leave recoverable idle, not phantom loading.
  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(owner.getSnapshot().venueProbe, null);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  assert.notEqual(openGen, undefined);

  // Old opening response resolves after close — must not paint loading/deny onto Entry.
  releaseOpen();
  await tick();
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  assert.equal(owner.getSnapshot().venueProbe, null);
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(keys.length, 0);

  // Actual Entry lifecycle: after close, focused probe (composerOpen false) starts fresh read.
  // Production gate fences composer-open / hidden; address14 owns focus-return counters.
  const composerSrc = read('../src/components/venue-experience-composer.tsx');
  assert.match(composerSrc, /venueExperienceEntryProbeTarget/);
  assert.match(composerSrc, /pendingCommand, composerOpen/);
  assert.match(composerSrc, /probeVenueEligibility\(target\.gameId, target\.venueId\)/);

  owner.probeVenueEligibility(gameId, venueId);
  await tick();
  assert.equal(owner.getSnapshot().venueEligibility.status, 'ready');
  assert.ok(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId));
  assert.equal(eligCalls >= 2, true);
  // Newer may_submit wins; cancelled deny never stuck the card.
  assert.equal(seen[0]!.call, 1);
  assert.equal(keys.length, 0);

  // Explicit reopen after fresh probe — no autosend.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(!!owner.getSnapshot().venueExperience, true);
  assert.equal(keys.length, 0);

  // UNKNOWN packet/key/body/age survive close; original recovery still works; close never POSTs.
  owner.patchVenueDraft({ audience: 'self_draft', text: 'Сохранённый текст закрытия', topics: ['surface'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownKey = owner.getSnapshot().command!.packet.key;
  const unknownBody = structuredClone(owner.getSnapshot().command!.packet.body);
  const unknownAge = owner.getSnapshot().command!.firstDispatchedAt;
  assert.ok(unknownAge);
  const postsBeforeClose = keys.length;
  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().venueExperience, null);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command!.packet.key, unknownKey);
  assert.deepEqual(owner.getSnapshot().command!.packet.body, unknownBody);
  assert.equal(owner.getSnapshot().command!.firstDispatchedAt, unknownAge);
  assert.equal(keys.length, postsBeforeClose);

  // Same-origin reopen recovers read-only pending; zero POST / no key rotate.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(!!owner.getSnapshot().venueExperience, true);
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.equal(keys.length, postsBeforeClose);

  // Coordinator close path must reset probe+idle (same honest recoverability as route retire).
  const coordinatorSrc = read('../src/postgame-coordinator.ts');
  assert.match(coordinatorSrc, /closeVenueExperience[\s\S]*venueProbe: null[\s\S]*venueEligibility: \{ status: 'idle' \}/);
});

test('#522 address14: production probe gate + real GET counts hidden0/refocus1/rerender0/open1; stale fenced', async () => {
  let releaseOpen!: () => void;
  const openGate = new Promise<void>(r => { releaseOpen = r; });
  let eligCalls = 0;
  const seen: number[] = [];
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        const call = ++eligCalls;
        seen.push(call);
        if (call === 1) await openGate;
        return eligibilityBody(call === 1 ? 'deny' : 'may_submit');
      },
    }),
  }, () => 'focus-probe-key');

  const focusedArgs = {
    routeFocused: true,
    authenticated: true,
    actor,
    meActorId: actor.actorId,
    meSessionId: actor.sessionId,
    gameId,
    liveVenueId: venueId,
    resultsStatus: 'ready' as const,
    composerOpen: false,
    pendingVenueJournal: false,
  };

  // Hidden / open-composer / pending / not-ready — no probe target.
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, routeFocused: false }), null);
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, composerOpen: true }), null);
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, pendingVenueJournal: true }), null);
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, resultsStatus: 'loading' }), null);
  assert.equal(venueExperienceEntryProbeTarget({
    ...focusedArgs,
    meSessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  }), null);

  owner.setActor(actor);
  // Opening owns its eligibility GET — Entry gate must not double while composer open.
  owner.openVenueExperience(gameId, venueId);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'loading');
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, composerOpen: true }), null);
  assert.equal(eligCalls, 1);

  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  // Hidden close (blur retire): gate rejects — zero additional GET.
  assert.equal(venueExperienceEntryProbeTarget({ ...focusedArgs, routeFocused: false }), null);
  assert.equal(eligCalls, 1);

  releaseOpen();
  await tick();
  // Stale opening deny must not paint; still idle, still one GET.
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  assert.equal(owner.getSnapshot().venueProbe, null);
  assert.equal(eligCalls, 1);

  // Focus return: one fresh probe from current gate.
  const refocus = venueExperienceEntryProbeTarget(focusedArgs);
  assert.ok(refocus);
  owner.probeVenueEligibility(refocus!.gameId, refocus!.venueId);
  await tick();
  assert.equal(eligCalls, 2);
  assert.equal(owner.getSnapshot().venueEligibility.status, 'ready');
  assert.ok(exactGameMaySubmitBasis(owner.getSnapshot().venueEligibility.data!, gameId));

  // Ordinary "rerender" re-eval of the same gate does not itself call probe — counts stay.
  assert.ok(venueExperienceEntryProbeTarget(focusedArgs));
  assert.equal(eligCalls, 2);

  // Concurrent focus+effect while loading: coordinator dedup — no third GET for same target.
  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().venueEligibility.status, 'idle');
  const beforeDup = eligCalls;
  const again = venueExperienceEntryProbeTarget(focusedArgs)!;
  owner.probeVenueEligibility(again.gameId, again.venueId);
  owner.probeVenueEligibility(again.gameId, again.venueId);
  await tick();
  assert.equal(eligCalls, beforeDup + 1);

  // Source wiring must actually call the production gate from both normal effect and focus setup.
  const composer = read('../src/components/venue-experience-composer.tsx');
  assert.match(composer, /venueExperienceEntryProbeTarget/);
  assert.match(composer, /auth\.participation\.getSnapshot\(\)/);
  assert.match(composer, /authIdentityRef/);
  assert.match(composer, /\[owner, gameId, auth\.participation\]/);
  assert.doesNotMatch(composer, /useFocusEffect\(useCallback\(\(\) => \{[\s\S]*results\?\.status[\s\S]*\}, \[owner, gameId/);
  const helpers = read('../src/venue-reviews.ts');
  assert.match(helpers, /export function venueExperienceEntryProbeTarget/);
  assert.equal(seen[0], 1);
});

test('#522 address16: venue ACK skips generic results/reminders; Entry receipt before fresh gates; UNKNOWN recovery', async () => {
  let resultsCalls = 0;
  let remindersCalls = 0;
  let mode: 'ok' | 'unknown' = 'ok';
  const keys: string[] = [];
  const owner: PostgameCoordinator = new PostgameCoordinator({
    ...idlePort({
      results: async () => {
        resultsCalls += 1;
        throw new PostgameError('private', 403);
      },
      reminders: async () => {
        remindersCalls += 1;
        return { items: [], writesEnabled: true, installed: true };
      },
      send: async (packet): Promise<unknown> => {
        assert.equal(isVenueExperienceCreatePacket(packet), true);
        if (!isVenueExperienceCreatePacket(packet)) {
          assert.fail(`expected venue-experience-create, got ${packet.kind}`);
        }
        keys.push(packet.key);
        if (mode === 'unknown') throw new PostgameError('network', 503);
        return {
          id: '55555555-5555-4555-8555-555555555555',
          version: 1,
          status: packet.body.audience === 'self_draft' ? 'self_draft' : 'submitted_waiting',
          reviewHandle: 'f'.repeat(32),
          receiptToken: packet.body.audience === 'self_draft' ? null : 'intake-tok',
          publicVisible: false,
          notBefore: null,
        };
      },
    }),
  }, () => `addr16-${keys.length + 1}`);

  owner.setActor(actor);
  // Seed unavailable results via real coordinator read error (not a fake write permit).
  await owner.loadResults(gameId);
  await tick();
  assert.equal(owner.getSnapshot().games[gameId]?.status, 'unavailable');
  const resultsSeed = resultsCalls;
  const remindersSeed = remindersCalls;

  // Fresh private ACK — zero generic follow-up reads; receipt on owned composer; no global notice.
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'self_draft', text: 'Личный опыт покрытия', topics: ['surface'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(keys.length, 1);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'self_draft');
  assert.equal(owner.getSnapshot().venueReceipt?.receiptToken, null);
  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(owner.getSnapshot().venueNotice, null);
  assert.equal(owner.getSnapshot().venueExperience?.gameId, gameId);
  assert.equal(owner.getSnapshot().venueExperience?.venueId, venueId);
  assert.ok(owner.getSnapshot().venueDraft);
  assert.equal(resultsCalls, resultsSeed);
  assert.equal(remindersCalls, remindersSeed);
  assert.equal(owner.getSnapshot().games[gameId]?.status, 'unavailable');

  // Fresh public ACK — same zero counters / no global notice; truthful pending receipt.
  owner.closeVenueExperience();
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'public_venue', text: 'Публичный опыт освещения', topics: ['lighting'] });
  await owner.ensureVenueConsentPreview();
  await owner.submitVenueExperience();
  await tick();
  assert.equal(keys.length, 2);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'submitted_waiting');
  assert.equal(owner.getSnapshot().venueReceipt?.receiptToken, 'intake-tok');
  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(resultsCalls, resultsSeed);
  assert.equal(remindersCalls, remindersSeed);

  // UNKNOWN recovery: reopen readonly original scope → explicit retry valid ACK same key/body/age.
  owner.closeVenueExperience();
  mode = 'unknown';
  owner.openVenueExperience(gameId, venueId);
  await tick();
  owner.patchVenueDraft({ audience: 'self_draft', text: 'Восстановление исходной отправки', topics: ['amenities'] });
  await owner.submitVenueExperience();
  await tick();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  const unknownPacket = owner.getSnapshot().command!.packet;
  assert.equal(isVenueExperienceCreatePacket(unknownPacket), true);
  const unknownKey = unknownPacket.key;
  const unknownBody = structuredClone(unknownPacket.body);
  const unknownAge = owner.getSnapshot().command!.firstDispatchedAt;
  assert.ok(unknownAge);
  const postsBeforeClose = keys.length;
  owner.closeVenueExperience();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command!.packet.key, unknownKey);
  assert.deepEqual(owner.getSnapshot().command!.packet.body, unknownBody);
  assert.equal(owner.getSnapshot().command!.firstDispatchedAt, unknownAge);
  owner.openVenueExperience(gameId, venueId);
  await tick();
  assert.equal(owner.getSnapshot().command?.packet.key, unknownKey);
  assert.deepEqual(owner.getSnapshot().command!.packet.body, unknownBody);
  assert.equal(owner.getSnapshot().command!.firstDispatchedAt, unknownAge);
  assert.equal(keys.length, postsBeforeClose);
  mode = 'ok';
  await owner.reconcileVenueExperience();
  await tick();
  assert.equal(keys.filter(k => k === unknownKey).length >= 1, true);
  assert.equal(owner.getSnapshot().command, null);
  assert.equal(owner.getSnapshot().venueReceipt?.status, 'self_draft');
  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(owner.getSnapshot().venueExperience?.gameId, gameId);
  assert.equal(owner.getSnapshot().venueExperience?.venueId, venueId);
  assert.equal(owner.getSnapshot().venueDraft?.text, 'Восстановление исходной отправки');
  assert.equal(resultsCalls, resultsSeed);
  assert.equal(remindersCalls, remindersSeed);
  // Unavailable results remain — receipt must not depend on refreshing them.
  assert.equal(owner.getSnapshot().games[gameId]?.status, 'unavailable');

  // Actual Entry receipt branch wiring before fresh liveVenue/results gates (shared frame).
  const composer = read('../src/components/venue-experience-composer.tsx');
  assert.match(composer, /confirmedOwnReceipt/);
  assert.match(composer, /VenueExperienceEntryFrame/);
  const receiptIdx = composer.indexOf('confirmedOwnReceipt');
  const liveIdx = composer.indexOf('if (!liveVenueId)');
  const readyIdx = composer.indexOf("results?.status !== 'ready'");
  assert.ok(receiptIdx > 0 && liveIdx > receiptIdx && readyIdx > receiptIdx);
  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(
    coordinator,
    /venue-experience-create[\s\S]*Receipt card owns success copy[\s\S]*return;[\s\S]*public-role-create/,
  );
  assert.match(coordinator, /finally still clears inFlight|venueFreshDispatchBind/);
});

test('source wiring: results entry + dual-auth guards + APK38 pins', () => {
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
  assert.match(composer, /тот же текст и то же действие/);
  assert.match(composer, /вернуться к этой отправке позже/);
  assert.doesNotMatch(composer, /без смены ключа|без новой заявки/);
  assert.match(composer, /venueExperienceReceiptSummary/);
  assert.match(composer, /recoveryVenueId|pendingCommand|pendingPacket/);
  assert.match(composer, /confirmedOwnReceipt/);
  assert.match(composer, /VenueExperienceEntryFrame/);
  assert.match(composer, /isVenueExperienceCreatePacket/);
  assert.match(composer, /onAccessibilityEscape/);
  assert.match(composer, /FocusContext/);
  assert.match(composer, /openerRef|liveRef/);
  assert.match(composer, /requestAnimationFrame/);
  assert.match(composer, /useFocusEffect/);
  assert.match(composer, /retireVenueExperienceSurface/);
  assert.match(composer, /routeFocused/);
  assert.match(composer, /ownedRouteRef/);
  assert.match(composer, /captureVenueExperienceRouteOwner/);
  assert.match(composer, /noteVenueExperienceRouteOwner/);
  // Cleanup must retire the captured owner — not rebuild expected from a live getSnapshot surface.
  assert.match(composer, /const expected = ownedRouteRef\.current/);
  assert.doesNotMatch(composer, /return \(\) => \{[\s\S]*getSnapshot\(\)[\s\S]*retireVenueExperienceSurface/);
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
  assert.match(helpers, /venueExperienceBasisAuthority/);
  assert.match(helpers, /captureVenueExperienceRouteOwner/);
  assert.match(helpers, /noteVenueExperienceRouteOwner/);
  assert.match(helpers, /venueExperienceEntryProbeTarget/);
  assert.match(helpers, /isVenueExperienceCreatePacket/);
  assert.match(helpers, /new Map/);
  assert.doesNotMatch(helpers, /Причина: \$\{basis\.reason\}/);

  const coordinator = read('../src/postgame-coordinator.ts');
  assert.match(coordinator, /venue-experience-create/);
  assert.match(coordinator, /isVenueExperienceCreatePacket/);
  assert.match(coordinator, /firstDispatchedAt/);
  assert.match(coordinator, /reconcileVenueExperience/);
  assert.match(coordinator, /postgameIdempotencyReplayBlocked|VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS|venueExperienceIdempotencyExpired/);
  assert.match(coordinator, /writePrepare|beginWritePrepare/);
  assert.match(coordinator, /retireVenueExperienceSurface/);
  assert.match(coordinator, /retireVenueConsentAuthority/);
  assert.match(coordinator, /venueExperienceBasisAuthority/);
  assert.match(coordinator, /eligibilityRequest/);
  assert.match(coordinator, /mayDispatchRetention|dispatchPermit/);
  assert.match(coordinator, /venueFreshDispatchBind|freshVenue|mayDispatchFreshVenue/);
  assert.match(coordinator, /Receipt card owns success copy|venueNotice: null/);
  assert.match(
    coordinator,
    /venue-experience-create[\s\S]*Receipt card owns success copy[\s\S]*return;[\s\S]*public-role-create/,
  );

  const api = read('../src/native-api.ts');
  assert.match(api, /venueExperienceEligibility/);
  assert.match(api, /venueExperienceConsentPreview/);
  assert.match(api, /\/me\/venue-reviews\/eligibility/);
  assert.match(api, /\/me\/venue-reviews\/consent-preview/);

  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /venueExperienceEligibility/);
  assert.match(auth, /venueExperienceConsentPreview/);
  assert.match(auth, /mayDispatchRetention|dispatchPermit|POSTGAME_RETENTION_EXPIRED|POSTGAME_DISPATCH_STALE/);
  assert.match(auth, /fresh venue authority|post-token/);

  const controller = read('../../api/src/venues/venue-reviews.controller.ts');
  assert.match(controller, /eligibility[\s\S]*requirePrincipal\(request\)/);
  assert.match(controller, /consentPreview[\s\S]*requirePrincipalMutation\(request\)/);
  assert.match(controller, /create\([\s\S]*requirePrincipalMutation\(request\)/);
  assert.match(controller, /listMine[\s\S]*requirePrincipal\(request\)/);
  assert.match(controller, /getMine[\s\S]*requirePrincipal\(request\)/);
  assert.match(controller, /submit_revision[\s\S]*withdraw[\s\S]*requirePrincipalMutation/);
  assert.match(controller, /ownCommand[\s\S]*requireCookieMutation\(request\)/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 53);
});
