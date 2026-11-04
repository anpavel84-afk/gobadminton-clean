import { describe, expect, it, vi } from "vitest";
import { GameRemindersController } from "../../src/games/game-reminders.controller";
import {
  REMINDER_MAX_ORDINAL,
  REMINDER_MIN_ACTIVATION_GAP_MS,
  REMINDER_OFFSETS_MS,
  REMINDER_SNOOZE_MS,
  canActivateAnother,
  canShowReminder,
  dueAtForOrdinal,
  gameEligibleForReminders,
  isReminderDue,
  isSnoozeExpired,
  laterReminderRequest,
  parseLaterBody,
  reminderWritesEnabled,
  snoozeUntil,
} from "../../src/games/game-reminders.policy";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { loadEnv } from "../../src/config/env";

const ends = new Date("2026-11-01T12:00:00.000Z");

describe("#457 reminder policy (fake clock)", () => {
  it("uses local 1h/24h/72h offsets and caps at 3 ordinals", () => {
    expect(REMINDER_MAX_ORDINAL).toBe(3);
    expect(REMINDER_OFFSETS_MS).toEqual({
      1: 3_600_000,
      2: 86_400_000,
      3: 259_200_000,
    });
    expect(dueAtForOrdinal(ends, 1).toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(dueAtForOrdinal(ends, 2).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(dueAtForOrdinal(ends, 3).toISOString()).toBe("2026-11-04T12:00:00.000Z");
  });

  it("due requires both endsAt and dueAt; timezone-stable ms arithmetic", () => {
    const due = dueAtForOrdinal(ends, 1);
    expect(
      isReminderDue({
        now: new Date("2026-11-01T12:30:00.000Z"),
        endsAt: ends,
        dueAt: due,
      }),
    ).toBe(false);
    expect(
      isReminderDue({
        now: new Date("2026-11-01T13:00:00.000Z"),
        endsAt: ends,
        dueAt: due,
      }),
    ).toBe(true);
    // endsAt moved into the future → wait even if dueAt already passed.
    expect(
      isReminderDue({
        now: new Date("2026-11-01T14:00:00.000Z"),
        endsAt: new Date("2026-11-01T15:00:00.000Z"),
        dueAt: due,
      }),
    ).toBe(false);
  });

  it("snooze postpones without resetting the activation-round cap", () => {
    const now = new Date("2026-11-01T14:00:00.000Z");
    expect(REMINDER_SNOOZE_MS).toBe(86_400_000);
    const until = snoozeUntil(now);
    expect(until.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(
      isSnoozeExpired({
        now: new Date("2026-11-02T13:59:59.000Z"),
        state: "snoozed",
        snoozedUntil: until,
      }),
    ).toBe(false);
    expect(
      isSnoozeExpired({
        now: new Date("2026-11-02T14:00:00.000Z"),
        state: "snoozed",
        snoozedUntil: until,
      }),
    ).toBe(true);
    expect(
      isSnoozeExpired({
        now,
        state: "visible",
        snoozedUntil: until,
      }),
    ).toBe(false);
  });

  it("activation budget caps at 3 and spaces rounds by 24h", () => {
    expect(REMINDER_MIN_ACTIVATION_GAP_MS).toBe(86_400_000);
    const now = new Date("2026-11-03T12:00:00.000Z");
    expect(
      canActivateAnother({
        activationCount: 0,
        lastActivatedAt: null,
        now,
      }),
    ).toBe(true);
    expect(
      canActivateAnother({
        activationCount: 3,
        lastActivatedAt: new Date("2026-11-01T13:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      canActivateAnother({
        activationCount: 1,
        lastActivatedAt: new Date("2026-11-02T13:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      canActivateAnother({
        activationCount: 1,
        lastActivatedAt: new Date("2026-11-02T12:00:00.000Z"),
        now,
      }),
    ).toBe(true);
  });

  it("stops eligibility on held/not_held/cancelled; waits for future games", () => {
    const now = new Date("2026-11-01T14:00:00.000Z");
    expect(
      gameEligibleForReminders({
        status: "published",
        endsAt: ends,
        now,
        outcomeValue: null,
      }),
    ).toEqual({ ok: true });
    expect(
      gameEligibleForReminders({
        status: "published",
        endsAt: ends,
        now,
        outcomeValue: "held",
      }),
    ).toEqual({ ok: false, stop: "outcome_recorded" });
    expect(
      gameEligibleForReminders({
        status: "cancelled",
        endsAt: ends,
        now,
        outcomeValue: null,
      }),
    ).toEqual({ ok: false, stop: "game_cancelled" });
    expect(
      gameEligibleForReminders({
        status: "published",
        endsAt: new Date("2026-11-02T00:00:00.000Z"),
        now,
        outcomeValue: null,
      }),
    ).toEqual({ ok: false });
  });

  it("canShow requires visible + active organizer + account + unknown outcome", () => {
    const base = {
      state: "visible" as const,
      now: new Date("2026-11-01T14:00:00.000Z"),
      endsAt: ends,
      outcomeValue: null as null,
      gameStatus: "published",
      organizerActive: true,
      accountActive: true,
      accountAccessOk: true,
    };
    expect(canShowReminder(base)).toBe(true);
    expect(canShowReminder({ ...base, state: "snoozed" })).toBe(false);
    expect(canShowReminder({ ...base, organizerActive: false })).toBe(false);
    expect(canShowReminder({ ...base, accountAccessOk: false })).toBe(false);
    expect(canShowReminder({ ...base, outcomeValue: "not_held" })).toBe(false);
  });

  it("Later body requires explicit command + expectedVersion; rejects extras", () => {
    expect(parseLaterBody({ command: "later", expectedVersion: 2 })).toEqual({
      command: "later",
      expectedVersion: 2,
    });
    expect(() => parseLaterBody({ command: "later" })).toThrow();
    expect(() => parseLaterBody({ expectedVersion: 1 })).toThrow();
    expect(() =>
      parseLaterBody({ command: "later", expectedVersion: 1, extra: true }),
    ).toThrow();
    expect(laterReminderRequest.safeParse({ command: "snooze", expectedVersion: 1 }).success).toBe(
      false,
    );
  });

  it("writes fail closed when POST_GAME_INTERNAL_ENABLED default off", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
    });
    expect(reminderWritesEnabled(env)).toBe(false);
    const admitted = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
      POST_GAME_INTERNAL_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-fingerprint-secret-32chars!!",
    });
    expect(reminderWritesEnabled(admitted)).toBe(true);
  });

  it.each([
    { headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": "ok" }, cookies: {} },
    { headers: { origin: "http://127.0.0.1:3001" }, cookies: { [SESSION_COOKIE]: "s" } },
  ])("auth rejects Later POST before service: %j", async (request) => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
    });
    const auth = {
      requireCookieMutation: vi.fn().mockRejectedValue(new Error("auth")),
      requireSession: vi.fn(),
    };
    const later = vi.fn();
    const controller = new GameRemindersController(
      auth as never,
      new IdempotencyService({} as never, env),
      { later, listMine: vi.fn() } as never,
    );
    await expect(
      controller.later(
        { headers: request.headers, cookies: request.cookies, body: {} } as never,
        { status: vi.fn() } as never,
        "10000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow("auth");
    expect(later).not.toHaveBeenCalled();
  });
});
