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

/** Explicit RFC3339 date-time with Z or numeric offset; rejects bare dates and calendar rollover. */
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function parsePilotInstant(raw: string, label: string): Date {
  const match = RFC3339_INSTANT.exec(raw);
  if (!match) {
    throw badRequest(
      "ADMIN_INVALID_REQUEST",
      `Некорректный ${label}: нужен RFC3339 date-time с Z или offset`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const frac = match[7] ?? "";
  const tz = match[8]!;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
  }
  let offsetMin = 0;
  if (tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const oh = Number(tz.slice(1, 3));
    const om = Number(tz.slice(4, 6));
    if (oh > 23 || om > 59) {
      throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
    }
    offsetMin = sign * (oh * 60 + om);
  }
  const msFrac = frac
    ? Math.min(999, Math.max(0, Math.round(Number(frac) * 1000)))
    : 0;
  if (!Number.isFinite(msFrac)) {
    throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
  }
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, msFrac) -
    offsetMin * 60_000;
  if (!Number.isFinite(utcMs)) {
    throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
  }
  // Rollover guard in the original wall-clock timezone (e.g. 2026-11-31 → Dec 1).
  const wall = new Date(utcMs + offsetMin * 60_000);
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() + 1 !== month ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour ||
    wall.getUTCMinutes() !== minute ||
    wall.getUTCSeconds() !== second
  ) {
    throw badRequest("ADMIN_INVALID_REQUEST", `Некорректный ${label}`);
  }
  return new Date(utcMs);
}

export function resolvePilotMetricsQuery(
  input: z.infer<typeof pilotMetricsQueryInputSchema>,
): PilotMetricsQuery {
  const to = input.to ? parsePilotInstant(input.to, "to") : new Date();
  const from = input.from
    ? parsePilotInstant(input.from, "from")
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
