import { describe, expect, it, vi } from "vitest";
import type { UnifiedPreview, UnifiedUpcomingGame, UnifiedSnapshot, UnifiedRow, UnifiedDistance } from "@gobadminton/contracts";
import { UnifiedDirectoryController, distanceText, liveUnifiedPreview, scopedCatalogCursor } from "../src/lib/unified-directory";
import { candidateMapAllowed, candidateMapConfigAllowed, MOSCOW_BUNDLE, allowedMapResource } from "../src/lib/radar-map-assets";
import type { RadarConfig } from "../src/lib/unified-directory";
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
describe("ordinary pagination follows only the ordinary filters", () => {
  const allCities = JSON.stringify({ city: "", areaKey: "", name: "", lookingOnly: false, trainerOnly: false });
  const moscow = JSON.stringify({ city: MOSCOW_BUNDLE.cityId, areaKey: "", name: "", lookingOnly: false, trainerOnly: false });
  const oldPage = { scope: allCities, value: "all-cities-page-2" };
  it("preserves All cities page2 across Radar OFF/ON, but not a city change", () => {
    expect(scopedCatalogCursor(oldPage, allCities)).toBe("all-cities-page-2");
    expect(scopedCatalogCursor(oldPage, moscow)).toBeNull();
    // A city/filter transition clears saved tokens; returning to A starts fresh.
    const cleared = null;
    expect(scopedCatalogCursor(cleared, allCities)).toBeNull();
  });
  it("invalidates pagination on name filters", () => {
    const nameChanged = JSON.stringify({ city: "", areaKey: "", name: "Anna", lookingOnly: false, trainerOnly: false });
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
    const config = { exposureMode:"live", unifiedDirectory:{ enabled:true }, cities:[{ cityId:MOSCOW_BUNDLE.cityId,regionId:"moscow",map:{availability:"dev_preview",mapId:"moscow",version:MOSCOW_BUNDLE.version} }] } as RadarConfig;
    expect(candidateMapConfigAllowed(config,MOSCOW_BUNDLE.cityId,"https://dev.gobadminton.ru")).toBe(true);
    expect(candidateMapConfigAllowed(config,MOSCOW_BUNDLE.cityId,"https://gobadminton.ru")).toBe(false);
    expect(candidateMapConfigAllowed(config,"another-city","https://dev.gobadminton.ru")).toBe(false);
    expect(candidateMapConfigAllowed({ ...config, cities:[{ ...config.cities[0]!, map:{ availability:"missing" } }] },MOSCOW_BUNDLE.cityId,"https://dev.gobadminton.ru")).toBe(false);
    expect(candidateMapConfigAllowed(null,MOSCOW_BUNDLE.cityId,"https://dev.gobadminton.ru")).toBe(false);
    expect(allowedMapResource(MOSCOW_BUNDLE.prefix + "style.json")).toBe(true); expect(allowedMapResource("https://evil.example/tiles")).toBe(false); expect(allowedMapResource(MOSCOW_BUNDLE.prefix + "../other/style.json")).toBe(false);
  });
});

describe("player schedule uses the complete selection fence", () => {
  const pin = (name: string): UnifiedRow => {
    const id = name === "A" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002";
    return { publicPlayerId: id, projection: "directory",
      player: { publicPlayerId: id, displayName: name, cityId: MOSCOW_BUNDLE.cityId, areaKey: null,
        level: null, trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
      radar: { resultId: id, resultRef: `u1.proof-${id}`, consentPolicyVersion: "radar-geographic-sharing-v2",
        validUntil: new Date(now + 45000).toISOString(), distance: null,
        geo: { latitude: 55.75, longitude: 37.61, crs: "EPSG:4326", model: "regional_grid_100m_v1", gridSizeMeters: 100,
          uncertaintyMeters: 100, sourceTimestampBucket: new Date(now).toISOString(), sourceAgeSeconds: 1, quality: "approximate" } } };
  };
  const game: UnifiedUpcomingGame = { id: "00000000-0000-4000-8000-000000000001", title: "API schedule", activityKind: "regular",
    startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T02:00:00Z", timezone: "Europe/Moscow",
    cover: { uploadedUrl: null }, venue: { name: "Hall", cover: { uploadedUrl: null } } };
  const preview = (p: UnifiedRow): UnifiedPreview => {
    const { publicPlayerId, displayName, level, trainer, avatar, canRequestContact } = p.player;
    const { consentPolicyVersion, geo, validUntil, distance } = p.radar!;
    return { player: { publicPlayerId, displayName, level, trainer, avatar, canRequestContact }, proximityBand: null,
      radar: { consentPolicyVersion, geo, validUntil, distance }, upcomingGames: [{ ...game }] };
  };
  function deferred() {
    let resolve!: (value: ReturnType<typeof ok>) => void;
    const promise = new Promise<ReturnType<typeof ok>>(r => { resolve = r; });
    return { promise, resolve };
  }
  it("A->B late A cannot repaint B's schedule; close aborts B and reopening redeems again", async () => {
    const a=pin("A"), b=pin("B"), da=deferred(), db=deferred();
    const request=vi.fn().mockResolvedValueOnce(ok(snapshot([a,b]))).mockReturnValueOnce(da.promise).mockReturnValueOnce(db.promise)
      .mockResolvedValueOnce(ok(preview(a))) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now); c.bind(me); await c.query(filters);
    const readA=c.select(a), readB=c.select(b);
    da.resolve(ok(preview(a))); await readA; expect(c.view.preview).toBeNull(); expect(c.view.selected).toBe(b.publicPlayerId);
    db.resolve(ok(preview(b))); await readB; expect(c.view.preview?.player.publicPlayerId).toBe(b.publicPlayerId);
    expect(c.view.preview?.upcomingGames).toEqual([game]);
    c.close(); expect(c.view.preview).toBeNull();
    expect(vi.mocked(request).mock.calls[2]![1]!.signal?.aborted).toBe(true);
    await c.select(a); expect(c.view.preview?.player.publicPlayerId).toBe(a.publicPlayerId);
    expect(vi.mocked(request).mock.calls.slice(1).every(call => call[0]==="/v1/radar/results/preview")).toBe(true);
    expect(JSON.parse(vi.mocked(request).mock.calls[3]![1]!.body as string)).toEqual({resultRef:a.radar!.resultRef});
  });
  it.each(["close","hidden","stop","account","csrf","dispose","filter","activation","map"] as const)("retires loaded and deferred schedules on %s", async action => {
    const a=pin("A"), late=deferred();
    const request=vi.fn().mockResolvedValueOnce(ok(snapshot([a]))).mockResolvedValueOnce(ok(preview(a))).mockReturnValueOnce(late.promise)
      .mockResolvedValue(ok({...snapshot([a]),mapPage:{nextMapCursor:null}})) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now); c.bind(me); await c.query(filters); await c.select(a);
    expect(c.view.preview?.upcomingGames).toHaveLength(1);
    const pending=c.select(a); expect(c.view.preview).toBeNull();
    if(action==='close')c.close(); if(action==='hidden')c.visibility(false); if(action==='stop')c.ordinary();
    if(action==='account')c.bind({...me,id:'different'}); if(action==='csrf')c.bind({...me,csrfToken:'replacement'}); if(action==='dispose')c.dispose();
    if(action==='filter')await c.query({...filters,trainer:true}); if(action==='activation')await c.query(filters,{kind:'current_activation',activationId:'new'},'new:2');
    if(action==='map')await c.map();
    expect(c.view.preview).toBeNull(); expect(c.view.selected).toBeNull();
    late.resolve(ok(preview(a))); await pending; expect(c.view.preview).toBeNull();
  });
  it.each(["snapshot","row","preview","game-start","nonfinite-snapshot","nonfinite-preview"] as const)("expires the whole schedule at %s deadline", async deadline => {
    const a=pin("A"); let time=now;
    const payload=preview(a);
    const request=vi.fn().mockResolvedValueOnce(ok(snapshot([a]))).mockResolvedValueOnce(ok(payload)) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>time); c.bind(me); await c.query(filters); await c.select(a);
    if(deadline==='snapshot')c.view.snapshot!.validUntil=new Date(now+100).toISOString();
    if(deadline==='row')a.radar!.validUntil=new Date(now+100).toISOString();
    if(deadline==='game-start')c.view.preview!.upcomingGames[0]!.startsAt=new Date(now+100).toISOString();
    if(deadline==='preview')c.view.preview!.radar.validUntil=new Date(now+100).toISOString();
    if(deadline==='nonfinite-snapshot')c.view.snapshot!.validUntil='invalid';
    if(deadline==='nonfinite-preview')c.view.preview!.radar.validUntil='invalid';
    time=now+100; c.tick(); expect(c.view.preview).toBeNull(); expect(c.view.selected).toBeNull();
  });
  it.each(['identity','deadline','missing-games','invalid-game','duplicate','over-limit','extra-private-field'])("rejects invalid successful preview admission: %s", async kind => {
    const a=pin('A'), payload=preview(a);
    if(kind==='identity')payload.player={...payload.player,publicPlayerId:'B'};
    if(kind==='deadline')payload.radar.validUntil='not-a-date';
    const malformed: unknown=kind==='extra-private-field'?{...payload,upcomingGames:[{...game,participationStatus:'confirmed'}]}:kind==='missing-games'?{...payload,upcomingGames:undefined}:kind==='invalid-game'?{...payload,upcomingGames:[{...game,startsAt:'invalid'}]}:kind==='duplicate'?{...payload,upcomingGames:[game,game]}:kind==='over-limit'?{...payload,upcomingGames:[game,game,game,game]}:payload;
    const request=vi.fn().mockResolvedValueOnce(ok(snapshot([a]))).mockResolvedValueOnce(ok(malformed)) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now);c.bind(me);await c.query(filters);await c.select(a);
    expect(c.view.preview).toBeNull();expect(c.view.selected).toBeNull();
  });
  it("accepts complete null, estimate and range previews and rejects malformed nested/private fields", () => {
    const a = pin("A"), valid = preview(a);
    const estimate: UnifiedDistance = { kind: "estimate", roundedMeters: 500, roundingStepMeters: 100,
      uncertaintyMeters: 200, lowerMeters: null, upperMeters: null, basis: "published_centers_geodesic", approximate: true };
    const range: UnifiedDistance = { ...estimate, kind: "range", roundedMeters: null, lowerMeters: 0, upperMeters: 500 };
    for (const distance of [null, estimate, range]) {
      expect(liveUnifiedPreview({ ...valid, radar: { ...valid.radar, distance } }, a.publicPlayerId, now)).toBe(true);
    }
    const invalid = [
      null, {}, { ...valid, player: null }, { ...valid, proximityBand: "near" },
      { ...valid, player: { ...valid.player, trainer: undefined } },
      { ...valid, player: { ...valid.player, avatar: { ...valid.player.avatar, contact: "private" } } },
      { ...valid, player: { ...valid.player, level: { scaleId: "s", scaleVersion: 1, levelId: "l", provenance: "self_declared", userId: "private" } } },
      { ...valid, radar: { ...valid.radar, consentPolicyVersion: "old" } },
      { ...valid, radar: { ...valid.radar, resultRef: "private-proof" } },
      { ...valid, radar: { ...valid.radar, geo: { ...valid.radar.geo, sourceAccuracyMeters: 1 } } },
      { ...valid, radar: { ...valid.radar, geo: { ...valid.radar.geo, latitude: NaN } } },
      { ...valid, radar: { ...valid.radar, distance: { ...estimate, contact: "private" } } },
      { ...valid, upcomingGames: [{ ...game, startsAt: new Date(now).toISOString() }] },
      { ...valid, upcomingGames: [{ ...game, timezone: "invalid/timezone" }] },
      { ...valid, upcomingGames: [{ ...game, venue: { ...game.venue, contact: "private" } }] },
      { ...valid, upcomingGames: [{ ...game, cover: { ...game.cover, userId: "private" } }] },
      { ...valid, upcomingGames: [{ ...game, id: "00000000-0000-4000-8000-000000000002" }, game] },
    ];
    for (const value of invalid) expect(liveUnifiedPreview(value as unknown as UnifiedPreview, a.publicPlayerId, now)).toBe(false);
  });
  it("transient failure clears old data, then retry obtains a fresh authorized empty schedule", async () => {
    const a=pin('A');
    const request=vi.fn().mockResolvedValueOnce(ok(snapshot([a]))).mockResolvedValueOnce(ok(preview(a)))
      .mockResolvedValueOnce({ok:false,status:503,error:'unavailable'}).mockResolvedValueOnce(ok({...preview(a),upcomingGames:[]})) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now);c.bind(me);await c.query(filters);await c.select(a);await c.select(a);
    expect(c.view.preview).toBeNull();expect(c.view.previewBusy).toBe(false);expect(c.view.previewError).not.toBe('');expect(c.view.selected).toBe(a.publicPlayerId);
    await c.select(a);expect(c.view.preview?.upcomingGames).toEqual([]);expect(c.view.previewError).toBe('');
  });
});
