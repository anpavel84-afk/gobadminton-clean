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
    // Same read-only identity fallback as public card: proof first, else trainer_led+profile owner.
    expect(where).toContain("trainer_profiles");
    expect(where).toContain("g.activity_kind = 'trainer_led'");
    expect(where).toContain("g.trainer_profile_id IS NOT NULL");
    expect(where).toContain("p.role = 'training'");
    expect(params).toContain(cityId);
    expect(params).toContain(handle);
    // Single bound parameter for both proof and fallback arms — no write/eligibility side effects.
    expect(params.filter((p) => p === handle)).toHaveLength(1);
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
    expect(where).not.toContain("trainer_profiles");
  });
});
