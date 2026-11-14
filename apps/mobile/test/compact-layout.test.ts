import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentWidth, introArtworkSize } from '../src/layout.ts';

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
