import type { FriendshipView, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import type { PublicPlayer } from "./consumer-types";

export type PlayerBrowseView = "list" | "cards";
export type PlayerBrowseSlideDirection = "next" | "prev";

/** Desktop directory / deck composition (Owner v5). Mobile keeps existing <1024 layout. */
export const PLAYER_BROWSE_DESKTOP_MQ = "(min-width: 1024px)";
/** Visible horizontal player change on desktop; reduced-motion uses 0. */
export const PLAYER_BROWSE_SLIDE_MS = 240;

/** Legacy sessionStorage global marker (v2). Kept for history; not sufficient for per-user guide. Do not wipe. */
export const PLAYER_BROWSE_TUTORIAL_KEY = "gb-player-gallery-tutorial-v2";
/** Per-actor localStorage completion prefix (v3). Value `"1"` only after real finish. */
export const PLAYER_BROWSE_TUTORIAL_V3_PREFIX = "gb-player-gallery-tutorial-v3";
export const PLAYER_BROWSE_HISTORY_KEY = "gbPlayerBrowse";

export type PlayerBrowseTutorialStep = 1 | 2;

export function browseSlideDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : PLAYER_BROWSE_SLIDE_MS;
}

export function browseSlideDirection(fromIndex: number, toIndex: number): PlayerBrowseSlideDirection | null {
  if (toIndex === fromIndex) return null;
  return toIndex > fromIndex ? "next" : "prev";
}

export function prefersBrowseReducedMotion(
  media: Pick<MediaQueryList, "matches"> | null | undefined,
): boolean {
  return Boolean(media?.matches);
}

export type PlayerBrowseHistoryState = {
  id: string;
  scope: string;
};

/** SSR and first client paint stay on list; URL `view=cards` applies after mount. */
export function parseBrowseView(search: string | URLSearchParams | null | undefined): PlayerBrowseView {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search ?? new URLSearchParams();
  return params.get("view") === "cards" ? "cards" : "list";
}

export function writeBrowseViewSearch(search: string, view: PlayerBrowseView): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (view === "cards") params.set("view", "cards");
  else params.delete("view");
  const value = params.toString();
  return value ? `?${value}` : "";
}

/** Authenticated actors key by `me.id`; guests share a separate bucket. Never a cross-user global suppress. */
export function tutorialActorKey(meId: string | null | undefined): string {
  const id = typeof meId === "string" ? meId.trim() : "";
  return id || "guest";
}

export function playerBrowseTutorialStorageKey(actorKey: string): string {
  return `${PLAYER_BROWSE_TUTORIAL_V3_PREFIX}:${actorKey}`;
}

/** Prefer localStorage for durable same-browser completion; null when blocked/unavailable. */
export function browseTutorialLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readTutorialCompleted(
  storage: Pick<Storage, "getItem"> | null | undefined,
  actorKey: string,
  memory: boolean,
): boolean {
  if (memory) return true;
  try {
    return storage?.getItem(playerBrowseTutorialStorageKey(actorKey)) === "1";
  } catch {
    return memory;
  }
}

/** Persist only after the learner finishes step 2 — not on first open or X abort. */
export function persistTutorialCompleted(
  storage: Pick<Storage, "setItem"> | null | undefined,
  actorKey: string,
): boolean {
  try {
    storage?.setItem(playerBrowseTutorialStorageKey(actorKey), "1");
    return true;
  } catch {
    return false;
  }
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

export type BrowseCssTransformPose = { x: number; y: number; rotDeg: number };

/**
 * Parse translate + rotation from a computed CSS transform (matrix / matrix3d / none).
 * Used to preserve spring base pose on re-grab so the first move applies delta relative to it.
 */
export function parseBrowseCssTransformPose(transform: string): BrowseCssTransformPose {
  if (!transform || transform === "none") return { x: 0, y: 0, rotDeg: 0 };
  const matrix3d = /^matrix3d\((.+)\)$/i.exec(transform.trim());
  if (matrix3d) {
    const parts = matrix3d[1]!.split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 16 && parts.every(Number.isFinite)) {
      return {
        x: parts[12]!,
        y: parts[13]!,
        rotDeg: Math.atan2(parts[1]!, parts[0]!) * (180 / Math.PI),
      };
    }
  }
  const matrix = /^matrix\((.+)\)$/i.exec(transform.trim());
  if (matrix) {
    const parts = matrix[1]!.split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 6 && parts.every(Number.isFinite)) {
      return {
        x: parts[4]!,
        y: parts[5]!,
        rotDeg: Math.atan2(parts[1]!, parts[0]!) * (180 / Math.PI),
      };
    }
  }
  return { x: 0, y: 0, rotDeg: 0 };
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

export function isBrowseDragExcludedTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest("button,a,input,select,textarea,summary,label,[data-browse-no-drag]"));
}

/** Ordinary catalog only — never Radar private rows. */
export function ordinaryBrowsePlayers(players: PublicPlayer[], ownPublicPlayerId?: string | null): PublicPlayer[] {
  const own = ownPublicPlayerId?.trim() || "";
  return players.filter(player => !own || player.publicPlayerId !== own);
}

export function indexOfBrowsePlayer(players: PublicPlayer[], id: string | null | undefined): number {
  if (!id) return -1;
  return players.findIndex(player => player.publicPlayerId === id);
}

export function readBrowseHistoryState(state: unknown, scope: string): PlayerBrowseHistoryState | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>)[PLAYER_BROWSE_HISTORY_KEY];
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as Record<string, unknown>).id;
  const savedScope = (raw as Record<string, unknown>).scope;
  if (typeof id !== "string" || typeof savedScope !== "string" || savedScope !== scope || !id) return null;
  return { id, scope: savedScope };
}

export function withBrowseHistoryState(state: unknown, value: PlayerBrowseHistoryState | null): object {
  const base = state && typeof state === "object" ? { ...(state as object) } as Record<string, unknown> : {};
  if (value) base[PLAYER_BROWSE_HISTORY_KEY] = value;
  else delete base[PLAYER_BROWSE_HISTORY_KEY];
  return base;
}

export function relationshipBlocksNewRequest(relationship: FriendshipView["relationship"] | undefined): boolean {
  return relationship === "outgoing_pending" || relationship === "incoming_pending"
    || relationship === "friends" || relationship === "unavailable";
}

/** Play-interest browse eligibility — never casts into friendship enums. */
export function playInterestBlocksNewSend(
  relationship: PlayInterestView["relationship"] | undefined,
): boolean {
  return relationship === "outgoing" || relationship === "mutual" || relationship === "unavailable";
}

/** Auto-advance after confirmed play interest: next peer still open for a new send. */
export function nextEligibleBrowseIndex(
  players: PublicPlayer[],
  fromIndex: number,
  known: ReadonlyMap<string, PlayInterestView["relationship"] | FriendshipView["relationship"]>,
  skipped: ReadonlySet<string>,
): number {
  if (players.length <= 1) return -1;
  for (let offset = 1; offset < players.length; offset += 1) {
    const index = (fromIndex + offset) % players.length;
    if (index === fromIndex) continue;
    const player = players[index];
    if (!player || skipped.has(player.publicPlayerId)) continue;
    const relationship = known.get(player.publicPlayerId);
    if (relationship == null) return index;
    if (
      relationship === "outgoing"
      || relationship === "mutual"
      || relationship === "unavailable"
      || relationshipBlocksNewRequest(relationship as FriendshipView["relationship"])
    ) continue;
    return index;
  }
  return -1;
}

export function canOfferFriendship(view: FriendshipView | null | undefined): boolean {
  if (!view?.capabilities.canRequest) return false;
  const relationship = view.relationship;
  // Honor coherent canRequest; never treat live accepted/pending as a fresh offer.
  if (relationship === "friends" || relationship === "outgoing_pending" || relationship === "incoming_pending") {
    return false;
  }
  return relationship === "none" || relationship === "unavailable";
}

export function canOfferPlayInterest(view: PlayInterestView | null | undefined): boolean {
  return Boolean(view?.capabilities.canSend && view.relationship === "none");
}

export type BrowseSkipStack = string[];

export function pushSkip(stack: BrowseSkipStack, id: string): BrowseSkipStack {
  if (!id || stack[stack.length - 1] === id) return stack;
  return [...stack, id];
}

export function popSkip(stack: BrowseSkipStack): { stack: BrowseSkipStack; id: string | null } {
  if (!stack.length) return { stack, id: null };
  const next = stack.slice(0, -1);
  return { stack: next, id: stack[stack.length - 1] ?? null };
}

/** Normalize bio whitespace before details pagination. */
export function normalizeBrowseBio(bio: string | null | undefined): string {
  return (bio ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Split a details bio into complete, non-overlapping word-boundary chunks
 * for the fixed-size desktop banner pager (no clipped/repeated same page).
 */
export function chunkBrowseBio(bio: string, maxChars: number): string[] {
  const text = normalizeBrowseBio(bio);
  if (!text) return [];
  if (maxChars <= 0 || text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= maxChars) {
      chunks.push(text.slice(start));
      break;
    }
    const hardEnd = start + maxChars;
    let breakAt = text.lastIndexOf(" ", hardEnd);
    if (breakAt <= start) breakAt = hardEnd;
    const piece = text.slice(start, breakAt).trimEnd();
    if (!piece) {
      chunks.push(text.slice(start, hardEnd));
      start = hardEnd;
      continue;
    }
    chunks.push(piece);
    start = breakAt;
    while (text[start] === " ") start += 1;
  }
  return chunks;
}

/** Reconstruct normalized bio from pager chunks (space-joined). */
export function reconstructBrowseBio(chunks: readonly string[]): string {
  return normalizeBrowseBio(chunks.join(" "));
}

/** Estimate first-chunk capacity from a full-bio overflow measure. */
export function estimateBrowseBioChunkChars(
  bioLength: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (bioLength <= 0) return 0;
  if (scrollHeight <= clientHeight + 2) return bioLength;
  const ratio = clientHeight / Math.max(scrollHeight, 1);
  return Math.max(24, Math.floor(bioLength * ratio * 0.9));
}
