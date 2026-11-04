import { z } from "zod";
import type { AppEnv } from "../config/env";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import { postGameWritesEnabled } from "./game-outcomes.policy";

export type ReminderOrdinal = 1 | 2 | 3;

/** Local implementation choice (not Owner SLA): 1h / 24h / 72h after endsAt. */
export const REMINDER_OFFSETS_MS: Record<ReminderOrdinal, number> = {
  1: 1 * 60 * 60 * 1000,
  2: 24 * 60 * 60 * 1000,
  3: 72 * 60 * 60 * 1000,
};

/** Min gap between actual activations (no burst catch-up of all ordinals). */
export const REMINDER_MIN_ACTIVATION_GAP_MS = 24 * 60 * 60 * 1000;

/** Local «Позже» snooze — 24h; does not reset the activation-round cap. */
export const REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

export const REMINDER_MAX_ORDINAL = 3;
export const REMINDER_SWEEP_BATCH = 50;

export const uuid = z.string().uuid().transform((value) => value.toLowerCase());

export type ReminderState = "scheduled" | "visible" | "snoozed" | "stopped";
export type ReminderStopReason =
  | "outcome_recorded"
  | "game_cancelled"
  | "role_lost"
  | "account_restricted"
  | "account_inactive"
  | "superseded";

export const laterReminderRequest = z
  .object({
    command: z.literal("later"),
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();

export type LaterReminderRequest = z.infer<typeof laterReminderRequest>;

export type ReminderView = {
  id: string;
  gameId: string;
  gameTitle: string | null;
  endsAt: string;
  ordinal: ReminderOrdinal;
  version: number;
  state: "visible";
  dueAt: string;
  visibleAt: string;
  resultsPath: string;
  allowedActions: {
    canOpenResults: boolean;
    canLater: boolean;
  };
};

export type ReminderListView = {
  items: ReminderView[];
  writesEnabled: boolean;
  installed: boolean;
};

export function parseReminderId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function parseLaterBody(input: unknown): LaterReminderRequest {
  const result = laterReminderRequest.safeParse(input);
  if (!result.success) {
    throw unprocessable("REMINDER_INPUT_INVALID", "Некорректный запрос напоминания");
  }
  return result.data;
}

export function unavailable(): never {
  throw notFound("REMINDER_NOT_FOUND", "Напоминание не найдено");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись напоминания недоступна");
}

export function reminderWritesEnabled(env: AppEnv): boolean {
  return postGameWritesEnabled(env);
}

export function dueAtForOrdinal(endsAt: Date, ordinal: ReminderOrdinal): Date {
  return new Date(endsAt.getTime() + REMINDER_OFFSETS_MS[ordinal]);
}

export function isOrdinal(value: number): value is ReminderOrdinal {
  return value === 1 || value === 2 || value === 3;
}

/** Pure due check: reminder may activate when both schedule and game end have passed. */
export function isReminderDue(input: {
  now: Date;
  endsAt: Date;
  dueAt: Date;
}): boolean {
  return (
    input.now.getTime() >= input.endsAt.getTime() &&
    input.now.getTime() >= input.dueAt.getTime()
  );
}

/** Snooze window elapsed — command advances or stops; does not re-show the same ordinal. */
export function isSnoozeExpired(input: {
  now: Date;
  state: ReminderState;
  snoozedUntil: Date | null;
}): boolean {
  if (input.state !== "snoozed" || !input.snoozedUntil) return false;
  return input.now.getTime() >= input.snoozedUntil.getTime();
}

/**
 * Max 3 actual activation rounds (incl. post-Later advance). Spacing blocks burst catch-up.
 */
export function canActivateAnother(input: {
  activationCount: number;
  lastActivatedAt: Date | null;
  now: Date;
}): boolean {
  if (input.activationCount >= REMINDER_MAX_ORDINAL) return false;
  if (!input.lastActivatedAt) return true;
  return (
    input.now.getTime() >=
    input.lastActivatedAt.getTime() + REMINDER_MIN_ACTIVATION_GAP_MS
  );
}

export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + REMINDER_SNOOZE_MS);
}

export function gameEligibleForReminders(input: {
  status: string;
  endsAt: Date;
  now: Date;
  outcomeValue: "held" | "not_held" | null;
}): { ok: true } | { ok: false; stop?: ReminderStopReason } {
  if (input.outcomeValue === "held" || input.outcomeValue === "not_held") {
    return { ok: false, stop: "outcome_recorded" };
  }
  if (input.status === "cancelled") {
    return { ok: false, stop: "game_cancelled" };
  }
  if (input.status !== "published" && input.status !== "completed") {
    return { ok: false };
  }
  if (input.now.getTime() < input.endsAt.getTime()) {
    return { ok: false };
  }
  return { ok: true };
}

export function canShowReminder(input: {
  state: ReminderState;
  now: Date;
  endsAt: Date;
  outcomeValue: "held" | "not_held" | null;
  gameStatus: string;
  organizerActive: boolean;
  accountActive: boolean;
  accountAccessOk: boolean;
}): boolean {
  if (!input.organizerActive || !input.accountActive || !input.accountAccessOk) {
    return false;
  }
  const life = gameEligibleForReminders({
    status: input.gameStatus,
    endsAt: input.endsAt,
    now: input.now,
    outcomeValue: input.outcomeValue,
  });
  if (!life.ok) return false;
  return input.state === "visible";
}

export function resultsPathFor(gameId: string): string {
  return `/my-games/${gameId}/results`;
}

export function parseListLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 20;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > 50) {
    throw badRequest("LIMIT_INVALID", "limit должен быть 1–50");
  }
  return value;
}
