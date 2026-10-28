import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { AppEnv } from "../../src/config/env";
import { readRadarPlayerGames } from "../../src/games/games.service";
import { RadarService } from "../../src/radar/radar.service";

const now = Date.parse("2030-01-01T00:00:00Z");
const env = { SOCIAL_RADAR_GEOGRAPHIC_ENABLED: true, SOCIAL_DIRECTORY_ENABLED: true, USER_RESTRICTIONS_INTERNAL_ENABLED: true, GAME_MODERATION_INTERNAL_ENABLED: true } as AppEnv;
const game = { id: "game", version: 1, title: "Real projection", status: "published", visibility: "public", activity_kind: "regular", settlement_purpose: "no_trainer_fee",
  starts_at: new Date(now+86400000), ends_at: new Date(now+90000000), application_deadline_at: new Date(now+3600000), timezone: "Europe/Moscow",
  capacity: 20, external_reserved_count: 0, confirmed_count: 1, game_cover_url: null, venue_cover_url: null, venue_name: "Court",
  venue_id: "private-venue-id", organizer_id: "private-organizer-id", organizer_public_contact: "private-contact", venue_booking_note: "private-note", venue_latitude: 55.75, venue_longitude: 37.6 };
function db() {
  let revision = "1";
  const query = vi.fn(async (sql: string, _params?: unknown[]): Promise<{ rows: unknown[] }> => {
    if (sql.includes("players_query_revision")) return { rows: [{ revision }] };
    if (sql.includes("SELECT g.id FROM games")) return { rows: [{ id: "game" }] };
    if (sql.includes("g.host_public_contact AS")) return { rows: [game] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { client, query, revise: () => { revision = "2"; } };
}
afterEach(() => vi.useRealTimers());
describe("Games-owned Radar schedule projection", () => {
  it("passes redeemed IDs as parameters and rereads after deterministic bounded Game fences", async () => {
    const { client, query } = db();
    const games = await readRadarPlayerGames(client, "viewer", "redeemed-target", env);
    expect(query.mock.calls[0]![1]).toEqual(["viewer", "redeemed-target", true]);
    expect(query.mock.calls[1]).toEqual(["SELECT id FROM games WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE", [["game"]]]);
    expect(query.mock.calls[2]![1]).toEqual(["viewer", "redeemed-target", true, ["game"]]);
    expect(games).toEqual([{ id: "game", title: "Real projection", activityKind: "regular", startsAt: game.starts_at.toISOString(), endsAt: game.ends_at.toISOString(), timezone: "Europe/Moscow", cover: { uploadedUrl: null }, venue: { name: "Court", cover: { uploadedUrl: null } } }]);
    expect(JSON.stringify(games)).not.toMatch(/private-|latitude|longitude|confirmed|manager|organizer/);
  });
  it("applies canonical discovery and relationship predicates before the limit in both reads", async () => {
    const { client, query } = db(); await readRadarPlayerGames(client,"viewer","target",env);
    for (const index of [0,2]) {
      const sql=query.mock.calls[index]![0];
      expect(sql).toContain("g.starts_at > statement_timestamp()"); expect(sql).toContain("g.status = 'published'"); expect(sql).toContain("g.visibility = 'public'");
      expect(sql).toContain("g.activity_kind IS NOT NULL"); expect(sql).toContain("ms.state <> 'clear'");
      expect(sql).toContain("g.created_by_user_id=$2"); expect(sql).toContain("p.directory_visible AND p.social_eligible");
      expect(sql).toContain("'social.directory'"); expect(sql).toContain("p.status='confirmed'"); expect(sql).toContain("gm.status='active'");
      expect(sql).toContain("gm.role IN ('owner','manager')"); expect(sql).toContain("ORDER BY g.starts_at,g.id LIMIT 3");
      expect(sql.indexOf("p.status='confirmed'")).toBeLessThan(sql.indexOf("LIMIT 3"));
    }
  });
  it("does not retain a candidate whose relationship changed while waiting", async () => {
    const {client,query}=db();
    query.mockImplementation(async sql=>({rows:sql.includes("SELECT g.id FROM games")?[{id:"game"}]:[]}));
    expect(await readRadarPlayerGames(client,"viewer","target",env)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("returns honest empty without extra locks when no game is authorized", async () => {
    const {client,query}=db(); query.mockResolvedValue({rows:[]});
    expect(await readRadarPlayerGames(client,"viewer","target",env)).toEqual([]);expect(query).toHaveBeenCalledTimes(1);
  });
});
function service() {
  vi.useFakeTimers();vi.setSystemTime(now);
  const database=db();
  const redeemed={targetUserId:"redeemed-target",publicPlayerId:"public-target",displayName:"Target",levelScaleId:null,levelScaleVersion:null,levelId:null,trainer:false,proximityBand:null,
    radar:{validUntil:new Date(now+45000).toISOString()}};
  const proofs={redeem:vi.fn(async()=>redeemed),assertFinalGeographicProof:vi.fn(async()=>{})};
  const actor={assertActiveConsumerInTransaction:vi.fn(async()=>{})};
  const budgets={consumePreview:vi.fn(async()=>{})};
  const args=[{connect:async()=>database.client},env,{assertAccess:()=>"live"},{},{},{},actor,budgets,proofs,{contactableTargets:async()=>new Set<string>()}];
  const radar=new RadarService(...args as ConstructorParameters<typeof RadarService>);
  return {radar,...database,proofs,actor,budgets};
}
describe("actual Radar preview transaction",()=>{
  it("redeems the viewer proof before Games, then fences revision, actor and proof before commit",async()=>{
    const h=service();const result=await h.radar.preview("viewer","session",{resultRef:"u1.private-proof"});
    expect(result.upcomingGames).toHaveLength(1);expect(h.proofs.redeem).toHaveBeenCalledWith(h.client,{actorId:"viewer",sessionId:"session",proof:"u1.private-proof"});
    expect(h.actor.assertActiveConsumerInTransaction).toHaveBeenCalledTimes(2);
    expect(h.proofs.assertFinalGeographicProof).toHaveBeenCalledWith(h.client,{actorId:"viewer",sessionId:"session",targetUserId:"redeemed-target",discoveryProof:"u1.private-proof"});
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
  for(const failure of ["redeem","final-proof","actor","revision"] as const) it(`fails closed with no committed schedule on ${failure}`,async()=>{
    const h=service();
    if(failure==="redeem")h.proofs.redeem.mockRejectedValue(new Error("unavailable"));
    if(failure==="final-proof")h.proofs.assertFinalGeographicProof.mockRejectedValue(new Error("expired"));
    if(failure==="actor")h.actor.assertActiveConsumerInTransaction.mockImplementationOnce(async()=>{}).mockRejectedValue(new Error("revoked"));
    if(failure==="revision")h.proofs.redeem.mockImplementation(async()=>{h.revise();return {targetUserId:"target",publicPlayerId:"public-target",displayName:"Target",levelScaleId:null,levelScaleVersion:null,levelId:null,trainer:false,proximityBand:null,radar:{validUntil:new Date(now+45000).toISOString()}};});
    await expect(h.radar.preview("viewer","session",{resultRef:"u1.private-proof"})).rejects.toThrow();
    expect(h.query.mock.calls.map(c=>c[0])).not.toContain("COMMIT");expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    if(failure==="redeem")expect(h.query.mock.calls.some(c=>c[0].includes("SELECT g.id FROM games"))).toBe(false);
    expect(h.client.release).toHaveBeenCalledOnce();
  });
  it("preserves legacy preview without adding schedule fields or Games reads",async()=>{
    const h=service();const result=await h.radar.preview("viewer","session",{resultRef:"legacy-proof"});
    expect(Object.hasOwn(result,"upcomingGames")).toBe(false);expect(h.query.mock.calls.some(c=>c[0].includes("FROM games"))).toBe(false);
  });
});
