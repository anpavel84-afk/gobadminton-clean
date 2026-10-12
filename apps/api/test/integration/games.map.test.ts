import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { GamesController } from "../../src/games/games.controller";
import { GamesService } from "../../src/games/games.service";
import { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { normalizeDiscovery } from "../../src/games/games-discovery.query";
import { gamesMapQuery } from "../../src/games/games-map.query";
import { readGamesMap } from "../../src/games/games-map.read";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL!;
(enabled ? describe : describe.skip)("GMap-1 real PostgreSQL/PostGIS public discovery", () => {
  let pool: Pool;
  let games: GamesService;
  let app: NestFastifyApplication;
  const participantUsers: string[] = [];
  const city = randomUUID(); const otherCity = randomUUID(); const owner = randomUUID();
  let venue: string;
  const filter = () => normalizeDiscovery({ cityId: city, temporalScope: "upcoming" });
  const map = () => readGamesMap(pool, filter());
  const url = () => `/v1/games/map?cityId=${city}&temporalScope=upcoming`;
  beforeAll(async () => {
    // This suite creates synthetic corruption fixtures; explicitly bind a disposable DB.
    if (process.env.GMAP1_DISPOSABLE_DB !== "1") throw new Error("GMAP1_DISPOSABLE_DB=1 required");
    const parsed = new URL(databaseUrl);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Loopback disposable PostgreSQL required");
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, PUBLIC_API_ORIGIN: "http://127.0.0.1:3000", APP_ENV: "local", NODE_ENV: "test" }, stdio: "pipe" });
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    await pool.query("INSERT INTO users(id) VALUES($1)", [owner]);
    for (const id of [city, otherCity]) await pool.query("INSERT INTO cities(id,country_code,name_ru,name_en,default_timezone) VALUES($1,'DE','GMap synthetic','GMap synthetic','Europe/Berlin')", [id]);
    games = Object.assign(Object.create(GamesService.prototype), { pool, env: { GAME_MODERATION_INTERNAL_ENABLED: false } }) as GamesService;
    const module = await Test.createTestingModule({ controllers: [GamesController], providers: [
      { provide: GamesService, useValue: games }, { provide: ConsumerAuthService, useValue: { optionalSession: async () => null } },
      { provide: IdempotencyService, useValue: {} },
    ] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("v1"); app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM participations WHERE game_id IN (SELECT id FROM games WHERE created_by_user_id=$1)", [owner]);
    await pool.query("DELETE FROM games WHERE created_by_user_id=$1", [owner]);
    await pool.query("DELETE FROM venues WHERE created_by_user_id=$1", [owner]);
    venue = await addVenue();
  });
  afterAll(async () => {
    await app?.close();
    if (pool) {
      await pool.query("DELETE FROM participations WHERE game_id IN (SELECT id FROM games WHERE created_by_user_id=$1)", [owner]);
      await pool.query("DELETE FROM games WHERE created_by_user_id=$1", [owner]);
      await pool.query("DELETE FROM venues WHERE created_by_user_id=$1", [owner]);
      await pool.query("DELETE FROM trainer_profiles WHERE user_id=$1", [owner]);
      await pool.query("DELETE FROM cities WHERE id=ANY($1)", [[city, otherCity]]);
      await pool.query("DELETE FROM users WHERE id=ANY($1)", [[owner, ...participantUsers]]);
      await pool.end();
    }
  });
  async function addVenue(cityId = city, lifecycle = "unverified", location = "POINT(13.4 52.5)") {
    const id = randomUUID();
    await pool.query(`INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      VALUES($1,$2,'Synthetic Venue','Synthetic address','Europe/Berlin',ST_GeogFromText($3),$4,$5,'synthetic','synthetic')`, [id, cityId, `SRID=4326;${location}`, owner, lifecycle]);
    return id;
  }
  async function addGames(n: number, venueId = venue, start = "2099-01-01T10:00:00Z") {
    const result = await pool.query<{ id: string }>(`INSERT INTO games(venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,
      capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,settlement_mode,settlement_terms,
      created_by_user_id,host_display_name,host_public_contact,activity_kind,settlement_purpose)
      SELECT $1,'Synthetic Game','published','public',$2::timestamptz + i * interval '1 second',
        $2::timestamptz + i * interval '1 second' + interval '2 hours','Europe/Berlin', '2000-01-01Z'::timestamptz,
        8,2,'doubles','test',1,'["mid"]'::jsonb,'external','Synthetic terms',$3,'Synthetic host','synthetic.invalid','regular','no_trainer_fee'
      FROM generate_series(0,$4::int-1) i RETURNING id`, [venueId, start, owner, n]);
    return result.rows.map(r => r.id);
  }
  async function alias(from: string, to: string) {
    await pool.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2 WHERE id=$1", [from, to]);
  }
  it("public static route, ordered previews, exact counts, no private data, freshness and no-store", async () => {
    const ids = await addGames(4);
    for (let i = 0; i < 3; i++) {
      const u = randomUUID(); participantUsers.push(u); await pool.query("INSERT INTO users(id) VALUES($1)", [u]);
      await pool.query("INSERT INTO participations(game_id,user_id,status) VALUES($1,$2,$3)", [ids[0], u, i < 2 ? "confirmed" : "pending"]);
    }
    const r = await app.inject({ method: "GET", url: url(), headers: { authorization: "Bearer ignored-public" } });
    expect(r.statusCode).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    const dto = r.json(); expect(dto.counts).toEqual({ matchingGames: 4, mappableGames: 4, unmappedGames: 0, venues: 1 });
    expect(dto.items[0].games.map((g: { id: string }) => g.id)).toEqual(ids.slice(0, 3));
    expect(dto.items[0].games[0].availablePlaces).toBe(4); expect(dto.items[0].hasMoreGames).toBe(true);
    expect(r.body).not.toContain("synthetic.invalid"); expect(r.body).not.toContain("organizer"); expect(r.body).not.toContain("userId");
    expect(Date.parse(dto.validUntil) - Date.parse(dto.generatedAt)).toBe(30000);
    const first = await games.listPublished({ cityId: city, temporalScope: "upcoming", venueId: venue, limit: 3 });
    const next = await games.listPublished({ cityId: city, temporalScope: "upcoming", venueId: venue, limit: 3, cursor: first.nextCursor! });
    expect(next.items.map(g => g.id)).toEqual(ids.slice(3));
  });
  it("includes a later-page Venue and distinct Venues at identical coordinates, including retired", async () => {
    await addGames(50); const later = await addVenue(city, "retired"); await addGames(1, later, "2099-02-01Z");
    expect((await games.listPublished({ cityId: city, limit: 50 })).items.every(g => g.venue.id === venue)).toBe(true);
    const dto = await map(); expect(dto.items).toHaveLength(2); expect(dto.counts.matchingGames).toBe(51);
    expect(dto.items[1]!.venue.id).toBe(later); expect(dto.items[1]!.venue.latitude).toBe(dto.items[0]!.venue.latitude);
  });
  it("resolves aliases into canonical city/identity with list/detail parity and alias drilldown", async () => {
    const canonical = await addVenue(otherCity, "verified"); const intermediate = await addVenue();
    const ids = await addGames(2); await addGames(1, canonical); await alias(venue, intermediate); await alias(intermediate, canonical);
    expect((await map()).counts.matchingGames).toBe(0);
    const f = normalizeDiscovery({ cityId: otherCity, temporalScope: "upcoming", venueId: venue });
    const dto = await readGamesMap(pool, f); expect(dto.counts.matchingGames).toBe(3); expect(dto.items[0]!.venue.id).toBe(canonical);
    const list = await games.listPublished({ cityId: otherCity, venueId: venue }); expect(list.items).toHaveLength(3);
    expect(list.items[0]!.venue.id).toBe(canonical); expect((await games.getGame(ids[0]!, null)).venue).toEqual(list.items[0]!.venue);
  });
  it("keeps broken chains list-visible and emits exclusive omission counts for empty coordinates/cycles/depth", async () => {
    const cycle = await addVenue(); await alias(venue, cycle); await alias(cycle, venue); const ids = await addGames(1);
    const empty = await addVenue(city, "unverified", "POINT EMPTY"); await addGames(2, empty);
    let origin = await addVenue(); const deep = origin;
    for (let i = 0; i < 9; i++) { const target = await addVenue(); await alias(origin, target); origin = target; }
    await addGames(1, deep);
    const dto = await map(); expect(dto.counts).toEqual({ matchingGames: 4, mappableGames: 0, unmappedGames: 4, venues: 0 });
    expect(dto.warnings).toEqual([{ code: "VENUE_CANONICAL_UNRESOLVED", gameCount: 2 }, { code: "VENUE_COORDINATES_INVALID", gameCount: 2 }]);
    expect((await games.listPublished({ cityId: city })).items).toHaveLength(4); expect((await games.getGame(ids[0]!, null)).venue.id).toBe(venue);
    // An eight-edge chain is valid (a ninth edge is not).
    await pool.query("UPDATE venues SET lifecycle_state='verified',canonical_venue_id=NULL WHERE canonical_venue_id=$1", [origin]);
    expect((await map()).counts.mappableGames).toBe(1);
  });
  it("missing target corruption safely falls back; no partial target or fabricated marker", async () => {
    await addGames(1); const client = await pool.connect();
    try { await client.query("BEGIN; SET LOCAL session_replication_role=replica"); await client.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2 WHERE id=$1", [venue, randomUUID()]); await client.query("COMMIT"); } finally { client.release(); }
    const dto = await map(); expect(dto.warnings).toEqual([{ code: "VENUE_CANONICAL_UNRESOLVED", gameCount: 1 }]);
    expect((await games.listPublished({ venueId: venue })).items[0]!.venue.id).toBe(venue);
  });
  it("NaN coordinates omit only their Games and never leak invalid values", async () => {
    await addGames(1, await addVenue(city, "unverified", "POINT(NaN NaN)")); await addGames(1);
    const dto = await map(); expect(dto.counts).toEqual({ matchingGames: 2, mappableGames: 1, unmappedGames: 1, venues: 1 });
    expect(dto.warnings).toEqual([{ code: "VENUE_COORDINATES_INVALID", gameCount: 1 }]); expect(JSON.stringify(dto)).not.toContain("NaN");
  });
  it("full Games with passed deadlines and inactive trainer profiles remain eligible", async () => {
    const ids = await addGames(2);
    const trainer = await pool.query("INSERT INTO trainer_profiles(user_id,display_name,status) VALUES($1,'Synthetic trainer','inactive') RETURNING id", [owner]);
    await pool.query("UPDATE games SET external_reserved_count=capacity WHERE id=$1", [ids[0]]);
    await pool.query("UPDATE games SET activity_kind='trainer_led',settlement_purpose='trainer_fee',price_status='by_agreement',trainer_profile_id=$2,trainer_display_name_snapshot='Synthetic trainer' WHERE id=$1", [ids[1], trainer.rows[0].id]);
    const dto = await map(); expect(dto.counts.matchingGames).toBe(2); expect(dto.items[0]!.games[0]!.availablePlaces).toBe(0);
    const f = { cityId: city, temporalScope: "upcoming", activityKind: "trainer_led" };
    expect((await readGamesMap(pool, normalizeDiscovery(f))).counts.matchingGames).toBe(1); expect((await games.listPublished(f)).items[0]!.id).toBe(ids[1]);
    await pool.query("UPDATE games SET status='cancelled' WHERE id=ANY($1)", [ids]); expect((await map()).counts.matchingGames).toBe(0);
  });
  it("preserves omitted/all scope and exact server cutoff, inclusive lower/exclusive upper, contradictory windows", async () => {
    await addGames(1, venue, "2000-01-01Z"); await addGames(3);
    expect((await games.listPublished({ cityId: city })).items).toHaveLength(4);
    expect((await games.listPublished({ cityId: city, temporalScope: "all" })).items).toHaveLength(4);
    expect((await map()).counts.matchingGames).toBe(3);
    const f = { cityId: city, temporalScope: "upcoming", startsFrom: "2099-01-01T11:00:01+01:00", startsBefore: "2099-01-01T11:00:02+01:00", levelScaleId: "test", levelId: "mid", activityKind: "regular" };
    expect((await games.listPublished(f)).items).toHaveLength(1); expect((await readGamesMap(pool, normalizeDiscovery(f))).counts.matchingGames).toBe(1);
    f.startsFrom = "2099-02-01T00:00:00Z";
    expect((await games.listPublished(f)).items).toHaveLength(0); expect((await readGamesMap(pool, normalizeDiscovery(f))).counts.matchingGames).toBe(0);
    // Insert exactly at server statement time: the subsequent upcoming statement
    // must exclude it without relying on the caller's clock.
    const boundaryIds = await addGames(1);
    await pool.query("UPDATE games SET starts_at=statement_timestamp() WHERE id=$1", [boundaryIds[0]]);
    expect((await games.listPublished({ cityId: city, temporalScope: "upcoming" })).items.map(g => g.id)).not.toContain(boundaryIds[0]);
    expect((await map()).counts.matchingGames).toBe(3);
  });
  it("UTC/DST city-day boundaries use supplied offset instants identically", async () => {
    await addGames(1, venue, "2099-03-28T23:00:00Z"); await addGames(1, venue, "2099-03-29T21:59:59Z"); await addGames(1, venue, "2099-03-29T22:00:00Z");
    const f = { cityId: city, temporalScope: "upcoming", startsFrom: "2099-03-29T00:00:00+01:00", startsBefore: "2099-03-30T00:00:00+02:00" };
    const cityDay = await pool.query("SELECT '2099-03-29'::timestamp AT TIME ZONE 'Europe/Berlin' AS lower, '2099-03-30'::timestamp AT TIME ZONE 'Europe/Berlin' AS upper");
    expect(cityDay.rows[0].lower.toISOString()).toBe(new Date(f.startsFrom).toISOString());
    expect(cityDay.rows[0].upper.toISOString()).toBe(new Date(f.startsBefore).toISOString());
    expect((await games.listPublished(f)).items).toHaveLength(2); expect((await readGamesMap(pool, normalizeDiscovery(f))).counts.matchingGames).toBe(2);
  });
  it("unknown ids empty, filters and public status exclusions", async () => {
    const ids = await addGames(6);
    for (const [id, status] of ids.slice(0, 3).map((id, i) => [id, ["draft", "cancelled", "completed"][i]])) await pool.query("UPDATE games SET status=$2 WHERE id=$1", [id, status]);
    await pool.query("UPDATE games SET visibility='unlisted' WHERE id=$1", [ids[3]]);
    await pool.query("UPDATE games SET activity_kind=NULL,settlement_purpose=NULL WHERE id=$1", [ids[4]]);
    expect((await map()).counts.matchingGames).toBe(1);
    for (const f of [{ cityId: randomUUID(), temporalScope: "upcoming" }, { cityId: city, venueId: randomUUID(), temporalScope: "upcoming" }, { cityId: city, levelScaleId: "unknown", temporalScope: "upcoming" }, { cityId: city, activityKind: "trainer_led", temporalScope: "upcoming" }]) {
      expect((await readGamesMap(pool, normalizeDiscovery(f))).counts.matchingGames).toBe(0); expect((await games.listPublished(f)).items).toHaveLength(0);
    }
  });
  it("rejects duplicate/unknown/array/overlong query, invalid uuid/activity/level/time; every error no-store", async () => {
    for (const suffix of ["&limit=1", "&cityId=" + city, "&venueId[]=x", "&bbox=1", "&foo=" + "x".repeat(8200), "&venueId=nope", "&activityKind=all", "&levelId=mid", "&startsFrom=tomorrow", "&startsFrom=2026-02-30T12:00:00Z", "&levelScaleId=" + "x".repeat(65)]) {
      const r = await app.inject({ method: "GET", url: url() + suffix }); expect(r.statusCode, suffix.slice(0,80)).toBe(422); expect(r.headers["cache-control"]).toBe("no-store"); expect(r.json()).not.toHaveProperty("items");
    }
  });
  it("measures representative 20-Venue/1000-Game SQL plan and list parity", async () => {
    await addGames(50);
    for (let i = 1; i < 20; i++) await addGames(50, await addVenue());
    const started = performance.now(); const dto = await map(); const elapsedMs = performance.now() - started;
    expect(dto.counts.matchingGames).toBe(1000); expect(dto.items).toHaveLength(20);
    let cursor: string | undefined; const listIds: string[] = [];
    do { const page = await games.listPublished({ cityId: city, temporalScope: "upcoming", limit: 100, cursor }); listIds.push(...page.items.map(g => g.id)); cursor = page.nextCursor ?? undefined; } while (cursor);
    expect(listIds).toHaveLength(1000); expect(new Set(listIds).size).toBe(1000);
    const query = gamesMapQuery(filter()); const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.sql, query.params);
    if (process.env.GMAP1_EVIDENCE_DIR) {
      writeFileSync(path.join(process.env.GMAP1_EVIDENCE_DIR, "map-representative-plan.json"), JSON.stringify(plan.rows[0], null, 2) + "\n");
      writeFileSync(path.join(process.env.GMAP1_EVIDENCE_DIR, "map-representative-measurements.json"), JSON.stringify({ venues: 20, games: 1000, previews: 60, elapsedMs, bytes: Buffer.byteLength(JSON.stringify(dto)) }, null, 2) + "\n");
    }
  });
  it("near-future validity stops at the first start, including an unplottable Game; empty result gets 30 seconds", async () => {
    const empty = await map(); expect(Date.parse(empty.validUntil) - Date.parse(empty.generatedAt)).toBe(30000);
    const starts = new Date(Date.now() + 10000).toISOString();
    await addGames(1, await addVenue(city, "unverified", "POINT EMPTY"), starts);
    const dto = await map(); expect(dto.validUntil).toBe(starts); expect(dto.items).toHaveLength(0);
  });
  it("zero coordinates are valid, and tie order uses Game id rather than participant multiplicity", async () => {
    const zero = await addVenue(city, "unverified", "POINT(0 0)"); const ids = await addGames(4, zero);
    await pool.query("UPDATE games SET starts_at='2099-01-01T10:00:00Z' WHERE id=ANY($1)", [ids]);
    const dto = await map(); expect(dto.items[0]!.venue.latitude).toBe(0); expect(dto.items[0]!.venue.longitude).toBe(0);
    expect(dto.items[0]!.games.map(g => g.id)).toEqual(ids.sort().slice(0,3));
  });
  it("200/201 Venues and 20000/20001 Games: complete success or explicit failure, list independently usable", async () => {
    await addGames(100);
    for (let i = 1; i < 200; i++) await addGames(100, await addVenue());
    await pool.query("INSERT INTO participations(game_id,user_id,status) SELECT id,$1,'confirmed' FROM games WHERE created_by_user_id=$1", [owner]);
    const started = performance.now(); const dto = await map(); const elapsedMs = performance.now() - started;
    expect(dto.counts).toEqual({ matchingGames: 20000, mappableGames: 20000, unmappedGames: 0, venues: 200 }); expect(dto.items.every(i => i.games.length === 3)).toBe(true);
    const query = gamesMapQuery(filter()); await pool.query("ANALYZE games; ANALYZE venues; ANALYZE participations");
    const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.sql, query.params);
    if (process.env.GMAP1_EVIDENCE_DIR) {
      writeFileSync(path.join(process.env.GMAP1_EVIDENCE_DIR, "map-envelope-plan.json"), JSON.stringify(plan.rows[0], null, 2) + "\n");
      writeFileSync(path.join(process.env.GMAP1_EVIDENCE_DIR, "map-measurements.json"), JSON.stringify({ postgres: (await pool.query("SELECT version(),PostGIS_Version() AS postgis")).rows[0], venues: 200, games: 20000, previews: 600, confirmedParticipationRows: 20000, elapsedMs, bytes: Buffer.byteLength(JSON.stringify(dto)), sqlQueryCalls: 3 }, null, 2) + "\n");
    }
    await addGames(1); const r = await app.inject({ method: "GET", url: url() }); expect(r.statusCode).toBe(422); expect(r.json().code).toBe("GAME_MAP_QUERY_TOO_BROAD"); expect(r.json()).not.toHaveProperty("items");
    await pool.query("DELETE FROM participations WHERE game_id IN (SELECT id FROM games WHERE created_by_user_id=$1)", [owner]);
    await pool.query("DELETE FROM games WHERE created_by_user_id=$1", [owner]);
    const all = await pool.query("SELECT id FROM venues WHERE created_by_user_id=$1", [owner]);
    for (const v of all.rows) await addGames(1, v.id);
    await addGames(1, await addVenue());
    await expect(map()).rejects.toMatchObject({ response: { code: "GAME_MAP_QUERY_TOO_BROAD" } });
    expect((await games.listPublished({ cityId: city, limit: 1 })).items).toHaveLength(1);
  });
  it("one snapshot during concurrent cancellation/publish/merge, next read converges", async () => {
    const ids = await addGames(2); const target = await addVenue();
    await pool.query("UPDATE games SET status='draft' WHERE id=$1", [ids[1]]);
    const q = gamesMapQuery(filter());
    const reading = pool.query(q.sql.replace(/\n {2}$/, " FROM (SELECT pg_sleep(0.3)) snapshot_pause"), q.params);
    // Wait for the same backend's explicit sleep, so mutation occurs after snapshot capture.
    for (let i = 0; i < 100; i++) {
      const active = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'");
      if (active.rowCount) break;
      await new Promise(r => setTimeout(r, 5));
      if (i === 99) throw new Error("snapshot pause was not observed");
    }
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("UPDATE games SET status=CASE WHEN id=$1 THEN 'cancelled' ELSE 'published' END WHERE id=ANY($2)", [ids[0], ids]); await client.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2 WHERE id=$1", [venue, target]); await client.query("COMMIT"); } finally { client.release(); }
    const before = (await reading).rows[0]; expect(before.matching_games).toBe(1); expect(before.items[0].venue.id).toBe(venue); expect(before.items[0].games[0].id).toBe(ids[0]);
    const after = await map(); expect(after.items[0]!.venue.id).toBe(target); expect(after.items[0]!.games[0]!.id).toBe(ids[1]);
  });
  it("whole-operation deadline includes pool acquisition; late acquisition releases cleanly", async () => {
    const single = new Pool({ connectionString: databaseUrl, max: 1 }); const held = await single.connect();
    try {
      const started = performance.now();
      await expect(readGamesMap(single, filter())).rejects.toMatchObject({ response: { code: "GAME_MAP_TEMPORARILY_UNAVAILABLE" } });
      expect(performance.now() - started).toBeLessThan(2800);
      held.release();
      expect((await readGamesMap(single, filter())).counts.matchingGames).toBe(0);
      expect(single.waitingCount).toBe(0); expect(single.idleCount).toBe(1);
    } finally { await single.end(); }
  });
  it("SQL deadline and client cancellation release connections; list still works", async () => {
    await addGames(1);
    const locker = await pool.connect(); await locker.query("BEGIN; LOCK TABLE participations IN ACCESS EXCLUSIVE MODE");
    const start = performance.now(); const unavailable = await app.inject({ method: "GET", url: url() });
    expect(unavailable.statusCode).toBe(503); expect(unavailable.headers["cache-control"]).toBe("no-store");
    expect(unavailable.json().code).toBe("GAME_MAP_TEMPORARILY_UNAVAILABLE"); expect(unavailable.body).not.toContain("SELECT");
    expect(performance.now() - start).toBeLessThan(2500);
    await locker.query("ROLLBACK"); locker.release();
    expect((await games.listPublished({ cityId: city })).items).toHaveLength(1);
    const abort = new AbortController(); const lock = await pool.connect(); await lock.query("BEGIN; LOCK TABLE participations IN ACCESS EXCLUSIVE MODE");
    const pending = readGamesMap(pool, filter(), abort.signal); setTimeout(() => abort.abort(), 30);
    await expect(pending).rejects.toMatchObject({ response: { code: "GAME_MAP_TEMPORARILY_UNAVAILABLE" } }); await lock.query("ROLLBACK"); lock.release();
    expect((await map()).counts.matchingGames).toBe(1);
    const connect = vi.spyOn(pool, "connect"); const acquired = await pool.connect(); const calls = vi.spyOn(acquired, "query"); acquired.release();
    // A successful request reuses the available connection and performs only BEGIN/settings, aggregate, COMMIT.
    await map(); expect(calls).toHaveBeenCalledTimes(3); expect(connect).toHaveBeenCalledTimes(2); calls.mockRestore(); connect.mockRestore();
    const idle = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"); expect(idle.rows[0].n).toBe(0);
  });
});
