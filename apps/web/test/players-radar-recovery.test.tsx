/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { confirmedDirectoryActivation, RadarController } from "../src/lib/radar-controller";
import { UnifiedDirectoryController, type RadarConfig } from "../src/lib/unified-directory";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch, ApiResult } from "../src/lib/api-client";
import type { UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { RadarView } from "../src/lib/radar-controller";
const mock = vi.hoisted(() => ({ view: {} as RadarView, rows: [] as UnifiedRow[] }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../src/components/consumer/radar/UnifiedPlayerCard", () => ({ UnifiedPlayerCard: () => <div>PRIVATE RADAR ROW</div> }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useRadarSession: () => ({ controller: {}, view: mock.view }),
  useRadarConfig: () => ({ exposureMode: "live", publishingV2: { enabled: true }, unifiedDirectory: { enabled: true, contractVersion: "players-unified-radar-v1", disclosure: { text: "Consent" } }, cities: [{ cityId: "moscow", regionId: "moscow-region", map: { availability: "missing" } }] }),
  useDirectoryFilters: () => ({ filters: { name: "", areaKey: "", cityId: "moscow", lookingOnly: false, trainerOnly: false }, update: vi.fn() }),
  // Snapshot generatedAt+30s is refresh-due; validUntil 2099 keeps authorized window renderable.
  useUnifiedDirectory: () => ({ controller: { matches: () => false, renderable: () => true }, view: { mode: "unified", snapshot: { contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "authenticated_live", cityId: "moscow", regionId: "moscow-region", generatedAt: "2026-10-15T00:00:00Z", validUntil: "2099-01-01", refreshAfterSeconds: 30, query: { queryRef: "context", originState: "authorized", originRef: "origin", ordering: "radar_distance_then_directory", asOf: "2026-10-15T00:00:00Z" }, map: { availability: "missing", mapId: null, version: null }, items: mock.rows, page: { returnedCount: mock.rows.length, rankStart: 1, rankEnd: mock.rows.length, hasMore: false, nextCursor: null }, totals: { matchingTotal: 1, radarTotal: 1, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" } } satisfies UnifiedSnapshot, rows: mock.rows, busy: false, notice: "Расстояние приблизительное, по опубликованным геопозициям.", stale: false, authenticationRequired: false, capabilityUnavailable: false } }),
}));
import { PlayersDirectoryPage, useRadarSearchEpisode } from "../src/components/consumer/pages/PlayersDirectoryPage";
it("Players keeps fixed controls, map CTA when active, and hides private rows after error", () => {
  mock.view = { phase: "off", confirmedOn: false, now: 0 } as RadarView;
  const off = renderToStaticMarkup(<PlayersDirectoryPage />);
  // Mobile compact directory-desktop switch (no giant «Игроки рядом» card / in-band status paragraphs).
  expect(off).toContain("Включить Radar");
  expect(off).toContain('role="switch"');
  expect(off).toContain('aria-label="Radar"');
  expect(off).not.toContain("Игроки рядом с вами");
  expect(off).not.toContain("Временный поиск по приблизительной близости");
  mock.view = { ...mock.view, phase: "disabled" };
  const disabled = renderToStaticMarkup(<PlayersDirectoryPage />);
  // Disabled: switch stays readable but disabled; header owns unavailable copy (directory-compact).
  expect(disabled).toContain('role="switch"');
  expect(disabled).toContain("disabled");
  expect(disabled).toContain("Включить Radar");
  mock.view = { ...mock.view, phase: "active", confirmedOn: true, status: { state: "active", contractVersion: "players-unified-radar-v1", activationId: "a", expiresAt: "2099-01-01", hardExpiresAt: "2099-01-01", foregroundUntil: "2099-01-01", locationValidUntil: "2099-01-01" } } as RadarView;
  mock.rows = [{ publicPlayerId: "private", projection: "radar_public", player: { publicPlayerId: "private", displayName: "Private", cityId: "moscow", areaKey: null, level: null, trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false }, radar: { resultId: "result", resultRef: "proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: "2099-01-01", distance: null, geo: { latitude: 55.75, longitude: 37.61, crs: "EPSG:4326", model: "regional_grid_1000m_v1", gridSizeMeters: 1000, uncertaintyMeters: 1000, quality: "approximate", sourceTimestampBucket: "2026-10-15T00:00:00Z", sourceAgeSeconds: 0 } } }];
  const active = renderToStaticMarkup(<PlayersDirectoryPage />);
  expect(active).toContain("PRIVATE RADAR ROW");
  expect(active).toContain("Игроки на карте");
  expect(active).toContain('href="/players/radar"');
  expect(active).toContain("Radar включён");
  expect(active).toContain('aria-checked="true"');
  // In-flow approximate-distance / session rows and Extend removed — header owns them.
  expect(active).not.toContain("Подтверждённый срок Radar");
  expect(active).not.toContain("Расстояние приблизительное, по опубликованным геопозициям");
  expect(active).not.toContain("Продлить");
  mock.view = { ...mock.view, phase: "error" };
  mock.rows = mock.rows.map(row => ({ ...row, publicPlayerId: "refreshed-private", player: { ...row.player, publicPlayerId: "refreshed-private" } })); // A directory refresh arrives with retained active status.
  const html = renderToStaticMarkup(<PlayersDirectoryPage />);
  // Error: private rows + map CTA gated; recovery actions stay in header (directory-compact), switch keeps phase label.
  expect(html).toContain("Проверьте статус Radar");
  expect(html).not.toContain("PRIVATE RADAR ROW");
  expect(html).not.toContain("Игроки на карте");
});


afterEach(() => { cleanup(); vi.useRealTimers(); });
const episodeFilters = { cityId: "moscow" };
const episodeKey = JSON.stringify(episodeFilters);
const episodeMe = { id: "viewer", csrfToken: "test-csrf" } as Me;
const episodeConfig: RadarConfig = {
  exposureMode: "live", publishingV2: { enabled: true }, cities: [],
  unifiedDirectory: { enabled: true, contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", pageLimit: 50, mapPageLimit: 100, models: ["regional_grid_100m_v1"], disclosure: { id: "test", sha256: "test", text: "Consent", locale: "ru" } },
};
async function episodeHarness(initial: "off" | "active" = "off", deferActivation = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const stamp = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  const active = { state: "active", activationId: "activation", version: 1, contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "live", ownerHere: true, startedAt: stamp(0), expiresAt: stamp(900), hardExpiresAt: stamp(1800), foregroundUntil: stamp(90), locationValidUntil: stamp(360), nextLocationUpdateAt: stamp(300) };
  let resolveRead!: (value: ApiResult<UnifiedSnapshot>) => void;
  const pending = new Promise<ApiResult<UnifiedSnapshot>>(resolve => { resolveRead = resolve; });
  let resolveStop!: (value: ApiResult<unknown>) => void;
  const stop = new Promise<ApiResult<unknown>>(resolve => { resolveStop = resolve; });
  let resolveActivation!: (value: ApiResult<unknown>) => void;
  const activation = new Promise<ApiResult<unknown>>(resolve => { resolveActivation = resolve; });
  const sourceRequest = vi.fn(async (path: string, init?: { method?: string }) => {
    if (path === "/v1/me") return { ok: true, status: 200, data: episodeMe };
    if (init?.method === "DELETE") return stop;
    if (deferActivation && path === "/v1/me/radar/activations" && init?.method === "POST") return activation;
    return { ok: true, status: 200, data: path.endsWith("/current") && !init?.method ? { ...active, state: initial } : active };
  }) as unknown as typeof apiFetch;
  const controller = new RadarController(sourceRequest); controller.setResultView("none"); controller.configure(episodeConfig);
  await controller.reconcile();
  const readRequest = vi.fn(async () => pending) as typeof apiFetch;
  const unified = new UnifiedDirectoryController(readRequest); unified.bind(episodeMe);
  const fix = async () => ({ latitude: 55.75, longitude: 37.61, accuracyMeters: 25, capturedAt: stamp(0) });
  const data = (radarTotal = 0): UnifiedSnapshot => ({
    contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "authenticated_live", cityId: "moscow", regionId: "moscow", generatedAt: stamp(0), validUntil: stamp(45), refreshAfterSeconds: 30,
    query: { queryRef: "fresh", originState: "none", originRef: null, ordering: "radar_city_then_directory", asOf: stamp(0) },
    items: [], page: { returnedCount: 0, rankStart: 0, rankEnd: 0, hasMore: false, nextCursor: null },
    totals: { matchingTotal: radarTotal, radarTotal, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" }, map: { availability: "missing", mapId: null, version: null },
  });
  const start = async () => { await act(async () => { controller.permission(); await controller.activate(fix); }); };
  return { controller, unified, readRequest, sourceRequest, resolveRead, resolveStop, resolveActivation, active, data, fix, start };
}
describe("R2 page-owned explicit search episode", () => {
  it("ignores historical ON admission, ordinary refresh and renew", async () => {
    const h = await episodeHarness("active");
    h.controller.view = { ...h.controller.view, admittedStartSequence: 7 };
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    expect(hook.result.current.display).toBeNull();
    await act(async () => { await h.controller.activate(h.fix, "renew"); });
    expect(h.controller.view.admittedStartSequence).toBe(7);
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: h.data() }); await read; });
    expect(hook.result.current.display).toBeNull();
  });
  it("arms through the shared header permission entry, waits for geo, then settles zero immediately", async () => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    act(() => h.controller.permission());
    expect(hook.result.current.display).toBeNull();
    expect(h.controller.view.admittedStartSequence).toBe(1);
    await act(async () => { await h.controller.activate(h.fix); });
    expect(hook.result.current.display).toBe("loading");
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    expect(hook.result.current.display).toBe("loading");
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: h.data() }); await read; });
    expect(hook.result.current.display).toBe("zero");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits beyond 15s for activation POST confirmation before starting search and its watchdog", async () => {
    const h = await episodeHarness("off", true);
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    let activation!: Promise<void>;
    await act(async () => { h.controller.permission(); activation = h.controller.activate(h.fix); });
    expect(h.sourceRequest).toHaveBeenCalledWith("/v1/me/radar/activations", expect.objectContaining({ method: "POST" }));
    expect(vi.mocked(h.sourceRequest).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.controller.view.phase).toBe("activating");
    expect(h.controller.view.confirmedOn).toBe(false);
    expect(confirmedDirectoryActivation(h.controller.snapshot())).toBeNull();
    expect(hook.result.current.display).toBeNull();
    expect(hook.result.current.observeFirstRead()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    const sourceCalls = vi.mocked(h.sourceRequest).mock.calls.length;
    act(() => vi.advanceTimersByTime(16000));
    expect(h.controller.view.phase).toBe("activating");
    expect(h.controller.view.confirmedOn).toBe(false);
    expect(hook.result.current.display).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.sourceRequest).toHaveBeenCalledTimes(sourceCalls);
    expect(h.readRequest).not.toHaveBeenCalled();
    await act(async () => { h.resolveActivation({ ok: true, status: 200, data: h.active }); await activation; });
    expect(h.controller.view.phase).toBe("active");
    expect(h.controller.view.confirmedOn).toBe(true);
    expect(confirmedDirectoryActivation(h.controller.snapshot())).toBe("activation");
    expect(hook.result.current.display).toBe("loading");
    expect(vi.getTimerCount()).toBe(1);
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    act(() => vi.advanceTimersByTime(14999));
    expect(hook.result.current.display).toBe("loading");
    expect(h.readRequest).toHaveBeenCalledTimes(1);
    const fresh = h.data();
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: fresh }); await read; });
    expect(h.unified.view.snapshot).toBe(fresh);
    expect(hook.result.current.display).toBe("zero");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([503, 0])("keeps failed activation POST (%s) in Radar controls without inline search or watchdog", async status => {
    const h = await episodeHarness("off", true);
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    let activation!: Promise<void>;
    await act(async () => { h.controller.permission(); activation = h.controller.activate(h.fix); });
    expect(h.sourceRequest).toHaveBeenCalledWith("/v1/me/radar/activations", expect.objectContaining({ method: "POST" }));
    expect(vi.mocked(h.sourceRequest).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.controller.view.phase).toBe("activating");
    expect(hook.result.current.display).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const sourceCalls = vi.mocked(h.sourceRequest).mock.calls.length;
    act(() => vi.advanceTimersByTime(16000));
    expect(h.controller.view.confirmedOn).toBe(false);
    expect(hook.result.current.display).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { h.resolveActivation({ ok: false, status, error: status ? "unavailable" : "unknown" }); await activation; });
    expect(h.controller.view.phase).toBe("error");
    expect(h.controller.view.notice).toBe("Не удалось проверить Radar. Проверьте статус перед следующим действием.");
    expect(h.controller.view.confirmedOn).toBe(false);
    expect(confirmedDirectoryActivation(h.controller.snapshot())).toBeNull();
    expect(hook.result.current.display).toBeNull();
    expect(hook.result.current.observeFirstRead()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16000));
    expect(hook.result.current.display).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.sourceRequest).toHaveBeenCalledTimes(sourceCalls);
    expect(h.readRequest).not.toHaveBeenCalled();
  });
  it("watchdog only ends display; a matching late read clears fallback and commits the same list", async () => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    await h.start();
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    const signal = vi.mocked(h.readRequest).mock.calls[0]![1]!.signal;
    act(() => vi.advanceTimersByTime(15000));
    expect(hook.result.current.display).toBe("slow");
    expect(signal?.aborted).toBe(false); expect(h.controller.view.confirmedOn).toBe(true);
    expect(h.readRequest).toHaveBeenCalledTimes(1);
    const fresh = h.data(1);
    fresh.items = [{
      publicPlayerId: "late-peer", projection: "radar_public",
      player: { publicPlayerId: "late-peer", displayName: "Late peer", cityId: "moscow", areaKey: null, level: null, trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
      radar: { resultId: "late-result", resultRef: "test-proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: fresh.validUntil, distance: null, geo: { latitude: 55.75, longitude: 37.61, crs: "EPSG:4326", model: "regional_grid_1000m_v1", gridSizeMeters: 1000, uncertaintyMeters: 1000, quality: "approximate", sourceTimestampBucket: fresh.generatedAt, sourceAgeSeconds: 0 } },
    }];
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: fresh }); await read; });
    expect(hook.result.current.display).toBeNull();
    expect(h.unified.view.snapshot).toBe(fresh); expect(h.unified.view.rows).toEqual(fresh.items);
    expect(h.readRequest).toHaveBeenCalledTimes(1);
  });
  it("reused pending is fallback rather than false success", async () => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey));
    await h.start();
    let foreign!: Promise<void>;
    act(() => { foreign = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1"); });
    await act(async () => { await h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    expect(hook.result.current.display).toBe("error");
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: h.data() }); await foreign; });
    expect(hook.result.current.display).toBe("error");
    expect(h.readRequest).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["failure", "invalid"] as const)("first matching %s settles without waiting for watchdog", async outcome => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey)); await h.start();
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    await act(async () => { h.resolveRead(outcome === "failure" ? { ok: false, status: 503, error: "unavailable" } : { ok: true, status: 200, data: null as unknown as UnifiedSnapshot }); await read; });
    expect(hook.result.current.display).toBe("error"); expect(vi.getTimerCount()).toBe(0);
  });
  it("physical OFF removes display while stop remains unresolved, and late READ cannot resurrect it", async () => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey)); await h.start();
    let read!: Promise<void>; let stop!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    act(() => { stop = h.controller.stop(); h.unified.ordinary(); });
    expect(hook.result.current.display).toBeNull(); expect(h.controller.view.confirmedOn).toBe(true); expect(h.controller.view.pendingStop).toBe(true);
    await act(async () => { h.resolveRead({ ok: true, status: 200, data: h.data() }); await read; h.resolveStop({ ok: false, status: 0, error: "unknown" }); await stop; });
    expect(hook.result.current.display).toBeNull(); expect(h.unified.view.rows).toEqual([]);
    expect(h.controller.view.pendingStop).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("unmount removes the watchdog without cancelling a current read", async () => {
    const h = await episodeHarness();
    const hook = renderHook(() => useRadarSearchEpisode(h.controller, h.unified, episodeKey)); await h.start();
    let read!: Promise<void>;
    act(() => { read = h.unified.query(episodeFilters, { kind: "current_activation", activationId: "activation" }, "activation:1", hook.result.current.observeFirstRead()); });
    const signal = vi.mocked(h.readRequest).mock.calls[0]![1]!.signal;
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0); expect(signal?.aborted).toBe(false);
    h.resolveRead({ ok: true, status: 200, data: h.data() }); await read;
    expect(h.unified.renderable(episodeFilters, "activation:1")).toBe(true);
  });
  it("denial and scope replacement retire the display generation", async () => {
    const h = await episodeHarness();
    const hook = renderHook(({ scope }) => useRadarSearchEpisode(h.controller, h.unified, scope), { initialProps: { scope: episodeKey } });
    act(() => h.controller.permission());
    await act(async () => { await h.controller.activate(async () => { throw { code: 1 }; }); });
    expect(hook.result.current.display).toBeNull();
    await h.start(); expect(hook.result.current.display).toBe("loading");
    const oldObserver = hook.result.current.observeFirstRead();
    hook.rerender({ scope: JSON.stringify({ cityId: "moscow", trainer: true }) });
    expect(hook.result.current.display).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    act(() => { oldObserver?.({ type: "settled", token: 1, scope: { filterKey: episodeKey, activationKey: "activation:1" }, outcome: "success" }); });
    expect(hook.result.current.display).toBeNull();
    hook.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
