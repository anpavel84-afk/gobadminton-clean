import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createPublicApi, PublicApiError } from '../src/public-api.ts';
import { LatestResource } from '../src/resource.ts';
import {
  communityRatingCountLabel,
  communitySummaryResourceKey,
  compactSummaryPhase,
  formatCommunityAverage,
  loadGameVenueCommunitySummary,
  venueCommunityNavParams,
} from '../src/game-venue-community-summary.ts';
import type { CommunityRatingSummary } from '../src/venue-community.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const venueA = '10000000-0000-4000-8000-0000000000a1';
const venueB = '10000000-0000-4000-8000-0000000000b2';

function available(venueId: string, average = 4.2, count = 5): CommunityRatingSummary {
  return { venueId, canonicalVenueId: venueId, state: 'available', average, count };
}
function empty(venueId: string): CommunityRatingSummary {
  return { venueId, canonicalVenueId: venueId, state: 'empty', average: null, count: 0 };
}
function unavailable(venueId: string): CommunityRatingSummary {
  return { venueId, canonicalVenueId: null, state: 'unavailable', average: null, count: null };
}
function itemsBody(summary: CommunityRatingSummary) {
  return { items: [summary] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test('#522 APK50 honest compact phases and Russian average/count labels', () => {
  assert.equal(compactSummaryPhase('loading', undefined), 'loading');
  assert.equal(compactSummaryPhase('idle', undefined), 'loading');
  assert.equal(compactSummaryPhase('error', undefined), 'error');
  assert.equal(compactSummaryPhase('ready', unavailable(venueA)), 'unavailable');
  assert.equal(compactSummaryPhase('ready', undefined), 'unavailable');
  assert.equal(compactSummaryPhase('ready', empty(venueA)), 'empty');
  assert.equal(compactSummaryPhase('ready', available(venueA)), 'available');
  assert.equal(formatCommunityAverage(4.2), '4,2');
  assert.equal(communityRatingCountLabel(1), '1 оценка');
  assert.equal(communityRatingCountLabel(3), '3 оценки');
  assert.equal(communityRatingCountLabel(5), '5 оценок');
  assert.equal(communityRatingCountLabel(11), '11 оценок');
  assert.deepEqual(venueCommunityNavParams(venueA), { id: venueA, from: 'game' });
  assert.equal(communitySummaryResourceKey(venueA), `game-venue-community-summary:${venueA}`);
});

test('#522 APK50 public summary GET omits credentials and never hits vote/comments/photo/me', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const signals: AbortSignal[] = [];
  const api = createPublicApi(async (url, init) => {
    seen.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(itemsBody(available(venueA))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const controller = new AbortController();
  const summary = await loadGameVenueCommunitySummary(venueA, (id, signal) => {
    if (signal) signals.push(signal);
    return api.communitySummary(id, signal);
  }, controller.signal);
  assert.equal(summary.state, 'available');
  assert.equal(summary.average, 4.2);
  assert.equal(summary.count, 5);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.init.credentials, 'omit');
  assert.equal(seen[0]!.init.method, 'GET');
  assert.deepEqual(seen[0]!.init.headers, { Accept: 'application/json' });
  assert.match(seen[0]!.url, /\/v1\/venue-community-summaries\?venueIds=/);
  assert.doesNotMatch(seen[0]!.url, /\/me\/|vote|comments|photo/i);
  assert.equal(signals[0], controller.signal);
});

test('#522 APK50 empty/unavailable parse; wrong venue identity rejected', async () => {
  assert.deepEqual(
    await loadGameVenueCommunitySummary(venueA, async () => itemsBody(empty(venueA))),
    empty(venueA),
  );
  assert.deepEqual(
    await loadGameVenueCommunitySummary(venueA, async () => itemsBody(unavailable(venueA))),
    unavailable(venueA),
  );
  await assert.rejects(
    () => loadGameVenueCommunitySummary(venueA, async () => itemsBody(available(venueB))),
    (error: unknown) => error instanceof Error && error.message === 'invalid',
  );
});

test('#522 APK50 LatestResource venue A→B suppresses stale A; retry replaces error', async () => {
  const resource = new LatestResource<CommunityRatingSummary>();
  const delayedA = deferred<CommunityRatingSummary>();
  const pendingA = resource.load(communitySummaryResourceKey(venueA), async () => delayedA.promise);
  assert.equal(resource.getSnapshot().status, 'loading');
  assert.equal(resource.getSnapshot().key, communitySummaryResourceKey(venueA));

  const pendingB = resource.load(communitySummaryResourceKey(venueB), async () => available(venueB, 3.5, 2));
  await pendingB;
  assert.equal(resource.getSnapshot().status, 'ready');
  assert.equal(resource.getSnapshot().data?.venueId, venueB);
  assert.equal(resource.getSnapshot().data?.average, 3.5);

  delayedA.resolve(available(venueA, 4.9, 99));
  await pendingA;
  assert.equal(resource.getSnapshot().key, communitySummaryResourceKey(venueB));
  assert.equal(resource.getSnapshot().data?.venueId, venueB);
  assert.notEqual(resource.getSnapshot().data?.average, 4.9);

  const key = communitySummaryResourceKey(venueA);
  await resource.load(key, async () => { throw new PublicApiError('network'); });
  assert.equal(resource.getSnapshot().status, 'error');
  await resource.load(key, async () => available(venueA, 4.0, 8));
  assert.equal(resource.getSnapshot().status, 'ready');
  assert.equal(resource.getSnapshot().data?.average, 4.0);
  assert.equal(resource.getSnapshot().data?.count, 8);
});

test('#522 APK50 source wiring: signed-in compact summary sibling, no NativeVenueCommunity owner, counter 50', () => {
  const helper = read('../src/game-venue-community-summary.ts');
  const component = read('../src/components/game-venue-community-summary.tsx');
  const gameDetails = read('../app/games/[id].tsx');
  const api = read('../src/public-api.ts');
  const privateContacts = read('../src/components/private-game-venue-contacts.tsx');

  assert.match(helper, /loadGameVenueCommunitySummary/);
  assert.match(helper, /parseSummaries/);
  assert.match(helper, /compactSummaryPhase/);
  assert.match(helper, /venueCommunityNavParams/);
  assert.match(helper, /from: 'game'/);

  assert.match(component, /GameVenueCommunitySummaryPanel/);
  assert.match(component, /useResource/);
  assert.match(component, /communitySummaryResourceKey/);
  assert.match(component, /publicApi\.communitySummary/);
  assert.match(component, /Оценки сообщества/);
  assert.match(component, /Загружаем оценки/);
  assert.match(component, /Не удалось загрузить оценки/);
  assert.match(component, /Повторить загрузку оценок/);
  assert.match(component, /Сводка оценок недоступна/);
  assert.match(component, /Пока нет оценок/);
  assert.match(component, /Оценки и обсуждение/);
  assert.match(component, /pathname: '\/venues\/\[id\]'/);
  assert.match(component, /venueCommunityNavParams/);
  assert.doesNotMatch(component, /NativeVenueCommunity|useVenueCommunity|communityOwn|communityMutation|privateGameVenueContacts|\/me\//);
  assert.doesNotMatch(component, /vote|photoIds|upsert|withdraw/);

  assert.match(gameDetails, /GameVenueCommunitySummaryPanel/);
  assert.match(gameDetails, /authenticated \? <GameVenueCommunitySummaryPanel venueId=\{game\.venue\.id\} \/>/);
  assert.match(gameDetails, /PrivateGameVenueContactsPanel/);
  const summaryIdx = gameDetails.indexOf('GameVenueCommunitySummaryPanel');
  const contactsIdx = gameDetails.indexOf('PrivateGameVenueContactsPanel');
  const courtIdx = gameDetails.indexOf('GameCourtBookingPanel');
  assert.ok(summaryIdx > 0 && contactsIdx > summaryIdx && courtIdx > contactsIdx);
  assert.doesNotMatch(gameDetails, /NativeVenueCommunity/);

  assert.match(api, /communitySummary: \(venueId: string, signal\?: AbortSignal\)/);
  assert.match(api, /credentials: 'omit'/);

  // Public summary must stay independent of private contacts result / empty omit.
  assert.match(privateContacts, /successful empty omits the section/i);
  assert.doesNotMatch(privateContacts, /GameVenueCommunitySummary|communitySummary|Оценки сообщества/);

  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 50);
});
