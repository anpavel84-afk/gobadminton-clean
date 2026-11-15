import { test } from 'node:test';
import assert from 'node:assert/strict';
import { game } from './fixtures.ts';
import { canShareGame, cardWhen, normalizeNtrpLevelId, gameAllowsSelectedNtrpLevel, filterGamesBySelectedNtrpLevel, discoveryListPresentation, gamePeople, discoveryDayBounds, futureDiscoveryBounds, cityDate, nextCalendarDay, discoveryCityHeading, formatLabel, levelLabel } from '../src/presentation.ts';

test('public-link sharing requires a published public game', () => {
  assert.equal(canShareGame({ status: 'published', visibility: 'public' }), true);
  for (const status of ['draft', 'cancelled', 'completed'] as const) {
    assert.equal(canShareGame({ status, visibility: 'public' }), false);
  }
  assert.equal(canShareGame({ status: 'published', visibility: 'unlisted' }), false);
  assert.equal(canShareGame({ status: 'draft', visibility: 'unlisted' }), false);
});

test('formats use accepted discovery labels; unknown keys are omitted', () => {
  assert.equal(formatLabel('doubles'), 'Парная игра');
  assert.equal(formatLabel('singles'), 'Одиночная игра');
  assert.equal(formatLabel('mixed'), 'Микст');
  assert.equal(formatLabel('mixed_doubles'), 'Микст');
  assert.equal(formatLabel('unknown-internal-key'), null);
});

test('levels respect exact accepted scale/version, numeric half-steps and pilot labels without raw-key fallbacks', () => {
  const rule = { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['1', '3.0', '3,5', '7.0'] };
  assert.equal(levelLabel(rule), 'NTRP 1,0 · 3,0 · 3,5 · 7,0');
  assert.equal(levelLabel({ scaleId: 'gb-social-pilot', scaleVersion: 1,
    allowedLevelIds: ['beginner', 'intermediate', 'advanced'] }), 'Начинающий · Средний · Продвинутый');
  for (const unsupported of [
    { ...rule, scaleId: 'foreign-scale' },
    { ...rule, scaleVersion: 2 },
    ...['0.5', '7.5', '3.2', '', 'internal-level'].map(id => ({ ...rule, allowedLevelIds: ['3.0', id] })),
    { scaleId: 'gb-social-pilot', scaleVersion: 1, allowedLevelIds: ['internal-level'] },
    { scaleId: 'gb-social-pilot', scaleVersion: 2, allowedLevelIds: ['beginner'] },
  ]) assert.equal(levelLabel(unsupported), 'Уточните у организатора');
  assert.equal(levelLabel({ ...rule, allowedLevelIds: [] }), 'Не указаны');
});

test('card date/time uses the actual game timezone and city heading never substitutes a default', () => {
  const when = cardWhen({ ...game, startsAt: '2026-11-20T23:30:00Z', endsAt: '2026-11-21T01:30:00Z', timezone: 'Asia/Tokyo' });
  assert.match(when.day, /21/);
  assert.equal(when.time, '08:30 — 10:30');
  assert.equal(discoveryCityHeading('Казань'), '· Казань');
  assert.equal(discoveryCityHeading('Москва'), 'в Москве');
});

test('discovery level matches only exact normalized ntrp v1 half-steps', () => {
  for (const value of ['3', '3.0', '3,0', ' 3.0 ']) assert.equal(normalizeNtrpLevelId(value), '3.0');
  for (const value of ['', '3.2', '0.5', '7.5', 'invalid', 'Infinity']) assert.equal(normalizeNtrpLevelId(value), null);
  const rule = { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['2.5', '3,0', '3.5'] };
  assert.equal(gameAllowsSelectedNtrpLevel(rule, '3'), true);
  assert.equal(gameAllowsSelectedNtrpLevel(rule, '4.0'), false);
  assert.equal(gameAllowsSelectedNtrpLevel(rule, '3.2'), false);
  assert.equal(gameAllowsSelectedNtrpLevel({ ...rule, scaleId: 'foreign' }, '3.0'), false);
  assert.equal(gameAllowsSelectedNtrpLevel({ ...rule, scaleVersion: 2 }, '3.0'), false);
  assert.equal(gameAllowsSelectedNtrpLevel({ ...rule, allowedLevelIds: [] }, '3.0'), false);
  assert.equal(gameAllowsSelectedNtrpLevel({ ...rule, allowedLevelIds: ['1.0', '7.0'] }, '7'), true);
});
test('loaded-only level zero preserves raw items, count plus and pagination; reset restores all', () => {
  const raw = Object.freeze([{ ...game, levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] } },
    { ...game, id: 'foreign', levelRule: { scaleId: 'other', scaleVersion: 1, allowedLevelIds: ['4.0'] } }]);
  const before = JSON.stringify(raw);
  assert.deepEqual(filterGamesBySelectedNtrpLevel(raw, '3'), [raw[0]]);
  const zero = discoveryListPresentation(raw, '4.0', 'next');
  assert.deepEqual(zero, { visible: [], count: 'Найдено: 0+ · из 2 загруженных', levelEmpty: true, canLoadMore: true });
  const reset = discoveryListPresentation(raw, '', 'next');
  assert.deepEqual(reset.visible, raw); assert.notStrictEqual(reset.visible, raw);
  assert.equal(reset.count, 'Найдено: 2+'); assert.equal(reset.canLoadMore, true);
  assert.equal(discoveryListPresentation(raw, '3.0', null).count, 'Найдено: 1 · из 2 загруженных');
  assert.equal(JSON.stringify(raw), before);
});
test('selected calendar date uses city midnight, DST day length and upcoming lower bound', () => {
  assert.equal(cityDate(new Date('2026-11-15T15:30:00Z'), 'Asia/Tokyo'), '2026-11-16');
  assert.equal(nextCalendarDay('2026-12-31'), '2027-01-01');
  assert.deepEqual(discoveryDayBounds('2026-11-16', 'Asia/Tokyo'), { startsFrom: '2026-11-15T15:00:00.000Z', startsBefore: '2026-11-16T15:00:00.000Z' });
  const spring = discoveryDayBounds('2026-03-29', 'Europe/Berlin');
  assert.equal(Date.parse(spring.startsBefore) - Date.parse(spring.startsFrom), 23 * 3600000);
  const autumn = discoveryDayBounds('2026-10-25', 'Europe/Berlin');
  assert.equal(Date.parse(autumn.startsBefore) - Date.parse(autumn.startsFrom), 25 * 3600000);
  const now = Date.parse('2026-11-16T04:15:00Z');
  assert.deepEqual(futureDiscoveryBounds('2026-11-16', 'Asia/Tokyo', now), { startsFrom: new Date(now).toISOString(), startsBefore: '2026-11-16T15:00:00.000Z' });
});
test('card role facts keep trainer separate from organizer without reputation invention', () => {
  const ordinary = gamePeople(game);
  assert.deepEqual(ordinary.map(p => [p.role, p.name]), [['Организатор', game.organizer.displayName]]);
  const trainer = { ...game, activityKind: 'trainer_led', trainer: { profileId: 't', displayName: 'Тренер Анна', declarationSource: 'self_declared' } } as const;
  assert.deepEqual(gamePeople(trainer).map(p => [p.role, p.name]), [['Тренер', 'Тренер Анна'], ['Организатор', game.organizer.displayName]]);
  assert.equal(gamePeople({ ...trainer, trainer: null })[0]?.name, 'Профиль недоступен');
  assert.deepEqual(gamePeople({ ...trainer, trainer: { ...trainer.trainer, displayName: game.organizer.displayName } }).map(p => p.role), ['Тренер', 'Организатор']);
  assert.equal(Object.keys(ordinary[0]!).some(k => /rating|reviews|score/i.test(k)), false);
});
