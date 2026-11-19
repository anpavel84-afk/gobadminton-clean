/** NTRP v1 half-steps 1.0…7.0 — pure math for the create-game dual-thumb range. */
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 7;
export const LEVEL_STEP = 0.5;
export const LEVELS: readonly number[] = Object.freeze(
  Array.from({ length: 13 }, (_, i) => LEVEL_MIN + i * LEVEL_STEP),
);

const STEP_INV = 1 / LEVEL_STEP;

export type LevelBound = 'lower' | 'upper';

export function snapLevel(raw: number): number {
  if (!Number.isFinite(raw)) return LEVEL_MIN;
  const snapped = Math.round(raw * STEP_INV) / STEP_INV;
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, snapped));
}

/** Visual % on the shared global track (independent of the other thumb). */
export function levelVisualPercent(value: number): number {
  const snapped = snapLevel(value);
  return ((snapped - LEVEL_MIN) / (LEVEL_MAX - LEVEL_MIN)) * 100;
}

/** Selected-interval fill as left/width percentages of the 1…7 track. */
export function levelSelectedFill(lower: number, upper: number): { left: number; width: number } {
  const lo = levelVisualPercent(lower);
  const hi = levelVisualPercent(upper);
  const left = Math.min(lo, hi);
  return { left, width: Math.max(0, Math.abs(hi - lo)) };
}

/** Map an X position on a measured track to a snapped NTRP value. */
export function levelFromTrackX(x: number, trackWidth: number): number {
  if (!(trackWidth > 0) || !Number.isFinite(x)) return LEVEL_MIN;
  const ratio = Math.min(1, Math.max(0, x / trackWidth));
  return snapLevel(LEVEL_MIN + ratio * (LEVEL_MAX - LEVEL_MIN));
}

/**
 * Apply a raw value to one bound; crossing clamps to the other endpoint
 * (mirrors web applyNtrpLevelBoundChange).
 */
export function applyLevelBoundChange(
  bound: LevelBound,
  raw: number,
  currentLower: number,
  currentUpper: number,
): { lower: number; upper: number } {
  const snapped = snapLevel(raw);
  const stableLower = snapLevel(currentLower);
  const stableUpper = snapLevel(currentUpper);
  if (bound === 'lower') {
    return { lower: Math.min(snapped, stableUpper), upper: stableUpper };
  }
  return { lower: stableLower, upper: Math.max(snapped, stableLower) };
}

/** Accessibility increment/decrement by one half-step with the same clamp. */
export function stepLevel(
  bound: LevelBound,
  direction: 1 | -1,
  lower: number,
  upper: number,
): { lower: number; upper: number } {
  const current = bound === 'lower' ? lower : upper;
  return applyLevelBoundChange(bound, current + direction * LEVEL_STEP, lower, upper);
}

/** Prefer the nearer thumb; overlapped thumbs use left-of-mid → lower. */
export function resolveLevelPointerBound(
  x: number,
  trackWidth: number,
  lower: number,
  upper: number,
  hitPx = 28,
): LevelBound | null {
  if (!(trackWidth > 0) || !Number.isFinite(x)) return null;
  const lowerX = (levelVisualPercent(lower) / 100) * trackWidth;
  const upperX = (levelVisualPercent(upper) / 100) * trackWidth;
  const distLower = Math.abs(x - lowerX);
  const distUpper = Math.abs(x - upperX);
  const nearLower = distLower <= hitPx;
  const nearUpper = distUpper <= hitPx;
  if (!nearLower && !nearUpper) return null;
  const overlapped = snapLevel(lower) === snapLevel(upper) || Math.abs(lowerX - upperX) <= hitPx;
  if (overlapped && nearLower && nearUpper) {
    return x <= (lowerX + upperX) / 2 ? 'lower' : 'upper';
  }
  if (nearLower && !nearUpper) return 'lower';
  if (nearUpper && !nearLower) return 'upper';
  return distLower <= distUpper ? 'lower' : 'upper';
}
