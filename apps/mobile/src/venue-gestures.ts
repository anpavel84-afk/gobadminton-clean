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
