import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { cityFieldLabel } from '../src/entry.ts';
import { parseVenueReviewsSummary } from '../src/venue-reviews.ts';
import { PublicApiError } from '../src/public-api.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const venueId = '11111111-1111-4111-8111-111111111111';
const handle = 'a'.repeat(32);

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

test('#598 #606 #624 R4 source assertions', () => {
  const reviews = read('../src/components/venue-reviews.tsx');
  const photos = read('../src/components/venue-photos.tsx');
  const community = read('../src/components/venue-community.tsx');
  const publicApi = read('../src/public-api.ts');
  const city = read('../app/city.tsx');
  const cityRow = read('../src/components/city-row.tsx');
  const myGames = read('../app/my-games.tsx');
  const games = read('../app/games/index.tsx');
  const players = read('../app/players/index.tsx');
  const entry = read('../src/entry.ts');

  assert.match(reviews, /Отзывы после игры/);
  assert.match(reviews, /После игры/);
  assert.match(reviews, /experienceReviews/);
  assert.doesNotMatch(reviews, /createVenueReview|comment-photos|previewVenueReviewConsent|getOwnVenueReviewEligibility/);
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
