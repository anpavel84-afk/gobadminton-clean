import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Toggle } from "../src/components/consumer/players/ProfileComposition";
import { radarSwitchDisabled } from "../src/components/consumer/radar/RadarControls";
import type { RadarView } from "../src/lib/radar-controller";
const view = { phase: "off", confirmedOn: false } as RadarView;
describe("Radar confirmed switch semantics", () => {
  it("keeps a stable accessible switch name and binary checked state while pending", () => {
    const html = renderToStaticMarkup(<Toggle label="Radar" on disabled describedBy="status" helper="Выключаем Radar…" />);
    expect(html).toContain('role="switch"'); expect(html).toContain('aria-label="Radar"'); expect(html).toContain('aria-checked="true"'); expect(html).toContain('aria-describedby="status"'); expect(html).toContain('disabled=""'); expect(html).not.toContain('aria-pressed');
    expect(renderToStaticMarkup(<Toggle label="Radar" on={false} />)).toContain('aria-checked="false"');
  });
  it("unknown and mutating states disable competing input; elsewhere and empty ON remain stoppable", () => {
    for (const phase of ["checking", "locating", "activating", "stopping", "error", "background", "permission", "disabled"] as const) expect(radarSwitchDisabled({ ...view, phase })).toBe(true);
    for (const phase of ["guest", "off", "active", "owned_elsewhere", "stopped"] as const) expect(radarSwitchDisabled({ ...view, phase })).toBe(false);
  });
});
