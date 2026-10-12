import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { gameLocalToIso } from "../src/lib/game-form";
import { canRequestParticipation } from "../src/lib/game-presentation";
import { listAllMyParticipations } from "../src/lib/api-client";
import { GameHero, GameTerms, PersonalGameCard } from "../src/components/consumer/games/GameDetailComposition";
import type { Game, Participation } from "../src/lib/consumer-types";
const game: Game = {
  id: "game", version: 1, title: "Парная игра", status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Организатор", publicContact: "Связь" }, venue: { id: "venue", name: "Зал", address: "Адрес", cityId: "city", timezone: "Europe/Moscow" },
  startsAt: "2035-01-01T16:00:00Z", endsAt: "2035-01-01T18:00:00Z", applicationDeadlineAt: "2035-01-01T15:00:00Z", timezone: "Europe/Moscow", capacity: 8, confirmedCount: 3, externalReservedCount: 1, availablePlaces: 4,
  formatKey: "internal_unknown_v7", levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] }, settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Аренду делим" },
};
const part: Participation = { id: "p", gameId: "game", userId: "user", status: "pending", version: 1, attemptNumber: 1, requestedAt: "2034-01-01T10:00:00Z" };
afterEach(() => { vi.unstubAllGlobals(); });
describe("FR-02 canonical Games", () => {
  it.each([
    ["Europe/Moscow", "2030-06-01T16:00:00.000Z"],
    ["Europe/Berlin", "2030-06-01T17:00:00.000Z"],
    ["Asia/Kolkata", "2030-06-01T13:30:00.000Z"],
  ])("keeps %s local schedule without exposing its identifier in detail or preview", (timezone, startsAt) => {
    const localGame = { ...game, timezone, venue: { ...game.venue, timezone }, startsAt, endsAt: gameLocalToIso("2030-06-01T21:00", timezone) };
    expect(gameLocalToIso("2030-06-01T19:00", timezone)).toBe(startsAt);
    for (const preview of [false, true]) {
      const html = renderToStaticMarkup(<GameHero game={localGame} preview={preview} />);
      expect(html).toContain("Время площадки</small>");
      expect(html).not.toContain(timezone);
      expect(html).toContain("19:00 — 21:00");
    }
  });
  it("preserves Berlin winter offset and the venue calendar date across UTC midnight", () => {
    expect(gameLocalToIso("2030-01-01T19:00", "Europe/Berlin")).toBe("2030-01-01T18:00:00.000Z");
    const startsAt = gameLocalToIso("2030-06-02T00:30", "Europe/Moscow");
    expect(startsAt).toBe("2030-06-01T21:30:00.000Z");
    const html = renderToStaticMarkup(<GameHero game={{ ...game, startsAt, endsAt: "2030-06-01T22:30:00Z" }} />);
    expect(html).toContain("2 июн.");
    expect(html).toContain("00:30 — 01:30");
  });
  it("renders regular and trainer from one family without inventing trainer data", () => {
    const regular = renderToStaticMarkup(<><GameHero game={game} /><GameTerms game={game} /></>);
    expect(regular).toContain("Парная игра"); expect(regular).toContain("19:00");
    expect(regular).not.toContain("internal_unknown_v7"); expect(regular).not.toContain("gb-game-coach");
    expect(regular).not.toContain("воланы включены"); expect(regular).toContain("Аренду делим");
    const trainer = renderToStaticMarkup(<GameTerms game={{ ...game, activityKind: "trainer_led", trainer: { profileId: "t", displayName: "Тренер", declarationSource: "self_declared" } }} />);
    expect(trainer).toContain("gb-game-coach"); expect(trainer).toContain("самостоятельно указано");
  });
  it("cancellation overrides stale confirmed card and pending is never a reserved seat", () => {
    const cancelled = renderToStaticMarkup(<PersonalGameCard game={{ ...game, status: "cancelled" }} ownStatus="confirmed" />);
    expect(cancelled).toContain("Игра отменена"); expect(cancelled).not.toContain("Место подтверждено");
    const pending = renderToStaticMarkup(<PersonalGameCard game={game} ownStatus="pending" />);
    expect(pending).toContain("Место пока не подтверждено"); expect(pending).toContain("Свободно 4 из 8");
  });
  it("converts form time in city timezone including DST and rejects nonexistent times", () => {
    expect(gameLocalToIso("2030-06-01T19:00", "Europe/Moscow")).toBe("2030-06-01T16:00:00.000Z");
    expect(gameLocalToIso("2030-06-01T19:00", "Europe/Berlin")).toBe("2030-06-01T17:00:00.000Z");
    expect(gameLocalToIso("2026-03-29T02:30", "Europe/Berlin")).toBe("");
    expect(gameLocalToIso("", "Europe/Moscow")).toBe("");
  });
  it("does not offer terminal reapply, expired deadline or stale full seat requests", () => {
    expect(canRequestParticipation(game, part)).toBe(false);
    expect(canRequestParticipation(game, { ...part, status: "withdrawn" })).toBe(true);
    for (const status of ["confirmed", "removed", "rejected", "expired", "cancelled_by_game"] as const) expect(canRequestParticipation(game, { ...part, status })).toBe(false);
    expect(canRequestParticipation({ ...game, applicationDeadlineAt: "2000-01-01T10:00:00Z" }, null)).toBe(false);
    expect(canRequestParticipation({ ...game, availablePlaces: 0 }, null)).toBe(false);
  });
  it("reads participation across all pages and fails closed if a later page fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: "next" }))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [part], nextCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", {});
    const result = await listAllMyParticipations(); expect(result.ok && result.data).toEqual([part]); expect(fetcher.mock.calls[1]?.[0]).toContain("cursor=next");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: "next" }))).mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect((await listAllMyParticipations()).ok).toBe(false);
  });
});
