import { describe, expect, it, vi } from "vitest";
import { GameAttendanceController } from "../../src/games/game-attendance.controller";
import {
  bulkPresentRequest,
  eligibleFromTransitions,
  parse,
  postGameWritesEnabled,
  putAttendanceRequest,
  summarizeRoster,
  unknownAttendanceRecord,
} from "../../src/games/game-attendance.policy";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { loadEnv } from "../../src/config/env";

const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
});

const context = "10000000-0000-4000-8000-000000000011";
const starts = new Date("2026-10-24T15:00:00.000Z");

describe("PG-1b attendance policy", () => {
  it("accepts present/absent and late only with present; requires correctionReason on correction", () => {
    expect(parse(putAttendanceRequest, { expectedVersion: 0, value: "present" }).value).toBe("present");
    expect(parse(putAttendanceRequest, { expectedVersion: 0, value: "present", late: true }).late).toBe(true);
    expect(() => parse(putAttendanceRequest, { expectedVersion: 0, value: "absent", late: true })).toThrow();
    expect(() => parse(putAttendanceRequest, { expectedVersion: 0, value: "unknown" })).toThrow();
    expect(() => parse(putAttendanceRequest, { expectedVersion: 1, value: "absent" })).toThrow();
    expect(
      parse(putAttendanceRequest, {
        expectedVersion: 1,
        value: "present",
        correctionReason: "Исправление",
      }).correctionReason,
    ).toBe("Исправление");
  });

  it("bulk-present requires confirmedExactSelection and rejects duplicates", () => {
    expect(
      parse(bulkPresentRequest, {
        items: [{ contextId: context, expectedVersion: 0 }],
        confirmedExactSelection: true,
      }).items,
    ).toHaveLength(1);
    expect(() =>
      parse(bulkPresentRequest, {
        items: [{ contextId: context, expectedVersion: 0 }],
        confirmedExactSelection: false,
      }),
    ).toThrow();
    expect(() =>
      parse(bulkPresentRequest, {
        items: [
          { contextId: context, expectedVersion: 0 },
          { contextId: context, expectedVersion: 0 },
        ],
        confirmedExactSelection: true,
      }),
    ).toThrow();
  });

  it("does not infer attendance from time; eligibility uses transitions or current confirmed", () => {
    const ends = new Date("2026-10-24T17:00:00.000Z");
    expect(
      eligibleFromTransitions([], starts, "confirmed", new Date("2026-10-20T00:00:00.000Z"), ends),
    ).toEqual({ eligible: true, proof: "current_confirmed" });
    expect(eligibleFromTransitions([], starts, "withdrawn", null, ends)).toEqual({
      eligible: false,
      proof: null,
    });
    const confirmedThenWithdrawnAfter = [
      { to_status: "confirmed", at: new Date("2026-10-20T00:00:00.000Z"), id: "a" },
      { to_status: "withdrawn", at: new Date("2026-10-25T00:00:00.000Z"), id: "b" },
    ];
    expect(eligibleFromTransitions(confirmedThenWithdrawnAfter, starts, "withdrawn", null, ends)).toEqual({
      eligible: true,
      proof: "transition_as_of_start",
    });
    const withdrawnBeforeStart = [
      { to_status: "confirmed", at: new Date("2026-10-20T00:00:00.000Z"), id: "a" },
      { to_status: "withdrawn", at: new Date("2026-10-23T00:00:00.000Z"), id: "b" },
    ];
    expect(eligibleFromTransitions(withdrawnBeforeStart, starts, "withdrawn", null, ends)).toEqual({
      eligible: false,
      proof: null,
    });
    // Negative proof: later withdrawal before start overrides earlier confirmation even when
    // stale confirmed_at remains on the participation row (disposable FAIL root cause).
    expect(
      eligibleFromTransitions(
        withdrawnBeforeStart,
        starts,
        "withdrawn",
        new Date("2026-10-20T00:00:00.000Z"),
        ends,
      ),
    ).toEqual({ eligible: false, proof: null });
    // Stale current=confirmed + old confirmedAt cannot override pre-start withdraw.
    expect(
      eligibleFromTransitions(
        withdrawnBeforeStart,
        starts,
        "confirmed",
        new Date("2026-10-20T00:00:00.000Z"),
        ends,
      ),
    ).toEqual({ eligible: false, proof: null });
    // New concrete confirmation after that withdraw, within the game window, is markable.
    expect(
      eligibleFromTransitions(
        withdrawnBeforeStart,
        starts,
        "confirmed",
        new Date("2026-10-24T12:00:00.000Z"),
        ends,
      ),
    ).toEqual({ eligible: true, proof: "current_confirmed" });
    // Current confirmed after ends cannot prove membership for this game window.
    expect(
      eligibleFromTransitions([], starts, "confirmed", new Date("2026-10-24T18:00:00.000Z"), ends),
    ).toEqual({ eligible: false, proof: null });
  });

  it("unknown projection has null provenance and summary separates clarification", () => {
    const unknown = unknownAttendanceRecord(context, "Анна", {
      canSetAttendance: true,
      canAcknowledge: false,
      canDispute: false,
      canWithdrawDispute: false,
    });
    expect(unknown).toMatchObject({
      value: "unknown",
      version: 0,
      assertion: { actorDisplay: null, source: null, at: null },
    });
    const summary = summarizeRoster([
      unknown,
      {
        ...unknown,
        value: "absent",
        version: 1,
        assertion: { actorDisplay: "Ольга", source: "manager_explicit", at: starts.toISOString() },
        dispute: { id: context, status: "open", challengedVersion: 1, version: 1 },
      },
      {
        ...unknown,
        value: "present",
        version: 2,
        acknowledgedVersion: 2,
        assertion: { actorDisplay: "Ольга", source: "manager_explicit", at: starts.toISOString() },
      },
    ]);
    expect(summary).toEqual({
      rosterCount: 3,
      marked: 2,
      unknown: 1,
      underClarification: 1,
      agreed: 1,
    });
  });

  it("writes remain fail-closed by default", () => {
    expect(postGameWritesEnabled(env)).toBe(false);
  });

  it("controller preserves actor/session/idempotency on PUT attendance", async () => {
    const a = "10000000-0000-4000-8000-000000000001";
    const s = "10000000-0000-4000-8000-000000000002";
    const auth = { requireCookieMutation: vi.fn().mockResolvedValue({ userId: a, sessionId: s }) };
    const putAttendance = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: unknownAttendanceRecord(context, "Анна", {
        canSetAttendance: true,
        canAcknowledge: false,
        canDispute: false,
        canWithdrawDispute: false,
      }),
    });
    const controller = new GameAttendanceController(
      auth as never,
      new IdempotencyService({} as never, env),
      { putAttendance } as never,
    );
    const body = { expectedVersion: 0, value: "present" };
    const reply = { status: vi.fn() };
    await controller.putAttendance(
      { headers: { "idempotency-key": "pg1b-synthetic-key-12345" }, body } as never,
      reply as never,
      context,
      context,
    );
    expect(putAttendance).toHaveBeenCalledWith(a, s, "pg1b-synthetic-key-12345", context, context, body);
    expect(reply.status).toHaveBeenCalledWith(200);
  });
});
