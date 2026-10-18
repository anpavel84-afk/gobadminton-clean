import { expect, it } from "vitest";
import { classifyMapError } from "../src/lib/games-map-diagnostics";
const rendered = { firstRender: true, loadedTiles: 1, sinceLoadMs: 9000 };
it.each(["style", "style-identity", "origin", "webgl", "init", "timeout"])("classifies fatal %s", kind => {
  expect(classifyMapError({ kind }, rendered)).toMatchObject({ kind, fatal: true });
});
it.each(["tiles", "glyph", "sprite", "geojson"])("keeps a single %s failure non-fatal after render", kind => {
  expect(classifyMapError({ kind }, rendered)).toMatchObject({ kind, fatal: false });
});
it("requires zero loaded tiles and the full eight second grace period", () => {
  expect(classifyMapError({ sourceId: "protomaps" }, { loadedTiles: 0, sinceLoadMs: 7999 }).fatal).toBe(false);
  expect(classifyMapError({ sourceId: "protomaps" }, { loadedTiles: 0, sinceLoadMs: 8000 })).toEqual({ kind: "tiles", fatal: true });
  expect(classifyMapError({ sourceId: "protomaps" }, { loadedTiles: 1, sinceLoadMs: 8000 }).fatal).toBe(false);
});
it("reports only a path and numeric status, never credentials, query or token", () => {
  expect(classifyMapError({ error: { url: "pmtiles://https://user:secret@example.test/map/moscow.pmtiles/10/1/2?token=private#secret", status: 503 } }, rendered))
    .toEqual({ kind: "tiles", fatal: false, url: "/map/moscow.pmtiles/10/1/2", status: 503 });
});
it.each([
  ["glyphs/Onest%20Regular/0-255.pbf", "glyph"], ["sprites/sprite.json", "sprite"],
  ["metro.geojson", "geojson"], ["style-dev.json", "style"],
])("recognizes resource %s", (path, kind) => {
  expect(classifyMapError({ error: { url: `https://example.test/${path}` } }, rendered).kind).toBe(kind);
});
