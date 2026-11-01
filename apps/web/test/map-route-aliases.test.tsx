import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapAlias = readFileSync(join(root, "src/app/games/map/page.tsx"), "utf8");
const venuesAlias = readFileSync(join(root, "src/app/venues/page.tsx"), "utf8");
const gameRoute = readFileSync(join(root, "src/app/games/[gameId]/page.tsx"), "utf8");
const venueMapLib = readFileSync(join(root, "src/lib/games-venue-map.ts"), "utf8");

describe("map / venues compatibility aliases (#445 C)", () => {
  it("static /games/map and /venues redirect only to canonical map view", () => {
    expect(mapAlias).toContain('redirect("/games?view=map")');
    expect(venuesAlias).toContain('redirect("/games?view=map")');
    expect(mapAlias).not.toMatch(/GameDetailPage|getGame|\/v1\/games/);
    expect(venuesAlias).not.toMatch(/GameDetailPage|getGame|\/v1\/games/);
    // No open redirect / query forwarding into arbitrary destinations.
    expect(mapAlias).not.toMatch(/searchParams|returnTo|redirect\([^"]/);
    expect(venuesAlias).not.toMatch(/searchParams|returnTo|redirect\([^"]/);
  });

  it("venue back helper still falls back to /games?view=map with privacy guards", () => {
    expect(venueMapLib).toContain('return "/games?view=map"');
    expect(venueMapLib).toMatch(/gamesMapReturnPath/);
    expect(venueMapLib).toMatch(/\^\\\/\(\?:games\|players\\\/radar\)\(\?:\\\?\|\$\)/);
  });

  it("game route rejects non-UUID ids before detail mount; accepts UUID shape case-insensitively", () => {
    expect(gameRoute).toContain("notFound()");
    expect(gameRoute).toContain("GAME_ID_UUID");
    expect(gameRoute).toMatch(/\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$/i);
    expect(gameRoute).toContain("GameDetailPage");
    // Literal legacy segment "map" is a static sibling route, not a game id fetch.
    expect(mapAlias).toContain("redirect");
    expect(gameRoute).not.toMatch(/version.*[1-5]|variant|clock_seq/);
  });
});
