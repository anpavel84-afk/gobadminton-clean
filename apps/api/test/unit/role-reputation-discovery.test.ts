import { describe, expect, it } from "vitest";
import { eligibleGames, normalizeDiscovery } from "../../src/games/games-discovery.query";

const cityId = "10000000-0000-4000-8000-000000000001";
const handle = "a".repeat(32);

describe("#394 role reputation discovery filter", () => {
  it("binds trainerRoleHandle into eligibleGames without dropping city/day/activity privacy gates", () => {
    const filter = normalizeDiscovery({
      cityId,
      activityKind: "trainer_led",
      temporalScope: "upcoming",
      trainerRoleHandle: handle.toUpperCase(),
    });
    expect(filter.trainerRoleHandle).toBe(handle);
    expect(filter.activityKind).toBe("trainer_led");
    const { where, params } = eligibleGames(filter, true);
    expect(where).toContain("g.status = 'published'");
    expect(where).toContain("g.visibility = 'public'");
    expect(where).toContain("game_moderation_state");
    expect(where).toContain("role_reputation_subjects");
    expect(where).toContain("grp.role = 'training'");
    expect(params).toContain(cityId);
    expect(params).toContain(handle);
  });

  it("rejects malformed trainerRoleHandle", () => {
    expect(() =>
      normalizeDiscovery({ cityId, trainerRoleHandle: "not-a-handle" }),
    ).toThrow();
  });

  it("keeps trainerRoleHandle null when omitted", () => {
    const filter = normalizeDiscovery({ cityId });
    expect(filter.trainerRoleHandle).toBeNull();
    const { where } = eligibleGames(filter);
    expect(where).not.toContain("role_reputation_subjects");
  });
});
