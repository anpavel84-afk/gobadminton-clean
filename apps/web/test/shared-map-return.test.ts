import { expect, it } from "vitest";
import { createRadarEntryCamera } from "../src/lib/radar-camera";
import { gamesMapReturnPath, venueMapPath } from "../src/lib/games-venue-map";

it("preserves exact Radar entry context through an exact venue, without opening arbitrary routes", () => {
  const origin = "/players/radar?cityId=moscow";
  const path = new URL(venueMapPath("zero-games", "2030-01-01", origin), "https://example.test");
  expect(path.pathname).toBe("/venues/zero-games");
  expect(path.searchParams.get("returnTo")).toBe(origin);
  expect(gamesMapReturnPath(path.searchParams.get("returnTo"))).toBe(origin);
  for (const unsafe of ["//evil.test", "/players", "/players/radar/other", "/players/radar-extra", "/players/radar#other", "https://example.test/players/radar"]) {
    expect(gamesMapReturnPath(unsafe)).toBe("/games?view=map");
  }
});

it("R1 fresh entry centres once on the first legitimate publication even with a saved camera", () => {
  const savedCamera = { lng: 38, lat: 56, zoom: 9 };
  const entry = createRadarEntryCamera();
  expect(entry.claim(undefined)).toBeNull(); // delayed server publication does not consume entry
  expect(entry.claim({ latitude: NaN, longitude: savedCamera.lng })).toBeNull();
  const initial = entry.claim({ latitude: 55.75, longitude: 37.61 });
  expect(initial).not.toBeNull();
  // Simulate manual pan, followed by refreshed published position / OFF-ON.
  savedCamera.lng = 37.9;
  expect(entry.claim(undefined)).toBeNull();
  expect(entry.claim({ latitude: 55.76, longitude: 37.62 })).toBeNull();
  expect(createRadarEntryCamera().claim({ latitude: 55.76, longitude: 37.62 })).not.toBeNull();
  expect(createRadarEntryCamera(true).claim({ latitude: 55.76, longitude: 37.62 })).toBeNull();
});
