import { describe, expect, it, vi } from "vitest";
import { confirmedDirectoryActivation, RadarController } from "../src/lib/radar-controller";
import { radarNeighborhood } from "../src/lib/radar-camera";
import { effectiveDeadline } from "../src/lib/radar-presentation";
import type { apiFetch } from "../src/lib/api-client";
import type { RadarActivation } from "../src/lib/radar-types";
const origin = Date.parse("2030-01-01T00:00:00Z");
const stamp = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
const active: RadarActivation = { state: "active", activationId: "activation", version: 1, ownerHere: true, policyVersion: "policy", exposureMode: "live", regionId: "moscow", radiusBucketKm: 5, startedAt: stamp(0), expiresAt: stamp(900), hardExpiresAt: stamp(1800), foregroundUntil: stamp(90), locationValidUntil: stamp(360), nextLocationUpdateAt: stamp(300), nextRadiusChangeAt: stamp(0) };
const fix = async () => ({ latitude: 55.75, longitude: 37.61, accuracyMeters: 25, capturedAt: stamp(0) });
function harness() {
  let now = origin, actor = "owner", state = "off";
  const request = vi.fn(async (path: string, init?: { method?: string }) => ({ ok: true, status: 200, data: path === "/v1/me" ? { id: actor, csrfToken: actor } : path === "/v1/me/social-profile" ? { displayName: "Player", socialEligible: true, radarConsented: true, radarConsentPolicyVersion: "policy" } : path.endsWith("/current") && !init?.method ? { ...active, state } : active }));
  const c = new RadarController(request as unknown as typeof apiFetch, () => now); c.setResultView("none");
  return { c, request, state: (value: string) => { state = value; }, actor: (value: string) => { actor = value; }, time: (seconds: number) => { now = origin + seconds * 1000; } };
}
describe("Wave A existing Radar lifecycle", () => {
  it.each(["15m", "1h", "until_off"] as const)("keeps %s intent out of the wire lease and requires consent", async duration => {
    const { c, request } = harness(); await c.reconcile();
    const gps = vi.fn(fix); await c.activate(gps); expect(gps).not.toHaveBeenCalled();
    c.permission(); c.chooseDuration(duration); await c.activate(gps);
    expect(c.view.phase).toBe("active"); expect(c.duration).toBe(duration);
    expect(effectiveDeadline(c.view.status as RadarActivation)).toBe(origin + 90000);
    expect(JSON.stringify(request.mock.calls)).not.toContain(duration);
    expect(gps).toHaveBeenCalledTimes(1);
  });
  it("SPA result-view changes preserve confirmed session without a new activation", async () => {
    const { c, request, state } = harness(); state("active"); await c.reconcile();
    for (let i = 0; i < 4; i++) { c.setResultView("none"); await c.checkIdentity(); }
    expect(c.view.confirmedOn).toBe(true); expect(c.view.status).toMatchObject({ activationId: "activation" });
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it("reload reads server expiry without automatically acquiring location or restarting", async () => {
    const { c, request, state } = harness(); state("expired"); await c.reconcile(); c.tick();
    expect(c.view.phase).toBe("expired"); expect(c.view.confirmedOn).toBe(false);
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it("account replacement and owned_elsewhere clear private rows and require explicit takeover", async () => {
    const { c, state, actor, request } = harness(); state("active"); await c.reconcile(); actor("second"); state("owned_elsewhere"); await c.checkIdentity();
    expect(c.view.me?.id).toBe("second"); expect(c.view.items).toEqual([]); expect(c.view.preview).toBeNull();
    expect(c.view.phase).toBe("owned_elsewhere"); expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it("long intent renews only a still-valid foreground lease without automatic GPS", async () => {
    const { c, request, time } = harness(); await c.reconcile(); c.permission(); c.chooseDuration("1h"); await c.activate(fix);
    // Model acknowledged foreground/location refreshes, with the original lease near expiry.
    c.view = { ...c.view, status: { ...active, foregroundUntil: stamp(950), locationValidUntil: stamp(1100), nextLocationUpdateAt: stamp(1000) } };
    time(850); c.tick();
    await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("/renew"))).toBe(true));
    const renewal = request.mock.calls.find(([path]) => path.endsWith("/renew"));
    expect(JSON.stringify(renewal)).not.toContain("latitude");
  });
  it("15 minute intent sends a stop rather than extending beyond its deadline", async () => {
    const { c, request, time } = harness(); await c.reconcile(); c.permission(); await c.activate(fix);
    c.view = { ...c.view, status: { ...active, expiresAt: stamp(1200), foregroundUntil: stamp(1000), locationValidUntil: stamp(1100) } };
    time(900); c.tick();
    await vi.waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    expect(request.mock.calls.some(([path]) => path.endsWith("/renew"))).toBe(false);
  });
  it.each(["navigation", "reconcile", "mutation", "heartbeat"])("retires the old account duration deadline on %s identity replacement", async route => {
    const { c, request, actor, state, time } = harness();
    await c.reconcile(); c.permission(); c.chooseDuration("1h"); await c.activate(fix);
    actor("replacement"); state("active");
    if (route === "navigation") await c.checkIdentity();
    else if (route === "reconcile") await c.reconcile();
    else if (route === "mutation") await c.activate(fix, "location");
    else { time(45); c.tick(); await vi.waitFor(() => expect(c.view.me?.id).toBe("replacement")); }
    expect(c.duration).toBe("15m");
    // B has its own longer, valid lease; A's one-hour deadline must not stop B.
    c.view = { ...c.view, status: { ...active, expiresAt: stamp(7200), hardExpiresAt: stamp(8000), foregroundUntil: stamp(4000), locationValidUntil: stamp(5000), nextLocationUpdateAt: stamp(4500) } };
    time(3600); c.tick();
    await c.checkIdentity();
    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(request.mock.calls.some(([path]) => path.endsWith("/renew"))).toBe(false);
  });
  it("blocks private directory access after heartbeat error even when directory refreshes", async () => {
    const { c, request, state, time } = harness(); state("active"); await c.reconcile();
    c.view = { ...c.view, status: { ...active, contractVersion: "players-unified-radar-v1" } };
    expect(confirmedDirectoryActivation(c.view)).toBe("activation");
    request.mockImplementationOnce(async () => ({ ok: true, status: 200, data: { id: "owner", csrfToken: "owner" } }))
      .mockImplementationOnce(async () => ({ ok: false, status: 503, data: undefined } as never));
    time(45); c.tick(); await vi.waitFor(() => expect(c.view.phase).toBe("error"));
    expect(c.view.status?.state).toBe("active");
    // A stale 30-second callback and a fresh directory response cannot reopen access.
    time(75);
    expect(confirmedDirectoryActivation(c.snapshot())).toBeNull();
    expect(confirmedDirectoryActivation({ ...c.view, confirmedOn: false, phase: "active" })).toBeNull();
  });
  it("recenter fits about ten km around coarse center, independent of participant pins", () => {
    const bounds = radarNeighborhood({ latitude: 55.75, longitude: 37.61 })!;
    expect((bounds[1][1] - bounds[0][1]) * 111.32).toBeCloseTo(20);
    expect((bounds[1][0] + bounds[0][0]) / 2).toBeCloseTo(37.61);
    for (const center of [undefined, { latitude: NaN, longitude: 37 }, { latitude: 0, longitude: 0 }]) expect(radarNeighborhood(center)).toBeNull();
  });
});
