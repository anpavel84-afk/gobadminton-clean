/** NTRP v1 numeric scale for create-game level range (inclusive half-steps). */
export const NTRP_LEVEL_MIN = 1;
export const NTRP_LEVEL_MAX = 7;
export const NTRP_LEVEL_STEP = 0.5;
export const NTRP_LEVEL_DEFAULT_LOWER = 3;
export const NTRP_LEVEL_DEFAULT_UPPER = 3.5;

const STEP_INV = 1 / NTRP_LEVEL_STEP;

export function formatNtrpLevelId(value: number): string {
  return (Math.round(value * STEP_INV) / STEP_INV).toFixed(1);
}

export function formatNtrpLevelDisplay(value: number): string {
  return formatNtrpLevelId(value).replace(".", ",");
}

export function formatNtrpLevelSummary(lower: number, upper: number): string {
  return `${formatNtrpLevelDisplay(lower)}–${formatNtrpLevelDisplay(upper)}`;
}

export function snapClampNtrpLevel(raw: number): number {
  if (!Number.isFinite(raw)) return NTRP_LEVEL_DEFAULT_LOWER;
  const snapped = Math.round(raw * STEP_INV) / STEP_INV;
  return Math.min(NTRP_LEVEL_MAX, Math.max(NTRP_LEVEL_MIN, snapped));
}

export function inclusiveNtrpLevelIds(lower: number, upper: number): string[] {
  const loSteps = Math.round(snapClampNtrpLevel(lower) * STEP_INV);
  const hiSteps = Math.round(snapClampNtrpLevel(upper) * STEP_INV);
  const from = Math.min(loSteps, hiSteps);
  const to = Math.max(loSteps, hiSteps);
  const ids: string[] = [];
  for (let step = from; step <= to; step += 1) {
    ids.push(formatNtrpLevelId(step / STEP_INV));
  }
  return ids;
}

export function serializeNtrpLevelIds(lower: number, upper: number): string {
  return inclusiveNtrpLevelIds(lower, upper).join(", ");
}

export function parseNtrpLevelRange(value: string): { lower: number; upper: number } {
  const parsed = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n));
  if (!parsed.length) {
    return { lower: NTRP_LEVEL_DEFAULT_LOWER, upper: NTRP_LEVEL_DEFAULT_UPPER };
  }
  const lower = snapClampNtrpLevel(Math.min(...parsed));
  const upper = snapClampNtrpLevel(Math.max(...parsed));
  return { lower, upper };
}

export type NtrpLevelBound = "lower" | "upper";

/** Stable visual % on the shared global NTRP track (1..7). Independent of the other thumb. */
export function ntrpLevelVisualPercent(value: number): number {
  const snapped = snapClampNtrpLevel(value);
  return ((snapped - NTRP_LEVEL_MIN) / (NTRP_LEVEL_MAX - NTRP_LEVEL_MIN)) * 100;
}

/** Selected-interval fill on the shared track; left/width in % of global 1..7. */
export function ntrpLevelSelectedFillStyle(
  lower: number,
  upper: number,
): { left: string; width: string } {
  const lo = ntrpLevelVisualPercent(lower);
  const hi = ntrpLevelVisualPercent(upper);
  const left = Math.min(lo, hi);
  const width = Math.max(0, Math.abs(hi - lo));
  return { left: `${left}%`, width: `${width}%` };
}

/** Apply a native range value to one bound; clamp to the other endpoint; never reverse. */
export function applyNtrpLevelBoundChange(
  bound: NtrpLevelBound,
  raw: unknown,
  currentLower: number,
  currentUpper: number,
): { lower: number; upper: number; serialized: string } | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const snapped = snapClampNtrpLevel(n);
  const stableLower = snapClampNtrpLevel(currentLower);
  const stableUpper = snapClampNtrpLevel(currentUpper);
  if (bound === "lower") {
    const lower = Math.min(snapped, stableUpper);
    return { lower, upper: stableUpper, serialized: serializeNtrpLevelIds(lower, stableUpper) };
  }
  const upper = Math.max(snapped, stableLower);
  return { lower: stableLower, upper, serialized: serializeNtrpLevelIds(stableLower, upper) };
}

/** Logical ARIA min for a thumb: lower stays global 1; upper is limited by current lower. */
export function ntrpLevelAriaValueMin(bound: NtrpLevelBound, lower: number, upper: number): number {
  void upper;
  return bound === "lower" ? NTRP_LEVEL_MIN : snapClampNtrpLevel(lower);
}

/** Logical ARIA max for a thumb: upper stays global 7; lower is limited by current upper. */
export function ntrpLevelAriaValueMax(bound: NtrpLevelBound, lower: number, upper: number): number {
  void lower;
  return bound === "lower" ? snapClampNtrpLevel(upper) : NTRP_LEVEL_MAX;
}

/** Painted thumb diameter used for overlap / hit targeting (matches games.css). */
export const NTRP_LEVEL_THUMB_HIT_PX = 22;

/** Map a pointer X on the shared global track to a snapped NTRP value. */
export function ntrpLevelValueFromTrackClientX(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
): number {
  if (!(trackWidth > 0) || !Number.isFinite(clientX) || !Number.isFinite(trackLeft)) {
    return NTRP_LEVEL_DEFAULT_LOWER;
  }
  const ratio = Math.min(1, Math.max(0, (clientX - trackLeft) / trackWidth));
  return snapClampNtrpLevel(NTRP_LEVEL_MIN + ratio * (NTRP_LEVEL_MAX - NTRP_LEVEL_MIN));
}

/**
 * Choose which thumb a pointer gesture should drive.
 * Overlapped / equal thumbs: left-of-center or leftward direction → lower; else upper.
 * Returns null when the pointer is not near either thumb (track click does not jump).
 */
export function resolveNtrpLevelPointerBound(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  lower: number,
  upper: number,
  options?: { directionDx?: number; hitPx?: number },
): NtrpLevelBound | null {
  if (!(trackWidth > 0) || !Number.isFinite(clientX) || !Number.isFinite(trackLeft)) return null;
  const hitPx = options?.hitPx ?? NTRP_LEVEL_THUMB_HIT_PX;
  const stableLower = snapClampNtrpLevel(lower);
  const stableUpper = snapClampNtrpLevel(upper);
  const lowerX = trackLeft + (ntrpLevelVisualPercent(stableLower) / 100) * trackWidth;
  const upperX = trackLeft + (ntrpLevelVisualPercent(stableUpper) / 100) * trackWidth;
  const distLower = Math.abs(clientX - lowerX);
  const distUpper = Math.abs(clientX - upperX);
  const nearLower = distLower <= hitPx;
  const nearUpper = distUpper <= hitPx;
  if (!nearLower && !nearUpper) return null;

  const overlapped = stableLower === stableUpper || Math.abs(lowerX - upperX) <= hitPx;
  if (overlapped && nearLower && nearUpper) {
    const dx = options?.directionDx;
    if (typeof dx === "number" && dx !== 0 && Number.isFinite(dx)) {
      return dx < 0 ? "lower" : "upper";
    }
    const mid = (lowerX + upperX) / 2;
    return clientX <= mid ? "lower" : "upper";
  }
  if (nearLower && !nearUpper) return "lower";
  if (nearUpper && !nearLower) return "upper";
  return distLower <= distUpper ? "lower" : "upper";
}
