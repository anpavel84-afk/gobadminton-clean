import { describe, expect, it } from "vitest";
import { gameDurationMinutes, gameLocalToIso, gameSchedule, gameStartIsFuture } from "../src/lib/game-form";

describe("Owner A city schedule", () => {
  it.each([1, 5, 30, 59])("allows +%i minute start with deadline=start", minutes => {
    const now = Date.parse("2030-06-01T15:00:00Z");
    const local = `2030-06-01T18:${String(minutes).padStart(2, "0")}`;
    const schedule = gameSchedule(local, "60", "Europe/Moscow")!;
    expect(gameStartIsFuture(schedule.startsAt, now)).toBe(true);
    expect(schedule.applicationDeadlineAt).toBe(schedule.startsAt);
    expect(Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)).toBe(3600000);
    expect(gameStartIsFuture(schedule.startsAt, Date.parse(schedule.startsAt))).toBe(false);
  });
  it.each(["60", "120", "180", "37", "1", "1440"])("uses elapsed duration %s across midnight", raw => {
    const schedule = gameSchedule("2030-06-02T23:59", raw, "Europe/Moscow")!;
    expect(schedule.startsAt).toBe("2030-06-02T20:59:00.000Z");
    expect(Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)).toBe(Number(raw) * 60000);
  });
  it.each(["", "0", "-1", "Infinity", "NaN", "1.5", "1e2", "1441"])("rejects invalid duration %s", raw => {
    expect(gameDurationMinutes(raw)).toBeNull();
    expect(gameSchedule("2030-06-02T19:00", raw, "Europe/Moscow")).toBeNull();
  });
  it.each(["2030-02-30T19:00", "2030-02-29T19:00", "2030-13-01T10:00", "2030-01-01T24:00", "2030-01-01T10:60", "garbage"])("rejects impossible local value %s", value => expect(gameLocalToIso(value, "Europe/Moscow")).toBe(""));
  it("rejects nonexistent DST times and uses elapsed time across spring transition", () => {
    expect(gameLocalToIso("2026-03-29T02:30", "Europe/Berlin")).toBe("");
    expect(gameSchedule("2026-03-29T01:30", "120", "Europe/Berlin")).toEqual({ startsAt: "2026-03-29T00:30:00.000Z", endsAt: "2026-03-29T02:30:00.000Z", applicationDeadlineAt: "2026-03-29T00:30:00.000Z" });
  });
  it("rejects now/past and malformed starts", () => {
    const now = Date.parse("2030-01-01T10:00:00Z");
    for (const start of ["invalid", "2030-01-01T10:00:00Z", "2030-01-01T09:59:00Z"]) expect(gameStartIsFuture(start, now)).toBe(false);
  });
});
