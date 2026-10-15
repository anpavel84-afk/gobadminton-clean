import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listAllUpcomingCityGames } from "../src/lib/api-client";
beforeEach(() => vi.stubGlobal("window", {}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const game = (id: string) => ({ id, venue: { id: "venue-id", cityId: "city" } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
it("merges all pages by immutable ID with one stable upcoming lower bound", async () => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const parsed = new URL(url, "https://example.test"); requests.push(parsed);
    return response(parsed.searchParams.has("cursor") ? { items: [game("a"), game("b")], nextCursor: null } : { items: [game("a")], nextCursor: "next" });
  }));
  const result = await listAllUpcomingCityGames("city");
  expect(result.ok && result.data.map(g => g.id)).toEqual(["a", "b"]);
  expect(requests[0].searchParams.get("startsFrom")).toBe(requests[1].searchParams.get("startsFrom"));
});
it("rejects repeated cursor instead of presenting a partial count", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ items: [game("a")], nextCursor: "repeat" })));
  expect((await listAllUpcomingCityGames("city")).ok).toBe(false);
});
it("discards partial data after an offline page failure", async () => {
  let count = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++count === 1 ? response({ items: [game("a")], nextCursor: "next" }) : response({ title: "Unavailable" }, 503)));
  expect((await listAllUpcomingCityGames("city")).ok).toBe(false);
});
