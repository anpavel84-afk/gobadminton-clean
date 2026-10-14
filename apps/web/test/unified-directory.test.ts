import { describe, expect, it, vi } from "vitest";
import type { UnifiedSnapshot, UnifiedRow, UnifiedDistance } from "@gobadminton/contracts";
import { UnifiedDirectoryController, distanceText, scopedCatalogCursor } from "../src/lib/unified-directory";
import { candidateMapAllowed, MOSCOW_BUNDLE, allowedMapResource } from "../src/lib/radar-map-assets";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch } from "../src/lib/api-client";
const now = Date.parse("2030-01-01T00:00:00Z");
const ok = (data: unknown) => ({ ok: true as const, status: 200, data });
const row = (id: string) => ({ publicPlayerId: id, projection: "directory", player: { publicPlayerId: id, displayName: id }, radar: null }) as UnifiedRow;
function snapshot(items: UnifiedRow[] = [row("first")]): UnifiedSnapshot {
  return { contractVersion: "players-unified-radar-v1", cityId: MOSCOW_BUNDLE.cityId, exposureMode: "synthetic_demo", generatedAt: new Date(now).toISOString(), validUntil: new Date(now + 45000).toISOString(), query: { queryRef: "context", originState: "none", originRef: null, ordering: "radar_city_then_directory", asOf: new Date(now).toISOString() }, items, map: { availability: "missing", mapId: null, version: null }, page: { returnedCount: items.length, rankStart: 1, rankEnd: items.length, hasMore: true, nextCursor: "page2" } } as UnifiedSnapshot;
}
const me = { id: "viewer", csrfToken: "csrf" } as Me;
const filters = { cityId: MOSCOW_BUNDLE.cityId };
describe("ordinary pagination follows the exact visible city and Radar state", () => {
  const allCities = JSON.stringify({ city: "", areaKey: "", name: "", lookingOnly: false, trainerOnly: false, radarOn: false });
  const moscowRadar = JSON.stringify({ city: MOSCOW_BUNDLE.cityId, areaKey: "", name: "", lookingOnly: false, trainerOnly: false, radarOn: true });
  const oldPage = { scope: allCities, value: "all-cities-page-2" };
  const moscowPage = { scope: moscowRadar, value: "moscow-page-2" };
  it("drops both previous page and next-cursor when Radar changes scope", () => {
    expect(scopedCatalogCursor(oldPage, allCities)).toBe("all-cities-page-2");
    expect(scopedCatalogCursor(oldPage, moscowRadar)).toBeNull();
    expect(scopedCatalogCursor(moscowPage, allCities)).toBeNull();
    expect(scopedCatalogCursor(null, moscowRadar)).toBeNull();
  });
  it("also invalidates pagination on ordinary filter changes without a Radar toggle", () => {
    const nameChanged = JSON.stringify({ city: "", areaKey: "", name: "Anna", lookingOnly: false, trainerOnly: false, radarOn: false });
    expect(scopedCatalogCursor(oldPage, nameChanged)).toBeNull();
  });
});
describe("unified directory privacy and global pagination", () => {
  it("keeps page order from the full-set server context, with no cap20 concatenation", async () => {
    const request = vi.fn(async (_path, init) => ok(JSON.parse(init.body).cursor ? { ...snapshot([row("server-rank51"), row("tail")]), page: { nextCursor: null } } : snapshot(Array.from({ length: 50 }, (_, i) => row(`rank${i + 1}`))))) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => now); c.bind(me); await c.query(filters); await c.more();
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual([...Array.from({ length: 50 }, (_, i) => `rank${i + 1}`), "server-rank51", "tail"]);
    expect(JSON.parse(vi.mocked(request).mock.calls[1]![1]!.body as string)).toMatchObject({ queryRef: "context", cursor: "page2" });
  });
  it("cannot repaint a late response after STOP, background or account switch", async () => {
    for (const action of ["stop", "hidden", "identity"] as const) {
      let resolve!: (v: ReturnType<typeof ok>) => void;
      const pending = new Promise<ReturnType<typeof ok>>(r => { resolve = r; });
      const request = vi.fn(async () => pending) as typeof apiFetch;
      const c = new UnifiedDirectoryController(request, () => now); c.bind(me); const read = c.query(filters);
      if (action === "stop") c.ordinary(); else if (action === "hidden") c.visibility(false); else c.bind({ ...me, id: "another" });
      resolve(ok(snapshot())); await read; expect(c.view.rows).toEqual([]); expect(c.view.snapshot).toBeNull();
    }
  });
  it("drops the old pending response on a changed filter and rereads latest after cooldown", async () => {
    let time = now;
    let resolveFirst!: (v: ReturnType<typeof ok>) => void;
    const first = new Promise<ReturnType<typeof ok>>(resolve => { resolveFirst = resolve; });
    const request = vi.fn()
      .mockImplementationOnce(async () => first)
      .mockImplementationOnce(async () => ok({ ...snapshot([row("new-filter-only")]), validUntil: new Date(time + 45000).toISOString() })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    const oldRead = c.query(filters, { kind: "current_activation", activationId: "active" }, "active:1");
    const newest = { ...filters, trainer: true };
    await c.query(newest, { kind: "current_activation", activationId: "active" }, "active:1");
    resolveFirst(ok(snapshot([row("old-filter")]))); await oldRead;
    expect(c.view.rows).toEqual([]); expect(c.view.snapshot).toBeNull();
    expect(c.view.mode).toBe("ordinary"); expect(request).toHaveBeenCalledTimes(1);
    time += 30000;
    await c.query(newest, { kind: "current_activation", activationId: "active" }, "active:1");
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["new-filter-only"]);
    expect(JSON.parse(vi.mocked(request).mock.calls[1]![1]!.body as string).filters).toMatchObject({ trainer: true });
  });
  it("clears the complete context on stale page2 and never appends a new epoch", async () => {
    let calls = 0;
    const request = vi.fn(async () => ++calls === 1 ? ok(snapshot()) : ({ ok: false, status: 409, error: "stale" })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => now); c.bind(me); await c.query(filters); await c.more();
    expect(c.view.stale).toBe(true); expect(c.view.rows).toEqual([]);
  });
  it("purges expired geometry/proofs at the server deadline, without new GPS", async () => {
    let time = now; const request = vi.fn(async () => ok(snapshot())) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me); await c.query(filters);
    time += 45000; c.tick(); expect(c.view.snapshot).toBeNull(); expect(c.view.rows).toEqual([]); expect(request).toHaveBeenCalledTimes(1);
  });
  it("matches the exact viewer activation version and retains it through reference-based refresh", async () => {
    let time = now;
    const data = { ...snapshot(), query: { ...snapshot().query, originState: "authorized", originRef: "private-reference" } };
    const request = vi.fn(async () => ok({ ...data, validUntil: new Date(time + 45000).toISOString() })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.matches(filters, "activation:1")).toBe(true); expect(c.matches(filters, "activation:2")).toBe(false);
    time += 30000; await c.refresh();
    expect(c.matches(filters, "activation:1")).toBe(true);
    expect(JSON.parse(vi.mocked(request).mock.calls[1]![1]!.body as string).origin).toEqual({ kind: "reference", originRef: "private-reference" });
  });
  it("recovers an expired private route context with the live activation and rate limit", async () => {
    let time = now; const request = vi.fn(async () => ok({ ...snapshot(), validUntil: new Date(time + 45000).toISOString() })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(request).toHaveBeenCalledTimes(1); expect(c.view.snapshot).not.toBeNull();
    time += 45000; c.tick(); expect(c.matches(filters, "activation:1")).toBe(false);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(request).mock.calls[1]![1]!.body as string).origin).toEqual({ kind: "current_activation", activationId: "activation" });
    expect(c.matches(filters, "activation:1")).toBe(true);
  });
  it("respects initial-query cooldown on filter changes and carries no old cursor", async () => {
    const request = vi.fn(async () => ok(snapshot())) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => now); c.bind(me); await c.query(filters); await c.query({ ...filters, trainer: true });
    expect(c.view.rows).toEqual([]); expect(c.view.stale).toBe(true); expect(request).toHaveBeenCalledTimes(1);
  });
});
describe("distance and map authority", () => {
  const estimate = (meters: number, step: 100 | 500 | 1000 = 100) => ({ kind: "estimate", roundedMeters: meters, roundingStepMeters: step }) as UnifiedDistance;
  it("displays accepted rounded meters/km with approximation, comma, and near-zero range", () => {
    expect(distanceText(estimate(400))).toBe("≈ 400 м"); expect(distanceText(estimate(1800))).toBe("≈ 1,8 км"); expect(distanceText(estimate(5000, 1000))).toBe("≈ 5 км");
    expect(distanceText({ kind: "range", upperMeters: 4000, roundingStepMeters: 1000 } as UnifiedDistance)).toBe("Рядом · до 4 км (примерно)"); expect(distanceText(null)).toBeNull();
  });
  it("never interprets missing registration as public map approval", () => {
    const preview = { ...snapshot(), map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version } } as UnifiedSnapshot;
    expect(candidateMapAllowed(preview, "https://gobadminton.ru")).toBe(false);
    expect(candidateMapAllowed(preview, "http://localhost:3001")).toBe(false);
    expect(candidateMapAllowed(snapshot(), "https://dev.gobadminton.ru")).toBe(false);
    expect(candidateMapAllowed(preview, "https://dev.gobadminton.ru")).toBe(true);
    expect(candidateMapAllowed({ ...preview, exposureMode: "authenticated_live" }, "https://dev.gobadminton.ru")).toBe(true);
    expect(candidateMapAllowed({ ...preview, cityId: "other" }, "https://dev.gobadminton.ru")).toBe(false);
    expect(candidateMapAllowed({ ...preview, map: { ...preview.map, version: "wrong" } } as unknown as UnifiedSnapshot, "https://dev.gobadminton.ru")).toBe(false);
    expect(allowedMapResource(MOSCOW_BUNDLE.prefix + "style.json")).toBe(true); expect(allowedMapResource("https://evil.example/tiles")).toBe(false); expect(allowedMapResource(MOSCOW_BUNDLE.prefix + "../other/style.json")).toBe(false);
  });
});
