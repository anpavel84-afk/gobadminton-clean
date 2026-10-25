import { describe, expect, it } from "vitest";
import { eligibleGames, normalizeDiscovery } from "../../src/games/games-discovery.query";
describe("Wave D reuses server public discovery authority", () => {
  it("keeps public/published scope and canonical ID predicate for venue schedules", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const result = eligibleGames(normalizeDiscovery({ cityId: id, venueId: id, temporalScope: "upcoming" }));
    expect(result.where).toContain("g.visibility = 'public'");
    expect(result.where).toContain("g.status = 'published'");
    expect(result.where).toContain("g.starts_at > statement_timestamp()");
    expect(result.where).toContain("SELECT id FROM effective_venues WHERE source_id");
    expect(result.where).not.toContain("name =");
    expect(result.params).toEqual([id, id]);
  });
});
