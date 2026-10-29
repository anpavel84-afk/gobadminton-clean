import { describe, expect, it, vi } from "vitest";
import { GameOutcomesController } from "../../src/games/game-outcomes.controller";
import {
  assertLifecycle,
  canRecordHint,
  parse,
  postGameWritesEnabled,
  putOutcomeRequest,
  type LockedGameRow,
} from "../../src/games/game-outcomes.policy";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { loadEnv } from "../../src/config/env";

const past: LockedGameRow = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "published",
  version: 2,
  ends_at: new Date("2020-01-01T00:00:00.000Z"),
};
const futureEnds = new Date(Date.now() + 3600_000);
const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
});

describe("PG-1a outcome policy and transport", () => {
  it("accepts held without reason and requires reason for not_held/correction", () => {
    expect(parse(putOutcomeRequest, { expectedVersion: 0, outcome: "held" })).toEqual({
      expectedVersion: 0,
      outcome: "held",
    });
    expect(parse(putOutcomeRequest, {
      expectedVersion: 0,
      outcome: "not_held",
      reason: "Дождь",
    }).reason).toBe("Дождь");
    expect(() => parse(putOutcomeRequest, { expectedVersion: 0, outcome: "not_held" })).toThrow();
    expect(() => parse(putOutcomeRequest, { expectedVersion: 1, outcome: "held" })).toThrow();
    expect(parse(putOutcomeRequest, {
      expectedVersion: 1,
      outcome: "held",
      reason: "Исправление",
    }).expectedVersion).toBe(1);
  });

  it("rejects unknown fields, overlong reason and control characters", () => {
    for (const input of [
      { expectedVersion: 0, outcome: "held", actorId: past.id },
      { expectedVersion: 0, outcome: "held", reason: "x".repeat(501) },
      { expectedVersion: 0, outcome: "not_held", reason: "bad\u0000" },
      { expectedVersion: -1, outcome: "held" },
      { expectedVersion: 0, outcome: "unknown" },
    ]) {
      expect(() => parse(putOutcomeRequest, input)).toThrow();
    }
  });

  it("lifecycle: pre-end/draft/cancelled-held fail; published/completed/cancelled-not_held ok", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(() => assertLifecycle({ ...past, status: "draft" }, "held", now)).toThrow();
    expect(() => assertLifecycle({ ...past, ends_at: futureEnds }, "held", now)).toThrow();
    expect(() => assertLifecycle({ ...past, status: "cancelled" }, "held", now)).toThrow();
    expect(() => assertLifecycle({ ...past, status: "cancelled" }, "not_held", now)).not.toThrow();
    expect(() => assertLifecycle(past, "held", now)).not.toThrow();
    expect(() => assertLifecycle({ ...past, status: "completed" }, "not_held", now)).not.toThrow();
  });

  it("writes fail closed outside local/test or exact DEV admission; PROD config rejected", () => {
    expect(postGameWritesEnabled(env)).toBe(false);
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
    expect(postGameWritesEnabled(admitted)).toBe(true);
    expect(() => loadEnv({
      NODE_ENV: "production",
      APP_ENV: "prod",
      DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
      PUBLIC_API_ORIGIN: "https://api.gobadminton.ru",
      PUBLIC_WEB_ORIGIN: "https://gobadminton.ru",
      POST_GAME_INTERNAL_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "openai",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-fingerprint-secret-32chars!!",
      OPENAI_MODERATION_API_KEY: "sk-synthetic",
      AUTH_PEPPER: "prod-synthetic-auth-pepper-32chars-min",
    })).toThrow(/Post-game writes/);
    expect(canRecordHint(env, "manager", past, new Date("2026-01-01"), true)).toBe(false);
  });

  it.each([
    { headers: { origin: env.PUBLIC_WEB_ORIGIN, "x-csrf-token": "ok" }, cookies: {} },
    { headers: { origin: env.PUBLIC_WEB_ORIGIN }, cookies: { [SESSION_COOKIE]: "s" } },
    { headers: { origin: "https://evil.invalid", "x-csrf-token": "ok" }, cookies: { [SESSION_COOKIE]: "s" } },
    { headers: { origin: env.PUBLIC_WEB_ORIGIN, "x-csrf-token": "bad" }, cookies: { [SESSION_COOKIE]: "s" } },
  ])("auth rejects PUT before service: %j", async (request) => {
    const auth = {
      requireCookieMutation: vi.fn().mockRejectedValue(new Error("auth")),
      requireSession: vi.fn(),
    };
    const put = vi.fn();
    const controller = new GameOutcomesController(
      auth as never,
      new IdempotencyService({} as never, env),
      { putOutcome: put } as never,
    );
    await expect(controller.putOutcome(request as never, { status: vi.fn() } as never, past.id)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("preserves actor/session/idempotency key on PUT", async () => {
    const a = "10000000-0000-4000-8000-000000000001";
    const s = "10000000-0000-4000-8000-000000000002";
    const auth = { requireCookieMutation: vi.fn().mockResolvedValue({ userId: a, sessionId: s }) };
    const put = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { gameId: past.id, outcome: { value: "held", version: 1, reason: null, provenance: null }, allowedActions: { canRecordOutcome: true } },
    });
    const controller = new GameOutcomesController(
      auth as never,
      new IdempotencyService({} as never, env),
      { putOutcome: put } as never,
    );
    const body = { expectedVersion: 0, outcome: "held" };
    const reply = { status: vi.fn() };
    await controller.putOutcome(
      { headers: { "idempotency-key": "pg1a-synthetic-key-12345" }, body } as never,
      reply as never,
      past.id,
    );
    expect(put).toHaveBeenCalledWith(a, s, "pg1a-synthetic-key-12345", past.id, body);
    expect(reply.status).toHaveBeenCalledWith(200);
  });
});
