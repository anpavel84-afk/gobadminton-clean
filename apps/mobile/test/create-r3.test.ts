import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  LEVELS,
  LEVEL_MAX,
  LEVEL_MIN,
  applyLevelBoundChange,
  levelFromTrackX,
  levelSelectedFill,
  levelVisualPercent,
  snapLevel,
  stepLevel,
} from '../src/level-range.ts';
import { createGameInstant } from '../src/presentation.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('level-range snap/clamp stay on NTRP half-steps 1.0…7.0', () => {
  assert.equal(LEVELS.length, 13);
  assert.equal(LEVELS[0], LEVEL_MIN);
  assert.equal(LEVELS[12], LEVEL_MAX);
  assert.equal(snapLevel(3.24), 3);
  assert.equal(snapLevel(3.26), 3.5);
  assert.equal(snapLevel(0), 1);
  assert.equal(snapLevel(9), 7);
  assert.equal(snapLevel(Number.NaN), 1);
});

test('level-range crossing clamps to the other endpoint', () => {
  assert.deepEqual(applyLevelBoundChange('lower', 5, 3, 4), { lower: 4, upper: 4 });
  assert.deepEqual(applyLevelBoundChange('upper', 2, 3, 4), { lower: 3, upper: 3 });
  assert.deepEqual(applyLevelBoundChange('lower', 2.5, 3, 4), { lower: 2.5, upper: 4 });
  assert.deepEqual(applyLevelBoundChange('upper', 5.5, 3, 4), { lower: 3, upper: 5.5 });
  assert.deepEqual(stepLevel('lower', 1, 3, 3.5), { lower: 3.5, upper: 3.5 });
  assert.deepEqual(stepLevel('upper', -1, 3, 3.5), { lower: 3, upper: 3 });
});

test('level-range track math maps position ↔ value and selected fill', () => {
  assert.equal(levelVisualPercent(1), 0);
  assert.equal(levelVisualPercent(7), 100);
  assert.equal(levelVisualPercent(4), 50);
  assert.equal(levelFromTrackX(0, 200), 1);
  assert.equal(levelFromTrackX(200, 200), 7);
  assert.equal(levelFromTrackX(100, 200), 4);
  assert.deepEqual(levelSelectedFill(3, 5), { left: levelVisualPercent(3), width: levelVisualPercent(5) - levelVisualPercent(3) });
});

test('venueCreateSheetPath hides bottom nav only on venue create sheet routes', () => {
  const nav = read('../src/components/main-navigation.tsx');
  assert.match(nav, /export function venueCreateSheetPath\(path: string\): boolean \{\s*return path === '\/games\/create\/venue' \|\| path\.startsWith\('\/games\/create\/venue\/'\);\s*\}/);
  assert.match(nav, /!venueCreateSheetPath\(path\)/);
  assert.doesNotMatch(read('../src/maps.ts'), /venueCreateSheetPath/);
  const venueCreateSheetPath = (path: string): boolean =>
    path === '/games/create/venue' || path.startsWith('/games/create/venue/');
  assert.equal(venueCreateSheetPath('/games/create/venue/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(venueCreateSheetPath('/games/create/venue'), true);
  assert.equal(venueCreateSheetPath('/games/create'), false);
  assert.equal(venueCreateSheetPath('/games/map'), false);
  assert.equal(venueCreateSheetPath('/games'), false);
});

test('createGameInstant formats date + HH:MM without seconds', () => {
  const text = createGameInstant('2026-11-19T00:00:00.000Z', 'Europe/Moscow');
  assert.match(text, /\d{2}:\d{2}/);
  assert.doesNotMatch(text, /\d{2}:\d{2}:\d{2}/);
});

test('R3 source: #589 formSheet detents once in _layout; nav helper; no route Stack.Screen', () => {
  const layout = read('../app/_layout.tsx');
  const venueRoute = read('../app/games/create/venue/[venueId].tsx');
  const nav = read('../src/components/main-navigation.tsx');
  assert.match(layout, /sheetAllowedDetents:\s*\[0\.9\]/);
  assert.match(layout, /sheetCornerRadius:\s*20/);
  assert.match(layout, /sheetGrabberVisible:\s*true/);
  assert.match(layout, /sheetExpandsWhenScrolledToEdge:\s*false/);
  assert.match(layout, /presentation:\s*'formSheet'/);
  assert.equal((layout.match(/games\/create\/venue\/\[venueId\]/g) ?? []).length, 1);
  assert.doesNotMatch(venueRoute, /Stack\.Screen/);
  assert.doesNotMatch(venueRoute, /presentation:\s*'formSheet'/);
  assert.match(nav, /export function venueCreateSheetPath/);
  assert.match(nav, /venueCreateSheetPath\(path\)/);
  assert.match(nav, /\/games\/create\/venue\//);
});

test('R3 source: #594 dual-thumb level-range + visibility select; chip grids gone', () => {
  const controls = read('../src/components/create-game-controls.tsx');
  const levelRange = read('../src/components/level-range.tsx');
  const pure = read('../src/level-range.ts');
  assert.match(controls, /from '\.\/level-range\.tsx'/);
  assert.match(controls, /LevelRange/);
  assert.doesNotMatch(controls, /title=\{level\.toFixed\(1\)\}/);
  assert.doesNotMatch(controls, /DiscoveryChip title="В поиске"/);
  assert.doesNotMatch(controls, /DiscoveryChip title="Только по ссылке"/);
  assert.match(controls, /title="Видимость"/);
  assert.match(controls, /VISIBILITY_OPTIONS/);
  assert.match(controls, /✓ /);
  assert.match(levelRange, /accessibilityRole="adjustable"/);
  assert.match(levelRange, /accessibilityLabel="От"/);
  assert.match(levelRange, /accessibilityLabel="До"/);
  assert.match(levelRange, /PanResponder/);
  assert.match(levelRange, /onAccessibilityAction/);
  assert.match(pure, /export function applyLevelBoundChange/);
  assert.match(pure, /export function snapLevel/);
  assert.equal(fileURLToPath(new URL('../src/level-range.ts', import.meta.url)).endsWith('level-range.ts'), true);
});

test('R3 source: #623 notice scroll/alert, time without seconds, Создать игру, terms labels', () => {
  const create = read('../src/components/create-game.tsx');
  const controls = read('../src/components/create-game-controls.tsx');
  assert.match(create, /scrollTo/);
  assert.match(create, /contactAlert/);
  assert.match(create, /if \(contactAlert\) return/);
  assert.match(create, /getInnerViewRef/);
  assert.match(create, /measureLayout/);
  assert.match(controls, /accessibilityRole="alert"/);
  assert.match(controls, /onContactAlertLayout/);
  assert.doesNotMatch(controls, /participationSectionY/);
  assert.match(create, /createGameInstant/);
  assert.doesNotMatch(create, /toLocaleString\('ru-RU',\s*\{\s*timeZone:/);
  assert.match(create, /title="Создать игру"/);
  assert.doesNotMatch(create, /title="Опубликовать"/);
  assert.match(create, /Условия площадки: /);
  assert.match(create, /Оплата тренеру: /);
  assert.match(create, /previewTerms/);
});
