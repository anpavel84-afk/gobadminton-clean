import { describe, expect, it, vi } from "vitest";
import { RadarController } from "../src/lib/radar-controller";
import type { apiFetch } from "../src/lib/api-client";
const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const fix = () => Promise.resolve({ latitude: 55.75, longitude: 37.61, accuracyMeters: 25, capturedAt: future(0) });
function harness(mode: string | undefined = "live", initial = "off") {
  const active = { state: "active", ownerHere: true, activationId: "a", version: 1, policyVersion: "radar-mvp-v1", exposureMode: mode, expiresAt: future(900), hardExpiresAt: future(1800), foregroundUntil: future(90), locationValidUntil: future(360), nextLocationUpdateAt: future(300) };
  const ok = (data: unknown) => ({ ok: true, status: 200, data });
  const request = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/v1/me") return ok({ id: "user", csrfToken: "csrf" });
    if (path === "/v1/me/social-profile") return ok({ version: 3, socialEligible: true, displayName: "Player", radarConsented: false, cityId: "a0000000-0000-4000-8000-000000000001" });
    if (path.endsWith("nearby")) return ok({ state: "empty", exposureMode: mode, items: [], displayTtlSeconds: 45, refreshAfterSeconds: 30 });
    if (path.endsWith("/current") && !init?.method) return ok({ ...active, state: initial });
    return ok(active);
  });
  const c = new RadarController(request as unknown as typeof apiFetch);
  return { c, request };
}
describe("live Radar explicit opt-in", () => {
  it("bootstraps a missing live profile name from the account and does not publish directory", async () => {
    const ok = (data: unknown) => ({ ok: true, status: 200, data });
    const request = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "/v1/me") return ok({ id: "user", displayName: "Account Name", csrfToken: "csrf" });
      if (path === "/v1/me/social-profile" && !init?.method) {
        return ok({ version: 0, socialEligible: true, displayName: "", radarConsented: false, directoryVisible: false });
      }
      if (path === "/v1/me/social-profile") {
        const body = JSON.parse(String(init?.body)) as { displayName?: string; directoryVisible?: boolean };
        expect(body.displayName).toBe("Account Name");
        expect(body).not.toHaveProperty("directoryVisible");
        return ok({ version: 1, socialEligible: true, displayName: "Account Name", radarConsented: true, directoryVisible: false });
      }
      if (path.endsWith("nearby")) return ok({ state: "empty", exposureMode: "live", items: [], displayTtlSeconds: 45, refreshAfterSeconds: 30 });
      if (path.endsWith("/current") && !init?.method) return ok({ state: "off", ownerHere: false, policyVersion: "radar-mvp-v1", exposureMode: "live" });
      return ok({ state: "active", ownerHere: true, activationId: "a", version: 1, policyVersion: "radar-mvp-v1", exposureMode: "live", expiresAt: future(900), hardExpiresAt: future(1800), foregroundUntil: future(90), locationValidUntil: future(360), nextLocationUpdateAt: future(300) });
    });
    const c = new RadarController(request as unknown as typeof apiFetch);
    await c.reconcile();
    c.permission();
    await c.activate(fix);
    expect(c.view.phase).toBe("active");
  });

  it("ordinary load/ticks and unconfirmed activation never acquire GPS or mutate consent", async () => {
    const { c, request } = harness(); const gps = vi.fn(fix);
    await c.reconcile(); c.tick(); await c.activate(gps);
    expect(gps).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    c.permission(); expect(gps).not.toHaveBeenCalled();
    await c.activate(gps);
    expect(gps).toHaveBeenCalledTimes(1);
    const patch = request.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(patch![1]!.body as string)).toEqual({ expectedVersion: 3, radarConsented: true, radarConsentPolicyVersion: "radar-mvp-v1" });
    expect(request.mock.calls.findIndex(([p]) => p === "/v1/me/radar/activations")).toBeGreaterThan(request.mock.calls.indexOf(patch!));
    expect(c.view.phase).toBe("active");
  });
  it("denial before start writes neither consent nor activation", async () => {
    const { c, request } = harness(); await c.reconcile(); c.permission();
    await c.activate(() => Promise.reject({ code: 1 }));
    expect(c.view.phase).toBe("denied");
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it.each([undefined, "unexpected"])("unknown exposure %s never acquires GPS", async mode => {
    const { c } = harness(mode === undefined ? "unexpected" : mode); await c.reconcile();
    if (mode === undefined) c.view = { ...c.view, exposureMode: null };
    c.permission(); const gps = vi.fn(fix); await c.activate(gps);
    expect(gps).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])("failed active refresh %s stops the exact generation", async code => {
    const { c, request } = harness("live", "active"); await c.reconcile();
    await c.activate(() => Promise.reject({ code }), "location");
    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    expect(c.view.phase).toBe(code === 1 ? "denied" : "location_error");
    expect(c.view.status?.state).toBe("off");
  });
  it("deliberate renew before the geo cooldown sends no new fix", async () => {
    const { c, request } = harness("live", "active"); await c.reconcile();
    const gps = vi.fn(fix); await c.activate(gps, "renew");
    expect(gps).not.toHaveBeenCalled();
    const renew = request.mock.calls.find(([p]) => p.endsWith("/renew"));
    expect(JSON.parse(renew![1]!.body as string)).toEqual({ activationId: "a", expectedVersion: 1 });
  });
  it("unsupported region during update stops old presence and offers directory fallback", async () => {
    const { c, request } = harness("live", "active"); await c.reconcile();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => path.endsWith("/current") && init?.method === "PATCH" ? { ok: false, status: 422, problem: { code: "RADAR_REGION_UNSUPPORTED" } } as never : original(path, init));
    await c.activate(fix, "location");
    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    expect(c.view.status?.state).toBe("off");
    expect(c.view.notice).toContain("в этом регионе");
  });
  it("permission revocation stops active Radar without another GPS call", async () => {
    const { c, request } = harness("live", "active"); await c.reconcile();
    await c.permissionDenied();
    expect(c.view.phase).toBe("denied"); expect(c.view.items).toEqual([]);
    expect(request.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it("hidden pending GPS never starts; demo ignores browser permission revocation", async () => {
    const { c, request } = harness(); await c.reconcile(); c.permission();
    let resolve!: (v: Awaited<ReturnType<typeof fix>>) => void;
    const start = c.activate(() => new Promise(r => { resolve = r; })); c.visibility(false);
    resolve(await fix()); await start;
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    const demo = harness("synthetic_demo", "active"); await demo.c.reconcile();
    const count = demo.request.mock.calls.length; await demo.c.permissionDenied();
    expect(demo.request.mock.calls).toHaveLength(count); expect(demo.c.view.phase).toBe("active");
  });

  it("unauthenticated Radar stays fenced and never acquires GPS", async () => {
    const request = vi.fn(async () => ({ ok: false as const, status: 401, problem: { code: "UNAUTHENTICATED" } }));
    const c = new RadarController(request as unknown as typeof apiFetch);
    const gps = vi.fn(fix);
    await c.reconcile();
    expect(c.view.phase).toBe("guest");
    c.permission();
    await c.activate(gps);
    expect(gps).not.toHaveBeenCalled();
  });
});
