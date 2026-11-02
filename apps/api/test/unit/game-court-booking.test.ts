import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { loadEnv } from "../../src/config/env";
import { GameCourtBookingController } from "../../src/games/game-court-booking.controller";
import {
  COURT_BOOKING_LABELS,
  initialCourtBooking,
  parse,
  projectCourtBooking,
  putCourtBookingRequest,
} from "../../src/games/game-court-booking.policy";

const gameId = "10000000-0000-4000-8000-000000000001";
const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
});

describe("#386 court-booking policy and transport", () => {
  it("accepts the four organizer-declared statuses and rejects forged extras", () => {
    for (const status of ["unspecified", "arranging", "organizer_confirmed", "not_arranged"] as const) {
      expect(parse(putCourtBookingRequest, { expectedVersion: 0, status })).toEqual({
        expectedVersion: 0,
        status,
      });
      expect(COURT_BOOKING_LABELS[status]).toMatch(/Не указано|Договариваемся|Подтверждено организатором|Не удалось договориться/);
    }
    for (const input of [
      { expectedVersion: 0, status: "provider_confirmed" },
      { expectedVersion: -1, status: "arranging" },
      { expectedVersion: 0, status: "arranging", actorId: gameId },
      { expectedVersion: 0, status: "arranging", declarationSource: "organizer_declared" },
    ]) {
      expect(() => parse(putCourtBookingRequest, input)).toThrow();
    }
  });

  it("projects missing row as unspecified/version0/updatedAt null", () => {
    expect(initialCourtBooking(gameId, true)).toEqual({
      gameId,
      status: "unspecified",
      version: 0,
      updatedAt: null,
      declarationSource: "organizer_declared",
      allowedActions: { canUpdate: true },
    });
    expect(projectCourtBooking(null, gameId, false).allowedActions.canUpdate).toBe(false);
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
    const controller = new GameCourtBookingController(
      auth as never,
      new IdempotencyService({} as never, env),
      { put } as never,
    );
    await expect(controller.put(request as never, { status: vi.fn() } as never, gameId)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("preserves actor/session/idempotency key on PUT and session on GET", async () => {
    const a = "10000000-0000-4000-8000-000000000001";
    const s = "10000000-0000-4000-8000-000000000002";
    const auth = {
      requireCookieMutation: vi.fn().mockResolvedValue({ userId: a, sessionId: s }),
      requireSession: vi.fn().mockResolvedValue({ userId: a, sessionId: s }),
    };
    const put = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: initialCourtBooking(gameId, true),
    });
    const get = vi.fn().mockResolvedValue(initialCourtBooking(gameId, true));
    const controller = new GameCourtBookingController(
      auth as never,
      new IdempotencyService({} as never, env),
      { put, get } as never,
    );
    const body = { expectedVersion: 0, status: "arranging" };
    const reply = { status: vi.fn() };
    await controller.put(
      { headers: { "idempotency-key": "court-booking-synthetic-key" }, body } as never,
      reply as never,
      gameId,
    );
    expect(put).toHaveBeenCalledWith(a, s, "court-booking-synthetic-key", gameId, body);
    expect(reply.status).toHaveBeenCalledWith(200);
    await controller.get({} as never, gameId);
    expect(get).toHaveBeenCalledWith(gameId, a);
  });
});
