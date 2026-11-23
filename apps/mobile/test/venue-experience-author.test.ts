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
  isVenueExperienceCreatePacket,
  isVenueExperienceCreateReceipt,
  isVenueExperiencePacketKind,
  parseOwnVenueEligibility,
  parseVenueConsentPreview,
  parseVenueReviewMutationReceipt,
  venueEligibilityReasonCopy,
  venueExperienceBasisAuthority,
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
  const owner = new PostgameCoordinator({
    ...idlePort({
      venueExperienceEligibility: async () => {
        eligCalls += 1;
        // 1 = open, 2 = submit prepare (deferred), 3 = newer load deny.
        if (eligCalls === 2) await submitGate;
        if (eligCalls >= 3) {
          noticeMarker = 'deny-painted';
          return eligibilityBody('deny');
        }
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
  assert.match(composer, /тот же текст и то же действие/);
  assert.match(composer, /вернуться к этой отправке позже/);
  assert.doesNotMatch(composer, /без смены ключа|без новой заявки/);
  assert.match(composer, /venueExperienceReceiptSummary/);
  assert.match(composer, /recoveryVenueId|pendingCommand|pendingPacket/);
  assert.match(composer, /isVenueExperienceCreatePacket/);
  assert.match(composer, /onAccessibilityEscape/);
  assert.match(composer, /FocusContext/);
  assert.match(composer, /openerRef|liveRef/);
  assert.match(composer, /requestAnimationFrame/);
  assert.match(composer, /useFocusEffect/);
  assert.match(composer, /retireVenueExperienceSurface/);
  assert.match(composer, /routeFocused/);
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
