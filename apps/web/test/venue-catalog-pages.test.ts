import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAllCityVenues } from "../src/lib/api-client";

const CITY = "a0000000-0000-4000-8000-000000000001";
const venue = (n: number) => ({
  id: String(n), cityId: CITY, name: `Зал ${n}`, address: `Москва ${n}`, timezone: "Europe/Moscow",
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => vi.stubGlobal("window", {})); // Same-origin browser API requests.
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("full Venue catalog pagination", () => {
  it("loads all 82 entries, including 32 on page 2 not represented by Games", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input), "https://gobadminton.ru").searchParams;
      expect(query.get("cityId")).toBe(CITY);
      expect(query.get("limit")).toBe("50");
      if (!query.get("cursor")) {
        return response({ items: Array.from({ length: 50 }, (_, n) => venue(n)), nextCursor: "next-50" });
      }
      expect(query.get("cursor")).toBe("next-50");
      return response({ items: Array.from({ length: 32 }, (_, n) => venue(n + 50)), nextCursor: null });
    });
    vi.stubGlobal("fetch", fetcher);
    const data = await listAllCityVenues(CITY);
    expect(data.ok).toBe(true);
    if (data.ok) {
      expect(data.data).toHaveLength(82);
      expect(data.data.at(-1)?.name).toBe("Зал 81");
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns an error instead of silently showing a partial catalog", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      return call === 1 ? response({ items: [venue(1)], nextCursor: "next" }) :
        response({ code: "FAILED", title: "Fetch error" }, 503);
    }));
    const data = await listAllCityVenues(CITY);
    expect(data.ok).toBe(false);
  });

  it("terminates if the service repeats the same cursor indefinitely", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ items: [venue(1)], nextCursor: "same" })));
    const data = await listAllCityVenues(CITY);
    expect(data.ok).toBe(false);
  });
});
