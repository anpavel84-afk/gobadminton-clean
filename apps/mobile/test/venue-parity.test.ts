import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  VENUE_ILLUSTRATION_BADGE,
  VENUE_ILLUSTRATION_KEYS,
  venueCoverChoice,
  venueIllustrationIndex,
  venueIllustrationKey,
} from '../src/venue-illustration.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const asset = (name: string) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));

test('#597 illustration choice is deterministic per venue and photo wins over illustration', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  assert.equal(venueIllustrationIndex(a), venueIllustrationIndex(a));
  assert.equal(venueIllustrationKey(a), VENUE_ILLUSTRATION_KEYS[venueIllustrationIndex(a)]);
  assert.ok(VENUE_ILLUSTRATION_KEYS.includes(venueIllustrationKey(a)));
  assert.notEqual(venueIllustrationKey(a), venueIllustrationKey(b));
  const photo = `/v1/media/venue-covers/${'a'.repeat(64)}.png`;
  assert.deepEqual(venueCoverChoice(a, photo), { kind: 'photo', url: photo });
  assert.deepEqual(venueCoverChoice(a, null), { kind: 'illustration', key: venueIllustrationKey(a) });
});

test('#597–#602 source assertions for Group B1 parity defects', () => {
  const detail = read('../src/components/venue-detail.tsx');
  const sheet = read('../src/components/venue-sheet.tsx');
  const cover = read('../src/components/venue-cover.tsx');
  const map = read('../app/games/map.tsx');
  const games = read('../app/games/index.tsx');
  const players = read('../app/players/index.tsx');
  const radar = read('../src/components/radar-controls.tsx');
  const provenance = read('../assets/provenance.json');

  assert.match(cover, /VENUE_ILLUSTRATION_BADGE/);
  assert.match(cover, /\{VENUE_ILLUSTRATION_BADGE\}/);
  assert.match(detail, /VenueCover/);
  assert.doesNotMatch(detail, /Нет изображения/);
  assert.doesNotMatch(detail, /Нет доступных изображений площадки/);
  assert.doesNotMatch(detail, /Нет данных/);
  assert.match(detail, /Создать игру на этой площадке →/);
  assert.match(detail, /align="left"/);
  assert.match(sheet, /Создать игру на этой площадке →/);
  assert.match(sheet, /align="left"/);
  // Old expectation pinned the mobile-only empty-games block; web mobile omits it (#598).
  assert.doesNotMatch(sheet, /На этой площадке пока нет игр/);
  assert.doesNotMatch(sheet, /Будьте первым, кто создаст игру и соберет компанию!/);
  assert.doesNotMatch(sheet, /Нет доступных игр по выбранным условиям/);
  assert.doesNotMatch(sheet, /Обновить расписание/);

  assert.doesNotMatch(map, /Обновить площадки/);
  assert.match(map, /RadarControls compact/);

  assert.match(games, /Пока нет игр/);
  assert.doesNotMatch(games, /Игр пока нет/);
  assert.match(games, /Соберите своих на площадке — создайте игру/);
  assert.match(games, /mapEntryHeight \+ insets\.bottom/);

  assert.match(players, /pointerEvents="box-none"/);
  assert.match(players, /useState<string \| null>\(routeContext\?\.filters\.cityId \?\? null\)/);
  assert.match(players, /Все города/);
  assert.match(radar, /Включить Radar/);
  assert.match(radar, /Radar включён/);

  for (const file of ['hand-v1.webp', 'pair-v1.webp', 'shuttles-v1.webp', 'racket-v1.webp', 'badminton-courts.jpg']) {
    assert.ok(provenance.includes(file), file);
    assert.ok(readFileSync(asset(file)).byteLength > 0, file);
  }
  assert.equal(VENUE_ILLUSTRATION_BADGE, 'Иллюстрация');
});
