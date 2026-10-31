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
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
  if (!parsed.length) {
    return { lower: NTRP_LEVEL_DEFAULT_LOWER, upper: NTRP_LEVEL_DEFAULT_UPPER };
  }
  const lower = snapClampNtrpLevel(Math.min(...parsed));
  const upper = snapClampNtrpLevel(Math.max(...parsed));
  return { lower, upper };
}

export type NtrpLevelBound = "lower" | "upper";

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
