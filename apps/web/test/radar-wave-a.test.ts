import { describe, expect, it, vi } from "vitest";
import { RadarController } from "../src/lib/radar-controller";
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
  it("recenter fits about ten km around coarse center, independent of participant pins", () => {
    const bounds = radarNeighborhood({ latitude: 55.75, longitude: 37.61 })!;
    expect((bounds[1][1] - bounds[0][1]) * 111.32).toBeCloseTo(20);
    expect((bounds[1][0] + bounds[0][0]) / 2).toBeCloseTo(37.61);
    for (const center of [undefined, { latitude: NaN, longitude: 37 }, { latitude: 0, longitude: 0 }]) expect(radarNeighborhood(center)).toBeNull();
  });
});
