import type { GalleryItem } from './venues.ts';

/** Accepted VenuePopup compact/handle axis lock (logical units / dp). */
export const VENUE_SHEET_AXIS_LOCK = 8;
/** Compact upward dy (finger up ⇒ negative) that commits expand. */
export const VENUE_SHEET_EXPAND_DY = -56;
/** Compact downward dy that dismisses/deselects. */
export const VENUE_SHEET_DISMISS_DY = 64;
/** Handle settle velocity threshold in logical units per ms (dp/ms). */
export const VENUE_HANDLE_VELOCITY = 0.5;
/** Ignore handle velocity samples older than this many ms. */
export const VENUE_HANDLE_VELOCITY_STALE_MS = 100;
/** Accepted VenueGallery axis lock (logical units / dp). */
export const VENUE_GALLERY_AXIS_LOCK = 10;
/** Horizontal gallery commit distance (logical units / dp). */
export const VENUE_GALLERY_SWIPE = 48;

export type SheetAxis = 'pending' | 'vertical' | 'horizontal';
export type GalleryAxis = 'pending' | 'horizontal' | 'vertical';
export type CompactSheetAction = 'expand' | 'dismiss' | 'origin' | 'none';
export type HandleSettleAction = 'expand' | 'collapse' | 'dismiss';
export type GallerySwipeAction = 'next' | 'previous' | 'none';
export type GallerySelection = { url: string; id: string };
export type SheetDragKind = 'compact' | 'handle';

/** Active sheet drag owned by one pointer; retired scopes ignore late releases. */
export type SheetDrag = {
  kind: SheetDragKind;
  axis: SheetAxis;
  startY: number;
  lastY: number;
  /** Native event timestamp clock shared by move and terminal release. */
  time: number;
  velocity: number;
  originExpanded: boolean;
  start: number;
  travel: number;
  generation: number;
  controlOrigin: boolean;
};

/** Pending until 8dp of movement; horizontal tie/dominance yields horizontal owner. */
export function decideSheetAxis(dx: number, dy: number): SheetAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < VENUE_SHEET_AXIS_LOCK) return 'pending';
  if (Math.abs(dx) >= Math.abs(dy)) return 'horizontal';
  return 'vertical';
}

/** Compact surface release: dy<=-56 expands, dy>=64 dismisses, else return origin. */
export function decideCompactRelease(axis: SheetAxis, dy: number): CompactSheetAction {
  if (axis !== 'vertical') return 'none';
  if (dy >= VENUE_SHEET_DISMISS_DY) return 'dismiss';
  if (dy <= VENUE_SHEET_EXPAND_DY) return 'expand';
  return 'origin';
}

/**
 * Expanded/compact handle settle using measured travel.
 * Velocity sign matches web VenuePopup: (lastY - y) / elapsed — upward motion is positive.
 * Stale velocity (>100ms) is ignored. Compact handle may dismiss on dy>=64 before settle.
 */
export function decideHandleSettle(input: {
  originExpanded: boolean;
  dy: number;
  start: number;
  travel: number;
  velocity: number;
  velocityAgeMs: number;
}): HandleSettleAction {
  if (!input.originExpanded && input.dy >= VENUE_SHEET_DISMISS_DY) return 'dismiss';
  const travel = Math.max(1, input.travel);
  const progress = Math.max(0, Math.min(travel, input.start - input.dy));
  const velocity = input.velocityAgeMs > VENUE_HANDLE_VELOCITY_STALE_MS ? 0 : input.velocity;
  const expand = Math.abs(velocity) >= VENUE_HANDLE_VELOCITY ? velocity > 0 : progress >= travel / 2;
  return expand ? 'expand' : 'collapse';
}

/** Gallery axis lock 10dp; abs(dy)>=abs(dx) yields vertical owner (parent sheet/scroll). */
export function decideGalleryAxis(dx: number, dy: number): GalleryAxis {
  if (Math.abs(dx) < VENUE_GALLERY_AXIS_LOCK && Math.abs(dy) < VENUE_GALLERY_AXIS_LOCK) return 'pending';
  if (Math.abs(dy) >= Math.abs(dx)) return 'vertical';
  return 'horizontal';
}

/** Left (dx<0) → next; right → previous; commit at abs(dx)>=48. */
export function decideGallerySwipe(axis: GalleryAxis, dx: number): GallerySwipeAction {
  if (axis !== 'horizontal' || Math.abs(dx) < VENUE_GALLERY_SWIPE) return 'none';
  return dx < 0 ? 'next' : 'previous';
}

/** Authoritative main/first when prior identity is missing; never invent paging for empty gallery. */
export function resolveGallerySelection(
  gallery: readonly GalleryItem[],
  mainImage: string | null,
  previous: GallerySelection | null,
): GalleryItem | null {
  if (!gallery.length) return null;
  if (previous) {
    const byUrl = gallery.find(item => item.url === previous.url);
    if (byUrl) return byUrl;
    const byId = gallery.find(item => item.id === previous.id);
    if (byId) return byId;
  }
  return gallery.find(item => item.url === mainImage) ?? gallery[0] ?? null;
}

export function gallerySelectionOf(item: GalleryItem | null): GallerySelection | null {
  return item ? { url: item.url, id: item.id } : null;
}

/** Modulo wrap; zero/one image leaves selection unchanged. */
export function stepGallerySelection(
  gallery: readonly GalleryItem[],
  current: GalleryItem | null,
  delta: 1 | -1,
): GalleryItem | null {
  if (!gallery.length) return null;
  if (gallery.length === 1) return gallery[0] ?? null;
  if (!current) return gallery[0] ?? null;
  const index = gallery.findIndex(item => item.url === current.url || item.id === current.id);
  const from = index >= 0 ? index : 0;
  return gallery[(from + delta + gallery.length) % gallery.length] ?? null;
}

/** Live compact lift clamped to measured travel (logical units). */
export function clampSheetLift(dy: number, travel: number): number {
  return Math.max(0, Math.min(Math.max(1, travel), -dy));
}

/** Age between two native-event timestamps; never mixes wall clock. */
export function eventClockAgeMs(laterTs: number, earlierTs: number): number {
  return Math.max(0, laterTs - earlierTs);
}

/**
 * Travel from measured compact/expanded heights, else available expanded bound.
 * Never invents +200 / ×2.5 phone guesses.
 */
export function measuredSheetTravel(compact: number, expanded: number, availableExpanded: number): number {
  if (!(compact > 0)) return 0;
  if (expanded > compact) return expanded - compact;
  if (availableExpanded > compact) return availableExpanded - compact;
  return 0;
}

/** Second finger cancels/ignores the active one-owner sheet/gallery gesture. */
export function secondTouchCancels(numberActiveTouches: number): boolean {
  return numberActiveTouches > 1;
}

/**
 * Follow-on suppress belongs only to the originating gesture activation.
 * A fresh touch with no active drag clears stale suppress so the next control works once.
 */
export function suppressAfterFreshTouch(activeDrag: boolean, suppress: boolean): boolean {
  if (activeDrag) return suppress;
  return false;
}

/** Consume one follow-on activation; returns whether the press must be discarded. */
export function consumeFollowOnSuppress(suppress: boolean): { suppress: boolean; blocked: boolean } {
  if (!suppress) return { suppress: false, blocked: false };
  return { suppress: false, blocked: true };
}

/** Late callbacks from a retired generation/scope must not mutate the newer owner. */
export function gestureGenerationActive(current: number, expected: number, mounted: boolean): boolean {
  return mounted && current === expected;
}

/** Selected media identity owns load/error/retry; late failures for prior media are ignored. */
export function mediaFailureApplies(activeIdentity: string, eventIdentity: string): boolean {
  return activeIdentity.length > 0 && activeIdentity === eventIdentity;
}

export function galleryMediaIdentity(item: GallerySelection | GalleryItem | null | undefined): string {
  if (!item) return '';
  return item.url || item.id || '';
}

/** Handle lift while expanded: downward drag distance shown before settle. */
export function expandedHandleLift(originExpanded: boolean, start: number, travel: number, dy: number): number {
  const position = Math.max(0, Math.min(travel, start - dy));
  return originExpanded ? Math.max(0, travel - position) : position;
}

/** Sample velocity on the shared event clock; preserve last sample when elapsed is 0. */
export function sampleHandleVelocity(
  previous: { lastY: number; time: number; velocity: number },
  pageY: number,
  timestamp: number,
): { lastY: number; time: number; velocity: number } {
  const elapsed = eventClockAgeMs(timestamp, previous.time);
  const velocity = elapsed > 0 ? (previous.lastY - pageY) / elapsed : previous.velocity;
  return { lastY: pageY, time: timestamp, velocity };
}

/**
 * Recover the original touch-down Y when PanResponder grant is delayed past axis lock.
 * `pageY - gesture.dy` is the canonical origin even if grant fires after 8dp recognition.
 */
export function canonicalSheetOriginY(pageY: number, gestureDy: number): number {
  return pageY - gestureDy;
}

/** Terminal release displacement from canonical origin (includes final release coordinate). */
export function sheetReleaseDy(releasePageY: number, originY: number): number {
  return releasePageY - originY;
}

/** Compact live growth height: settled compact + upward lift, capped by available expanded bound. */
export function compactLiveGrowthHeight(compactHeight: number, lift: number, availableExpanded: number): number {
  if (!(compactHeight > 0) || !(lift > 0)) return compactHeight > 0 ? compactHeight : 0;
  const cap = availableExpanded > compactHeight ? availableExpanded : compactHeight + lift;
  return Math.min(cap, compactHeight + lift);
}

/** Minimal event/gesture shapes shared by production PanResponder wiring and owning tests. */
export type ResponderTouchEvent = { nativeEvent: { pageY: number; timestamp: number } };
export type ResponderGestureSnapshot = { dx: number; dy: number; numberActiveTouches: number };

export type SheetResponderPorts = {
  isExpanded: () => boolean;
  isHandleActive: () => boolean;
  getControlOrigin: () => boolean;
  getGeneration: () => number;
  getTravel: () => number;
  getLift: () => number;
  getDrag: () => SheetDrag | null;
  setDrag: (next: SheetDrag | null) => void;
  beginFreshTouch: () => void;
  retireGesture: (clearSuppress?: boolean) => void;
  applyLift: (value: number) => void;
  settleLift: () => void;
  markSuppress: () => void;
  endCompact: (axis: SheetAxis, dy: number, gen: number) => void;
  endHandle: (gen: number, dy: number, velocity: number, velocityAgeMs: number) => void;
  /** Ordinary handle activate when grant/release never locked vertical (View host; Pressable is a11y child). */
  activateHandle?: () => void;
};

/**
 * Production compact-surface responder callbacks — used directly by PanResponder.create
 * and by owning tests with injected ports (no copied harness).
 */
export function createCompactSheetHandlers(ports: SheetResponderPorts) {
  return {
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      if (ports.isExpanded() || ports.isHandleActive() || ports.getControlOrigin()) return false;
      if (secondTouchCancels(gesture.numberActiveTouches)) return false;
      return decideSheetAxis(gesture.dx, gesture.dy) === 'vertical';
    },
    onPanResponderGrant: (event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      ports.beginFreshTouch();
      const travel = ports.getTravel();
      const originY = canonicalSheetOriginY(event.nativeEvent.pageY, gesture.dy);
      ports.setDrag({
        kind: 'compact', axis: 'pending', startY: originY, lastY: event.nativeEvent.pageY,
        time: event.nativeEvent.timestamp, velocity: 0, originExpanded: false, start: 0, travel,
        generation: ports.getGeneration(), controlOrigin: ports.getControlOrigin(),
      });
    },
    onPanResponderMove: (event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      const current = ports.getDrag();
      if (!current || current.kind !== 'compact' || current.generation !== ports.getGeneration()) return;
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.retireGesture(true);
        ports.settleLift();
        return;
      }
      if (current.controlOrigin) return;
      if (current.axis === 'pending') {
        const axis = decideSheetAxis(gesture.dx, gesture.dy);
        if (axis === 'pending') return;
        if (axis === 'horizontal') { ports.setDrag(null); ports.settleLift(); return; }
        current.axis = 'vertical';
        ports.markSuppress();
      }
      const sampled = sampleHandleVelocity(current, event.nativeEvent.pageY, event.nativeEvent.timestamp);
      current.lastY = sampled.lastY; current.time = sampled.time; current.velocity = sampled.velocity;
      if (current.travel > 0) ports.applyLift(clampSheetLift(gesture.dy, current.travel));
    },
    onPanResponderRelease: (event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      const current = ports.getDrag();
      if (!current || current.kind !== 'compact') { ports.settleLift(); return; }
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.retireGesture(true); ports.settleLift(); return;
      }
      const axis = current.axis === 'pending' ? decideSheetAxis(gesture.dx, gesture.dy) : current.axis;
      const dy = sheetReleaseDy(event.nativeEvent.pageY, current.startY);
      ports.endCompact(axis, dy, current.generation);
    },
    onPanResponderTerminate: () => { ports.retireGesture(true); ports.settleLift(); },
    onPanResponderTerminationRequest: () => true,
  };
}

/** Production handle responder callbacks shared by PanResponder.create and owning tests. */
export function createHandleSheetHandlers(ports: SheetResponderPorts) {
  return {
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: ResponderTouchEvent) => {
      ports.beginFreshTouch();
      const originExpanded = ports.isExpanded();
      const travel = ports.getTravel();
      const lift = ports.getLift();
      const start = originExpanded ? travel : (lift > 0 ? Math.min(travel, lift) : 0);
      ports.setDrag({
        kind: 'handle', axis: 'pending', startY: event.nativeEvent.pageY, lastY: event.nativeEvent.pageY,
        time: event.nativeEvent.timestamp, velocity: 0, originExpanded, start, travel,
        generation: ports.getGeneration(), controlOrigin: false,
      });
    },
    onPanResponderMove: (event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      const current = ports.getDrag();
      if (!current || current.kind !== 'handle' || current.generation !== ports.getGeneration()) return;
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.retireGesture(true); ports.settleLift(); return;
      }
      if (current.axis === 'pending') {
        const axis = decideSheetAxis(gesture.dx, gesture.dy);
        if (axis === 'pending') return;
        if (axis === 'horizontal') { ports.setDrag(null); ports.settleLift(); ports.markSuppress(); return; }
        current.axis = 'vertical';
        ports.markSuppress();
      }
      if (current.travel <= 0) return;
      const sampled = sampleHandleVelocity(current, event.nativeEvent.pageY, event.nativeEvent.timestamp);
      current.lastY = sampled.lastY; current.time = sampled.time; current.velocity = sampled.velocity;
      const dy = event.nativeEvent.pageY - current.startY;
      ports.applyLift(expandedHandleLift(current.originExpanded, current.start, current.travel, dy));
    },
    onPanResponderRelease: (event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      const current = ports.getDrag();
      if (!current || current.kind !== 'handle') { ports.settleLift(); return; }
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.retireGesture(true); ports.settleLift(); return;
      }
      const releaseY = event.nativeEvent.pageY;
      const releaseTime = event.nativeEvent.timestamp;
      const dy = sheetReleaseDy(releaseY, current.startY);
      const velocityAgeMs = eventClockAgeMs(releaseTime, current.time);
      // Pending axis + under lock: ordinary tap on the View host (Pressable child is a11y-only).
      if (current.axis === 'pending' && Math.abs(dy) < VENUE_SHEET_AXIS_LOCK) {
        ports.setDrag(null);
        ports.settleLift();
        ports.activateHandle?.();
        return;
      }
      ports.endHandle(current.generation, dy, current.velocity, velocityAgeMs);
    },
    onPanResponderTerminate: () => { ports.retireGesture(true); ports.settleLift(); },
    onPanResponderTerminationRequest: () => false,
  };
}

export type GalleryResponderPorts = {
  canPage: () => boolean;
  isMounted: () => boolean;
  getGeneration: () => number;
  bumpGeneration: () => void;
  isRetired: () => boolean;
  setRetired: (retired: boolean) => void;
  getAxis: () => GalleryAxis;
  setAxis: (axis: GalleryAxis) => void;
  onGrantFresh: () => void;
  onCommit: (action: Exclude<GallerySwipeAction, 'none'>) => void;
};

/**
 * Production gallery/image swipe callbacks. Second finger irrevocably retires the
 * current gesture until a genuine new grant; late releases check generation/mount.
 */
export function createGalleryGestureHandlers(ports: GalleryResponderPorts) {
  return {
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      if (!ports.canPage()) return false;
      // Do not gate on retired here — a genuine new pointer that wins must reach grant to clear retirement.
      if (secondTouchCancels(gesture.numberActiveTouches)) return false;
      const next = decideGalleryAxis(gesture.dx, gesture.dy);
      ports.setAxis(next);
      return next === 'horizontal';
    },
    onPanResponderGrant: () => {
      ports.onGrantFresh();
      ports.setRetired(false);
      ports.setAxis('pending');
    },
    onPanResponderMove: (_event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      if (ports.isRetired()) return;
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.setRetired(true);
        ports.setAxis('pending');
        ports.bumpGeneration();
        return;
      }
      if (ports.getAxis() === 'pending') ports.setAxis(decideGalleryAxis(gesture.dx, gesture.dy));
    },
    onPanResponderRelease: (_event: ResponderTouchEvent, gesture: ResponderGestureSnapshot) => {
      const gen = ports.getGeneration();
      if (!ports.isMounted() || ports.getGeneration() !== gen) {
        ports.setAxis('pending');
        return;
      }
      if (ports.isRetired()) {
        ports.setAxis('pending');
        return;
      }
      if (secondTouchCancels(gesture.numberActiveTouches)) {
        ports.setRetired(true);
        ports.setAxis('pending');
        ports.bumpGeneration();
        return;
      }
      const locked = ports.getAxis() === 'pending' ? decideGalleryAxis(gesture.dx, gesture.dy) : ports.getAxis();
      ports.setAxis('pending');
      const action = decideGallerySwipe(locked, gesture.dx);
      if (action === 'none') return;
      if (!ports.isMounted() || ports.getGeneration() !== gen || ports.isRetired()) return;
      ports.onCommit(action);
    },
    onPanResponderTerminate: () => {
      ports.setRetired(true);
      ports.setAxis('pending');
      ports.bumpGeneration();
    },
    onPanResponderTerminationRequest: () => true,
  };
}

export type FocusSchedulePort = (cb: () => void) => { cancel: () => void };

const defaultFocusSchedule: FocusSchedulePort = (cb) => {
  const id = setTimeout(cb, 0);
  return { cancel: () => clearTimeout(id) };
};

/** Unmount-safe opener/fallback focus restoration scheduling (RN focus semantics). */
export function scheduleReturnFocus(
  restore: () => void,
  schedule: FocusSchedulePort = defaultFocusSchedule,
): { cancel: () => void } {
  return schedule(restore);
}

/**
 * Production dismiss/opener focus lifecycle shared with owning tests.
 * Intentional dismiss restore survives sheet unmount disposal; obsolete nav/scope cancels.
 */
export function createReturnFocusLifecycle() {
  let pending: { cancel: () => void; kind: 'dismiss' | 'transient' } | null = null;
  return {
    /** Final compact dismiss: one deferred restore that must outlive sheet unmount cleanup. */
    armDismissRestore(restore: () => void, schedule: FocusSchedulePort = defaultFocusSchedule) {
      pending?.cancel();
      const handle = schedule(() => {
        pending = null;
        restore();
      });
      pending = { cancel: handle.cancel, kind: 'dismiss' };
    },
    /** Cancel pending restore (genuine obsolete navigation / destroyed scope). */
    cancelObsolete() {
      pending?.cancel();
      pending = null;
    },
    /**
     * Sheet unmount disposal: keep intentional dismiss armed; cancel transient work only.
     * Does not invent a restore when dismiss was never armed.
     */
    disposeSheetUnmount() {
      if (!pending) return;
      if (pending.kind === 'dismiss') return;
      pending.cancel();
      pending = null;
    },
  };
}
