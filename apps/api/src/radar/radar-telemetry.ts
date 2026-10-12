import type { Logger } from "@nestjs/common";

const FORBIDDEN =
  /lat|lon|coord|bearing|meter|geohash|cell|resultRef|discoveryProof|pepper|fix|accuracy/i;

const ALLOWED = new Set([
  "op",
  "outcome",
  "code",
  "status",
  "durationMs",
  "radiusBucketKm",
  "itemCount",
  "deleted",
]);

export type RadarMetric = {
  op: string;
  outcome: "ok" | "unavailable" | "denied" | "error" | "limited";
  code?: string;
  status?: number;
  durationMs?: number;
  radiusBucketKm?: number;
  itemCount?: number;
  deleted?: number;
};

export function redactRadarMetric(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN.test(key) || !ALLOWED.has(key)) continue;
    if (typeof value === "string" && FORBIDDEN.test(value)) continue;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function emitRadarMetric(logger: Logger, metric: RadarMetric): void {
  logger.log(redactRadarMetric(metric));
}
