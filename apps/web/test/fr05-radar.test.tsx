import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RadarController } from "../src/lib/radar-controller";
import { bandLabel, effectiveDeadline, radarHonestyNotice, radarLevel, radarPosition, remainingTime } from "../src/lib/radar-presentation";
import { syntheticDemoFix } from "../src/lib/radar-demo-fix";
import { RadarCanvas } from "../src/components/consumer/radar/RadarComposition";
import type { RadarActivation, RadarItem } from "../src/lib/radar-types";
import type { apiFetch } from "../src/lib/api-client";
const origin = Date.parse("2030-10-05T10:00:00Z");
const stamp = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
const profile = { version: 1, socialEligible: true, displayName: "Алексей", radarConsented: true, radarConsentPolicyVersion: "radar-policy" };
const me = { id: "own", displayName: "Алексей", csrfToken: "csrf", locale: "ru", linkedProviders: [] };
const activation: RadarActivation = { state: "active", ownerHere: true, activationId: "generation", version: 1, policyVersion: "radar-policy", regionId: "region", radiusBucketKm: 5, startedAt: stamp(0), expiresAt: stamp(600), hardExpiresAt: stamp(3600), foregroundUntil: stamp(90), locationValidUntil: stamp(300), nextLocationUpdateAt: stamp(60), nextRadiusChangeAt: stamp(60), exposureMode: "live" };
const item: RadarItem = { resultId: "r1", resultRef: "private-result-proof", player: { publicPlayerId: "peer", displayName: "Мария Л.", level: null, trainer: false }, proximityBand: "near", displaySlot: 0 };
const ok = (data: unknown) => ({ ok: true, status: 200, data });
const nearby = { state: "results", policyVersion: "radar-policy", radiusBucketKm: 5, refreshAfterSeconds: 30, displayTtlSeconds: 45, items: [item], exposureMode: "live" as const };
function harness() {
  let now = origin;
  const fetch = vi.fn(async (path: string, _init?: {method?: string}) => ok(path === "/v1/me" ? me : path.endsWith("nearby") ? nearby : path.endsWith("preview") ? { player: item.player, proximityBand: item.proximityBand } : activation));
  const c = new RadarController(fetch as unknown as typeof apiFetch, () => now);
  return { c, fetch, advance: (ms: number) => { now += ms; } };
}
function deferred() { let resolve!: (value: ReturnType<typeof ok>) => void; const promise = new Promise<ReturnType<typeof ok>>(r => { resolve = r; }); return { promise, resolve }; }
describe("FR-05 Radar privacy and geometry", () => {
  it("uses only coarse band radius and synthetic angle, with central anchor", () => {
    expect(radarPosition(item)).toEqual({ left: "69%", top: "50%" });
    expect(radarPosition({ proximityBand: "outer", displaySlot: 90 })).toEqual({ left: "50%", top: "93%" });
    expect(bandLabel).toEqual({ near: "Ближняя зона", middle: "Средняя зона", outer: "Дальняя зона" });
    expect(effectiveDeadline(activation)).toBe(origin + 90000);
    expect(remainingTime(stamp(90), origin)).toBe("1:30");
  });
  it("renders no fake peers, counts, proof, metrics, targeting or unknown level keys", () => {
    const html = renderToStaticMarkup(createElement(RadarCanvas, { items: [item], selected: item.resultId, onSelect: vi.fn(), active: true }));
    expect(html).toContain("Точки расположены условно; расстояние приблизительное.");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/private-result-proof|lastSeen|latitude|longitude|км|Сокол|\+2/);
    const empty = renderToStaticMarkup(createElement(RadarCanvas, { items: [], selected: null, onSelect: vi.fn(), active: true }));
    expect(empty).not.toContain("radar-marker ");
    expect(radarLevel({ ...item.player, level: { levelId: "INTERNAL_LEVEL", scaleId: "x", scaleVersion: 1, provenance: "self_declared" } })).toBe("Уровень не указан");
  });
});
describe("FR-05 asynchronous lifecycle", () => {
  it("binds nearby to own generation and preview to the in-memory proof", async () => {
    const { c, fetch } = harness(); await c.reconcile();
    expect(c.view.selected).toBe(item.resultId);
    expect(c.view.preview?.player.displayName).toBe("Мария Л.");
    expect(fetch.mock.calls.find(([p]) => p.endsWith("nearby"))).toEqual(["/v1/me/radar/nearby", { headers: { "X-Radar-Activation-Id": "generation" } }]);
    expect(JSON.stringify(fetch.mock.calls.find(([p]) => p.endsWith("preview")))).toContain("private-result-proof");
  });
  it("stop interrupts a pending nearby read and a late reply cannot repaint peers", async () => {
    const { c, fetch } = harness(); const pending = deferred();
    fetch.mockImplementation(async (p: string) => p.endsWith("nearby") ? pending.promise : ok(p === "/v1/me" ? me : activation));
    const read = c.reconcile(); await vi.waitFor(() => expect(c.view.loading).toBe(true));
    await c.stop(); pending.resolve(ok(nearby)); await read;
    expect(c.view.phase).toBe("stopped"); expect(c.view.items).toEqual([]); expect(c.view.preview).toBeNull();
  });
  it("hidden clears peers, ignores late preview, performs no ticks, resumes status first", async () => {
    const { c, fetch } = harness(); await c.reconcile(); const pending = deferred();
    fetch.mockImplementation(async () => pending.promise); const preview = c.select(item);
    c.visibility(false); const count = fetch.mock.calls.length; c.tick(); expect(fetch.mock.calls).toHaveLength(count);
    pending.resolve(ok({ player: item.player, proximityBand: "near" })); await preview;
    expect(c.view.items).toEqual([]); expect(c.view.preview).toBeNull();
    fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : { state: "expired", ownerHere: false, policyVersion: "p" }));
    c.visibility(true); await vi.waitFor(() => expect(c.view.phase).toBe("expired"));
    expect(fetch.mock.calls.slice(-2).map(c => c[0])).toEqual(["/v1/me", "/v1/me/radar/activations/current"]);
  });
  it("clears expired display data even while the next read is pending", async () => {
    const { c, fetch, advance } = harness(); await c.reconcile(); const pending = deferred(); fetch.mockImplementation(async () => pending.promise);
    advance(30000); c.tick(); advance(15000); c.tick(); expect(c.view.items).toEqual([]);
    advance(45000); c.tick(); expect(c.view.phase).toBe("checking"); pending.resolve(ok(nearby)); await Promise.resolve(); expect(c.view.items).toEqual([]);
  });
  it("cancelled geolocation cannot create presence", async () => {
    const { c, fetch } = harness(); fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : { state: "off", ownerHere: true, policyVersion: "p", exposureMode: "live" })); await c.reconcile();
    let resolve!: (v: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string }) => void;
    c.permission(); const start = c.activate(() => new Promise(r => { resolve = r; })); c.cancel();
    resolve({ latitude: 55, longitude: 37, accuracyMeters: 10, capturedAt: stamp(0) }); await start;
    expect(fetch.mock.calls.some(([p]) => p === "/v1/me/radar/activations")).toBe(false);
  });
  it.each([1, 2, 3])("geolocation failure %i never creates presence", async code => {
    const { c, fetch } = harness(); fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : { ...activation, state: "off" })); await c.reconcile(); c.permission(); fetch.mockClear(); await c.activate(() => Promise.reject({ code }));
    expect(c.view.phase).toBe(code === 1 ? "denied" : "location_error"); expect(fetch).not.toHaveBeenCalled();
  });
  it("unknown start requires status reconciliation and never automatically resends", async () => {
    const { c, fetch } = harness(); await c.reconcile(); fetch.mockResolvedValue({ ok: false, status: 0 } as never);
    await c.activate(async () => ({ latitude: 55, longitude: 37, accuracyMeters: 10, capturedAt: stamp(0) }), "location");
    expect(c.view.phase).toBe("error"); const count = fetch.mock.calls.length; c.tick(); expect(fetch.mock.calls).toHaveLength(count); expect(c.view.items).toEqual([]);
  });
  it("401 clears identity, results and proof context", async () => {
    const { c, fetch } = harness(); await c.reconcile(); fetch.mockResolvedValue({ ok: false, status: 401 } as never); await c.reconcile();
    expect(c.view.phase).toBe("guest"); expect(c.view.me).toBeNull(); expect(c.view.status).toBeNull(); expect(c.view.items).toEqual([]);
  });
  it("foreground identity change clears previous peers before any heartbeat", async () => {
    const { c, fetch, advance } = harness(); await c.reconcile();
    fetch.mockImplementation(async p => ok(p === "/v1/me" ? { ...me, id: "other" } : { state: "off", ownerHere: true, policyVersion: "p", exposureMode: "live" }));
    const before = fetch.mock.calls.length; advance(45000); c.tick(); await vi.waitFor(() => expect(c.view.phase).toBe("off"));
    expect(c.view.items).toEqual([]); expect(c.view.preview).toBeNull(); expect(c.view.me?.id).toBe("other");
    expect(fetch.mock.calls.slice(before).some(([p]) => p.endsWith("heartbeat"))).toBe(false);
  });
  it("policy disabled remains fail-closed without acquiring location", async () => {
    const { c, fetch } = harness(); fetch.mockImplementation(async p => p === "/v1/me" ? ok(me) : ({ ok: false, status: 404, problem: { code: "SOCIAL_RADAR_DISABLED" } }) as never);
    await c.reconcile(); expect(c.view.phase).toBe("disabled"); expect(c.view.items).toEqual([]);
  });
  it("synthetic demo mode loads city scope, shows honesty copy, and never needs browser geolocation", async () => {
    expect(radarHonestyNotice("synthetic_demo")).toContain("Синтетический демо-режим");
    expect(radarHonestyNotice("live")).toBe("");
    const fix = syntheticDemoFix("a0000000-0000-4000-8000-000000000001", origin);
    expect(fix.latitude).toBeCloseTo(55.7558, 3);
    const { c, fetch } = harness();
    fetch.mockImplementation(async p => {
      if (p === "/v1/me") return ok(me);
      if (p === "/v1/me/social-profile") return ok({ cityId: "a0000000-0000-4000-8000-000000000001" });
      if (p.endsWith("nearby")) return ok({ ...nearby, exposureMode: "synthetic_demo" });
      return ok({ ...activation, exposureMode: "synthetic_demo", state: "off", ownerHere: true });
    });
    await c.reconcile();
    expect(c.view.exposureMode).toBe("synthetic_demo");
    expect(c.view.demoCityId).toBe("a0000000-0000-4000-8000-000000000001");
    expect(c.usesSyntheticLocation()).toBe(true);
    expect(c.view.notice).toContain("Синтетический демо-режим");
    c.permission();
    await c.activate(async () => fix);
    expect(fetch.mock.calls.some(([p]) => p === "/v1/me/radar/activations")).toBe(true);
  });
  it("Retry-After prevents immediate reconciliation", async () => {
    const { c, fetch, advance } = harness(); fetch.mockResolvedValue({ ok: false, status: 429, retryAfterSeconds: 120 } as never); await c.reconcile();
    const count = fetch.mock.calls.length; await c.reconcile(); expect(fetch.mock.calls).toHaveLength(count); advance(120000); await c.reconcile(); expect(fetch.mock.calls.length).toBeGreaterThan(count);
  });
  it("explicit takeover sends current CAS and fresh fix without revealing another session", async () => {
    const { c, fetch } = harness(); fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : { ...activation, state: "owned_elsewhere", ownerHere: false })); await c.reconcile();
    fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : p === "/v1/me/social-profile" ? profile : p.endsWith("nearby") ? nearby : activation)); c.permission(); await c.activate(async () => ({ latitude: 55, longitude: 37, accuracyMeters: 10, capturedAt: stamp(0) }));
    const call = fetch.mock.calls.find(([p]) => p.endsWith("takeover")); expect(JSON.stringify(call)).toContain('\\"confirm\\":true'); expect(c.view.phase).toBe("active");
  });
});

describe("Shared foreground Radar session", () => {
  it("list/map/other navigation preserves generation and cohort without start/stop/GPS", async () => {
    const { c, fetch, advance } = harness(); c.setResultView("list"); await c.reconcile();
    expect(c.view.items).toEqual([item]); expect(c.view.selected).toBeNull();
    const before = fetch.mock.calls.length;
    c.setResultView("map"); c.setResultView("list"); c.setResultView("none");
    expect(c.view.items).toEqual([item]); expect(c.view.status).toMatchObject({ activationId: "generation" });
    expect(fetch.mock.calls.slice(before).some(([p]) => p.endsWith("nearby") || p.endsWith("activations"))).toBe(false);
    advance(46000); c.tick(); await vi.waitFor(() => expect(fetch.mock.calls.some(([p]) => p.endsWith("heartbeat"))).toBe(true));
    expect(fetch.mock.calls.filter(([p]) => p.endsWith("nearby"))).toHaveLength(1);
  });
  it("failed OFF survives hidden/visible and retries only the exact generation before heartbeat", async () => {
    const { c, fetch } = harness(); await c.reconcile();
    let deleted = false;
    fetch.mockImplementation(async (p: string, init?: {method?: string}) => {
      if (p === "/v1/me") return ok(me);
      if (init?.method === "DELETE") return deleted ? ok(null) : { ok: false, status: 0 } as never;
      return ok(activation);
    });
    await c.stop(); expect(c.view.pendingStop).toBe(true); expect(c.view.confirmedOn).toBe(true); expect(c.view.items).toEqual([]);
    c.visibility(false); deleted = true; c.visibility(true);
    await vi.waitFor(() => expect(c.view.phase).toBe("stopped"));
    expect(c.view.confirmedOn).toBe(false); expect(c.view.pendingStop).toBe(false);
    expect(fetch.mock.calls.some(([p]) => p.endsWith("heartbeat"))).toBe(false);
  });
  it("old OFF intent cannot delete a newer takeover generation", async () => {
    const { c, fetch } = harness(); await c.reconcile();
    fetch.mockImplementation(async (p: string, init?: {method?: string}) => p === "/v1/me" ? ok(me) : init?.method === "DELETE" ? { ok: false, status: 0 } as never : ok({ ...activation, activationId: "new-generation" }));
    await c.stop(); const deletes = fetch.mock.calls.filter(([, init]) => (init as {method?:string})?.method === "DELETE").length;
    await c.reconcile();
    expect(fetch.mock.calls.filter(([, init]) => (init as {method?:string})?.method === "DELETE")).toHaveLength(deletes);
    expect(c.view.status).toMatchObject({ activationId: "new-generation" }); expect(c.view.pendingStop).toBe(false);
  });
  it("account changed while obtaining a fix cannot receive prior account activation", async () => {
    const { c, fetch } = harness();
    fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : { state: "off", exposureMode: "live", policyVersion: "p" }));
    await c.reconcile(); c.permission();
    await c.activate(async () => { fetch.mockImplementation(async p => ok(p === "/v1/me" ? { ...me, id: "other" } : { state: "off", exposureMode: "live", policyVersion: "p" })); return { latitude: 55, longitude: 37, accuracyMeters: 20, capturedAt: stamp(0) }; });
    expect(fetch.mock.calls.some(([p]) => p.endsWith("activations"))).toBe(false); expect(c.view.me?.id).toBe("other");
  });
});

describe("Proof-bound preview cancellation", () => {
  it("close/reopen of the same row ignores the old asynchronous preview", async () => {
    const { c, fetch } = harness(); c.setResultView("list"); await c.reconcile();
    const first = deferred(); let count = 0;
    fetch.mockImplementation(async p => p.endsWith("preview") && ++count === 1 ? first.promise : ok({ player: { ...item.player, displayName: "Current preview" }, proximityBand: "near" }));
    const old = c.select(item); c.closePreview(); await c.select(item);
    first.resolve(ok({ player: { ...item.player, displayName: "Old preview" }, proximityBand: "near" })); await old;
    expect(c.view.preview?.player.displayName).toBe("Current preview");
  });
});

describe("Radar cadence across generation changes", () => {
  it("OFF/ON does not re-read nearby before the existing user budget allows it", async () => {
    const { c, fetch, advance } = harness(); c.setResultView("list"); await c.reconcile();
    fetch.mockImplementation(async (p: string) => ok(p === "/v1/me" ? me : p === "/v1/me/social-profile" ? profile : p.endsWith("nearby") ? nearby : activation));
    await c.stop(); c.permission(); await c.activate(async () => ({ latitude: 55, longitude: 37, accuracyMeters: 20, capturedAt: stamp(0) }));
    expect(c.view.phase).toBe("active"); expect(c.view.loading).toBe(true);
    expect(fetch.mock.calls.filter(([p]) => p.endsWith("nearby"))).toHaveLength(1);
    advance(30000); c.tick(); await vi.waitFor(() => expect(fetch.mock.calls.filter(([p]) => p.endsWith("nearby"))).toHaveLength(2));
  });
});

describe("Page-local start intent and global mutation recovery", () => {
  it("leaving Players before GPS finishes cancels start, including a direct map route", async () => {
    const { c, fetch } = harness(); c.setResultView("list");
    fetch.mockImplementation(async p => ok(p === "/v1/me" ? me : {state:"off",policyVersion:"radar-policy",exposureMode:"live"}));await c.reconcile();c.permission();
    let resolve!: (fix: {latitude:number;longitude:number;accuracyMeters:number;capturedAt:string}) => void;
    const start=c.activate(()=>new Promise(r=>{resolve=r;}));c.setResultView("map");
    resolve({latitude:55,longitude:37,accuracyMeters:20,capturedAt:stamp(0)});await start;
    expect(fetch.mock.calls.some(([p])=>p.endsWith("activations"))).toBe(false);
  });
  it("a dispatched start returning after hide/resume is reconciled without a duplicate mutation", async () => {
    const { c, fetch } = harness();c.setResultView("list");const pending=deferred();let serverActive=false;
    fetch.mockImplementation(async (p:string,init?:{method?:string})=>{
      if(p==="/v1/me")return ok(me);if(p==="/v1/me/social-profile")return ok(profile);
      if(p.endsWith("activations")&&init?.method==="POST")return pending.promise;
      if(p.endsWith("nearby"))return ok(nearby);
      return ok(serverActive?activation:{state:"off",policyVersion:"radar-policy",exposureMode:"live"});
    });await c.reconcile();c.permission();const start=c.activate(async()=>({latitude:55,longitude:37,accuracyMeters:20,capturedAt:stamp(0)}));
    await vi.waitFor(()=>expect(fetch.mock.calls.some(([p])=>p.endsWith("activations"))).toBe(true));
    c.visibility(false);c.visibility(true);await vi.waitFor(()=>expect(c.view.phase).toBe("off"));c.permission();
    const gps=vi.fn(async()=>({latitude:55,longitude:37,accuracyMeters:20,capturedAt:stamp(0)}));await c.activate(gps);expect(gps).not.toHaveBeenCalled();
    serverActive=true;pending.resolve(ok(activation));await start;await vi.waitFor(()=>expect(c.view.phase).toBe("active"));
    expect(fetch.mock.calls.filter(([p])=>p.endsWith("activations"))).toHaveLength(1);
  });
});
