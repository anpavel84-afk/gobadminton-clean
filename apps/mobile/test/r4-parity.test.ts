import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { cityFieldLabel } from '../src/entry.ts';
import {
  appendPublicVenueReviewItems,
  parseVenueReviewsSummary,
  PUBLIC_VENUE_REVIEWS_GALLERY_LIMIT,
  PUBLIC_VENUE_REVIEWS_PREVIEW_LIMIT,
  PublicVenueReviewsGallery,
  shouldOpenPublicVenueReviewsGallery,
  type PublicVenueReviewItem,
  type VenueReviewsSummary,
} from '../src/venue-reviews.ts';
import { PublicApiError } from '../src/public-api.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const venueId = '11111111-1111-4111-8111-111111111111';
const otherVenue = '22222222-2222-4222-8222-222222222222';
const handle = 'a'.repeat(32);

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function item(suffix: string, text = `Текст ${suffix}`): PublicVenueReviewItem {
  return {
    reviewHandle: suffix.padStart(32, '0'),
    authorLabel: 'Участник игры',
    text,
    topics: ['surface'],
    publishedRevision: 1,
    publishedAt: '2026-11-01T12:00:00Z',
  };
}

function page(
  items: PublicVenueReviewItem[],
  nextCursor: string | null,
  publishedCount = items.length,
): VenueReviewsSummary {
  return {
    venueId,
    publishedCount,
    items,
    nextCursor,
    canWriteHint: false,
  };
}

test('#624 cityFieldLabel: loading placeholder, unavailable only when ready', () => {
  assert.equal(cityFieldLabel({
    hydrated: false, status: 'loading', city: null, savedCityId: 'city-1', emptyLabel: 'Не выбран',
  }), 'Загружаем…');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'loading', city: null, savedCityId: 'city-1', emptyLabel: 'Не выбран',
  }), 'Загружаем…');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'idle', city: null, savedCityId: 'city-1', emptyLabel: 'Не выбран',
  }), 'Загружаем…');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'ready', city: null, savedCityId: 'city-1', emptyLabel: 'Не выбран',
  }), 'Выбор недоступен');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'ready', city: null, savedCityId: null, emptyLabel: 'Не выбран',
  }), 'Не выбран');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'ready', city: { nameRu: 'Москва' }, savedCityId: 'city-1', emptyLabel: 'Не выбран',
  }), 'Москва');
  assert.equal(cityFieldLabel({
    hydrated: true, status: 'error', city: null, savedCityId: null, emptyLabel: 'Все города',
  }), 'Все города');
});

test('#598 experience-reviews parser accepts contract DTO and fails closed', () => {
  const ok = parseVenueReviewsSummary({
    venueId,
    publishedCount: 1,
    items: [{
      reviewHandle: handle,
      authorLabel: 'Участник игры',
      text: 'Хорошее покрытие',
      topics: ['surface'],
      publishedRevision: 1,
      publishedAt: '2026-11-01T12:00:00Z',
    }],
    nextCursor: null,
    canWriteHint: false,
  }, venueId);
  assert.equal(ok.venueId, venueId);
  assert.equal(ok.items[0]?.text, 'Хорошее покрытие');
  assert.equal(ok.items[0]?.authorLabel, 'Участник игры');

  assert.throws(() => parseVenueReviewsSummary({
    venueId,
    publishedCount: 0,
    items: [],
    nextCursor: null,
    canWriteHint: false,
  }, 'not-a-uuid'), (e: unknown) => e instanceof PublicApiError && e.kind === 'invalid');

  assert.throws(() => parseVenueReviewsSummary({
    venueId,
    publishedCount: 1,
    items: [{
      reviewHandle: handle,
      authorLabel: 'Игрок',
      text: 'x',
      topics: [],
      publishedRevision: 1,
      publishedAt: '2026-11-01T12:00:00Z',
    }],
    nextCursor: null,
    canWriteHint: false,
  }, venueId), (e: unknown) => e instanceof PublicApiError && e.kind === 'invalid');
});

test('#522 public gallery CTA gate + append dedupe', () => {
  assert.equal(PUBLIC_VENUE_REVIEWS_PREVIEW_LIMIT, 5);
  assert.equal(PUBLIC_VENUE_REVIEWS_GALLERY_LIMIT, 20);
  assert.equal(shouldOpenPublicVenueReviewsGallery(6, 5), true);
  assert.equal(shouldOpenPublicVenueReviewsGallery(5, 5), false);
  assert.equal(shouldOpenPublicVenueReviewsGallery(0, 0), false);
  assert.equal(shouldOpenPublicVenueReviewsGallery(4, 5), false);
  const a = item('1');
  const b = item('2');
  const merged = appendPublicVenueReviewItems([a], [a, b]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.reviewHandle, b.reviewHandle);
});

test('#522 PublicVenueReviewsGallery: first20, exact cursor, dedupe, busy, late fence, more retry', async () => {
  const calls: Array<{ venueId: string; cursor: string | undefined; limit: number }> = [];
  let releaseMore: () => void = () => {};
  let failMore = false;
  let moreItems = [item('1'), item('2')];

  const gallery = new PublicVenueReviewsGallery({
    experienceReviews: async (id, cursor, limit) => {
      calls.push({ venueId: id, cursor, limit });
      if (cursor === undefined) {
        return page([item('1')], 'cur-a', 3);
      }
      assert.equal(cursor, 'cur-a');
      assert.equal(limit, PUBLIC_VENUE_REVIEWS_GALLERY_LIMIT);
      await new Promise<void>(resolve => { releaseMore = resolve; });
      if (failMore) throw new PublicApiError('network');
      return page(moreItems, null, 3);
    },
  });

  gallery.open(venueId);
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    venueId,
    cursor: undefined,
    limit: PUBLIC_VENUE_REVIEWS_GALLERY_LIMIT,
  });
  assert.equal(gallery.getSnapshot().phase, 'ready');
  assert.equal(gallery.getSnapshot().items.length, 1);
  assert.equal(gallery.getSnapshot().nextCursor, 'cur-a');

  // Double-tap while more is in flight — second call ignored.
  gallery.loadMore();
  gallery.loadMore();
  assert.equal(calls.length, 2);
  assert.equal(gallery.getSnapshot().loadingMore, true);
  failMore = true;
  releaseMore();
  await flush();
  assert.equal(gallery.getSnapshot().moreError, true);
  assert.equal(gallery.getSnapshot().items.length, 1);
  assert.equal(gallery.getSnapshot().nextCursor, 'cur-a');

  // Retry same cursor without losing rows.
  failMore = false;
  moreItems = [item('1'), item('2')];
  gallery.loadMore();
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.cursor, 'cur-a');
  releaseMore();
  await flush();
  assert.equal(gallery.getSnapshot().moreError, false);
  assert.equal(gallery.getSnapshot().items.map(i => i.reviewHandle).join('|'), [
    item('1').reviewHandle,
    item('2').reviewHandle,
  ].join('|'));
  assert.equal(gallery.getSnapshot().nextCursor, null);

  // Consumed cursor + null next — further loadMore is a no-op.
  gallery.loadMore();
  assert.equal(calls.length, 3);

  // Late response after close must not paint.
  let releaseLate: () => void = () => {};
  const late = new PublicVenueReviewsGallery({
    experienceReviews: async (id, cursor, limit) => {
      calls.push({ venueId: id, cursor, limit });
      if (cursor === undefined) return page([item('8')], 'late-cur', 2);
      await new Promise<void>(resolve => { releaseLate = resolve; });
      return page([item('9')], null, 2);
    },
  });
  late.open(venueId);
  await flush();
  late.loadMore();
  late.close();
  releaseLate();
  await flush();
  assert.equal(late.getSnapshot().open, false);
  assert.equal(late.getSnapshot().items.length, 0);

  // Venue change via reopen fences prior in-flight more into the old venue.
  let releaseCross: () => void = () => {};
  const crossCalls: Array<{ venueId: string; cursor: string | undefined }> = [];
  const cross = new PublicVenueReviewsGallery({
    experienceReviews: async (id, cursor) => {
      crossCalls.push({ venueId: id, cursor });
      if (cursor === undefined) {
        return {
          venueId: id,
          publishedCount: 2,
          items: [item('3')],
          nextCursor: 'x-cur',
          canWriteHint: false,
        };
      }
      await new Promise<void>(resolve => { releaseCross = resolve; });
      return {
        venueId: id,
        publishedCount: 2,
        items: [item('4')],
        nextCursor: null,
        canWriteHint: false,
      };
    },
  });
  cross.open(venueId);
  await flush();
  cross.loadMore();
  cross.open(otherVenue);
  releaseCross();
  await flush();
  assert.equal(cross.getSnapshot().venueId, otherVenue);
  assert.equal(cross.getSnapshot().items.length, 1);
  assert.equal(cross.getSnapshot().items[0]?.reviewHandle, item('3').reviewHandle);
  assert.ok(crossCalls.some(c => c.venueId === otherVenue && c.cursor === undefined));
});

test('#522 PublicVenueReviewsGallery: same-cursor + A→B→A normalize; first-page fence', async () => {
  // Same request cursor echoed as nextCursor → terminal null, rows kept, More dead-CTA gone.
  const sameCalls: Array<string | undefined> = [];
  const same = new PublicVenueReviewsGallery({
    experienceReviews: async (_id, cursor) => {
      sameCalls.push(cursor);
      if (cursor === undefined) return page([item('1')], 'cur-same', 2);
      assert.equal(cursor, 'cur-same');
      return page([item('1'), item('2')], 'cur-same', 2);
    },
  });
  same.open(venueId);
  await flush();
  same.loadMore();
  await flush();
  assert.equal(same.getSnapshot().items.length, 2);
  assert.equal(same.getSnapshot().nextCursor, null);
  assert.equal(same.getSnapshot().moreError, false);
  same.loadMore();
  assert.equal(sameCalls.length, 2);

  // A → B → A cycle: returning already-consumed A must terminal-null without dropping rows.
  const cycleCalls: Array<string | undefined> = [];
  const cycle = new PublicVenueReviewsGallery({
    experienceReviews: async (_id, cursor) => {
      cycleCalls.push(cursor);
      if (cursor === undefined) return page([item('a')], 'cur-A', 3);
      if (cursor === 'cur-A') return page([item('a'), item('b')], 'cur-B', 3);
      if (cursor === 'cur-B') return page([item('a'), item('b'), item('c')], 'cur-A', 3);
      throw new PublicApiError('invalid');
    },
  });
  cycle.open(venueId);
  await flush();
  cycle.loadMore();
  await flush();
  assert.equal(cycle.getSnapshot().nextCursor, 'cur-B');
  cycle.loadMore();
  await flush();
  assert.equal(cycle.getSnapshot().items.map(i => i.reviewHandle).join('|'), [
    item('a').reviewHandle,
    item('b').reviewHandle,
    item('c').reviewHandle,
  ].join('|'));
  assert.equal(cycle.getSnapshot().nextCursor, null);
  cycle.loadMore();
  assert.equal(cycleCalls.length, 3);

  // Network more-error keeps same cursor for honest retry (not consumed).
  let failNet = true;
  let releaseNet: () => void = () => {};
  const net = new PublicVenueReviewsGallery({
    experienceReviews: async (_id, cursor) => {
      if (cursor === undefined) return page([item('n1')], 'cur-net', 2);
      await new Promise<void>(resolve => { releaseNet = resolve; });
      if (failNet) throw new PublicApiError('network');
      return page([item('n1'), item('n2')], null, 2);
    },
  });
  net.open(venueId);
  await flush();
  net.loadMore();
  releaseNet();
  await flush();
  assert.equal(net.getSnapshot().moreError, true);
  assert.equal(net.getSnapshot().nextCursor, 'cur-net');
  assert.equal(net.getSnapshot().items.length, 1);
  failNet = false;
  net.loadMore();
  releaseNet();
  await flush();
  assert.equal(net.getSnapshot().moreError, false);
  assert.equal(net.getSnapshot().nextCursor, null);
  assert.equal(net.getSnapshot().items.length, 2);

  // First-page error → retryFirst; late close fences in-flight first GET.
  let firstFail = true;
  let releaseFirst: () => void = () => {};
  const firstCalls: number[] = [];
  const first = new PublicVenueReviewsGallery({
    experienceReviews: async () => {
      firstCalls.push(1);
      await new Promise<void>(resolve => { releaseFirst = resolve; });
      if (firstFail) throw new PublicApiError('network');
      return page([item('f1')], 'cur-f', 1);
    },
  });
  first.open(venueId);
  releaseFirst();
  await flush();
  assert.equal(first.getSnapshot().phase, 'error');
  firstFail = false;
  first.retryFirst();
  assert.equal(first.getSnapshot().phase, 'loading');
  releaseFirst();
  await flush();
  assert.equal(first.getSnapshot().phase, 'ready');
  assert.equal(first.getSnapshot().items.length, 1);
  assert.equal(firstCalls.length, 2);

  const lateFirst = new PublicVenueReviewsGallery({
    experienceReviews: async () => {
      await new Promise<void>(resolve => { releaseFirst = resolve; });
      return page([item('late')], null, 1);
    },
  });
  lateFirst.open(venueId);
  lateFirst.close();
  releaseFirst();
  await flush();
  assert.equal(lateFirst.getSnapshot().open, false);
  assert.equal(lateFirst.getSnapshot().items.length, 0);
  assert.equal(lateFirst.getSnapshot().phase, 'idle');
});

test('#598 #606 #624 #522 R4 source assertions', () => {
  const reviews = read('../src/components/venue-reviews.tsx');
  const photos = read('../src/components/venue-photos.tsx');
  const community = read('../src/components/venue-community.tsx');
  const publicApi = read('../src/public-api.ts');
  const logic = read('../src/venue-reviews.ts');
  const city = read('../app/city.tsx');
  const cityRow = read('../src/components/city-row.tsx');
  const myGames = read('../app/my-games.tsx');
  const games = read('../app/games/index.tsx');
  const players = read('../app/players/index.tsx');
  const entry = read('../src/entry.ts');

  assert.match(reviews, /Отзывы после игры/);
  assert.match(reviews, /После игры/);
  assert.match(reviews, /experienceReviews/);
  assert.match(reviews, /Все отзывы ·/);
  assert.match(reviews, /Отзывы о площадке/);
  assert.match(reviews, /DiscoverySheet/);
  assert.match(reviews, /PublicVenueReviewsGallery/);
  assert.match(reviews, /title="Ещё"/);
  assert.match(reviews, /PUBLIC_VENUE_REVIEWS_PREVIEW_LIMIT/);
  assert.doesNotMatch(reviews, /createVenueReview|comment-photos|previewVenueReviewConsent|getOwnVenueReviewEligibility/);
  assert.doesNotMatch(reviews, /reportVenueReview|submit_revision|appeal/);
  assert.match(logic, /class PublicVenueReviewsGallery/);
  assert.match(logic, /PUBLIC_VENUE_REVIEWS_GALLERY_LIMIT = 20/);
  assert.match(logic, /appendPublicVenueReviewItems/);
  assert.match(photos, /Фотографии сообщества/);
  assert.match(photos, /Фотографии из публикаций об этой площадке/);
  assert.match(photos, /Пока нет фотографий сообщества\./);
  assert.match(photos, /communityPhotos/);
  assert.doesNotMatch(photos, /commentPhotosFromThreads/);
  assert.doesNotMatch(photos, /comment-photos|FormData|multipart|POST/);
  assert.match(community, /VenueReviewsSection/);
  assert.match(community, /VenueCommunityPhotosSection venueId=/);
  assert.match(publicApi, /experience-reviews/);
  assert.match(publicApi, /parseVenueReviewsSummary/);
  assert.match(publicApi, /community-photos/);
  assert.match(publicApi, /isCommunityPhotoPage/);
  assert.match(publicApi, /credentials: 'omit'/);

  assert.match(city, /Где хотите играть\?/);
  assert.match(city, /Город/);
  assert.match(city, /variant="select"/);
  assert.match(city, /Оставить «/);
  assert.match(city, /Город поиска/);
  assert.match(city, /Выбор города поиска не меняет город игрового профиля/);
  assert.match(city, /← К играм/);
  assert.match(cityRow, /variant/);
  assert.match(cityRow, /'select'/);
  assert.match(cityRow, /Выбрать/);

  assert.match(myGames, /PrimaryButton title="Найти игру"/);
  assert.match(myGames, /OutlineButton title="Найти игру"/);
  assert.doesNotMatch(myGames, /TextButton title="Найти игру"/);

  assert.match(entry, /export function cityFieldLabel/);
  assert.match(games, /cityFieldLabel/);
  assert.match(players, /cityFieldLabel/);
  assert.match(entry, /Загружаем…/);
});
