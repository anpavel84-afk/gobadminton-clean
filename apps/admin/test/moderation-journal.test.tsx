import { describe, expect, it } from "vitest";
import { freshStepUp, visibleNavigation, type Session } from "../src/lib/admin-client";

describe("ModerationJournal affordances", () => {
  it("clears metadata view semantics when step-up is stale", () => {
    const now = Date.now();
    const fresh: Session = {
      principalId: "p",
      userId: "u",
      status: "active",
      version: 1,
      roles: ["superadmin"],
      sessionId: "s",
      expiresAt: new Date(now + 3600000).toISOString(),
      stepUpAt: new Date(now - 1000).toISOString(),
      csrfToken: "csrf",
    };
    const stale = { ...fresh, stepUpAt: new Date(now - 11 * 60 * 1000).toISOString() };
    expect(freshStepUp(fresh, now)).toBe(true);
    expect(freshStepUp(stale, now)).toBe(false);
  });

  it("keeps security nav superadmin-only and never treats metadata as raw Cases source", () => {
    // Navigation affordance only — API enforces audit.security.read + step-up.
    expect(visibleNavigation(["superadmin"]).some((i) => i.id === "security")).toBe(true);
    expect(visibleNavigation(["moderator"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["support"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["pilot_viewer"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["content_manager"]).some((i) => i.id === "security")).toBe(false);
  });
});
