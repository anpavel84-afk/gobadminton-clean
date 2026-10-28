import { afterEach, expect, it, vi } from "vitest";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import {
  mapPreloadEligible,
  preloadGamesMapAssets,
  resetMapPreloadStateForTests,
} from "../src/lib/map-preload";

const DEV_ORIGIN = new URL(MOSCOW_BUNDLE.prefix).origin;
const STYLE_URL = `${MOSCOW_BUNDLE.prefix}style-dev.json`;
const eligible = {
  cityId: MOSCOW_BUNDLE.cityId,
  origin: DEV_ORIGIN,
  online: true,
  saveData: false,
  hidden: false,
};

afterEach(() => {
  resetMapPreloadStateForTests();
  vi.restoreAllMocks();
});

it.each([
  { label: "unsupported city", env: { ...eligible, cityId: "a0000000-0000-4000-8000-000000000002" } },
  { label: "wrong origin", env: { ...eligible, origin: "https://example.test" } },
  { label: "saveData", env: { ...eligible, saveData: true } },
  { label: "offline", env: { ...eligible, online: false } },
  { label: "hidden", env: { ...eligible, hidden: true } },
])("skips preload when $label", async ({ env }) => {
  const warmModule = vi.fn(async () => undefined);
  const fetchStyle = vi.fn();
  expect(mapPreloadEligible(env)).toBe(false);
  await expect(preloadGamesMapAssets({ env, warmModule, fetchStyle })).resolves.toBe("skipped");
  expect(warmModule).not.toHaveBeenCalled();
  expect(fetchStyle).not.toHaveBeenCalled();
});

it("warms the module and style once across concurrent callers", async () => {
  let resolveWarm!: () => void;
  const warmModule = vi.fn(() => new Promise<void>(resolve => { resolveWarm = resolve; }));
  const fetchStyle = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.credentials).toBe("omit");
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;
  });

  const first = preloadGamesMapAssets({ env: eligible, warmModule, fetchStyle });
  const second = preloadGamesMapAssets({ env: eligible, warmModule, fetchStyle });
  await Promise.resolve();
  expect(warmModule).toHaveBeenCalledOnce();
  resolveWarm();
  await expect(Promise.all([first, second])).resolves.toEqual(["done", "done"]);
  expect(warmModule).toHaveBeenCalledOnce();
  expect(fetchStyle).toHaveBeenCalledOnce();
  expect(fetchStyle.mock.calls[0]?.[0]).toBe(STYLE_URL);

  await expect(preloadGamesMapAssets({ env: eligible, warmModule, fetchStyle })).resolves.toBe("done");
  expect(warmModule).toHaveBeenCalledOnce();
  expect(fetchStyle).toHaveBeenCalledOnce();
});

it("allows a later intent retry after an optional preload failure", async () => {
  const warmModule = vi.fn(async () => undefined);
  const fetchStyle = vi.fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

  await expect(preloadGamesMapAssets({ env: eligible, warmModule, fetchStyle })).resolves.toBe("failed");
  await expect(preloadGamesMapAssets({ env: eligible, warmModule, fetchStyle })).resolves.toBe("done");
  expect(warmModule).toHaveBeenCalledOnce();
  expect(fetchStyle).toHaveBeenCalledTimes(2);
});

it("returns aborted without marking style success when the caller signal aborts", async () => {
  const abort = new AbortController();
  abort.abort();
  const warmModule = vi.fn(async () => undefined);
  const fetchStyle = vi.fn();
  await expect(preloadGamesMapAssets({
    env: eligible, warmModule, fetchStyle, signal: abort.signal,
  })).resolves.toBe("aborted");
  expect(warmModule).not.toHaveBeenCalled();
  expect(fetchStyle).not.toHaveBeenCalled();

  await expect(preloadGamesMapAssets({
    env: eligible,
    warmModule,
    fetchStyle: vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) as Response),
  })).resolves.toBe("done");
});
