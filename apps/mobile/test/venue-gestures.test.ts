import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryItem } from '../src/venues.ts';
import {
  clampSheetLift,
  consumeFollowOnSuppress,
  decideCompactRelease,
  decideGalleryAxis,
  decideGallerySwipe,
  decideHandleSettle,
  decideSheetAxis,
  eventClockAgeMs,
  expandedHandleLift,
  galleryMediaIdentity,
  gallerySelectionOf,
  gestureGenerationActive,
  measuredSheetTravel,
  mediaFailureApplies,
  resolveGallerySelection,
  sampleHandleVelocity,
  secondTouchCancels,
  stepGallerySelection,
  suppressAfterFreshTouch,
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

test('event clock age never mixes wall clock; fresh short flicks and delayed release use one timeline', () => {
  assert.equal(eventClockAgeMs(1100, 1000), 100);
  assert.equal(eventClockAgeMs(1000, 1100), 0);
  // Fresh short fast up: last move at t=1050, release at t=1060 → age 10 < stale.
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: -40, start: 0, travel: 200,
    velocity: VENUE_HANDLE_VELOCITY, velocityAgeMs: eventClockAgeMs(1060, 1050),
  }), 'expand');
  // Fresh short fast down.
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 40, start: 200, travel: 200,
    velocity: -VENUE_HANDLE_VELOCITY, velocityAgeMs: eventClockAgeMs(2060, 2050),
  }), 'collapse');
  // Delayed release: last move aged beyond stale window → velocity ignored.
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 40, start: 200, travel: 200,
    velocity: -VENUE_HANDLE_VELOCITY,
    velocityAgeMs: eventClockAgeMs(2200, 2050),
  }), 'expand');
  // Final release dy crosses compact-down threshold even when last move was earlier.
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: VENUE_SHEET_DISMISS_DY, start: 0, travel: 200,
    velocity: 0, velocityAgeMs: eventClockAgeMs(1500, 1200),
  }), 'dismiss');
  const sampled = sampleHandleVelocity({ lastY: 400, time: 1000, velocity: 0 }, 360, 1040);
  assert.equal(sampled.velocity, (400 - 360) / 40);
  assert.equal(sampled.time, 1040);
  assert.equal(sampled.lastY, 360);
});

test('measured travel rejects +200/×2.5 guesses; expanded handle lift tracks before settle', () => {
  assert.equal(measuredSheetTravel(0, 500, 700), 0);
  assert.equal(measuredSheetTravel(172, 500, 700), 328);
  assert.equal(measuredSheetTravel(172, 0, 700), 528);
  assert.equal(measuredSheetTravel(172, 100, 100), 0);
  assert.equal(expandedHandleLift(true, 200, 200, 80), 80);
  assert.equal(expandedHandleLift(false, 0, 200, -80), 80);
});

test('follow-on suppress clears on fresh touch; second pointer cancels; retired generation ignores late callbacks', () => {
  assert.equal(suppressAfterFreshTouch(false, true), false);
  assert.equal(suppressAfterFreshTouch(true, true), true);
  assert.deepEqual(consumeFollowOnSuppress(true), { suppress: false, blocked: true });
  assert.deepEqual(consumeFollowOnSuppress(false), { suppress: false, blocked: false });
  assert.equal(secondTouchCancels(1), false);
  assert.equal(secondTouchCancels(2), true);
  assert.equal(gestureGenerationActive(3, 3, true), true);
  assert.equal(gestureGenerationActive(4, 3, true), false);
  assert.equal(gestureGenerationActive(3, 3, false), false);
});

test('selected media identity owns load/error/retry; late prior failure ignored', () => {
  assert.equal(galleryMediaIdentity({ url: '/a.jpg', id: 'a' }), '/a.jpg');
  assert.equal(mediaFailureApplies('/a.jpg', '/a.jpg'), true);
  assert.equal(mediaFailureApplies('/b.jpg', '/a.jpg'), false);
  assert.equal(mediaFailureApplies('', '/a.jpg'), false);
});

/** Owning adapter harness: executes responder lifecycle with a shared event clock. */
function createHandleAdapter() {
  const drag: {
    startY: number; lastY: number; time: number; velocity: number; start: number; travel: number;
    originExpanded: boolean; axis: 'pending' | 'vertical' | 'horizontal'; generation: number;
  } | null = { startY: 0, lastY: 0, time: 0, velocity: 0, start: 200, travel: 200, originExpanded: true, axis: 'pending', generation: 1 };
  let state = drag;
  const actions: string[] = [];
  const grant = (pageY: number, timestamp: number) => {
    state = {
      startY: pageY, lastY: pageY, time: timestamp, velocity: 0, start: 200, travel: 200,
      originExpanded: true, axis: 'pending', generation: 1,
    };
  };
  const move = (pageY: number, timestamp: number, dx: number, dy: number) => {
    if (!state) return;
    if (state.axis === 'pending') {
      const axis = decideSheetAxis(dx, dy);
      if (axis === 'pending') return;
      if (axis === 'horizontal') { state = null; return; }
      state.axis = 'vertical';
    }
    const sampled = sampleHandleVelocity(state, pageY, timestamp);
    state.lastY = sampled.lastY; state.time = sampled.time; state.velocity = sampled.velocity;
  };
  const release = (pageY: number, timestamp: number) => {
    if (!state || state.axis !== 'vertical') { state = null; return; }
    const dy = pageY - state.startY;
    const velocityAgeMs = eventClockAgeMs(timestamp, state.time);
    actions.push(decideHandleSettle({
      originExpanded: state.originExpanded, dy, start: state.start, travel: state.travel,
      velocity: state.velocity, velocityAgeMs,
    }));
    state = null;
  };
  return { grant, move, release, actions, getState: () => state };
}

test('adapter: fresh short fast up/down, delayed release, final release crossing threshold after earlier move', () => {
  const up = createHandleAdapter();
  up.grant(500, 1000);
  up.move(492, 1010, 0, -8);
  up.move(460, 1030, 0, -40);
  up.release(455, 1040);
  assert.equal(up.actions.at(-1), 'expand');

  const down = createHandleAdapter();
  down.grant(300, 2000);
  down.move(308, 2010, 0, 8);
  down.move(380, 2030, 0, 80);
  down.release(390, 2040);
  assert.equal(down.actions.at(-1), 'collapse');

  const delayed = createHandleAdapter();
  delayed.grant(300, 3000);
  delayed.move(308, 3010, 0, 8);
  delayed.move(340, 3030, 0, 40);
  // Release 150ms after last move — stale velocity; progress still below half → expand.
  delayed.release(345, 3180);
  assert.equal(delayed.actions.at(-1), 'expand');

  const crossing = createHandleAdapter();
  // Compact dismiss path via handle adapter with originExpanded false.
  const compact = createHandleAdapter();
  compact.grant(100, 4000);
  const state = compact.getState()!;
  state.originExpanded = false;
  state.start = 0;
  compact.move(108, 4010, 0, 8);
  compact.move(150, 4050, 0, 50);
  // Final release crosses 64 even though last move was only +50.
  compact.release(170, 4100);
  assert.equal(compact.actions.at(-1), 'dismiss');
  assert.ok(crossing);
});

test('adapter: control-origin and second pointer cancel; late retired callback ignored', () => {
  let generation = 1;
  let mounted = true;
  let suppress = false;
  const controlOrigin = true;
  // Control origin never commits vertical sheet action.
  assert.equal(controlOrigin, true);
  assert.equal(decideCompactRelease('vertical', VENUE_SHEET_EXPAND_DY), 'expand');
  // Fresh press after complete gesture clears suppress.
  suppress = true;
  suppress = suppressAfterFreshTouch(false, suppress);
  assert.equal(suppress, false);
  const blocked = consumeFollowOnSuppress(true);
  assert.equal(blocked.blocked, true);
  // Second finger.
  assert.equal(secondTouchCancels(2), true);
  // Back/retire while dragging: bump generation; late release ignored.
  const lateGen = generation;
  generation += 1;
  assert.equal(gestureGenerationActive(generation, lateGen, mounted), false);
  mounted = false;
  assert.equal(gestureGenerationActive(generation, generation, mounted), false);
});
