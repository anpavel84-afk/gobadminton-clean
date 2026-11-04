import { z } from "zod";
import { badRequest } from "../auth/problem";
import {
  PILOT_DEFAULT_WINDOW_DAYS,
  PILOT_MAX_WINDOW_DAYS,
} from "./pilot-metrics.policy";

const uuid = z.string().uuid();

export const pilotMetricsQueryInputSchema = z
  .object({
    cityId: uuid.optional(),
    from: z.string().min(1).max(64).optional(),
    to: z.string().min(1).max(64).optional(),
  })
  .strict();

export type PilotMetricsQuery = {
  cityId: string | null;
  from: Date;
  to: Date;
};

function parseInstant(raw: string, label: string): Date {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
  }
  return new Date(ms);
}

export function resolvePilotMetricsQuery(
  input: z.infer<typeof pilotMetricsQueryInputSchema>,
): PilotMetricsQuery {
  const to = input.to ? parseInstant(input.to, "to") : new Date();
  const from = input.from
    ? parseInstant(input.from, "from")
    : new Date(to.getTime() - PILOT_DEFAULT_WINDOW_DAYS * 86_400_000);
  if (!(from.getTime() < to.getTime())) {
    throw badRequest("ADMIN_INVALID_REQUEST", "Окно должно быть полуинтервалом [from, to)");
  }
  const spanMs = to.getTime() - from.getTime();
  if (spanMs > PILOT_MAX_WINDOW_DAYS * 86_400_000) {
    throw badRequest(
      "ADMIN_INVALID_REQUEST",
      `Окно не длиннее ${PILOT_MAX_WINDOW_DAYS} суток`,
    );
  }
  return { cityId: input.cityId ?? null, from, to };
}

export const pilotMetricsQuerySchema = pilotMetricsQueryInputSchema;
