import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  clampCapacity,
  createGameDateChoice,
  createGameDateOptions,
  createGameTimeSlots,
  durationChipSelected,
  DURATION_CHIPS,
} from '../src/game-form.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('create-game date chips resolve today/tomorrow and 60 days in the venue timezone', () => {
  const { today, tomorrow, days } = createGameDateOptions('Asia/Tokyo', new Date('2026-11-15T15:30:00Z'));
  assert.equal(today, '2026-11-16');
  assert.equal(tomorrow, '2026-11-17');
  assert.equal(days.length, 60);
  assert.equal(days[0], today);
  assert.equal(days[59], '2027-01-14');
  assert.equal(createGameDateChoice(today, 'Asia/Tokyo', new Date('2026-11-15T15:30:00Z')), 'today');
  assert.equal(createGameDateChoice(tomorrow, 'Asia/Tokyo', new Date('2026-11-15T15:30:00Z')), 'tomorrow');
  assert.equal(createGameDateChoice('2026-12-01', 'Asia/Tokyo', new Date('2026-11-15T15:30:00Z')), 'custom');
});

test('create-game time slots are 30-minute HH:MM values across the day', () => {
  const slots = createGameTimeSlots();
  assert.equal(slots.length, 48);
  assert.equal(slots[0], '00:00');
  assert.equal(slots[1], '00:30');
  assert.equal(slots[47], '23:30');
  assert.ok(slots.every(slot => /^\d{2}:\d{2}$/.test(slot)));
});

test('duration chips map to minutes and capacity clamps to 1..1000', () => {
  assert.deepEqual([...DURATION_CHIPS], [60, 120, 180]);
  assert.equal(durationChipSelected('60', false), 60);
  assert.equal(durationChipSelected('120', false), 120);
  assert.equal(durationChipSelected('180', false), 180);
  assert.equal(durationChipSelected('90', false), 'custom');
  assert.equal(durationChipSelected('120', true), 'custom');
  assert.equal(clampCapacity(0), 1);
  assert.equal(clampCapacity(-3), 1);
  assert.equal(clampCapacity(4.9), 4);
  assert.equal(clampCapacity(1000), 1000);
  assert.equal(clampCapacity(1001), 1000);
  assert.equal(clampCapacity(Number.NaN), 1);
});

test('create-game UI source: section cards, sticky footer, no intermediate venue step, sheet a11y, preview steps, map SR status, venue back', () => {
  const create = read('../src/components/create-game.tsx');
  const controls = read('../src/components/create-game-controls.tsx');
  const map = read('../app/games/map.tsx');
  const venueDetail = read('../src/components/venue-detail.tsx');
  const game = read('../app/games/[id].tsx');
  const venueRoute = read('../app/games/create/venue/[venueId].tsx');

  for (const title of ['Основное', 'Место и время', 'Для кого', 'Условия участия', 'Фото этой игры']) {
    assert.match(controls, new RegExp(`title="${title}"`));
  }
  assert.match(create, /title="Отмена"/);
  assert.match(create, /title="Далее — к созданию"/);
  assert.match(create, /footer: formFooter/);
  assert.match(create, /ScrollView/);
  assert.ok(create.indexOf('footer: formFooter') > create.indexOf('ScrollView'));
  assert.doesNotMatch(create, /Выбрать эту площадку для формы/);
  assert.doesNotMatch(controls, /Выбрать эту площадку для формы/);
  assert.match(controls, /accessibilityLabel="Назад"/);
  assert.match(controls, /accessibilityLabel="Закрыть"/);
  assert.match(controls, /1 · Данные/);
  assert.match(controls, /2 · Проверка/);
  assert.match(create, /StepIndicator/);
  assert.match(create, /Проверка перед созданием/);
  assert.match(create, /Назад к редактированию/);

  const loading = map.slice(map.indexOf("city && state.status === 'loading'"), map.indexOf("city && state.status === 'error'"));
  assert.doesNotMatch(loading, /<Loading/);
  assert.match(loading, /accessibilityLiveRegion="polite"/);
  assert.match(loading, /width:1,height:1/);
  assert.match(loading, /Загружаем площадки и расписания…/);

  assert.match(game, /from:\s*['"]game['"]/);
  assert.match(venueDetail, /from === ['"]game['"]/);
  assert.match(venueDetail, /← К игре/);
  assert.match(venueDetail, /← Назад к карте/);
  assert.match(venueRoute, /presentation:\s*'formSheet'/);
  assert.match(venueRoute, /← Все игры/);
  assert.match(create, /← Все игры/);
});

test('create-game-controls lives next to create-game for the extracted UI', () => {
  assert.equal(fileURLToPath(new URL('../src/components/create-game-controls.tsx', import.meta.url)).endsWith('create-game-controls.tsx'), true);
  assert.match(read('../src/components/create-game.tsx'), /create-game-controls\.tsx/);
});
