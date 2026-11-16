import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryItem } from '../src/venues.ts';
import {
  clampSheetLift,
  decideCompactRelease,
  decideGalleryAxis,
  decideGallerySwipe,
  decideHandleSettle,
  decideSheetAxis,
  gallerySelectionOf,
  resolveGallerySelection,
  stepGallerySelection,
  VENUE_GALLERY_AXIS_LOCK,
  VENUE_GALLERY_SWIPE,
  VENUE_HANDLE_VELOCITY,
  VENUE_HANDLE_VELOCITY_STALE_MS,
  VENUE_SHEET_AXIS_LOCK,
  VENUE_SHEET_DISMISS_DY,
  VENUE_SHEET_EXPAND_DY,
} from '../src/venue-gestures.ts';

const photo = (id: string, url: string): GalleryItem => ({
  id, url, credit: { kind: 'photo', text: 'Фото', url: null },
});

test('sheet axis stays pending under lock; horizontal tie/dominance owns horizontal', () => {
  assert.equal(decideSheetAxis(0, 0), 'pending');
  assert.equal(decideSheetAxis(VENUE_SHEET_AXIS_LOCK - 1, VENUE_SHEET_AXIS_LOCK - 1), 'pending');
  assert.equal(decideSheetAxis(10, 10), 'horizontal');
  assert.equal(decideSheetAxis(12, 8), 'horizontal');
  assert.equal(decideSheetAxis(8, 12), 'vertical');
});

test('compact release expands, dismisses, or returns origin only after vertical lock', () => {
  assert.equal(decideCompactRelease('pending', VENUE_SHEET_EXPAND_DY), 'none');
  assert.equal(decideCompactRelease('horizontal', VENUE_SHEET_DISMISS_DY), 'none');
  assert.equal(decideCompactRelease('vertical', VENUE_SHEET_EXPAND_DY), 'expand');
  assert.equal(decideCompactRelease('vertical', VENUE_SHEET_EXPAND_DY - 1), 'expand');
  assert.equal(decideCompactRelease('vertical', VENUE_SHEET_DISMISS_DY), 'dismiss');
  assert.equal(decideCompactRelease('vertical', 0), 'origin');
  assert.equal(decideCompactRelease('vertical', -55), 'origin');
  assert.equal(decideCompactRelease('vertical', 63), 'origin');
});

test('handle settle uses measured half-travel or fresh velocity; stale velocity ignored; compact dismiss preserved', () => {
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: VENUE_SHEET_DISMISS_DY, start: 0, travel: 200, velocity: 0, velocityAgeMs: 0,
  }), 'dismiss');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 120, start: 200, travel: 200, velocity: 0, velocityAgeMs: 0,
  }), 'collapse');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 40, start: 200, travel: 200, velocity: 0, velocityAgeMs: 0,
  }), 'expand');
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: -10, start: 0, travel: 200, velocity: VENUE_HANDLE_VELOCITY, velocityAgeMs: 0,
  }), 'expand');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 10, start: 200, travel: 200, velocity: -VENUE_HANDLE_VELOCITY, velocityAgeMs: 0,
  }), 'collapse');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 10, start: 200, travel: 200, velocity: -VENUE_HANDLE_VELOCITY,
    velocityAgeMs: VENUE_HANDLE_VELOCITY_STALE_MS + 1,
  }), 'expand');
  assert.equal(clampSheetLift(-80, 200), 80);
  assert.equal(clampSheetLift(40, 200), 0);
  assert.equal(clampSheetLift(-400, 200), 200);
});

test('gallery axis lock and swipe commit with modulo step; zero/one image has no pretend paging', () => {
  assert.equal(decideGalleryAxis(0, 0), 'pending');
  assert.equal(decideGalleryAxis(VENUE_GALLERY_AXIS_LOCK - 1, VENUE_GALLERY_AXIS_LOCK - 1), 'pending');
  assert.equal(decideGalleryAxis(12, 12), 'vertical');
  assert.equal(decideGalleryAxis(20, 8), 'horizontal');
  assert.equal(decideGallerySwipe('pending', VENUE_GALLERY_SWIPE), 'none');
  assert.equal(decideGallerySwipe('vertical', VENUE_GALLERY_SWIPE), 'none');
  assert.equal(decideGallerySwipe('horizontal', VENUE_GALLERY_SWIPE - 1), 'none');
  assert.equal(decideGallerySwipe('horizontal', -VENUE_GALLERY_SWIPE), 'next');
  assert.equal(decideGallerySwipe('horizontal', VENUE_GALLERY_SWIPE), 'previous');

  const a = photo('a', '/a.jpg'), b = photo('b', '/b.jpg'), c = photo('c', '/c.jpg');
  assert.equal(stepGallerySelection([], null, 1), null);
  assert.equal(stepGallerySelection([a], a, 1), a);
  assert.equal(stepGallerySelection([a, b, c], a, 1), b);
  assert.equal(stepGallerySelection([a, b, c], c, 1), a);
  assert.equal(stepGallerySelection([a, b, c], a, -1), c);
});

test('gallery selection survives refresh of surviving URL/id and falls back to main/first when removed', () => {
  const a = photo('a', '/a.jpg'), b = photo('b', '/b.jpg'), c = photo('c', '/c.jpg');
  assert.equal(resolveGallerySelection([], null, null), null);
  assert.equal(resolveGallerySelection([a, b], '/b.jpg', null), b);
  assert.equal(resolveGallerySelection([a, b], null, null), a);
  const kept = resolveGallerySelection([a, b, c], '/a.jpg', gallerySelectionOf(b));
  assert.equal(kept, b);
  const byId = resolveGallerySelection([photo('b', '/b-new.jpg'), a], '/a.jpg', { url: '/b.jpg', id: 'b' });
  assert.equal(byId?.id, 'b');
  assert.equal(byId?.url, '/b-new.jpg');
  const removed = resolveGallerySelection([a, c], '/a.jpg', gallerySelectionOf(b));
  assert.equal(removed, a);
  const mainGone = resolveGallerySelection([b, c], '/gone.jpg', null);
  assert.equal(mainGone, b);
});
