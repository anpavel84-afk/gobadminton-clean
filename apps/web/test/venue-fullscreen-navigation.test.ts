import { expect, it } from "vitest";
import { gamesMapReturnPath, markerActivation, venueMapPath } from "../src/lib/games-venue-map";

it("opens the exact existing full-page venue route with date and map return context", () => {
  const back = "/games?view=map&day=2026-10-18&activity=regular";
  const url = new URL(venueMapPath("venue/id", "2026-10-18", back), "https://example.test");
  expect(url.pathname).toBe("/venues/venue%2Fid");
  expect(url.searchParams.get("day")).toBe("2026-10-18");
  expect(url.searchParams.get("returnTo")).toBe(back);
  for (const unsafe of ["https://other.test", "//other.test", "/games/other", "/games-extra"]) {
    expect(gamesMapReturnPath(unsafe)).toBe("/games?view=map");
  }
});
it("allows clicks and keyboard but suppresses drag and cancelled pointer clicks", () => {
  const gesture = markerActivation();
  gesture.start(10, 10); gesture.move(12, 11); expect(gesture.allow(1)).toBe(true);
  gesture.start(10, 10); gesture.move(40, 10); gesture.move(10, 10);
  expect(gesture.allow(1)).toBe(false);
  expect(gesture.allow(0)).toBe(true);
  gesture.start(10, 10); gesture.cancel(); expect(gesture.allow(1)).toBe(false);
});
