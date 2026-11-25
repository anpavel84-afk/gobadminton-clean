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
import {
  GAME_COVER_EDITOR_COPY,
  gamePhotoSelectionLive,
  type GamePhotoSelectionFence,
  type GamePhotoSelectionLiveState,
} from '../src/game-cover.ts';

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

test('#522 FIX5: production gamePhotoSelectionLive — current confirm; stale after same-scope retire; cross-scope old cannot replace parent', () => {
  const previewA = Object.freeze({ mime: 'image/jpeg' as const, bytes: new Uint8Array([1]) });
  const previewB = Object.freeze({ mime: 'image/png' as const, bytes: new Uint8Array([9]) });
  type PreviewBytes = GamePhotoSelectionLiveState['previewBytes'];
  const live: {
    mounted: boolean;
    foreground: boolean;
    disabled: boolean;
    generation: number;
    scope: string;
    assetUri: string | null;
    cropX: number;
    cropY: number;
    previewBytes: PreviewBytes;
  } = {
    mounted: true,
    foreground: true,
    disabled: false,
    generation: 0,
    scope: 'actor-a:1',
    assetUri: 'file://a',
    cropX: 0.5,
    cropY: 0.5,
    previewBytes: previewA,
  };
  const holder: { current: NonNullable<PreviewBytes> | null } = { current: null };

  const confirmWith = (fence: GamePhotoSelectionFence): NonNullable<PreviewBytes> | null => {
    if (!gamePhotoSelectionLive(fence, live) || !fence.previewBytes) return null;
    const derivative = Object.freeze({
      mime: fence.previewBytes.mime,
      bytes: fence.previewBytes.bytes,
    });
    if (!gamePhotoSelectionLive(fence, live)) return null;
    holder.current = derivative;
    return derivative;
  };

  const currentFence: GamePhotoSelectionFence = {
    generation: live.generation,
    scope: live.scope,
    assetUri: live.assetUri,
    cropX: live.cropX,
    cropY: live.cropY,
    previewBytes: live.previewBytes,
  };
  assert.ok(confirmWith(currentFence));
  assert.equal(holder.current!.bytes[0], 1);

  // Same-scope pick/crop/reset retire — old confirm rejected (gen + identity).
  live.generation += 1;
  live.assetUri = 'file://b';
  live.previewBytes = previewB;
  holder.current = null;
  assert.equal(confirmWith(currentFence), null);
  assert.equal(holder.current, null);

  // Identity alone (same gen) also rejects stale preview after crop/replace.
  live.generation = currentFence.generation;
  live.assetUri = currentFence.assetUri;
  live.previewBytes = previewB;
  assert.equal(gamePhotoSelectionLive(currentFence, live), false);
  live.generation += 1;
  live.assetUri = 'file://b';
  live.previewBytes = previewB;

  const freshFence: GamePhotoSelectionFence = {
    generation: live.generation,
    scope: live.scope,
    assetUri: live.assetUri,
    cropX: live.cropX,
    cropY: live.cropY,
    previewBytes: live.previewBytes,
  };
  assert.ok(confirmWith(freshFence));

  // Cross-scope: old confirm cannot replace fresh parent.
  const oldScopeFence = freshFence;
  live.generation += 1;
  live.scope = 'actor-c:3';
  live.assetUri = 'file://c';
  live.previewBytes = previewA;
  holder.current = Object.freeze({ mime: previewA.mime, bytes: previewA.bytes });
  const freshParent = holder.current;
  confirmWith(oldScopeFence);
  assert.strictEqual(holder.current, freshParent);

  // Create keeps photo mount across preview↔edit; confirmed preview shows image.
  const create = read('../src/components/create-game.tsx');
  assert.match(create, /Form stays mounted under preview|display:\s*['"]none['"]/);
  assert.match(create, /confirmedPreviewUri/);
  assert.match(create, /aspectRatio: 3/);
  assert.equal(GAME_COVER_EDITOR_COPY.confirmPick, 'Подтвердить выбор фото');
});

test('#522 FIX8: create-view rebinds after auth/actor generation; crop boundary no-op preserves confirm', () => {
  const create = read('../src/components/create-game.tsx');
  // Focus lifetime binds on actor identity — not auth.status (same-session refresh must not release).
  assert.match(create, /if\s*\(\s*!actor\s*\)\s*return/);
  assert.doesNotMatch(create, /useFocusEffect\(useCallback\(\(\)\s*=>\s*\{[^}]*auth\.status/);
  assert.match(create, /\[owner,\s*actor\?\.actorId,\s*actor\?\.sessionId,\s*actor\?\.generation\]/);
  assert.match(create, /bindCreationView/);

  const photoSelection = read('../src/components/game-photo-selection.tsx');
  assert.match(photoSelection, /nextX === fenceAtRender\.cropX/);
  assert.match(photoSelection, /nextY === fenceAtRender\.cropY/);
  // step clamp: unchanged coordinate at 0/1 must early-return before invalidateConfirmed.
  const step = (value: number, delta: number) =>
    Math.min(1, Math.max(0, Math.round((value + delta) * 10) / 10));
  assert.equal(step(0, -0.1), 0);
  assert.equal(step(1, 0.1), 1);
  assert.equal(step(0.5, -0.1), 0.4);
});
