import { describe, expect, it } from "vitest";
import { rankCurrentCohort, type NearbyCandidateRow } from "../../src/radar/radar-matching";
const now = new Date("2026-10-07T12:00:00Z");
function peer(id: string, distance: number): NearbyCandidateRow {
  return { user_id: id, activation_id: id, public_player_id: id, version: 1,
    display_name: id, level_scale_id: null, level_scale_version: null,
    level_id: null, trainer: false, dist_m: distance };
}
const rank = (rows: NearbyCandidateRow[]) => rankCurrentCohort("test-pepper", "viewer", 10, now, rows);
describe("Radar coarse nearest-first", () => {
  it("returns one peer, excludes outside radius and caps at 20", () => {
    expect(rank([peer("one", 1000)])).toHaveLength(1);
    expect(rank([peer("outside", 10001)])).toEqual([]);
    expect(rank(Array.from({ length: 205 }, (_, n) => peer(String(n), 9000)).concat(peer("closest", 0)))).toHaveLength(20);
    expect(rank(Array.from({ length: 205 }, (_, n) => peer(String(n), 9000)).concat(peer("closest", 0)))[0]?.user_id).toBe("closest");
  });
  it("orders by band then coarse bucket with deterministic ties independent of exact distance/input order", () => {
    const rows = [peer("outer", 8000), peer("middle", 4500), peer("near", 2999), peer("tie-a", 1100), peer("tie-b", 1900)];
    const a = rank(rows).map(p => p.user_id);
    expect(a.slice(2)).toEqual(["near", "middle", "outer"]);
    expect(rank([...rows].reverse()).map(p => p.user_id)).toEqual(a);
    expect(rank(rows.map(p => p.user_id === "tie-a" ? { ...p, dist_m: 1999 } : p.user_id === "tie-b" ? { ...p, dist_m: 1001 } : p)).map(p => p.user_id)).toEqual(a);
    // Exactly 3km is still near, before >3km even in the same bucket.
    expect(rank([peer("middle-boundary", 3001), peer("near-boundary", 3000)]).map(p => p.user_id)).toEqual(["near-boundary", "middle-boundary"]);
  });
});
