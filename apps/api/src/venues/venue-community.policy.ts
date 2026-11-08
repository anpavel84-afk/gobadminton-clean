import { z } from "zod";
import { notFound, unprocessable } from "../auth/problem";

export const COMMUNITY_RATING_MIN = 1;
export const COMMUNITY_RATING_MAX = 5;
export const COMMUNITY_SUMMARY_BATCH_MAX = 200;

const uuid = z.string().uuid();

export type CommunityAggregateState = "empty" | "available" | "unavailable";

export type CommunityRatingSummary = {
  venueId: string;
  canonicalVenueId: string | null;
  average: number | null;
  count: number | null;
  state: CommunityAggregateState;
};

export type CommunityOwnVote = {
  venueId: string;
  canonicalVenueId: string;
  value: number | null;
  version: number;
  withdrawn: boolean;
  moderationState: "clear" | "withheld";
  allowedActions: {
    upsert: boolean;
    update: boolean;
    withdraw: boolean;
  };
};

export type CommunityOwnVoteResponse = {
  own: CommunityOwnVote | null;
  summary: CommunityRatingSummary;
};

export type CommunitySummariesResponse = {
  items: CommunityRatingSummary[];
};

export const upsertCommunityRatingRequest = z
  .object({
    value: z.number().int().min(COMMUNITY_RATING_MIN).max(COMMUNITY_RATING_MAX),
    expectedVersion: z.number().int().min(0).max(2147483647),
  })
  .strict();

export const withdrawCommunityRatingRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();

export type UpsertCommunityRatingRequest = z.infer<typeof upsertCommunityRatingRequest>;
export type WithdrawCommunityRatingRequest = z.infer<typeof withdrawCommunityRatingRequest>;

export function parseCommunity<T>(schema: z.ZodType<T>, input: unknown, code = "RATING_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    if (code === "RATING_INPUT_INVALID" && input && typeof input === "object" && "value" in input) {
      const value = (input as { value?: unknown }).value;
      if (typeof value === "number" && (!Number.isInteger(value) || value < 1 || value > 5)) {
        throw unprocessable("RATING_VALUE_INVALID", "Оценка должна быть целым числом от 1 до 5");
      }
    }
    throw unprocessable(code, "Некорректный запрос оценки");
  }
  return result.data;
}

export function parseVenueId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

export function parseVenueIdList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    throw unprocessable("RATING_VENUE_IDS_INVALID", "Укажите идентификаторы площадок");
  }
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw unprocessable("RATING_VENUE_IDS_INVALID", "Укажите идентификаторы площадок");
  }
  if (parts.length > COMMUNITY_SUMMARY_BATCH_MAX) {
    throw unprocessable(
      "RATING_VENUE_IDS_LIMIT",
      `Не больше ${COMMUNITY_SUMMARY_BATCH_MAX} площадок за запрос`,
    );
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of parts) {
    const parsed = uuid.safeParse(part);
    if (!parsed.success) {
      throw unprocessable("RATING_VENUE_IDS_INVALID", "Некорректный идентификатор площадки");
    }
    if (seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    ids.push(parsed.data);
  }
  return ids;
}

/** Server-derived average: exact sum/count rounded to one decimal. Never invent 0/5.0/NaN. */
export function roundCommunityAverage(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

export function emptySummary(venueId: string, canonicalVenueId: string): CommunityRatingSummary {
  return {
    venueId,
    canonicalVenueId,
    average: null,
    count: 0,
    state: "empty",
  };
}

export function unavailableSummary(venueId: string, canonicalVenueId: string | null): CommunityRatingSummary {
  return {
    venueId,
    canonicalVenueId,
    average: null,
    count: null,
    state: "unavailable",
  };
}

export function availableSummary(
  venueId: string,
  canonicalVenueId: string,
  sum: number,
  count: number,
): CommunityRatingSummary {
  if (count <= 0) return emptySummary(venueId, canonicalVenueId);
  return {
    venueId,
    canonicalVenueId,
    average: roundCommunityAverage(sum, count),
    count,
    state: "available",
  };
}
