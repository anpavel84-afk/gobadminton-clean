import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { radarHeaderStatus, radarRingFraction } from "../src/lib/radar-header";
import { confirmedSessionDeadline } from "../src/lib/radar-presentation";
import type { RadarView } from "../src/lib/radar-controller";
const now = Date.parse("2026-10-09T12:00:00Z");
const stamp = (n: number) => new Date(now + n * 1000).toISOString();
const active = { phase: "active", me: { id:"A" }, status: { state:"active", startedAt:stamp(0), expiresAt:stamp(900),hardExpiresAt:stamp(1800),foregroundUntil:stamp(100),locationValidUntil:stamp(120),nextLocationUpdateAt:stamp(60) }, now, confirmedOn:true, pendingStop:false, exposureMode:"live" } as RadarView;
const sessionSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/radar/RadarSessionProvider.tsx"),
  "utf8",
);
describe("compact Radar is a pure honest projection", () => {
  it.each(["checking","guest","off","permission","locating","activating","disabled"])("%s without server confirmation stays hidden", phase => {
    expect(radarHeaderStatus({...active, phase, confirmedOn:false} as RadarView)).toBeNull();
  });
  it("renders an authoritative decreasing session ring with no clock beyond expiry", () => {
    expect(radarRingFraction(active)).toBeGreaterThan(0);
    expect(radarRingFraction({...active,now:now+150000})).toBeLessThan(radarRingFraction(active));
    expect(radarRingFraction({...active,now:now+900000})).toBe(0);
    expect(radarRingFraction({...active,confirmedOn:false})).toBe(0);
    expect(radarRingFraction({...active,status:{...active.status!,startedAt:"bad"} as RadarView["status"]})).toBe(0);
  });
  it("header until uses confirmed session expiry, not foregroundUntil or heartbeat", () => {
    expect(confirmedSessionDeadline(active.status as { expiresAt: string; hardExpiresAt: string })).toBe(now + 900000);
    expect(radarHeaderStatus(active)).toEqual({tone:"active",text:"Радар включён",until:now+900000});
    // Display until is session end; past foreground authority still forces checking (enforcement elsewhere).
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
  it("invalid session timestamps stay neutral; demo remains explicit", () => {
    expect(radarHeaderStatus({...active,status:{...active.status!,expiresAt:"invalid"} as RadarView["status"]})?.tone).toBe("checking");
    expect(radarHeaderStatus({...active,exposureMode:"synthetic_demo"})?.text).toBe("Радар включён · демо");
  });
  it("ring tracks expiresAt capped by hardExpiresAt, not foreground pulse", () => {
    const shortHard = {...active, status:{...active.status!, expiresAt:stamp(900), hardExpiresAt:stamp(300)} as RadarView["status"]};
    expect(radarRingFraction({...shortHard, now:now+150000})).toBeLessThan(radarRingFraction(shortHard));
    expect(radarRingFraction({...shortHard, now:now+300000})).toBe(0);
  });
  it("QA-04: expiry warning dismissal survives background/checking; resets on identity/session end", () => {
    expect(sessionSource).toContain("warnedExpiryKey");
    expect(sessionSource).toContain("warnedIdentityId");
    expect(sessionSource).toContain('transientPhase');
    expect(sessionSource).toContain('"background"');
    expect(sessionSource).toContain('"checking"');
    // Must not clear sticky dismissal solely because running became false.
    expect(sessionSource).not.toMatch(/if\s*\(\s*!running\s*\)\s*\{\s*warnedExpiryKey\.current\s*=\s*null/);
    expect(sessionSource).toContain("setExpiryPrompt(null)");
    expect(sessionSource).toContain("Escape");
    expect(sessionSource).toContain("pointerdown");
  });
});
