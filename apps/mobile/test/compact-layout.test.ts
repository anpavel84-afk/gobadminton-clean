import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { contentWidth, introArtworkSize } from '../src/layout.ts';

/** Mirrors exported `mainNavCompactCells` in main-navigation.tsx (no .tsx import under strip-types). */
function mainNavCompactCells(input: {
  windowWidth: number;
  insetLeft: number;
  insetRight: number;
  fontScale: number;
}): boolean {
  const rowInner = input.windowWidth - input.insetLeft - input.insetRight - 8;
  const equalContent = rowInner / 4 - 4;
  return equalContent < 70 * Math.max(input.fontScale, 0);
}

test('compact intro reserves measured copy/actions before artwork and both horizontal cutouts', () => {
  const insets = { top: 24, bottom: 24, left: 0, right: 0 };
  const width = contentWidth(360, insets, 20);
  // Group heights are inputs from native onLayout, not claims of device measurements.
  const portrait = { width, viewportHeight: 660, copyHeight: 150, actionsHeight: 112, fontScale: 1 };
  assert.equal(introArtworkSize(portrait), 195);
  const enlarged = { ...portrait, copyHeight: 240, actionsHeight: 150, fontScale: 1.3 };
  const size = introArtworkSize(enlarged);
  assert.ok(size < 195);
  assert.ok(size + 24 + enlarged.copyHeight + enlarged.actionsHeight + 32 + 6 + 36 <= enlarged.viewportHeight);
  assert.equal(contentWidth(780, { ...insets, left: 44, right: 28 }, 20), 668);
  assert.equal(contentWidth(60, { ...insets, left: 44, right: 28 }, 20), 0);
});
test('short landscape and large text relinquish decoration without shrinking text or actions', () => {
  const layout = { width: 668, viewportHeight: 230, copyHeight: 180, actionsHeight: 150, fontScale: 1.3 };
  assert.equal(introArtworkSize(layout), 0);
  assert.equal(introArtworkSize({ ...layout, fontScale: 2, copyHeight: 360, actionsHeight: 220 }), 0);
  const roomy = introArtworkSize({ width: 380, viewportHeight: 900, copyHeight: 150, actionsHeight: 112, fontScale: 1 });
  assert.equal(roomy, 270);
  const narrow = introArtworkSize({ width: 180, viewportHeight: 900, copyHeight: 150, actionsHeight: 112, fontScale: 1 });
  assert.ok(narrow * 1.4 <= 180 + 1e-8);
});

test('#522 compact bottom nav keeps equal cells at 420/1.0 and switches at 360/1.3', () => {
  const nav = readFileSync(new URL('../src/components/main-navigation.tsx', import.meta.url), 'utf8');
  assert.match(nav, /export function mainNavCompactCells/);
  assert.match(nav, /equalContent < 70 \* Math\.max\(input\.fontScale, 0\)/);
  assert.match(nav, /flexBasis: 'auto'/);
  assert.match(nav, /flexGrow: 1, flexShrink: 1/);
  assert.match(nav, /minWidth: 48, minHeight: 64/);
  assert.doesNotMatch(nav, /numberOfLines|ellipsizeMode|maxFontSizeMultiplier|allowFontScaling=\{false\}/);
  assert.equal(mainNavCompactCells({ windowWidth: 420, insetLeft: 0, insetRight: 0, fontScale: 1 }), false);
  assert.equal(mainNavCompactCells({ windowWidth: 360, insetLeft: 0, insetRight: 0, fontScale: 1.3 }), true);
  assert.equal(mainNavCompactCells({ windowWidth: 360, insetLeft: 0, insetRight: 0, fontScale: 1 }), false);
  // Larger font on compact viewport still triggers intrinsic allocation; wrapping remains native Text.
  assert.equal(mainNavCompactCells({ windowWidth: 360, insetLeft: 0, insetRight: 0, fontScale: 2 }), true);
});

test('venue sheet footer reserves safe bottom separately from scroll body, and fullscreen tabs hide only exact map route', async () => {
  const {venueSheetSpacing,fullscreenGamesMap}=await import('../src/maps.ts');
  assert.equal(venueSheetSpacing(24).footerBottom,40);
  assert.equal(venueSheetSpacing(0).bodyBottom,24);
  assert.equal(fullscreenGamesMap('/games/map'),true);
  for (const route of ['/games','/games/map/other','/games/create','/games/manage/id','/players','/players/map','/messages','/profile']) assert.equal(fullscreenGamesMap(route),false,route);
});
