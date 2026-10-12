import { describe, expect, it } from "vitest";
import { cityDate, futureDiscoveryBounds, futureDiscoveryItems, nextCalendarDay } from "../src/lib/discovery-presentation";

describe("Owner A future-only city feed", () => {
  const now = Date.parse("2030-06-01T21:05:00Z");
  it.each(["Europe/Moscow", "UTC", "America/Sao_Paulo"])("device %s cannot change Moscow/SPB Today bounds", device => {
    const localDay = cityDate(new Date(now), "Europe/Moscow");
    expect(localDay).toBe("2030-06-02");
    expect(cityDate(new Date(now), device)).toBeTruthy();
    expect(futureDiscoveryBounds(localDay, "Europe/Moscow", now)).toEqual({ startsFrom: "2030-06-01T21:05:00.000Z", startsBefore: "2030-06-02T21:00:00.000Z" });
    expect(futureDiscoveryBounds(nextCalendarDay(localDay), "Europe/Moscow", now).startsFrom).toBe("2030-06-02T21:00:00.000Z");
  });
  it("filters equality/past/malformed from every cached/page union and clock advance", () => {
    const items = [{ id: "past", startsAt: "2030-06-01T21:04:00Z" }, { id: "now", startsAt: "2030-06-01T21:05:00Z" }, { id: "soon", startsAt: "2030-06-01T21:06:00Z" }, { id: "later", startsAt: "2030-06-01T21:07:00Z" }, { id: "invalid", startsAt: "invalid" }];
    expect(futureDiscoveryItems(items, now).map(x => x.id)).toEqual(["soon", "later"]);
    expect(futureDiscoveryItems(items, now + 60000).map(x => x.id)).toEqual(["later"]);
    expect(futureDiscoveryItems(items, now + 120000)).toEqual([]);
    expect(futureDiscoveryBounds("2030-06-02", "Europe/Moscow", now + 60000).startsFrom).toBe("2030-06-01T21:06:00.000Z");
  });
});
