import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryCityController, DISCOVERY_CITY_KEY, MOSCOW, PETERSBURG, readDeviceCities, supportedLocation, validManual } from "../src/lib/discovery-city";
import type { apiFetch } from "../src/lib/api-client";
const ok = (data: unknown) => ({ ok: true, data, status: 200 });
const fail = (status = 404) => ({ ok: false, status, error: "fixture" });
const me = { id: "A", displayName: "Анна", csrfToken: "csrf-A" };
function deferred() { let resolve!: (v: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
function storage() { const data = new Map<string,string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key,value); } } as Storage; }
function manual(cityId: string, sync = "acknowledged") { return { cityId, source: "manual", sync, savedAt: Date.now(), expiresAt: Date.now() + 365 * 86400000 }; }
const controllers: DiscoveryCityController[] = [];
function harness(handler: (path: string, init?: RequestInit) => unknown, device = storage()) {
  const request = vi.fn(handler); const c = new DiscoveryCityController(request as unknown as typeof apiFetch, () => device); controllers.push(c); return { c, request, device };
}
const flush = async () => { await vi.advanceTimersByTimeAsync(1); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T12:00:00Z")); });
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
describe("discovery city exact contract and asynchronous authority", () => {
  it("SSR starts neutral, supported hint opens Games directly and does not write preferences", async () => {
    const {c,request} = harness(p => p === "/v1/me" ? fail(401) : ok({ cityId: PETERSBURG, source: "ip" }));
    expect(c.snapshot().location).toBeNull(); const work = c.start(); await flush(); await work;
    expect(c.snapshot().location?.cityId).toBe(PETERSBURG);
    expect(request.mock.calls.some(([,i]) => i?.method)).toBe(false);
  });
  it("500ms hint deadline falls back to Moscow and ignores a late reply", async () => {
    const hint = deferred(); const {c} = harness(p => p === "/v1/me" ? fail(401) : hint.promise);
    const work = c.start(); await vi.advanceTimersByTimeAsync(501); await work;
    expect(c.snapshot().location?.cityId).toBe(MOSCOW);
    hint.resolve(ok({cityId:PETERSBURG,source:"ip"})); await flush(); expect(c.snapshot().location?.cityId).toBe(MOSCOW);
  });
  it("manual Moscow survives a late Petersburg hint and browser restart", async () => {
    const device = storage(); const hint = deferred(); const {c} = harness(p => p === "/v1/me" ? fail(401) : hint.promise, device);
    const work = c.start(); await vi.advanceTimersByTimeAsync(501); await work; expect(c.choose(MOSCOW)).toBe(true);
    hint.resolve(ok({cityId:PETERSBURG,source:"ip"})); await flush(); expect(c.snapshot().location?.cityId).toBe(MOSCOW);
    const next = harness(p => p === "/v1/me" ? fail(401) : ok({cityId:PETERSBURG,source:"ip"}), device).c;
    const reload = next.start(); await flush(); await reload; expect(next.snapshot().location?.cityId).toBe(MOSCOW);
  });
  it("account manual outranks guest; hint never changes the public profile", async () => {
    const device = storage(); device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({guest:manual(MOSCOW)}));
    const {c,request} = harness(p => p === "/v1/me" ? ok(me) : p.includes("preference") ? ok({cityId:PETERSBURG,version:4}) : ok({cityId:MOSCOW,source:"default"}),device);
    await c.start(); expect(c.snapshot().location?.cityId).toBe(PETERSBURG);
    expect(request.mock.calls.some(([p,i]) => p.includes("social-profile") || i?.method)).toBe(false);
  });
  it("confirmed-empty imports guest once with CSRF and exact expectedVersion", async () => {
    const device=storage();device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({guest:manual(PETERSBURG)}));
    const {c,request}=harness((p,i) => p === "/v1/me" ? ok(me) : p.includes("preference") ? ok(i?.method ? {cityId:PETERSBURG,version:1} : {cityId:null,version:0}) : ok({cityId:MOSCOW,source:"default"}),device);
    await c.start(); const puts=request.mock.calls.filter(([,i])=>i?.method === "PUT"); expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0]![1]!.body as string)).toEqual({cityId:PETERSBURG,expectedVersion:0});
    expect(puts[0]![1]).toMatchObject({csrfToken:"csrf-A",idempotent:true});expect(c.snapshot().unsynced).toBe(false);
  });
  it("guest import conflict adopts real account preference instead of overwriting it", async () => {
    let reads=0;const device=storage();device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({guest:manual(PETERSBURG)}));
    const {c,request}=harness((p,i)=>p === "/v1/me" ? ok(me) : p.includes("preference") ? i?.method ? fail(409) : ok(++reads === 1 ? {cityId:null,version:0} : {cityId:MOSCOW,version:1}) : ok({cityId:MOSCOW,source:"default"}),device);
    await c.start();expect(c.snapshot().location?.cityId).toBe(MOSCOW);expect(request.mock.calls.filter(([,i])=>i?.method === "PUT")).toHaveLength(1);
  });
  it("404 is safe device fallback and never falsely acknowledges an account write", async () => {
    const {c}=harness(p => p === "/v1/me" ? ok(me) : p.includes("preference") ? fail(404) : ok({cityId:MOSCOW,source:"default"}));
    await c.start(); c.choose(PETERSBURG); await flush(); expect(c.snapshot()).toMatchObject({unsynced:true,location:{cityId:PETERSBURG}});
    expect(c.snapshot().notice).not.toContain("Город сохранён");
  });
  it("pending scoped manual survives reload and ignores a conflicting account read", async () => {
    const device=storage();device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({accounts:{A:manual(PETERSBURG,"pending")}}));
    const {c}=harness((p,i) => p === "/v1/me" ? ok(me) : p.includes("preference") ? ok(i?.method ? {cityId:PETERSBURG,version:8} : {cityId:MOSCOW,version:7}) : ok({cityId:MOSCOW,source:"default"}),device);
    await c.start(); expect(c.snapshot()).toMatchObject({unsynced:false,location:{cityId:PETERSBURG}});
  });
  it("account lookup is bounded; late manual account replaces provisional hint", async () => {
    const preference=deferred();const {c}=harness(p=>p === "/v1/me" ? ok(me) : p.includes("preference") ? preference.promise : ok({cityId:MOSCOW,source:"default"}));
    const work=c.start();await vi.advanceTimersByTimeAsync(1501);expect(c.snapshot().location?.cityId).toBe(MOSCOW);
    preference.resolve(ok({cityId:PETERSBURG,version:2}));await work;expect(c.snapshot().location?.cityId).toBe(PETERSBURG);
  });
  it("manual click fences late account/hint and rapid PUT replies", async () => {
    const preference=deferred(),write=deferred();let gets=0;
    const {c}=harness((p,i)=>p === "/v1/me" ? ok(me) : p.includes("preference") ? i?.method ? write.promise : ++gets === 1 ? preference.promise : ok({cityId:null,version:0}) : ok({cityId:MOSCOW,source:"default"}));
    const work=c.start();await vi.advanceTimersByTimeAsync(1501);c.choose(PETERSBURG);await flush();c.choose(MOSCOW);
    preference.resolve(ok({cityId:PETERSBURG,version:9}));await work;write.resolve(ok({cityId:PETERSBURG,version:1}));await flush();
    expect(c.snapshot().location?.cityId).toBe(MOSCOW);expect(c.snapshot().unsynced).toBe(true);
  });
  it("late failed account read cannot restore an older cache after manual save succeeds", async () => {
    const old = deferred(); let reads=0;const device=storage();device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({accounts:{A:manual(MOSCOW)}}));
    const {c}=harness((p,init)=>p === "/v1/me" ? ok(me) : p.includes("preference") ? init?.method ? ok({cityId:PETERSBURG,version:3}) : ++reads === 1 ? old.promise : ok({cityId:MOSCOW,version:2}) : ok({cityId:MOSCOW,source:"default"}),device);
    const work=c.start();await vi.advanceTimersByTimeAsync(1501);c.choose(PETERSBURG);await flush();expect(c.snapshot().unsynced).toBe(false);
    old.resolve(fail(503));await work;expect(c.snapshot()).toMatchObject({location:{cityId:PETERSBURG},unsynced:false});
  });
  it("409 retries explicit choice once with fresh version then retains pending intent", async () => {
    let version=0;const {c,request}=harness((p,i)=>p === "/v1/me" ? ok(me) : p.includes("preference") ? i?.method ? fail(409) : ok({cityId:null,version:version++}) : ok({cityId:MOSCOW,source:"default"}));
    const start=c.start();await flush();await start;c.choose(PETERSBURG);await flush();
    const puts=request.mock.calls.filter(([,i])=>i?.method === "PUT");expect(puts).toHaveLength(2);
    expect(puts.map(([,i])=>JSON.parse(i!.body as string).expectedVersion)).toEqual([0,1]);expect(c.snapshot().unsynced).toBe(true);
  });
  it("logout and account switch fence all old private replies and clear account caches", async () => {
    let actor: string|null="A";const pending=deferred();const device=storage();
    const {c}=harness(p=>p === "/v1/me" ? actor ? ok({...me,id:actor}) : fail(401) : p.includes("preference") ? actor === "A" ? pending.promise : ok({cityId:null,version:0}) : ok({cityId:MOSCOW,source:"default"}),device);
    const old=c.start();await vi.advanceTimersByTimeAsync(1501);actor=null;const logout=c.start(true);await flush();await logout;
    pending.resolve(ok({cityId:PETERSBURG,version:4}));await old;expect(c.snapshot().location?.cityId).toBe(MOSCOW);
    expect(readDeviceCities(device).accounts).toEqual({});actor="B";const login=c.start(true);await flush();await login;expect(c.snapshot().location?.cityId).toBe(MOSCOW);
  });
  it("blocked storage retains memory choice and reports failure without a picker", async () => {
    const {c}=harness(p=>p === "/v1/me" ? fail(401) : fail(404), {getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");}} as unknown as Storage);
    const work=c.start();await flush();await work;c.choose(PETERSBURG);expect(c.snapshot()).toMatchObject({location:{cityId:PETERSBURG},notice:"Не удалось сохранить город на этом устройстве."});
  });
  it("cross-tab explicit choice invalidates in-flight intent in the current scope", async () => {
    const {c,device}=harness(p=>p === "/v1/me" ? fail(401) : ok({cityId:MOSCOW,source:"default"}));
    const work=c.start();await flush();await work;device.setItem(DISCOVERY_CITY_KEY,JSON.stringify({guest:manual(PETERSBURG),accounts:{B:manual(MOSCOW)}}));c.storageChanged();expect(c.snapshot().location?.cityId).toBe(PETERSBURG);
  });
  it("rejects expired/corrupt/municipal values and derives labels from supported IDs", () => {
    expect(validManual({...manual(MOSCOW),expiresAt:Date.now()-1})).toBe(false);
    expect(validManual({...manual(MOSCOW),cityId:"municipality"})).toBe(false);
    expect(validManual({...manual(MOSCOW),serverVersion:NaN})).toBe(false);
    const device=storage();device.setItem(DISCOVERY_CITY_KEY,"null");expect(readDeviceCities(device).accounts).toEqual({});
    expect(supportedLocation(MOSCOW)).toEqual({cityId:MOSCOW,nameRu:"Москва",timezone:"Europe/Moscow"});expect(supportedLocation("municipality")).toBeNull();
  });
});
