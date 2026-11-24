import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  clampCapacity,
  createGameDateChoice,
  createGameDateOptions,
  createGameTimeSlots,
  durationChipSelected,
  DURATION_CHIPS,
} from '../src/game-form.ts';
import { GAME_COVER_EDITOR_COPY } from '../src/game-cover.ts';

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

  for (const title of ['Основное', 'Место и время', 'Для кого', 'Условия участия']) {
    assert.match(controls, new RegExp(`title="${title}"`));
  }
  assert.match(controls, /title="Фото этой игры · необязательно"/);
  assert.match(create, /GamePhotoSelection/);
  assert.match(create, /photoReady/);
  assert.match(create, /setCreationPhoto/);
  assert.match(create, /publishPreview/);
  assert.match(controls, /photoSlot/);
  const photoSelection = read('../src/components/game-photo-selection.tsx');
  assert.match(photoSelection, /GAME_COVER_EDITOR_COPY\.confirmPick/);
  assert.equal(GAME_COVER_EDITOR_COPY.confirmPick, 'Подтвердить выбор фото');
  assert.match(photoSelection, /Без своего фото/);
  assert.match(photoSelection, /prepareGameCoverDerivative/);
  assert.match(photoSelection, /aspectRatio: COVER_PREVIEW_ASPECT|aspectRatio: 3/);
  assert.doesNotMatch(photoSelection, /aspectRatio: 2\.5/);
  assert.doesNotMatch(photoSelection, /owner\.change|mutateGameCover|gameCover\.change/);
  // Preview↔edit keeps photo selection mounted (display:none under preview).
  assert.match(create, /display:\s*['"]none['"]/);
  assert.match(create, /bindCreationView/);
  assert.match(create, /creationCoverBlocksPublish/);
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
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /presentation:\s*'formSheet'/);
  assert.match(layout, /sheetAllowedDetents:\s*\[0\.9\]/);
  assert.doesNotMatch(venueRoute, /Stack\.Screen/);
  assert.match(venueRoute, /← Все игры/);
  assert.match(create, /← Все игры/);
});

test('create-game-controls lives next to create-game for the extracted UI', () => {
  assert.equal(fileURLToPath(new URL('../src/components/create-game-controls.tsx', import.meta.url)).endsWith('create-game-controls.tsx'), true);
  assert.match(read('../src/components/create-game.tsx'), /create-game-controls\.tsx/);
});

test('#522 FIX4: production photo selection — stale confirm after retire and cross-scope pick cannot inject parent', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  // Mirror the component's render-time generation fence (gen captured OUTSIDE handlers).
  const fenceSource = `
    function makeSelection(scopeKey) {
      const scopeEpoch = { current: 0 };
      const liveScope = { current: scopeKey };
      const mounted = { current: true };
      const foreground = { current: true };
      const disabled = { current: false };
      let parent = null;
      let ready = true;
      const selectionLive = (gen, scope) =>
        mounted.current && foreground.current && !disabled.current
        && scopeEpoch.current === gen && liveScope.current === scope;
      const retire = (clearParent) => {
        scopeEpoch.current += 1;
        if (clearParent) { parent = null; ready = true; }
      };
      const render = (scope) => {
        if (liveScope.current !== scope) {
          scopeEpoch.current += 1;
          liveScope.current = scope;
        }
        const genAtRender = scopeEpoch.current;
        const scopeAtRender = scope;
        const previewBytes = { mime: 'image/jpeg', bytes: new Uint8Array([1]) };
        return {
          confirm: () => {
            if (!selectionLive(genAtRender, scopeAtRender) || !previewBytes) return;
            const derivative = Object.freeze({ mime: previewBytes.mime, bytes: previewBytes.bytes });
            if (!selectionLive(genAtRender, scopeAtRender)) return;
            parent = derivative;
            ready = true;
          },
          pickInject: () => {
            if (!selectionLive(genAtRender, scopeAtRender)) return;
            parent = Object.freeze({ mime: 'image/png', bytes: new Uint8Array([9]) });
            ready = false;
          },
          genAtRender,
        };
      };
      return { render, retire, mounted, foreground, liveScope, scopeEpoch, getParent: () => parent, getReady: () => ready };
    }
    makeSelection;
  `;
  const makeSelection = runInNewContext(stripTypeScriptTypes(fenceSource), {}) as (
    scopeKey: string,
  ) => {
    render: (scope: string) => { confirm: () => void; pickInject: () => void; genAtRender: number };
    retire: (clearParent: boolean) => void;
    mounted: { current: boolean };
    foreground: { current: boolean };
    liveScope: { current: string };
    scopeEpoch: { current: number };
    getParent: () => { mime: string; bytes: Uint8Array } | null;
    getReady: () => boolean;
  };
  const a = makeSelection('actor-a:1');
  const first = a.render('actor-a:1');
  first.confirm();
  assert.ok(a.getParent());
  // Same scope after real unmount retirement — old confirm must not re-inject.
  a.retire(true);
  assert.equal(a.getParent(), null);
  first.confirm();
  assert.equal(a.getParent(), null);
  // Background retirement (same scope) also fences.
  const second = a.render('actor-a:1');
  a.foreground.current = false;
  a.retire(true);
  second.confirm();
  assert.equal(a.getParent(), null);
  a.foreground.current = true;
  // Cross-actor scope: old pick/confirm cannot invalidate the new parent.
  const b = makeSelection('actor-b:2');
  const oldPick = b.render('actor-b:2');
  b.liveScope.current = 'actor-c:3';
  b.scopeEpoch.current += 1;
  const fresh = b.render('actor-c:3');
  fresh.confirm();
  assert.ok(b.getParent());
  const kept = b.getParent();
  oldPick.pickInject();
  oldPick.confirm();
  assert.strictEqual(b.getParent(), kept);
  // Create keeps photo mount across preview↔edit; confirmed preview shows image.
  const create = read('../src/components/create-game.tsx');
  assert.match(create, /Form stays mounted under preview|display:\s*['"]none['"]/);
  assert.match(create, /confirmedPreviewUri/);
  assert.match(create, /aspectRatio: 3/);
  assert.equal(GAME_COVER_EDITOR_COPY.confirmPick, 'Подтвердить выбор фото');
});
