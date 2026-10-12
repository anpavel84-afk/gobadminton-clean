import { describe, expect, it, vi } from "vitest";
import { RadarController } from "../src/lib/radar-controller";
import { DEMO_MOSCOW_CITY_ID } from "../src/lib/radar-demo-fix";
import type { RadarConfig } from "../src/lib/unified-directory";
import type { apiFetch } from "../src/lib/api-client";
const policy = "radar-geographic-sharing-v2";
const wire = "players-unified-radar-v1";
const disclosure = { id: "radar-geographic-sharing-v2.ru.v1", sha256: "4db62187f338a24b05cecd1a379da01e64027161e3171043c1c6233546fac19f", text: "Передаю геопозицию пока Radar включён", locale: "ru" as const };
const config: RadarConfig = { exposureMode: "live", publishingV2: { enabled: true }, unifiedDirectory: { enabled: true, contractVersion: wire, policyVersion: policy, pageLimit: 50, mapPageLimit: 100, models: ["regional_grid_100m_v1"], disclosure }, cities: [] };
const fix = { latitude: 55.75, longitude: 37.61, accuracyMeters: 25, capturedAt: new Date().toISOString() };
function harness() {
  const request = vi.fn(async (path: string) => ({ ok: true, status: 200, data: path === "/v1/me" ? { id: "viewer", csrfToken: "csrf" } : { state: "off", ownerHere: false, policyVersion: policy, contractVersion: wire } })) as unknown as typeof apiFetch;
  const controller = new RadarController(request); controller.configure(config); controller.setResultView("none");
  return { controller, request };
}
describe("negotiated v2 sharing", () => {
  it("cold/off/permission do not acquire; explicit start sends the exact receipt with no old profile consent PATCH", async () => {
    const { controller, request } = harness(); const acquire = vi.fn(async () => fix);
    await controller.reconcile(); expect(controller.view.exposureMode).toBe("live"); controller.permission();
    expect(acquire).not.toHaveBeenCalled(); await controller.activate(acquire);
    expect(acquire).toHaveBeenCalledTimes(1);
    const start = vi.mocked(request).mock.calls.find(([path]) => path === "/v1/me/radar/activations")!;
    expect(JSON.parse(start[1]!.body as string)).toEqual({ location: fix, contractVersion: wire, consentPolicyVersion: policy, consent: { accepted: true, disclosureId: disclosure.id, disclosureHash: disclosure.sha256 } });
    expect(vi.mocked(request).mock.calls.some(([path]) => path === "/v1/me/social-profile")).toBe(false);
  });
  it("publishing disabled after disclosure prevents even a location acquisition", async () => {
    const { controller, request } = harness(); await controller.reconcile(); controller.permission();
    controller.configure({ ...config, publishingV2: { enabled: false } }); const acquire = vi.fn(async () => fix);
    await controller.activate(acquire); expect(acquire).not.toHaveBeenCalled(); expect(controller.view.phase).toBe("disabled");
    expect(vi.mocked(request).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("metadata-only OFF status preserves negotiated synthetic exposure and admitted profile city", async () => {
    const request = vi.fn(async (path: string) => ({ ok: true, status: 200, data: path === "/v1/me" ? { id: "viewer", csrfToken: "csrf" } : path === "/v1/me/social-profile" ? { cityId: DEMO_MOSCOW_CITY_ID } : { state: "off", ownerHere: false, policyVersion: policy, contractVersion: wire } })) as unknown as typeof apiFetch;
    const controller = new RadarController(request); controller.configure({ ...config, exposureMode: "synthetic_demo" }, DEMO_MOSCOW_CITY_ID); controller.setResultView("none");
    await controller.reconcile(); expect(controller.view.demoCityId).toBe(DEMO_MOSCOW_CITY_ID); expect(controller.usesSyntheticLocation()).toBe(true);
    expect(controller.view.exposureMode).toBe("synthetic_demo");
  });
  it("viewer disabled independently never falls back to legacy consent publication", async () => {
    const { controller, request } = harness(); controller.configure({ ...config, unifiedDirectory: { ...config.unifiedDirectory, enabled: false } });
    await controller.reconcile(); controller.permission(); await controller.activate(async () => fix);
    const start = vi.mocked(request).mock.calls.find(([path]) => path === "/v1/me/radar/activations")!;
    expect(JSON.parse(start[1]!.body as string).contractVersion).toBe(wire);
    expect(vi.mocked(request).mock.calls.some(([path]) => path === "/v1/me/social-profile")).toBe(false);
  });
});
