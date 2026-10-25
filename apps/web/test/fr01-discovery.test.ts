import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cityDate, futureDiscoveryBounds, futureDiscoveryItems, discoveryDayBounds, discoveryFormat, discoveryGameWhen, nextCalendarDay } from "../src/lib/discovery-presentation";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import type { Game } from "../src/lib/consumer-types";
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

const game: Game = {
  id: "api-game", version: 1, title: "Вечерние миксты", status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Анна П.", publicContact: "private-not-rendered" },
  venue: { id: "venue", name: "Корт", cityId: "city", address: "Адрес из ответа", timezone: "Europe/Moscow" },
  startsAt: "2030-01-01T16:00:00Z", endsAt: "2030-01-01T18:00:00Z", timezone: "Europe/Moscow", applicationDeadlineAt: "2030-01-01T15:00:00Z",
  capacity: 8, confirmedCount: 2, externalReservedCount: 1, availablePlaces: 5, formatKey: "doubles", levelRule: { scaleId: "pilot", scaleVersion: 1, allowedLevelIds: ["3.0"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Аренду делим поровну" },
};

describe("FR-01 discovery dates", () => {
  it("binds today and exclusive day bounds to the selected city across UTC midnight", () => {
    expect(cityDate(new Date("2026-10-04T22:00:00Z"), "Europe/Moscow")).toBe("2026-10-05");
    expect(discoveryDayBounds("2026-10-05", "Europe/Moscow")).toEqual({ startsFrom: "2026-10-04T21:00:00.000Z", startsBefore: "2026-10-05T21:00:00.000Z" });
    expect(nextCalendarDay("2026-12-31")).toBe("2027-01-01");
  });
  it("handles 23/25-hour city days at DST boundaries", () => {
    const spring = discoveryDayBounds("2026-03-29", "Europe/Berlin");
    const autumn = discoveryDayBounds("2026-10-25", "Europe/Berlin");
    expect(Date.parse(spring.startsBefore) - Date.parse(spring.startsFrom)).toBe(23 * 3600000);
    expect(Date.parse(autumn.startsBefore) - Date.parse(autumn.startsFrom)).toBe(25 * 3600000);
  });
  it("shows Game time in its own timezone", () => {
    expect(discoveryGameWhen(game).time).toBe("19:00 — 21:00");
  });
});

describe("FR-01 API-backed card semantics", () => {
  it.each([
    ["doubles", "Парная игра"], ["singles", "Одиночная игра"],
    ["mixed", "Микст"], ["mixed_doubles", "Микст"],
  ])("keeps the existing consumer label for %s", (formatKey, label) => {
    expect(discoveryFormat(formatKey)).toBe(label);
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: { ...game, formatKey } }));
    expect(html).toContain(`<span>${label}</span>`);
  });
  it.each(["internal_format_v2", "x", "x".repeat(64), "toString", "constructor", "__proto__"])(
    "omits unsupported contract-valid format %s without changing either card family",
    (formatKey) => {
      expect(discoveryFormat(formatKey)).toBeNull();
      for (const activityKind of ["regular", "trainer_led"] as const) {
        const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: { ...game, activityKind, formatKey } }));
        expect(html).not.toContain(`<span>${formatKey}</span>`);
        if (formatKey === "internal_format_v2") expect(html).not.toContain(formatKey);
        expect(html).toContain('<div class="gb-discovery-meta"><span>Уровень: 3.0</span></div>');
        for (const value of [game.title, game.venue.address, "Свободно 5 из 8", "Аренду делим поровну", 'href="/games/api-game"']) expect(html).toContain(value);
      }
    },
  );
  it("renders title, capacity, terms and detail links without exposing contacts or claiming confirmation", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game }));
    for (const value of [game.title, game.venue.address, "Свободно 5 из 8", "Аренду делим поровну", 'href="/games/api-game"', "Обычная игра", "Парная игра"]) expect(html).toContain(value);
    expect(html).not.toMatch(/private-not-rendered|Место подтверждено|Оплата тренеру/);
  });
  it("keeps trainer identity, full and cancelled states separate", () => {
    const full = { ...game, activityKind: "trainer_led" as const, trainer: { profileId: "trainer", displayName: "Ирина Т.", declarationSource: "self_declared" as const }, availablePlaces: 0 };
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: full }));
    expect(html).toContain("С тренером"); expect(html).toContain("Ирина Т."); expect(html).toContain("Мест нет");
    expect(html).toContain(game.organizer.displayName);
    expect(html).toContain("Тренер · самостоятельно указано");
    expect(html).toContain("Организатор");
    expect(renderToStaticMarkup(createElement(DiscoveryGameCard, { game: { ...game, status: "cancelled" } }))).toContain("Игра отменена");
  });
});


describe("Owner all-upcoming discovery", () => {
  it("keeps the unset date lower-bounded only, and restores it after date selection", () => {
    const now = Date.parse("2030-01-01T10:00:00Z");
    expect(futureDiscoveryBounds("", "Europe/Moscow", now)).toEqual({ startsFrom: "2030-01-01T10:00:00.000Z" });
    expect(futureDiscoveryBounds("2030-01-02", "Europe/Moscow", now)).toEqual({ startsFrom: "2030-01-01T21:00:00.000Z", startsBefore: "2030-01-02T21:00:00.000Z" });
    expect(futureDiscoveryBounds("", "Europe/Moscow", now)).not.toHaveProperty("startsBefore");
  });
  it("removes past, exactly-started and invalid items while preserving API order across dates", () => {
    const now = Date.parse("2030-01-01T10:00:00Z");
    const items = ["2029-12-31T12:00:00Z", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", "2030-01-02T12:00:00Z", "invalid"].map(startsAt => ({ startsAt }));
    expect(futureDiscoveryItems(items, now).map(g => g.startsAt)).toEqual(["2030-01-01T11:00:00Z", "2030-01-02T12:00:00Z"]);
  });
});
