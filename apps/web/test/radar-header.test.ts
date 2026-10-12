import { describe, expect, it } from "vitest";
import { radarHeaderStatus } from "../src/lib/radar-header";
import type { RadarView } from "../src/lib/radar-controller";
const now = Date.parse("2026-10-09T12:00:00Z");
const stamp = (n: number) => new Date(now + n * 1000).toISOString();
const active = { phase: "active", me: { id:"A" }, status: { state:"active", expiresAt:stamp(300),hardExpiresAt:stamp(400),foregroundUntil:stamp(100),locationValidUntil:stamp(120),nextLocationUpdateAt:stamp(60) }, now, confirmedOn:true, pendingStop:false, exposureMode:"live" } as RadarView;
describe("compact Radar is a pure honest projection", () => {
  it.each(["checking","guest","off","permission","locating","activating","disabled"])("%s without server confirmation stays hidden", phase => {
    expect(radarHeaderStatus({...active, phase, confirmedOn:false} as RadarView)).toBeNull();
  });
  it("uses the effective deadline, not just expiresAt", () => {
    expect(radarHeaderStatus(active)).toEqual({tone:"active",text:"Радар включён",until:now+100000});
    expect(radarHeaderStatus({...active,now:now+101000})?.tone).toBe("checking");
  });
  it("due fix is attention, with no implicit GPS request", () => {
    expect(radarHeaderStatus({...active,now:now+61000})).toEqual({tone:"attention",text:"Радар: обновите геопозицию"});
  });
  it.each(["error","checking","background","denied","location_error"])("confirmed %s is never green", phase => {
    expect(radarHeaderStatus({...active,phase} as RadarView)?.tone).toBe("checking");
  });
  it("stop uncertainty wins and other-device ownership remains distinct", () => {
    expect(radarHeaderStatus({...active,pendingStop:true})?.text).toBe("Проверить выключение радара");
    expect(radarHeaderStatus({...active,phase:"owned_elsewhere"})?.text).toBe("Радар включён на другом устройстве");
    expect(radarHeaderStatus({...active,me:null})).toBeNull();
  });
  it("invalid timestamps stay neutral; demo remains explicit", () => {
    expect(radarHeaderStatus({...active,status:{...active.status!,foregroundUntil:"invalid"} as RadarView["status"]})?.tone).toBe("checking");
    expect(radarHeaderStatus({...active,exposureMode:"synthetic_demo"})?.text).toBe("Радар включён · демо");
  });
});
