import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_MOSCOW_LABEL, devMoscowFix } from "../src/lib/radar-dev-moscow";
import { acquireRadarLocation } from "../src/components/consumer/radar/RadarSessionProvider";
import { RadarController } from "../src/lib/radar-controller";
import { compatibleRadarConfig } from "../src/lib/unified-directory";
import type { RadarConfig } from "../src/lib/unified-directory";
afterEach(() => vi.unstubAllGlobals());
describe("private DEV Moscow location", () => {
  const config = { exposureMode: "live", devMoscowTest: { latitude: 55.7558, longitude: 37.6173, accuracyMeters: 25 } } as RadarConfig;
  it("requires exact host and private capability, otherwise leaves GPS as default", () => {
    for (const origin of ["https://gobadminton.ru", "http://dev.gobadminton.ru", "https://dev.gobadminton.ru:444", "https://dev.gobadminton.ru.evil"])
      expect(devMoscowFix(config, origin)).toBeNull();
    expect(devMoscowFix(null, "https://dev.gobadminton.ru")).toBeNull();
    expect(devMoscowFix({ ...config, exposureMode: "synthetic_demo" }, "https://dev.gobadminton.ru")).toBeNull();
  });
  it("returns the precise Moscow test fix with a new timestamp per acquisition and honest label", () => {
    const a = devMoscowFix(config, "https://dev.gobadminton.ru", 1000)!;
    const b = devMoscowFix(config, "https://dev.gobadminton.ru", 2000)!;
    expect(a).toEqual({ latitude: 55.7558, longitude: 37.6173, accuracyMeters: 25, capturedAt: new Date(1000).toISOString() });
    expect(b.capturedAt).not.toBe(a.capturedAt);
    expect(DEV_MOSCOW_LABEL).toBe("DEV · тестовая геолокация: Москва");
  });
  it("acquisition bypasses denied GPS only for private DEV capability and preserves real GPS elsewhere", async () => {
    const gps = vi.fn((success: (p: unknown) => void) => success({ coords:{ latitude:-23.55,longitude:-46.63,accuracy:50 }, timestamp:0 }));
    vi.stubGlobal("document", { hidden:false });
    vi.stubGlobal("window", { isSecureContext:true,location:{origin:"https://dev.gobadminton.ru"} });
    vi.stubGlobal("navigator", { geolocation:{getCurrentPosition:gps} });
    const c = new RadarController();
    c.configure(compatibleRadarConfig({ ...config, unifiedDirectory:{enabled:true,contractVersion:"players-unified-radar-v1",disclosure:{text:"consent"}},publishingV2:{enabled:true},cities:[] }));
    c.view = { ...c.view, me:{id:"private-config-owner",displayName:"Pl An",csrfToken:"csrf",locale:"ru",linkedProviders:[]} };
    await expect(acquireRadarLocation(c)).resolves.toMatchObject({latitude:55.7558,longitude:37.6173,accuracyMeters:25});
    expect(gps).not.toHaveBeenCalled();
    vi.stubGlobal("window", { isSecureContext:true,location:{origin:"https://gobadminton.ru"} });
    await expect(acquireRadarLocation(c)).resolves.toMatchObject({latitude:-23.55,longitude:-46.63});
    expect(gps).toHaveBeenCalledOnce();
    vi.stubGlobal("document", { hidden:true });
    await expect(acquireRadarLocation(c)).rejects.toMatchObject({code:2});
  });

});
