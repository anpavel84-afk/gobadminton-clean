import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../src/config/env";
import { readRadarPlayerGames } from "../../src/games/games.service";
import { RadarService } from "../../src/radar/radar.service";

const now = new Date("2030-01-01T00:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
const env = { SOCIAL_DIRECTORY_ENABLED: true, USER_RESTRICTIONS_INTERNAL_ENABLED: true,
  GAME_MODERATION_INTERNAL_ENABLED: true, SOCIAL_RADAR_GEOGRAPHIC_ENABLED: true } as AppEnv;
function game(gameId = id) {
  return { id: gameId, title: "Public game", activity_kind: "regular", settlement_purpose: "no_trainer_fee",
    starts_at: new Date(+now + 3600000), ends_at: new Date(+now + 7200000), timezone: "Europe/Moscow",
    application_deadline_at: now, capacity: 4, external_reserved_count: 0, confirmed_count: 2,
    game_cover_url: `/v1/media/game-covers/${"a".repeat(64)}.png`, venue_cover_url: `/v1/media/venue-covers/${"b".repeat(64)}.png`,
    venue_name: "Public hall", venue_latitude: 55, venue_longitude: 37,
    organizer_id: "PRIVATE_ORGANIZER", organizer_public_contact: "PRIVATE_CONTACT",
    venue_contact_phone: "PRIVATE_PHONE", venue_booking_note: "PRIVATE_NOTE", trainer_profile_id: "PRIVATE_TRAINER",
    allowed_level_ids: [], settlement_terms: "PRIVATE_TERMS", created_by_user_id: "PRIVATE_CREATOR" };
}
/** This mock models DB results, not SQL privacy correctness. The disposable-DB
 * suite executes the real predicates. Here actual preview/projection code owns
 * sequencing, fresh reads, payload shaping and rollback behavior. */
function harness(options: { candidates?: boolean; fresh?: boolean; revision?: boolean; final?: boolean; redeemed?: boolean } = {}) {
  const rows = options.candidates === false ? [] : [{ id }];
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("SELECT revision")) return { rows: [{ revision: sql.includes("FOR SHARE") && options.revision === false ? "2" : "1" }] };
    if (sql.includes("SELECT g.id")) return { rows };
    if (sql.includes("SELECT id FROM games")) return { rows };
    if (sql.includes("game_effective_cover_url")) return { rows: options.fresh === false ? [] : [game()] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const actor = { assertActiveConsumerInTransaction: vi.fn(async () => {}) };
  const budget = { consumePreview: vi.fn(async () => {}) };
  const proofs = {
    redeem: vi.fn(async () => {
      if (options.redeemed === false) throw new Error("proof unavailable");
      return { targetUserId: "redeemed-target", publicPlayerId: "public-target", displayName: "Target", levelScaleId: null,
        levelScaleVersion: null, levelId: null, trainer: false, proximityBand: null,
        radar: { validUntil: new Date(+now + 45000).toISOString(), geo: {}, distance: null } };
    }),
    assertFinalGeographicProof: vi.fn(async () => { if (options.final === false) throw new Error("final unavailable"); }),
  };
  const profiles = { contactableTargets: vi.fn(async () => new Set()) };
  const args = [pool, env, { assertAccess: () => "live" }, {}, {}, {}, actor, budget, proofs, profiles];
  const service = new RadarService(...args as unknown as ConstructorParameters<typeof RadarService>);
  return { client, query, service, proofs, actor, budget };
}
afterEach(() => vi.useRealTimers());
describe("authorized Radar preview and Games-owned projection", () => {
  it.each(["directory-public immutable creator", "confirmed target / active viewer roster manager"])("projects the permitted %s DB result with an exact allowlist", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const h = harness(); const result = await h.service.preview("viewer", "session", { resultRef: "u1.private-proof" });
    expect(result.upcomingGames).toEqual([{
      id, title: "Public game", activityKind: "regular", startsAt: new Date(+now + 3600000).toISOString(),
      endsAt: new Date(+now + 7200000).toISOString(), timezone: "Europe/Moscow",
      cover: { uploadedUrl: game().game_cover_url }, venue: { name: "Public hall", cover: { uploadedUrl: game().venue_cover_url } },
    }]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    const candidates = h.query.mock.calls.find(([sql]) => sql.includes("SELECT g.id"))!;
    expect(candidates[1]).toEqual(["viewer", "redeemed-target", true]);
    const sqls = h.query.mock.calls.map(([sql]) => sql);
    expect(sqls.findIndex(sql => sql.includes("FOR SHARE") && sql.includes("FROM games")))
      .toBeLessThan(sqls.findIndex(sql => sql.includes("game_effective_cover_url")));
    expect(sqls.at(-1)).toBe("COMMIT"); expect(h.actor.assertActiveConsumerInTransaction).toHaveBeenCalledTimes(2);
    expect(h.proofs.assertFinalGeographicProof).toHaveBeenCalledTimes(2);
  });
  it.each(["ordinary viewer confirmed membership", "radar-only creator", "invitation-only", "nonconfirmed target"])("retains truthful empty projection for %s", async () => {
    const h = harness({ candidates: false });
    const result = await h.service.preview("viewer", "session", { resultRef: "u1.proof" });
    expect(result.upcomingGames).toEqual([]);
    expect(h.query.mock.calls.some(([sql]) => sql.includes("game_effective_cover_url"))).toBe(false);
  });
  it("rechecks after the Game wait and suppresses a retired candidate", async () => {
    const h = harness({ fresh: false });
    const project = await readRadarPlayerGames(h.client, env, "viewer", "target");
    expect(await project()).toEqual([]);
    expect(h.query.mock.calls.map(([sql]) => sql).at(-1)).toContain("p.status='confirmed'");
  });
  it.each([{ final: false }, { revision: false }, { redeemed: false }])("rolls back without any schedule on failed final/revision/proof authorization: %s", async options => {
    const h = harness(options);
    await expect(h.service.preview("viewer", "session", { resultRef: "u1.proof" })).rejects.toThrow();
    expect(h.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(h.query.mock.calls.map(([sql]) => sql).at(-1)).toBe("ROLLBACK");
    expect(h.client.release).toHaveBeenCalledOnce();
    if (options.redeemed === false) expect(h.query.mock.calls.some(([sql]) => sql.includes("FROM games"))).toBe(false);
  });
  it("releases no payload if the last proof check fails after games were projected", async () => {
    const h=harness();
    h.proofs.assertFinalGeographicProof.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('expired after projection'));
    await expect(h.service.preview('viewer','session',{resultRef:'u1.proof'})).rejects.toThrow('expired after projection');
    expect(h.query.mock.calls.some(([sql])=>sql.includes('game_effective_cover_url'))).toBe(true);
    expect(h.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');
    expect(h.query.mock.calls.map(([sql])=>sql).at(-1)).toBe('ROLLBACK');
  });
  it("rechecks the actor session after Game/revision waits before releasing any schedule", async () => {
    const h = harness();
    h.actor.assertActiveConsumerInTransaction.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("session invalidated"));
    await expect(h.service.preview("viewer", "session", { resultRef: "u1.proof" }))
      .rejects.toThrow("session invalidated");
    expect(h.query.mock.calls.some(([sql]) => sql.includes("FROM games"))).toBe(true);
    expect(h.query.mock.calls.some(([sql]) => sql.includes("game_effective_cover_url"))).toBe(false);
    expect(h.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(h.query.mock.calls.map(([sql]) => sql).at(-1)).toBe("ROLLBACK");
  });
  it("does not broaden legacy preview contracts", async () => {
    const h = harness(); const result = await h.service.preview("viewer", "session", { resultRef: "legacy.proof" });
    expect(result).not.toHaveProperty("upcomingGames");
    expect(h.query.mock.calls.some(([sql]) => sql.includes("FROM games"))).toBe(false);
  });
  it("deduplicates and orders actual projected payloads within three held Game ids", async () => {
    const second="00000000-0000-4000-8000-000000000002", third="00000000-0000-4000-8000-000000000003", foreign="00000000-0000-4000-8000-000000000004";
    const a=game(), b={...game(second),starts_at:new Date(+now+1800000)}, c={...game(third),starts_at:b.starts_at};
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT g.id')?[{id},{id:second},{id:third},{id:foreign}]:sql.includes('SELECT id FROM games')?[{id},{id:second},{id:third}]:[a,c,b,b,game(foreign)]}));
    const client={query} as unknown as PoolClient;
    const project=await readRadarPlayerGames(client,env,'viewer','target');
    expect((await project()).map(row=>row.id)).toEqual([second,third,id]);
    const lock=query.mock.calls.find(([sql])=>sql.includes('SELECT id FROM games'))!;
    expect((lock as unknown[])[1]).toEqual([[id,second,third]]);
  });
  it("budgets and redeems against the same transaction/client at the injected wall clock",async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const h=harness();
    await h.service.preview('viewer','session',{resultRef:'u1.private-proof'});
    expect(h.budget.consumePreview).toHaveBeenCalledWith(h.client,'viewer',now);
    expect(h.proofs.redeem).toHaveBeenCalledWith(h.client,{actorId:'viewer',sessionId:'session',proof:'u1.private-proof'});
  });
  it("uses bounded deterministic Game fences, and canonical eligibility/media before limit", async () => {
    const h = harness(); await readRadarPlayerGames(h.client, env, "viewer", "target");
    const candidate = h.query.mock.calls.find(([sql]) => sql.includes("SELECT g.id"))![0];
    for (const predicate of ["g.status = 'published'", "g.visibility = 'public'", "g.activity_kind IS NOT NULL", "g.starts_at > statement_timestamp()", "g.created_by_user_id=$2", "p.directory_visible", "social.directory", "user_blocks", "p.status='confirmed'", "gm.status='active'", "gm.role IN ('owner','manager')", "game_moderation_state", "ORDER BY g.starts_at,g.id LIMIT 3"]) expect(candidate).toContain(predicate);
    expect(h.query.mock.calls.find(([sql]) => sql.includes("SELECT id FROM games"))![0]).toContain("ORDER BY id FOR SHARE");
  });
});
