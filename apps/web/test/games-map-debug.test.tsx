import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useState(initial: unknown) {
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }];
  },
  useEffect(effect: () => void) { h.cursor++; h.effects.push(effect); },
}));
import { logMapEvent, mapLogEntries } from "../src/lib/games-map-debug";
import { GamesMapDebugPanel } from "../src/components/consumer/games/GamesMapDebugPanel";
function setup(search: string) {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { location: { search } });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  return vi.spyOn(console, "info").mockImplementation(() => {});
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); h.slots = []; h.effects = []; });
it("keeps at most 200 shaped entries and rejects query strings and coordinates", () => {
  const output = setup("?mapdebug=1");
  for (let i = 0; i < 205; i++) logMapEvent("tiles", i);
  const entries = mapLogEntries(); expect(entries).toHaveLength(200);
  expect(entries[0]).toEqual({ t: expect.any(Number), ev: "tiles", detail: 5 });
  logMapEvent("tile-error", "/tile?secret=value"); logMapEvent("tile-error", "55.75,37.62");
  expect(mapLogEntries().slice(-2).map(entry => entry.detail)).toEqual(["redacted", "redacted"]);
  expect(window.__gbMapLog).toHaveLength(200); expect(output).toHaveBeenCalled();
  window.location.search = ""; logMapEvent("idle"); expect(output).toHaveBeenLastCalledWith("[games-map-life]", expect.objectContaining({ ev: "idle" }));
});
it("does not output or append diagnostics when disabled", () => {
  const output = setup(""); const before = mapLogEntries(); logMapEvent("load");
  expect(output).not.toHaveBeenCalled(); expect(window.__gbMapLog).toBeUndefined(); expect(mapLogEntries()).toEqual(before);
});
it.each([true, false])("panel opt-in %s", enabled => {
  setup(enabled ? "?mapdebug=1" : "");
  h.cursor = 0; GamesMapDebugPanel(); h.effects.splice(0).forEach(effect => effect());
  h.cursor = 0; const markup = renderToStaticMarkup(GamesMapDebugPanel());
  if (enabled) { expect(markup).toContain("Скопировать"); expect(markup).toContain("Закрыть"); }
  else expect(markup).toBe("");
});
