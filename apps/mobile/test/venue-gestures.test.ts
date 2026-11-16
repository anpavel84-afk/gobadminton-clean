import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryItem } from '../src/venues.ts';
import {
  canonicalSheetOriginY,
  clampSheetLift,
  compactLiveGrowthHeight,
  consumeFollowOnSuppress,
  createCompactSheetHandlers,
  createGalleryGestureHandlers,
  createHandleSheetHandlers,
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
  createReturnFocusLifecycle,
  scheduleReturnFocus,
  secondTouchCancels,
  sheetReleaseDy,
  stepGallerySelection,
  suppressAfterFreshTouch,
  VENUE_GALLERY_AXIS_LOCK,
  VENUE_GALLERY_SWIPE,
  VENUE_HANDLE_VELOCITY,
  VENUE_HANDLE_VELOCITY_STALE_MS,
  VENUE_SHEET_AXIS_LOCK,
  VENUE_SHEET_DISMISS_DY,
  VENUE_SHEET_EXPAND_DY,
  type GalleryAxis,
  type ResponderGestureSnapshot,
  type ResponderTouchEvent,
  type SheetDrag,
  type SheetResponderPorts,
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
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: -40, start: 0, travel: 200,
    velocity: VENUE_HANDLE_VELOCITY, velocityAgeMs: eventClockAgeMs(1060, 1050),
  }), 'expand');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 40, start: 200, travel: 200,
    velocity: -VENUE_HANDLE_VELOCITY, velocityAgeMs: eventClockAgeMs(2060, 2050),
  }), 'collapse');
  assert.equal(decideHandleSettle({
    originExpanded: true, dy: 40, start: 200, travel: 200,
    velocity: -VENUE_HANDLE_VELOCITY,
    velocityAgeMs: eventClockAgeMs(2200, 2050),
  }), 'expand');
  assert.equal(decideHandleSettle({
    originExpanded: false, dy: VENUE_SHEET_DISMISS_DY, start: 0, travel: 200,
    velocity: 0, velocityAgeMs: eventClockAgeMs(1500, 1200),
  }), 'dismiss');
  const sampled = sampleHandleVelocity({ lastY: 400, time: 1000, velocity: 0 }, 360, 1040);
  assert.equal(sampled.velocity, (400 - 360) / 40);
  assert.equal(sampled.time, 1040);
  assert.equal(sampled.lastY, 360);
});

test('measured travel rejects +200/×2.5 guesses; expanded handle lift tracks before settle; compact live growth', () => {
  assert.equal(measuredSheetTravel(0, 500, 700), 0);
  assert.equal(measuredSheetTravel(172, 500, 700), 328);
  assert.equal(measuredSheetTravel(172, 0, 700), 528);
  assert.equal(measuredSheetTravel(172, 100, 100), 0);
  assert.equal(expandedHandleLift(true, 200, 200, 80), 80);
  assert.equal(expandedHandleLift(false, 0, 200, -80), 80);
  assert.equal(compactLiveGrowthHeight(172, 80, 700), 252);
  assert.equal(compactLiveGrowthHeight(172, 0, 700), 172);
  assert.equal(compactLiveGrowthHeight(172, 600, 400), 400);
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

/** Strongly typed production fixture ports — same handlers PanResponder.create receives. */
function createSheetFixture(options: {
  expanded?: boolean;
  controlOrigin?: boolean;
  travel?: number;
  generation?: number;
}) {
  let drag: SheetDrag | null = null;
  let lift = 0;
  const lifts: number[] = [];
  const actions: string[] = [];
  let suppress = false;
  let controlOrigin = options.controlOrigin ?? false;
  let generation = options.generation ?? 1;
  const travel = options.travel ?? 200;
  const ports: SheetResponderPorts = {
    isExpanded: () => options.expanded ?? false,
    isHandleActive: () => drag?.kind === 'handle',
    getControlOrigin: () => controlOrigin,
    getGeneration: () => generation,
    getTravel: () => travel,
    getLift: () => lift,
    getDrag: () => drag,
    setDrag: (next) => { drag = next; },
    beginFreshTouch: () => { suppress = suppressAfterFreshTouch(drag !== null, suppress); },
    retireGesture: (clearSuppress = true) => {
      drag = null;
      controlOrigin = false;
      if (clearSuppress) suppress = false;
      lift = 0;
    },
    applyLift: (value) => { lift = value; lifts.push(value); },
    settleLift: () => { lift = 0; },
    markSuppress: () => { suppress = true; },
    endCompact: (axis, dy, gen) => {
      if (!gestureGenerationActive(generation, gen, true)) { drag = null; lift = 0; return; }
      if (drag?.controlOrigin) { drag = null; lift = 0; return; }
      const action = decideCompactRelease(axis, dy);
      drag = null;
      lift = 0;
      if (action === 'none' || action === 'origin') { actions.push(action === 'origin' ? 'origin' : 'none'); return; }
      suppress = true;
      actions.push(action);
    },
    endHandle: (gen, dy, velocity, velocityAgeMs) => {
      const current = drag;
      if (!current || current.kind !== 'handle' || !gestureGenerationActive(generation, gen, true)) {
        drag = null; lift = 0; return;
      }
      if (current.controlOrigin || current.axis !== 'vertical' || current.travel <= 0) {
        drag = null; lift = 0; return;
      }
      const action = decideHandleSettle({
        originExpanded: current.originExpanded, dy, start: current.start, travel: current.travel,
        velocity, velocityAgeMs,
      });
      drag = null;
      suppress = true;
      lift = 0;
      actions.push(action);
    },
    activateHandle: () => { actions.push('activate'); },
  };
  const touch = (pageY: number, timestamp: number): ResponderTouchEvent => ({ nativeEvent: { pageY, timestamp } });
  const gesture = (dx: number, dy: number, touches = 1): ResponderGestureSnapshot => ({ dx, dy, numberActiveTouches: touches });
  return {
    ports, actions, lifts,
    getDrag: () => drag,
    getLift: () => lift,
    getSuppress: () => suppress,
    setControlOrigin: (value: boolean) => { controlOrigin = value; },
    bumpGeneration: () => { generation += 1; },
    touch, gesture,
    compact: createCompactSheetHandlers(ports),
    handle: createHandleSheetHandlers(ports),
  };
}

/**
 * Equivalent of frozen RN Pressable.js host merge: restProps then usePressability
 * eventHandlers — duplicate responder keys resolve to Pressability, not PanResponder.
 */
function composePressableHostView<T extends Record<string, unknown>>(
  restProps: T,
  pressabilityEventHandlers: Record<string, unknown>,
): T & Record<string, unknown> {
  return { ...restProps, ...pressabilityEventHandlers };
}

/** Map factory callbacks to host responder prop names the way PanResponder.panHandlers does. */
function handleFactoryAsPanHandlers(handlers: ReturnType<typeof createHandleSheetHandlers>) {
  return {
    onStartShouldSetResponder: handlers.onStartShouldSetPanResponder,
    onMoveShouldSetResponder: handlers.onMoveShouldSetPanResponder,
    onResponderGrant: handlers.onPanResponderGrant,
    onResponderStart: handlers.onPanResponderStart,
    onResponderMove: handlers.onPanResponderMove,
    onResponderRelease: handlers.onPanResponderRelease,
    onResponderTerminate: handlers.onPanResponderTerminate,
    onResponderTerminationRequest: handlers.onPanResponderTerminationRequest,
  };
}

test('production compact handlers: delayed grant origin, full -60 expand, first large move then release', () => {
  // Grant after 8dp recognition at dy=-10; full gesture is -60 from touch origin → expand.
  const delayed = createSheetFixture({});
  assert.equal(delayed.compact.onMoveShouldSetPanResponder(delayed.touch(490, 1000), delayed.gesture(0, -10)), true);
  delayed.compact.onPanResponderGrant(delayed.touch(490, 1010), delayed.gesture(0, -10));
  assert.equal(delayed.getDrag()?.startY, canonicalSheetOriginY(490, -10));
  delayed.compact.onPanResponderMove(delayed.touch(450, 1040), delayed.gesture(0, -50));
  delayed.compact.onPanResponderRelease(delayed.touch(440, 1050), delayed.gesture(0, -60));
  assert.equal(delayed.actions.at(-1), 'expand');
  assert.equal(sheetReleaseDy(440, canonicalSheetOriginY(490, -10)), -60);

  // First large move already past threshold, then release near that grant sample — must not lose full gesture.
  // Bug was: startY=grant pageY ⇒ release dy≈0; fixed origin keeps touch-down so dy≈-60.
  const firstLarge = createSheetFixture({});
  firstLarge.compact.onPanResponderGrant(firstLarge.touch(440, 2000), firstLarge.gesture(0, -60));
  assert.equal(firstLarge.getDrag()?.startY, 500);
  firstLarge.compact.onPanResponderMove(firstLarge.touch(440, 2010), firstLarge.gesture(0, -60));
  firstLarge.compact.onPanResponderRelease(firstLarge.touch(442, 2020), firstLarge.gesture(0, -58));
  assert.equal(firstLarge.actions.at(-1), 'expand');
  assert.ok(Math.abs(sheetReleaseDy(442, 500)) >= Math.abs(VENUE_SHEET_EXPAND_DY));
});

test('production handle handlers: fresh short flick, delayed release clock, final release crossing threshold', () => {
  const up = createSheetFixture({ expanded: true });
  up.handle.onPanResponderGrant(up.touch(500, 1000));
  up.handle.onPanResponderMove(up.touch(492, 1010), up.gesture(0, -8));
  up.handle.onPanResponderMove(up.touch(460, 1030), up.gesture(0, -40));
  up.handle.onPanResponderRelease(up.touch(455, 1040), up.gesture(0, -45));
  assert.equal(up.actions.at(-1), 'expand');

  const down = createSheetFixture({ expanded: true });
  down.handle.onPanResponderGrant(down.touch(300, 2000));
  down.handle.onPanResponderMove(down.touch(308, 2010), down.gesture(0, 8));
  down.handle.onPanResponderMove(down.touch(380, 2030), down.gesture(0, 80));
  down.handle.onPanResponderRelease(down.touch(390, 2040), down.gesture(0, 90));
  assert.equal(down.actions.at(-1), 'collapse');

  const delayed = createSheetFixture({ expanded: true });
  delayed.handle.onPanResponderGrant(delayed.touch(300, 3000));
  delayed.handle.onPanResponderMove(delayed.touch(308, 3010), delayed.gesture(0, 8));
  delayed.handle.onPanResponderMove(delayed.touch(340, 3030), delayed.gesture(0, 40));
  delayed.handle.onPanResponderRelease(delayed.touch(345, 3180), delayed.gesture(0, 45));
  assert.equal(delayed.actions.at(-1), 'expand');

  const compactDismiss = createSheetFixture({ expanded: false });
  compactDismiss.handle.onPanResponderGrant(compactDismiss.touch(100, 4000));
  compactDismiss.handle.onPanResponderMove(compactDismiss.touch(108, 4010), compactDismiss.gesture(0, 8));
  compactDismiss.handle.onPanResponderMove(compactDismiss.touch(150, 4050), compactDismiss.gesture(0, 50));
  compactDismiss.handle.onPanResponderRelease(compactDismiss.touch(170, 4100), compactDismiss.gesture(0, 70));
  assert.equal(compactDismiss.actions.at(-1), 'dismiss');
});

test('production additional-touch START: grant1→START2→lift(no MOVE)→release0/1 commits nothing; fresh grant recovers', () => {
  // Compact expand threshold via reconstructed release axis — START cancel must clear drag first.
  const compactUp = createSheetFixture({});
  compactUp.compact.onPanResponderGrant(compactUp.touch(500, 1000), compactUp.gesture(0, 0));
  assert.equal(compactUp.getDrag()?.kind, 'compact');
  // Initial single-finger START must leave the granted owner intact.
  compactUp.compact.onPanResponderStart(compactUp.touch(500, 1005), compactUp.gesture(0, 0, 1));
  assert.equal(compactUp.getDrag()?.kind, 'compact');
  compactUp.compact.onPanResponderStart(compactUp.touch(500, 1010), compactUp.gesture(0, 0, 2));
  assert.equal(compactUp.getDrag(), null);
  compactUp.compact.onPanResponderRelease(compactUp.touch(500 + VENUE_SHEET_EXPAND_DY, 1020), compactUp.gesture(0, VENUE_SHEET_EXPAND_DY, 0));
  compactUp.compact.onPanResponderRelease(compactUp.touch(500 + VENUE_SHEET_EXPAND_DY, 1030), compactUp.gesture(0, VENUE_SHEET_EXPAND_DY, 1));
  assert.equal(compactUp.actions.length, 0);

  const compactDown = createSheetFixture({});
  compactDown.compact.onPanResponderGrant(compactDown.touch(200, 2000), compactDown.gesture(0, 0));
  compactDown.compact.onPanResponderStart(compactDown.touch(200, 2010), compactDown.gesture(0, 0, 2));
  compactDown.compact.onPanResponderRelease(compactDown.touch(200 + VENUE_SHEET_DISMISS_DY, 2020), compactDown.gesture(0, VENUE_SHEET_DISMISS_DY, 0));
  compactDown.compact.onPanResponderRelease(compactDown.touch(200 + VENUE_SHEET_DISMISS_DY, 2030), compactDown.gesture(0, VENUE_SHEET_DISMISS_DY, 1));
  assert.equal(compactDown.actions.length, 0);

  compactUp.compact.onPanResponderGrant(compactUp.touch(500, 1100), compactUp.gesture(0, -10));
  compactUp.compact.onPanResponderMove(compactUp.touch(440, 1140), compactUp.gesture(0, -60));
  compactUp.compact.onPanResponderRelease(compactUp.touch(440, 1150), compactUp.gesture(0, -60));
  assert.equal(compactUp.actions.at(-1), 'expand');

  // Handle: lock vertical with first finger, then second START without further MOVE; release 0/1 must not settle.
  const handleDown = createSheetFixture({ expanded: true });
  handleDown.handle.onPanResponderGrant(handleDown.touch(300, 3000));
  handleDown.handle.onPanResponderMove(handleDown.touch(308, 3010), handleDown.gesture(0, 8));
  handleDown.handle.onPanResponderMove(handleDown.touch(380, 3030), handleDown.gesture(0, 80));
  assert.equal(handleDown.getDrag()?.axis, 'vertical');
  handleDown.handle.onPanResponderStart(handleDown.touch(380, 3040), handleDown.gesture(0, 80, 2));
  assert.equal(handleDown.getDrag(), null);
  handleDown.handle.onPanResponderRelease(handleDown.touch(390, 3050), handleDown.gesture(0, 90, 0));
  handleDown.handle.onPanResponderRelease(handleDown.touch(390, 3060), handleDown.gesture(0, 90, 1));
  assert.equal(handleDown.actions.length, 0);

  const handleUp = createSheetFixture({ expanded: true });
  handleUp.handle.onPanResponderGrant(handleUp.touch(500, 4000));
  handleUp.handle.onPanResponderMove(handleUp.touch(492, 4010), handleUp.gesture(0, -8));
  handleUp.handle.onPanResponderMove(handleUp.touch(440, 4030), handleUp.gesture(0, -60));
  handleUp.handle.onPanResponderStart(handleUp.touch(440, 4040), handleUp.gesture(0, -60, 2));
  handleUp.handle.onPanResponderRelease(handleUp.touch(430, 4050), handleUp.gesture(0, -70, 0));
  handleUp.handle.onPanResponderRelease(handleUp.touch(430, 4060), handleUp.gesture(0, -70, 1));
  assert.equal(handleUp.actions.length, 0);

  // Host panHandlers mapping forwards onResponderStart to the same production callback.
  const mapped = createSheetFixture({ expanded: false });
  const host = handleFactoryAsPanHandlers(mapped.handle);
  (host.onResponderGrant as (e: ResponderTouchEvent) => void)(mapped.touch(100, 4100));
  (host.onResponderMove as (e: ResponderTouchEvent, g: ResponderGestureSnapshot) => void)(
    mapped.touch(108, 4110), mapped.gesture(0, 8),
  );
  (host.onResponderStart as (e: ResponderTouchEvent, g: ResponderGestureSnapshot) => void)(
    mapped.touch(108, 4120), mapped.gesture(0, 8, 2),
  );
  assert.equal(mapped.getDrag(), null);
  (host.onResponderRelease as (e: ResponderTouchEvent, g: ResponderGestureSnapshot) => void)(
    mapped.touch(170, 4130), mapped.gesture(0, 70, 0),
  );
  assert.equal(mapped.actions.length, 0);

  handleDown.handle.onPanResponderGrant(handleDown.touch(300, 3100));
  handleDown.handle.onPanResponderMove(handleDown.touch(308, 3110), handleDown.gesture(0, 8));
  handleDown.handle.onPanResponderMove(handleDown.touch(380, 3130), handleDown.gesture(0, 80));
  handleDown.handle.onPanResponderRelease(handleDown.touch(390, 3140), handleDown.gesture(0, 90));
  assert.equal(handleDown.actions.at(-1), 'collapse');

  // Gallery: START2 sticky-retires; release 0/1 with dx threshold must not page; fresh grant recovers.
  let axis: GalleryAxis = 'pending';
  let generation = 1;
  let retired = false;
  const commits: string[] = [];
  const gallery = createGalleryGestureHandlers({
    canPage: () => true,
    isMounted: () => true,
    getGeneration: () => generation,
    bumpGeneration: () => { generation += 1; },
    isRetired: () => retired,
    setRetired: (value) => { retired = value; },
    getAxis: () => axis,
    setAxis: (next) => { axis = next; },
    onGrantFresh: () => {},
    onCommit: (action) => { commits.push(action); },
  });
  const gTouch = { nativeEvent: { pageY: 0, timestamp: 0 } };
  gallery.onPanResponderGrant();
  gallery.onPanResponderStart(gTouch, { dx: 0, dy: 0, numberActiveTouches: 2 });
  assert.equal(retired, true);
  const retiredGen = generation;
  gallery.onPanResponderRelease(gTouch, { dx: -VENUE_GALLERY_SWIPE, dy: 0, numberActiveTouches: 0 });
  gallery.onPanResponderRelease(gTouch, { dx: VENUE_GALLERY_SWIPE, dy: 0, numberActiveTouches: 1 });
  assert.equal(commits.length, 0);
  assert.equal(retired, true);
  assert.equal(generation, retiredGen);

  gallery.onPanResponderGrant();
  assert.equal(retired, false);
  gallery.onPanResponderMove(gTouch, { dx: -VENUE_GALLERY_SWIPE, dy: 0, numberActiveTouches: 1 });
  gallery.onPanResponderRelease(gTouch, { dx: -VENUE_GALLERY_SWIPE, dy: 0, numberActiveTouches: 1 });
  assert.equal(commits.at(-1), 'next');
});

test('production callbacks: cancelled control, gallery second finger including release0, retired unmount/Back, normal tap, focus ports', () => {
  // R4a: controlOrigin latched then cleared (press-out) — body swipe expands; control drag never does.
  const control = createSheetFixture({ controlOrigin: true });
  assert.equal(control.compact.onMoveShouldSetPanResponder(control.touch(400, 1000), control.gesture(0, -20)), false);
  control.setControlOrigin(false);
  assert.equal(control.compact.onMoveShouldSetPanResponder(control.touch(400, 1100), control.gesture(0, -20)), true);
  control.compact.onPanResponderGrant(control.touch(400, 1110), control.gesture(0, -20));
  control.compact.onPanResponderMove(control.touch(340, 1140), control.gesture(0, -60));
  control.compact.onPanResponderRelease(control.touch(340, 1150), control.gesture(0, -60));
  assert.equal(control.actions.at(-1), 'expand');

  const latched = createSheetFixture({ controlOrigin: true });
  latched.compact.onPanResponderGrant(latched.touch(400, 1200), latched.gesture(0, -20));
  assert.equal(latched.getDrag()?.controlOrigin, true);
  latched.compact.onPanResponderMove(latched.touch(340, 1230), latched.gesture(0, -60));
  latched.compact.onPanResponderRelease(latched.touch(340, 1240), latched.gesture(0, -60));
  assert.equal(latched.actions.length, 0);

  // R4b: gallery second finger retires; release with 0/1 touches and dx>=48 must not page; fresh grant recovers.
  let axis: GalleryAxis = 'pending';
  let generation = 1;
  let retired = false;
  const mounted = true;
  const commits: string[] = [];
  const gallery = createGalleryGestureHandlers({
    canPage: () => true,
    isMounted: () => mounted,
    getGeneration: () => generation,
    bumpGeneration: () => { generation += 1; },
    isRetired: () => retired,
    setRetired: (value) => { retired = value; },
    getAxis: () => axis,
    setAxis: (next) => { axis = next; },
    onGrantFresh: () => {},
    onCommit: (action) => { commits.push(action); },
  });
  const gTouch = { nativeEvent: { pageY: 0, timestamp: 0 } };
  gallery.onPanResponderGrant();
  gallery.onPanResponderMove(gTouch, { dx: -30, dy: 0, numberActiveTouches: 1 });
  assert.equal(axis, 'horizontal');
  gallery.onPanResponderMove(gTouch, { dx: -50, dy: 0, numberActiveTouches: 2 });
  assert.equal(retired, true);
  gallery.onPanResponderRelease(gTouch, { dx: -60, dy: 0, numberActiveTouches: 0 });
  assert.equal(commits.length, 0);
  gallery.onPanResponderGrant();
  gallery.onPanResponderMove(gTouch, { dx: -50, dy: 0, numberActiveTouches: 1 });
  gallery.onPanResponderRelease(gTouch, { dx: -50, dy: 0, numberActiveTouches: 1 });
  assert.equal(commits.at(-1), 'next');

  // Retired generation / unmount / Back ignores late compact release.
  const retiredSheet = createSheetFixture({ generation: 2 });
  retiredSheet.compact.onPanResponderGrant(retiredSheet.touch(500, 5000), retiredSheet.gesture(0, -10));
  const lateGen = retiredSheet.getDrag()!.generation;
  retiredSheet.bumpGeneration();
  retiredSheet.compact.onPanResponderRelease(retiredSheet.touch(440, 5060), retiredSheet.gesture(0, -60));
  assert.equal(gestureGenerationActive(3, lateGen, true), false);
  assert.equal(retiredSheet.actions.length, 0);

  // Normal handle tap on View host: pending axis release activates once (not settle invent).
  const tap = createSheetFixture({ expanded: false });
  tap.handle.onPanResponderGrant(tap.touch(200, 6000));
  tap.handle.onPanResponderRelease(tap.touch(200, 6010), tap.gesture(0, 0));
  assert.deepEqual(tap.actions, ['activate']);
});

test('handle rendered-host composition: Pressable merge overrides panHandlers; View host preserves gesture owner', () => {
  const broken = createSheetFixture({ expanded: false });
  const panHandlers = handleFactoryAsPanHandlers(broken.handle);
  let pressabilityGrant = 0;
  const pressabilityHandlers = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: () => { pressabilityGrant += 1; },
    onResponderMove: () => {},
    onResponderRelease: () => {},
    onResponderTerminate: () => {},
    onResponderTerminationRequest: () => true,
  };

  // Broken Pressable host: restProps then pressability — grant never reaches factory.
  const brokenHost = composePressableHostView(panHandlers, pressabilityHandlers);
  (brokenHost.onResponderGrant as (e: ResponderTouchEvent) => void)(broken.touch(100, 4000));
  assert.equal(pressabilityGrant, 1);
  assert.equal(broken.getDrag(), null);

  // Fixed View host owns panHandlers; Pressable child keeps separate onPress/a11y surface.
  const fixed = createSheetFixture({ expanded: false });
  const viewHost = handleFactoryAsPanHandlers(fixed.handle);
  const pressableChild = composePressableHostView(
    { onPress: () => { /* a11y activate */ } },
    pressabilityHandlers,
  );
  (viewHost.onResponderGrant as (e: ResponderTouchEvent) => void)(fixed.touch(100, 4000));
  assert.equal(fixed.getDrag()?.kind, 'handle');
  (viewHost.onResponderMove as (e: ResponderTouchEvent, g: ResponderGestureSnapshot) => void)(
    fixed.touch(150, 4050), fixed.gesture(0, 50),
  );
  (viewHost.onResponderRelease as (e: ResponderTouchEvent, g: ResponderGestureSnapshot) => void)(
    fixed.touch(170, 4100), fixed.gesture(0, 70),
  );
  assert.equal(fixed.actions.at(-1), 'dismiss');
  assert.equal(typeof pressableChild.onPress, 'function');
});

test('return-focus lifecycle: deferred dismiss survives unmount disposal; obsolete cancels; null host safe', () => {
  const life = createReturnFocusLifecycle();
  const calls: string[] = [];
  let queued: (() => void) | null = null;
  const deferred = (cb: () => void) => {
    queued = cb;
    return {
      cancel: () => {
        if (queued === cb) queued = null;
      },
    };
  };

  let host: { focus: () => void } | null = { focus: () => { calls.push('fallback'); } };
  life.armDismissRestore(() => { host?.focus(); }, deferred);
  // Production dismiss: onClose unmounts sheet → dispose must NOT cancel armed dismiss.
  life.disposeSheetUnmount();
  assert.equal(typeof queued, 'function');
  queued!();
  queued = null;
  assert.deepEqual(calls, ['fallback']);

  calls.length = 0;
  life.armDismissRestore(() => { calls.push('stale'); }, deferred);
  life.cancelObsolete();
  assert.equal(queued, null);
  // length check keeps calls: string[] (deepEqual([],) narrows to never[] and breaks later push)
  assert.equal(calls.length, 0);

  host = { focus: () => { calls.push('alive'); } };
  life.armDismissRestore(() => { host?.focus(); }, deferred);
  host = null;
  life.disposeSheetUnmount();
  queued!();
  queued = null;
  assert.deepEqual(calls, []);

  // scheduleReturnFocus primitive still available for direct inject.
  let sync = 0;
  const handle = scheduleReturnFocus(() => { sync += 1; }, (cb) => {
    cb();
    return { cancel: () => {} };
  });
  assert.equal(sync, 1);
  handle.cancel();
});
