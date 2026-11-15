/** Accepted WEB2a tuning. Native coordinates are dp and sample timestamps are milliseconds. */
import type { PublicPlayer, PlayerFilters } from './players.ts';
import { playerFilterKey } from './players.ts';
export const fullscreenPlayerBrowse = (path: string): boolean => path === '/players/browse';
export const tutorialStorageKey = (actorId: string | null) => `gb-player-gallery-tutorial-v3:${actorId ?? 'guest'}`;
export function ordinaryBrowsePlayers(players: PublicPlayer[], ownId?: string | null): PublicPlayer[] {
  return players.filter(p => p.publicPlayerId !== ownId);
}
export function browseCatalogIdentity(filters: PlayerFilters, selected: string | null, players: PublicPlayer[]) {
  return { key: playerFilterKey(filters), index: Math.max(0, players.findIndex(p => p.publicPlayerId === selected)) };
}
export const browseBioText = (player: PublicPlayer) => (player.bio ?? '').replace(/\s+/g, ' ').trim();
/** Break at actual native line boundaries, retaining every character and allowing one tall line to scroll. */
export function measuredBioPages(text: string, lines: readonly {text:string;height:number}[], bodyHeight: number): string[] {
  if (!text || !lines.length || bodyHeight <= 0) return [text || 'О себе пока ничего не написано.'];
  const chunks: string[] = [];
  let start = 0, cursor = 0, height = 0;
  for (const line of lines) {
    const found = text.indexOf(line.text.trim(), cursor);
    const offset = found < 0 ? cursor : found;
    if (height > 0 && height + line.height > bodyHeight && offset > start) {
      chunks.push(text.slice(start, offset)); start = offset; height = 0;
    }
    height += line.height;
    cursor = Math.min(text.length, offset + line.text.trim().length);
  }
  chunks.push(text.slice(start));
  return chunks;
}
export function detailPages(player: PublicPlayer, measured?: readonly string[]): string[] {
  return ['Игровой профиль', ...(measured?.length ? measured : [browseBioText(player) || 'О себе пока ничего не написано.'])];
}
/* ——— OUR mobile gesture tuning (Astra deep study reference; not Tinder private constants) ——— */

/** Axis lock after this travel (px). */
export const PLAYER_BROWSE_AXIS_LOCK_PX = 8;
/** Horizontal/vertical dominance multiplier once travel exceeds the lock. */
export const PLAYER_BROWSE_AXIS_DOMINANCE = 1.3;
/** Recent velocity sample window (ms), including the release sample. */
export const PLAYER_BROWSE_VELOCITY_WINDOW_MS = 80;
/** Pause without motion → treat recent velocity as 0 (ms). */
export const PLAYER_BROWSE_VELOCITY_PAUSE_MS = 100;
/** Projection horizon for short-fast flick (ms). */
export const PLAYER_BROWSE_PROJECT_MS = 180;
/** Fast flick velocity along the locked axis (px/ms). */
export const PLAYER_BROWSE_FLICK_VELOCITY = 0.65;
/** Cap estimated velocity noise (px/ms). */
export const PLAYER_BROWSE_VELOCITY_CAP = 2.5;
/** Reverse travel that clears prior momentum (px). */
export const PLAYER_BROWSE_REVERSAL_TRAVEL_PX = 10;
/** Fresh opposite velocity that vetoes commit even past distance (px/ms). */
export const PLAYER_BROWSE_REVERSAL_VELOCITY = 0.2;
/** Bound card tilt while dragging (deg). */
export const PLAYER_BROWSE_MAX_ROTATION_DEG = 12;
/** Off-screen margin past rotated AABB (px). */
export const PLAYER_BROWSE_EXIT_MARGIN_PX = 24;
/** Exit duration bounds (ms). */
export const PLAYER_BROWSE_EXIT_MS_MIN = 140;
export const PLAYER_BROWSE_EXIT_MS_MAX = 300;
/** Fallback exit speed when release velocity is tiny (px/ms). */
export const PLAYER_BROWSE_EXIT_BASE_SPEED = 1.6;
/** Spring-back duration (ms). */
export const PLAYER_BROWSE_RETURN_MS = 220;
/** On release, horizontal must still dominate residual vertical by this factor. */
export const PLAYER_BROWSE_RELEASE_AXIS_RATIO = 1.2;

export type PlayerBrowseGestureAxis = "none" | "horizontal" | "vertical";
export type PlayerBrowseGestureResult =
  | "none"
  | "horizontal"
  | "vertical"
  | "skip"
  | "request"
  | "vertical-up"
  | "vertical-down";

export type PlayerBrowseVelocitySample = { t: number; x: number; y: number };

/** Slow-distance commit threshold D = clamp(72, 0.24W, 112). */
export function swipeThresholdPx(width: number): number {
  return Math.max(72, Math.min(112, width * 0.24));
}

/** Minimum travel for a projected flick F = clamp(18, 0.06W, 28). */
export function swipeMinTravelPx(width: number): number {
  return Math.max(18, Math.min(28, width * 0.06));
}

/** Grab-pivot rotation bounded to ±PLAYER_BROWSE_MAX_ROTATION_DEG. */
export function browseDragRotationDeg(dx: number, width: number, reducedMotion = false): number {
  if (reducedMotion || width <= 0) return 0;
  const raw = (PLAYER_BROWSE_MAX_ROTATION_DEG * dx) / width;
  return Math.max(-PLAYER_BROWSE_MAX_ROTATION_DEG, Math.min(PLAYER_BROWSE_MAX_ROTATION_DEG, raw));
}

/**
 * Recent-window velocity (px/ms) along an axis.
 * Includes the release sample; returns 0 when the last motion is older than the pause window.
 */
export function sampleBrowseVelocity(
  samples: readonly PlayerBrowseVelocitySample[],
  axis: PlayerBrowseGestureAxis,
  now = samples.length ? samples[samples.length - 1]!.t : 0,
): number {
  if (axis === "none" || samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  if (now - last.t > PLAYER_BROWSE_VELOCITY_PAUSE_MS) return 0;
  const windowStart = last.t - PLAYER_BROWSE_VELOCITY_WINDOW_MS;
  let earlier = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const candidate = samples[i]!;
    earlier = candidate;
    if (candidate.t <= windowStart) break;
  }
  const dt = last.t - earlier.t;
  if (dt <= 0) return 0;
  const raw = axis === "horizontal"
    ? (last.x - earlier.x) / dt
    : (last.y - earlier.y) / dt;
  return Math.max(-PLAYER_BROWSE_VELOCITY_CAP, Math.min(PLAYER_BROWSE_VELOCITY_CAP, raw));
}

function axisFromDelta(dx: number, dy: number, locked: PlayerBrowseGestureAxis): PlayerBrowseGestureAxis {
  if (locked === "horizontal" || locked === "vertical") return locked;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < PLAYER_BROWSE_AXIS_LOCK_PX && absY < PLAYER_BROWSE_AXIS_LOCK_PX) return "none";
  if (absX > absY * PLAYER_BROWSE_AXIS_DOMINANCE) return "horizontal";
  if (absY > absX * PLAYER_BROWSE_AXIS_DOMINANCE) return "vertical";
  return "none";
}

/**
 * Release commit: reverse veto first (even past D), then slow-distance OR projected flick.
 * Distance alone must not win before the reverse check (prior bug).
 */
export function releaseCommitted(input: {
  travel: number;
  extent: number;
  velocity?: number;
  /** True when fresh velocity opposes travel (after reversal travel). */
  reverseVeto?: boolean;
}): boolean {
  if (input.reverseVeto) return false;
  const travel = Math.abs(input.travel);
  const extent = Math.max(1, input.extent);
  const D = swipeThresholdPx(extent);
  const F = swipeMinTravelPx(extent);
  if (travel >= D) return true;
  const vx = input.velocity ?? 0;
  if (travel < F) return false;
  if (Math.abs(vx) < PLAYER_BROWSE_FLICK_VELOCITY) return false;
  // same-direction projected flick: p = travel_signed + vx*T must reach D
  const projected = travel + Math.abs(vx) * PLAYER_BROWSE_PROJECT_MS;
  return projected >= D;
}

/** True when opposite velocity after a reverse travel should veto commit. */
export function browseReleaseReverseVeto(
  travel: number,
  velocity: number | undefined,
): boolean {
  if (velocity == null) return false;
  if (Math.abs(travel) < PLAYER_BROWSE_REVERSAL_TRAVEL_PX) return false;
  // velocity opposes the net travel direction
  if (travel > 0 && velocity <= -PLAYER_BROWSE_REVERSAL_VELOCITY) return true;
  if (travel < 0 && velocity >= PLAYER_BROWSE_REVERSAL_VELOCITY) return true;
  return false;
}

/**
 * Mobile gesture contract (OUR tuning):
 * axis lock 8px + 1.3× dominance; release = reverse-veto then slow-D or projected flick;
 * vertical release reports up/down for details/cover/paging.
 */
export function classifyPointerGesture(input: {
  dx: number;
  dy: number;
  width: number;
  height?: number;
  phase: "move" | "release";
  lockedAxis?: PlayerBrowseGestureAxis;
  /** Axis velocity in px/ms (sign follows dx for horizontal, dy for vertical). */
  velocity?: number;
  reverseVeto?: boolean;
}): PlayerBrowseGestureResult {
  const locked = input.lockedAxis ?? "none";
  const axis = axisFromDelta(input.dx, input.dy, locked);
  if (input.phase === "move") {
    if (axis === "horizontal") return "horizontal";
    if (axis === "vertical") return "vertical";
    return "none";
  }
  if (axis === "horizontal") {
    if (Math.abs(input.dx) < PLAYER_BROWSE_RELEASE_AXIS_RATIO * Math.abs(input.dy)) return "none";
    const reverse = input.reverseVeto
      ?? browseReleaseReverseVeto(input.dx, input.velocity);
    if (!releaseCommitted({
      travel: input.dx,
      extent: input.width,
      velocity: input.velocity,
      reverseVeto: reverse,
    })) return "none";
    return input.dx < 0 ? "skip" : "request";
  }
  if (axis === "vertical") {
    const extent = input.height ?? input.width;
    if (Math.abs(input.dy) < PLAYER_BROWSE_RELEASE_AXIS_RATIO * Math.abs(input.dx)) return "none";
    const reverse = input.reverseVeto
      ?? browseReleaseReverseVeto(input.dy, input.velocity);
    if (!releaseCommitted({
      travel: input.dy,
      extent,
      velocity: input.velocity,
      reverseVeto: reverse,
    })) return "none";
    return input.dy < 0 ? "vertical-up" : "vertical-down";
  }
  return "none";
}

/**
 * Geometry-safe horizontal exit translation so rotated card corners clear the viewport.
 * Width+48 alone can leave corners visible at ~12° tilt.
 */
export function browseExitTranslationPx(input: {
  dir: -1 | 1;
  width: number;
  height: number;
  rotationDeg: number;
  currentX?: number;
  margin?: number;
}): number {
  const margin = input.margin ?? PLAYER_BROWSE_EXIT_MARGIN_PX;
  const rad = (Math.abs(input.rotationDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = input.width / 2;
  const halfH = input.height / 2;
  const aabbHalfW = Math.abs(halfW * cos) + Math.abs(halfH * sin);
  const clear = aabbHalfW + (input.width / 2) + margin;
  const from = input.currentX ?? 0;
  if (input.dir > 0) return Math.max(from, clear);
  return Math.min(from, -clear);
}

/** Exit duration from residual distance and release speed, clamped 140–300ms. */
export function browseExitDurationMs(distancePx: number, velocityPxPerMs: number): number {
  const speed = Math.max(Math.abs(velocityPxPerMs), PLAYER_BROWSE_EXIT_BASE_SPEED);
  const raw = Math.abs(distancePx) / speed;
  return Math.max(PLAYER_BROWSE_EXIT_MS_MIN, Math.min(PLAYER_BROWSE_EXIT_MS_MAX, raw));
}


/** One native touch episode. Recognizer vx/vy units are deliberately never used. */
export class BrowseGesture {
  axis: PlayerBrowseGestureAxis = 'none';
  samples: PlayerBrowseVelocitySample[] = [];
  dragged = false;
  cancelled = false;
  readonly peer: string; readonly episode: number;
  constructor(peer: string, episode: number, t: number) { this.peer=peer; this.episode=episode; this.samples = [{t,x:0,y:0}]; }
  move(x: number, y: number, t: number) {
    if (this.cancelled) return;
    const previous = this.samples[this.samples.length-1]!;
    if (t > previous.t && (previous.x !== x || previous.y !== y)) {
      this.samples.push({x,y,t});
      const cutoff=t-PLAYER_BROWSE_VELOCITY_WINDOW_MS-40;
      while(this.samples.length>2 && this.samples[0]!.t<cutoff)this.samples.shift();
      if (this.samples.length > 12) this.samples.shift();
    }
    const result = classifyPointerGesture({dx:x,dy:y,width:1,phase:'move',lockedAxis:this.axis});
    if (result === 'horizontal' || result === 'vertical') this.axis = result;
    if (Math.max(Math.abs(x),Math.abs(y)) >= PLAYER_BROWSE_AXIS_LOCK_PX) this.dragged = true;
  }
  release(x: number, y: number, t: number, width: number, height: number) {
    this.move(x,y,t);
    const velocity = sampleBrowseVelocity(this.samples,this.axis,t);
    return { result: this.cancelled ? 'none' as const : classifyPointerGesture({dx:x,dy:y,width,height,phase:'release',lockedAxis:this.axis,velocity}), velocity };
  }
  cancel() { this.cancelled = true; this.dragged = true; }
}
