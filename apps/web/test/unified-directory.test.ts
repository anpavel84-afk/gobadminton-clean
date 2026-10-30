import { describe, expect, it, vi } from "vitest";
import type { UnifiedSnapshot, UnifiedRow, UnifiedDistance, UnifiedPreview } from "@gobadminton/contracts";
import { UnifiedDirectoryController, distanceText, scopedCatalogCursor, liveUnifiedPreview } from "../src/lib/unified-directory";
import { candidateMapAllowed, candidateMapConfigAllowed, MOSCOW_BUNDLE, allowedMapResource } from "../src/lib/radar-map-assets";
import type { RadarConfig } from "../src/lib/unified-directory";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch } from "../src/lib/api-client";
const now = Date.parse("2030-01-01T00:00:00Z");
const ok = (data: unknown) => ({ ok: true as const, status: 200, data });
const row = (id: string) => ({ publicPlayerId: id, projection: "directory", player: { publicPlayerId: id, displayName: id }, radar: null }) as UnifiedRow;
function snapshot(items: UnifiedRow[] = [row("first")]): UnifiedSnapshot {
  return { policyVersion: "radar-geographic-sharing-v2", regionId: "moscow", refreshAfterSeconds: 30, totals: { matchingTotal: items.length, radarTotal: items.filter(row => row.radar).length, ordinaryOnlyTotal: items.filter(row => !row.radar).length, completeness: "exact_at_asOf" }, contractVersion: "players-unified-radar-v1", cityId: MOSCOW_BUNDLE.cityId, exposureMode: "synthetic_demo", generatedAt: new Date(now).toISOString(), validUntil: new Date(now + 45000).toISOString(), query: { queryRef: "context", originState: "none", originRef: null, ordering: "radar_city_then_directory", asOf: new Date(now).toISOString() }, items, map: { availability: "missing", mapId: null, version: null }, page: { returnedCount: items.length, rankStart: 1, rankEnd: items.length, hasMore: true, nextCursor: "page2" } };
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
    const request = vi.fn(async () => ok({
      ...data,
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
    })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.matches(filters, "activation:1")).toBe(true); expect(c.matches(filters, "activation:2")).toBe(false);
    time += 30000;
    expect(c.matches(filters, "activation:1")).toBe(false);
    await c.refresh();
    expect(c.matches(filters, "activation:1")).toBe(true);
    expect(JSON.parse(vi.mocked(request).mock.calls[1]![1]!.body as string).origin).toEqual({ kind: "reference", originRef: "private-reference" });
  });
  it("recovers an expired private route context with the live activation and rate limit", async () => {
    let time = now;
    const request = vi.fn(async () => ok({
      ...snapshot(),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
    })) as typeof apiFetch;
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
  it("does not falsely stale a valid window on early unchanged cooldown request", async () => {
    const request = vi.fn(async () => ok(snapshot())) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => now); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(request).toHaveBeenCalledTimes(1);
    expect(c.view.snapshot).not.toBeNull();
    expect(c.view.stale).toBe(false);
    expect(c.view.mode).toBe("unified");
  });
  it("rejects activation version key churn during cooldown; same-key soft refresh stays renderable", async () => {
    let time = now;
    const request = vi.fn(async () => ok({
      ...snapshot(),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
    })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:2");
    expect(request).toHaveBeenCalledTimes(1);
    expect(c.renderable(filters, "activation:2")).toBe(false);
    expect(c.view.stale).toBe(true);
    expect(c.view.mode).toBe("ordinary");
    time = now + 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(request).toHaveBeenCalledTimes(2);
    expect(c.renderable(filters, "activation:1")).toBe(true);
    time = now + 60000;
    expect(c.matches(filters, "activation:1")).toBe(false);
    expect(c.renderable(filters, "activation:1")).toBe(true);
    await c.refresh();
    expect(request).toHaveBeenCalledTimes(3);
    expect(c.renderable(filters, "activation:1")).toBe(true);
  });

  it("keeps renderable authorized window at +30s of 45s while matches is false and expiry is false", async () => {
    let time = now;
    const request = vi.fn(async () => ok({
      ...snapshot([row("peer-a"), row("peer-b"), row("peer-c"), row("peer-d"), row("peer-e"), row("peer-f")].map((r, i) => ({
        ...r,
        publicPlayerId: `peer-${i + 1}`,
        projection: "radar_public",
        radar: { resultId: `r${i}`, resultRef: `ref-${i}`, consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: new Date(now + 45000).toISOString(), distance: null,
          geo: { latitude: 55.75, longitude: 37.6, crs: "EPSG:4326", model: "regional_grid_100m_v1", gridSizeMeters: 100, uncertaintyMeters: 100, quality: "approximate", sourceTimestampBucket: new Date(now).toISOString(), sourceAgeSeconds: 0 } },
      }))),
      generatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 45000).toISOString(),
    })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.rows).toHaveLength(6);
    time = now + 30000;
    expect(c.matches(filters, "activation:1")).toBe(false);
    expect(c.renderable(filters, "activation:1")).toBe(true);
    c.tick();
    expect(c.view.snapshot).not.toBeNull();
    expect(c.view.mode).toBe("unified");
    expect(c.view.stale).toBe(false);
    expect(c.renderable(filters, "activation:1")).toBe(true);
  });

  it("nextRefreshAt recovers after 429 Retry-After without stacking another fixed 30s wait", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      if (calls === 2) return { ok: false as const, status: 429, error: "rate", retryAfterSeconds: 5 };
      return ok({
        ...snapshot([row("recovered-after-429")]),
        generatedAt: new Date(time).toISOString(),
        validUntil: new Date(time + 45000).toISOString(),
      });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    // Soft same-key 429 keeps the still-valid authorized window.
    expect(c.view.snapshot).not.toBeNull();
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["before"]);
    expect(c.view.mode).toBe("unified");
    expect(c.renderable(filters, "activation:1")).toBe(true);
    expect(c.nextRefreshAt()).toBe(time + 5000);
    // Projection path: arm only fires when nextRefreshAt allows (not a fixed +30s).
    time += 4999;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(calls).toBe(2);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["before"]);
    time += 1;
    expect(c.nextRefreshAt()).toBe(time);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(calls).toBe(3);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["recovered-after-429"]);
    expect(c.renderable(filters, "activation:1")).toBe(true);
  });
  it("clears retained window when Retry-After outlives validUntil", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      return { ok: false as const, status: 429, error: "rate", retryAfterSeconds: 60 };
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.snapshot).toBeNull();
    expect(c.view.rows).toEqual([]);
    expect(c.view.mode).toBe("ordinary");
  });
  it("resource 404 does not permanently disable unified capability", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      if (calls === 2) {
        return { ok: false as const, status: 404, error: "gone", problem: { type: "about:blank", title: "Источник местоположения недоступен", status: 404, code: "RESOURCE_UNAVAILABLE", requestId: "test" } };
      }
      return ok({
        ...snapshot([row("recovered-after-resource-404")]),
        generatedAt: new Date(time).toISOString(),
        validUntil: new Date(time + 45000).toISOString(),
      });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.capabilityUnavailable).toBe(false);
    expect(c.view.snapshot).toBeNull();
    expect(c.view.mode).toBe("ordinary");
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(calls).toBe(3);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["recovered-after-resource-404"]);
    expect(c.view.mode).toBe("unified");
  });
  it("publishes expiry fences atomically before subscribers can re-arm unified", async () => {
    let time = now;
    const request = vi.fn(async () => ok({
      ...snapshot([row("peer")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
    })) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    let seenOrdinary = false;
    c.subscribe(() => {
      if (c.view.mode === "ordinary" && c.view.snapshot === null) seenOrdinary = true;
      // A synchronous subscriber must never observe cleared rows still marked unified.
      if (c.view.snapshot === null) expect(c.view.mode).toBe("ordinary");
    });
    time += 45000;
    c.tick();
    expect(seenOrdinary).toBe(true);
    expect(c.view.mode).toBe("ordinary");
    expect(c.view.rows).toEqual([]);
  });
  it("recovers immediately after 409 without waiting out the initial cooldown", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return ok({ ...snapshot(), generatedAt: new Date(time).toISOString(), validUntil: new Date(time + 45000).toISOString() });
      if (calls === 2) return { ok: false as const, status: 409, error: "stale" };
      return ok({ ...snapshot([row("recovered")]), generatedAt: new Date(time).toISOString(), validUntil: new Date(time + 45000).toISOString() });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.snapshot).toBeNull();
    expect(c.view.stale).toBe(true);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(calls).toBe(3);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["recovered"]);
    expect(c.view.mode).toBe("unified");
  });
  it("503 soft refresh retries within valid TTL instead of waiting out the 30s nextInitial gate", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      if (calls === 2) return { ok: false as const, status: 503, error: "upstream" };
      return ok({
        ...snapshot([row("recovered-after-503")]),
        generatedAt: new Date(time).toISOString(),
        validUntil: new Date(time + 45000).toISOString(),
      });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["before"]);
    expect(c.view.mode).toBe("unified");
    expect(c.renderable(filters, "activation:1")).toBe(true);
    // Bounded ~2s retry — not requestStart+30s which would land after validUntil.
    expect(c.nextRefreshAt()).toBe(time + 2000);
    time += 2000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(calls).toBe(3);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["recovered-after-503"]);
    expect(c.view.mode).toBe("unified");
  });
  it("clears expired displayed peers while allowing an in-flight refresh to commit after latency", async () => {
    let time = now;
    let resolveRefresh!: (value: ReturnType<typeof ok>) => void;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      return new Promise<ReturnType<typeof ok>>(resolve => { resolveRefresh = resolve; });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    const pending = c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 15000;
    c.tick();
    expect(c.view.snapshot).toBeNull();
    expect(c.view.rows).toEqual([]);
    expect(c.view.mode).toBe("ordinary");
    resolveRefresh(ok({
      ...snapshot([row("fresh-after-expiry")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
    }));
    await pending;
    expect(calls).toBe(2);
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["fresh-after-expiry"]);
    expect(c.view.mode).toBe("unified");
    expect(c.view.stale).toBe(false);
  });
  it("QA-01: expiry-during-read 429 installs Retry-After before sync subscriber can re-query", async () => {
    let time = now;
    type RateLimited = { ok: false; status: number; error: string; retryAfterSeconds: number };
    let resolveRefresh!: (value: RateLimited) => void;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("before")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      return new Promise<RateLimited>(resolve => { resolveRefresh = resolve; });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 30000;
    const pending = c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    time += 15000;
    c.tick();
    expect(c.view.snapshot).toBeNull();
    c.subscribe(() => {
      // Must observe Retry-After already installed — no extra read before the gate.
      void c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    });
    resolveRefresh({ ok: false, status: 429, error: "rate", retryAfterSeconds: 5 });
    await pending;
    expect(calls).toBe(2);
    expect(c.nextRefreshAt()).toBe(time + 5000);
    expect(c.view.busy).toBe(false);
  });
  it("QA-01: resource 404 settles mode+fences atomically; sync recovery publishes unified", async () => {
    let time = now;
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return ok({
          ...snapshot([row("a"), row("b"), row("c"), row("d"), row("e"), row("f")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
        });
      }
      if (calls === 2) {
        return {
          ok: false as const,
          status: 404,
          error: "gone",
          problem: {
            type: "about:blank",
            title: "Источник местоположения недоступен",
            status: 404,
            code: "RESOURCE_UNAVAILABLE",
            requestId: "test",
          },
        };
      }
      return ok({
        ...snapshot([row("r1"), row("r2"), row("r3"), row("r4"), row("r5"), row("r6")]),
        generatedAt: new Date(time).toISOString(),
        validUntil: new Date(time + 45000).toISOString(),
      });
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.rows).toHaveLength(6);
    let recovering: Promise<void> | null = null;
    // Mirror PlayersDirectoryPage arming: set BEFORE c.query so invalidate/set notify
    // cannot reenter while recovering is still null (assignment happens only after query returns).
    let arming = false;
    let sawAtomic404 = false;
    c.subscribe(() => {
      if (c.view.mode === "ordinary" && c.view.snapshot === null && !c.view.capabilityUnavailable && !arming && !recovering) {
        // Failure settlement must publish ordinary+clear together (not cleared while still unified).
        expect(c.view.rows).toEqual([]);
        sawAtomic404 = true;
        arming = true;
        try {
          recovering = c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
        } finally {
          arming = false;
        }
      }
    });
    time += 30000;
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    if (recovering) await recovering;
    expect(sawAtomic404).toBe(true);
    expect(calls).toBe(3);
    expect(c.view.capabilityUnavailable).toBe(false);
    expect(c.view.mode).toBe("unified");
    expect(c.view.rows.map(r => r.publicPlayerId)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(c.matches(filters, "activation:1")).toBe(true);
    expect(c.renderable(filters, "activation:1")).toBe(true);
    expect(c.nextRefreshAt()).toBe(time + 30000);
  });
});
describe("distance and map authority", () => {
  const estimate = (meters: number, step: 100 | 500 | 1000 = 100) => ({ kind: "estimate", roundedMeters: meters, roundingStepMeters: step }) as UnifiedDistance;
  it("displays accepted rounded meters/km with approximation, comma, and near-zero range", () => {
    expect(distanceText(estimate(400))).toBe("≈ 400 м"); expect(distanceText(estimate(1800))).toBe("≈ 1,8 км"); expect(distanceText(estimate(5000, 1000))).toBe("≈ 5 км");
    expect(distanceText({ kind: "range", upperMeters: 4000, roundingStepMeters: 1000 } as UnifiedDistance)).toBe("Рядом · до 4 км (примерно)"); expect(distanceText(null)).toBeNull();
  });
  it("never interprets missing registration as public map approval", () => {
    const preview: UnifiedSnapshot = { ...snapshot(), map: { availability: "dev_preview", mapId: "moscow", version: "moscow-20261007-p4-098a869f-v001" } };
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

const privateRow: UnifiedRow = { publicPlayerId: "peer", projection: "radar_public",
  player: { publicPlayerId: "peer", displayName: "Peer", cityId: null, areaKey: null, level: null, trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
  radar: { resultId: "result", resultRef: "private-proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: new Date(now+40000).toISOString(), distance: null,
    geo: { latitude: 55.75, longitude: 37.6, crs: "EPSG:4326", model: "regional_grid_100m_v1", gridSizeMeters: 100, uncertaintyMeters: 100, quality: "approximate", sourceTimestampBucket: new Date(now).toISOString(), sourceAgeSeconds: 0 } } };
const privatePreview: UnifiedPreview = { player: { publicPlayerId: "peer", displayName: "Peer", level: null, trainer: false, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false }, proximityBand: null,
  radar: { consentPolicyVersion: privateRow.radar!.consentPolicyVersion, geo: privateRow.radar!.geo, validUntil: privateRow.radar!.validUntil, distance: null },
  upcomingGames: [{ id: "game", title: "Permitted game", activityKind: "regular", startsAt: new Date(now+86400000).toISOString(), endsAt: new Date(now+90000000).toISOString(), timezone: "Europe/Moscow", cover: { uploadedUrl: null }, venue: { name: "Court", cover: { uploadedUrl: null } } }] };

describe("proactive Radar soft refresh (#365)", () => {
  it("soft-refreshes before TTL without blank blink and keeps continuity past the original 45s wall", async () => {
    let time = now;
    let resolveRefresh!: (value: ReturnType<typeof ok>) => void;
    let resolveFreshMap!: (value: ReturnType<typeof ok>) => void;
    const refreshPending = new Promise<ReturnType<typeof ok>>(resolve => { resolveRefresh = resolve; });
    const freshMapPending = new Promise<ReturnType<typeof ok>>(resolve => { resolveFreshMap = resolve; });
    let queryCalls = 0;
    let mapCalls = 0;
    let activeQueryRef = "query-ref-1";
    const livePin = (id = "peer"): UnifiedRow => ({
      ...privateRow,
      publicPlayerId: id,
      player: { ...privateRow.player, publicPlayerId: id, displayName: id },
      radar: { ...privateRow.radar!, resultRef: `${id}-proof`, validUntil: new Date(time + 45000).toISOString() },
    });
    const request = vi.fn(async (path: string) => {
      if (String(path).endsWith("/map")) {
        mapCalls += 1;
        if (mapCalls === 1) {
          return ok({
            ...snapshot([livePin()]),
            generatedAt: new Date(time).toISOString(),
            validUntil: new Date(time + 45000).toISOString(),
            query: { ...snapshot().query, queryRef: activeQueryRef, originState: "authorized", originRef: "origin" },
            items: [livePin()],
            mapPage: { returnedCount: 1, rankStart: 1, rankEnd: 1, hasMore: false, nextMapCursor: null },
          });
        }
        return freshMapPending;
      }
      queryCalls += 1;
      if (queryCalls === 1) {
        activeQueryRef = "query-ref-1";
        return ok({
          ...snapshot([livePin()]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
          query: { ...snapshot().query, queryRef: activeQueryRef, originState: "authorized", originRef: "origin" },
        });
      }
      return refreshPending;
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time);
    c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    await c.map();
    expect(c.view.pins).toHaveLength(1);
    expect(c.matches(filters, "activation:1")).toBe(true);
    time += 30000;
    expect(c.matches(filters, "activation:1")).toBe(false);
    const refresh = c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    expect(c.view.snapshot).not.toBeNull();
    expect(c.view.pins).toHaveLength(1);
    expect(c.view.busy).toBe(false);
    expect(c.view.mode).toBe("unified");
    time += 10000;
    resolveRefresh(ok({
      ...snapshot([livePin("fresh")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
      query: { ...snapshot().query, queryRef: "query-ref-2", originState: "authorized", originRef: "origin" },
    }));
    // Old pins remain while fresh map is still deferred.
    await vi.waitFor(() => { expect(mapCalls).toBe(2); });
    expect(c.view.pins).toHaveLength(1);
    expect(c.view.pins[0]?.publicPlayerId).toBe("peer");
    expect(c.view.snapshot?.query.queryRef).toBe("query-ref-1");
    resolveFreshMap(ok({
      ...snapshot([livePin("fresh")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
      query: { ...snapshot().query, queryRef: "query-ref-2", originState: "authorized", originRef: "origin" },
      items: [livePin("fresh")],
      mapPage: { returnedCount: 1, rankStart: 1, rankEnd: 1, hasMore: false, nextMapCursor: null },
    }));
    await refresh;
    expect(c.view.mode).toBe("unified");
    expect(c.view.snapshot?.query.queryRef).toBe("query-ref-2");
    expect(c.view.pins.length).toBeGreaterThan(0);
    expect(c.view.pins[0]?.publicPlayerId).toBe("fresh");
    expect(c.matches(filters, "activation:1")).toBe(true);
    // Original wall was now+45s; fresh snapshot extends past it.
    time = now + 50000;
    c.tick();
    expect(c.view.snapshot).not.toBeNull();
    expect(c.view.mode).toBe("unified");
    expect(c.view.pins.length).toBeGreaterThan(0);
  });

  it("soft-refresh after close() commits refreshed pins without resurrecting selection", async () => {
    let time = now;
    let resolveRefresh!: (value: ReturnType<typeof ok>) => void;
    let resolveFreshMap!: (value: ReturnType<typeof ok>) => void;
    const refreshPending = new Promise<ReturnType<typeof ok>>(resolve => { resolveRefresh = resolve; });
    const freshMapPending = new Promise<ReturnType<typeof ok>>(resolve => { resolveFreshMap = resolve; });
    let queryCalls = 0;
    let mapCalls = 0;
    let previewCalls = 0;
    const livePin = (id: string): UnifiedRow => ({
      ...privateRow,
      publicPlayerId: id,
      player: { ...privateRow.player, publicPlayerId: id, displayName: id },
      radar: { ...privateRow.radar!, resultRef: `${id}-proof`, validUntil: new Date(time + 45000).toISOString() },
    });
    const request = vi.fn(async (path: string) => {
      if (String(path).endsWith("/preview")) {
        previewCalls += 1;
        return ok({ ...privatePreview, player: { ...privatePreview.player, publicPlayerId: "peer" } });
      }
      if (String(path).endsWith("/map")) {
        mapCalls += 1;
        if (mapCalls === 1) {
          return ok({
            ...snapshot([livePin("peer")]),
            generatedAt: new Date(time).toISOString(),
            validUntil: new Date(time + 45000).toISOString(),
            query: { ...snapshot().query, queryRef: "query-ref-1", originState: "authorized", originRef: "origin" },
            items: [livePin("peer")],
            mapPage: { returnedCount: 1, rankStart: 1, rankEnd: 1, hasMore: false, nextMapCursor: null },
          });
        }
        return freshMapPending;
      }
      queryCalls += 1;
      if (queryCalls === 1) {
        return ok({
          ...snapshot([livePin("peer")]),
          generatedAt: new Date(time).toISOString(),
          validUntil: new Date(time + 45000).toISOString(),
          query: { ...snapshot().query, queryRef: "query-ref-1", originState: "authorized", originRef: "origin" },
        });
      }
      return refreshPending;
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time);
    c.bind(me);
    await c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    await c.map();
    await c.select(c.view.pins[0]!);
    expect(c.view.selected).toBe("peer");
    const previewsBeforeRefresh = previewCalls;
    time += 30000;
    const refresh = c.query(filters, { kind: "current_activation", activationId: "activation" }, "activation:1");
    // RadarPage Close / venue handoff / hide-layer all use close() while query/map may still be in flight.
    c.close();
    expect(c.view.selected).toBeNull();
    resolveRefresh(ok({
      ...snapshot([livePin("peer"), livePin("fresh")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
      query: { ...snapshot().query, queryRef: "query-ref-2", originState: "authorized", originRef: "origin" },
    }));
    await vi.waitFor(() => { expect(mapCalls).toBe(2); });
    resolveFreshMap(ok({
      ...snapshot([livePin("peer"), livePin("fresh")]),
      generatedAt: new Date(time).toISOString(),
      validUntil: new Date(time + 45000).toISOString(),
      query: { ...snapshot().query, queryRef: "query-ref-2", originState: "authorized", originRef: "origin" },
      items: [livePin("peer"), livePin("fresh")],
      mapPage: { returnedCount: 2, rankStart: 1, rankEnd: 2, hasMore: false, nextMapCursor: null },
    }));
    await refresh;
    expect(c.view.snapshot?.query.queryRef).toBe("query-ref-2");
    expect(c.view.pins.map(row => row.publicPlayerId)).toEqual(["peer", "fresh"]);
    expect(c.view.selected).toBeNull();
    expect(c.view.preview).toBeNull();
    expect(previewCalls).toBe(previewsBeforeRefresh);
  });
});

describe("whole-schedule admission and cancellation fences", () => {
  const invalid: unknown[] = [null, {}, { ...privatePreview, upcomingGames: undefined }, { ...privatePreview, proximityBand: "near" },
    { ...privatePreview, contact: "secret" }, { ...privatePreview, player: { ...privatePreview.player, userId: "secret" } },
    { ...privatePreview, radar: { ...privatePreview.radar, validUntil: "invalid" } }, { ...privatePreview, radar: { ...privatePreview.radar, validUntil: new Date(now).toISOString() } },
    { ...privatePreview, radar: { ...privatePreview.radar, geo: { ...privatePreview.radar.geo, latitude: NaN } } },
    { ...privatePreview, player: { ...privatePreview.player, publicPlayerId: "other" } },
    { ...privatePreview, upcomingGames: Array(4).fill(privatePreview.upcomingGames[0]) },
    { ...privatePreview, upcomingGames: [privatePreview.upcomingGames[0],privatePreview.upcomingGames[0]] },
    ...["userId", "participation", "contact"].map(key => ({ ...privatePreview, upcomingGames: [{ ...privatePreview.upcomingGames[0], [key]: "secret" }] })),
    { ...privatePreview, upcomingGames: [{ ...privatePreview.upcomingGames[0], venue: { ...privatePreview.upcomingGames[0]!.venue, bookingNote: "secret" } }] },
    { ...privatePreview, upcomingGames: [{ ...privatePreview.upcomingGames[0], startsAt: new Date(now-1).toISOString() }] },
    { ...privatePreview, upcomingGames: [{ ...privatePreview.upcomingGames[0], timezone: "Invalid/Zone" }] }];
  it.each(invalid.map((value,index)=>({value,index})))("rejects malformed or private preview $index without relaxing the guard",async({value})=>{
    const request=(async(path:string)=>ok(path.endsWith("/preview")?value:snapshot([privateRow]))) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now);c.bind(me);await c.query(filters);await c.select(c.view.rows[0]!);
    expect(c.view.preview).toBeNull();expect(c.view.selected).toBeNull();expect(liveUnifiedPreview(value,"peer",now)).toBe(false);
  });
  it("accepts complete strict preview and retires the whole schedule at its exact TTL",async()=>{
    let time=now;
    const c=new UnifiedDirectoryController((async(path:string)=>ok(path.endsWith("/preview")?privatePreview:snapshot([privateRow]))) as typeof apiFetch,()=>time);
    c.bind(me);await c.query(filters);await c.select(c.view.rows[0]!);expect(c.view.preview).toEqual(privatePreview);
    time+=40000;c.tick();expect(c.view.preview).toBeNull();expect(c.view.selected).toBeNull();
  });
  for(const action of ["close","stop","hide","account","session","dispose","filter","activation","map","expiry"] as const) it(`cannot repaint late schedule after ${action}`,async()=>{
    let time=now,resolve!:(value:ReturnType<typeof ok>)=>void;
    const pending=new Promise<ReturnType<typeof ok>>(r=>{resolve=r;});
    const c=new UnifiedDirectoryController((async(path:string)=>path.endsWith("/preview")?pending:ok(path.endsWith("/map")?{...snapshot([privateRow]),mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextMapCursor:null}}:snapshot([privateRow]))) as typeof apiFetch,()=>time);
    c.bind(me);await c.query(filters);const selection=c.select(c.view.rows[0]!);
    if(action==="close")c.close();if(action==="stop")c.ordinary();if(action==="hide")c.visibility(false);
    if(action==="account")c.bind({...me,id:"other"});if(action==="session")c.bind({...me,csrfToken:"new"});if(action==="dispose")c.dispose();
    if(action==="filter")await c.query({...filters,trainer:true});if(action==="activation")await c.query(filters,{kind:"current_activation",activationId:"new"},"new:2");
    if(action==="map")await c.map();if(action==="expiry"){time+=45000;c.tick();}
    resolve(ok(privatePreview));await selection;expect(c.view.preview).toBeNull();expect(c.view.selected).toBeNull();
  });
  it("A -> B ignores A arriving last, and reopening always redeems a fresh preview",async()=>{
    const other:UnifiedRow={...privateRow,publicPlayerId:"other",player:{...privateRow.player,publicPlayerId:"other"},radar:{...privateRow.radar!,resultRef:"other-proof"}};
    let resolve!:(value:ReturnType<typeof ok>)=>void;
    const pending=new Promise<ReturnType<typeof ok>>(r=>{resolve=r;});let reads=0;
    const request=vi.fn(async(path:string)=>path.endsWith("/preview")?++reads===1?pending:ok({...privatePreview,player:{...privatePreview.player,publicPlayerId:"other"}}):ok(snapshot([privateRow,other]))) as typeof apiFetch;
    const c=new UnifiedDirectoryController(request,()=>now);c.bind(me);await c.query(filters);const a=c.select(c.view.rows[0]!);await c.select(c.view.rows[1]!);
    resolve(ok(privatePreview));await a;expect(c.view.preview?.player.publicPlayerId).toBe("other");c.close();await c.select(c.view.rows[1]!);expect(reads).toBe(3);
  });
});
