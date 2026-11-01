import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));
vi.mock("../src/components/consumer/pages/GameDetailPage", () => ({
  GameDetailPage: () => null,
}));
import { redirect, notFound } from "next/navigation";
import MapAlias from "../src/app/games/map/page";
import VenuesAlias from "../src/app/venues/page";
import GamePage from "../src/app/games/[gameId]/page";
import { gamesMapReturnPath } from "../src/lib/games-venue-map";

beforeEach(() => vi.clearAllMocks());
describe("map entrances and invalid game routes (#445)", () => {
  it("redirects both compatibility entrances to the existing map", () => {
    for (const route of [MapAlias, VenuesAlias]) {
      expect(() => route()).toThrow("redirect:/games?view=map");
    }
    expect(redirect).toHaveBeenCalledTimes(2);
  });
  it("terminates invalid game routes before rendering game detail", async () => {
    for (const gameId of ["map", "not-a-game", "https://evil.example"]) {
      await expect(GamePage({ params: Promise.resolve({ gameId }) })).rejects.toThrow("not-found");
    }
    expect(notFound).toHaveBeenCalledTimes(3);
    for (const gameId of ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"]) {
      const page = await GamePage({ params: Promise.resolve({ gameId }) });
      expect(page.props.gameId).toBe(gameId);
    }
    expect(notFound).toHaveBeenCalledTimes(3);
  });
  it("preserves a safe venue return path and rejects an external destination", () => {
    expect(gamesMapReturnPath(null)).toBe("/games?view=map");
    expect(gamesMapReturnPath("/games?view=map&cityId=moscow")).toBe("/games?view=map&cityId=moscow");
    expect(gamesMapReturnPath("https://evil.example")).toBe("/games?view=map");
  });
});
