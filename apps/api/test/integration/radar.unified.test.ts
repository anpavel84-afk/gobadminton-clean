import { DEV_MOSCOW_PEER_IDS } from "../../src/radar/dev-moscow-test";
import { redeemUnifiedProof } from "../../src/radar/unified-proof";
import { GeographicRadarService } from "../../src/radar/geographic.service";
import cookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { AuthModule } from "../../src/auth/auth.module";
import {
  SessionService,
  type IssuedSession,
} from "../../src/auth/session.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { ProfilesService } from "../../src/profiles/profiles.service";
import { RadarModule } from "../../src/radar/radar.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { SafetyService } from "../../src/safety/safety.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { DEMO_SPB_CITY_ID, demoUserId } from "../../src/database/demo-ids";
import { UnifiedPlayersService } from "../../src/radar/unified.service";
import {
  UNIFIED_WIRE,
  UNIFIED_POLICY,
  UNIFIED_DISCLOSURE_ID,
  UNIFIED_DISCLOSURE_HASH,
  openUnified,
  sealUnified,
  proofSchema,
  contextSchema,
} from "../../src/radar/unified-contract";
import {
  GEO_POLICY,
  GEO_DISCLOSURE_ID,
} from "../../src/radar/geographic-contract";
import {
  resetRadarPresenceBeforeServingTraffic,
  sqlExecutorFromPg,
} from "../../src/radar/radar-recovery";

type Person = { id: string; publicId: string; issued: IssuedSession };
type Snapshot = Awaited<ReturnType<UnifiedPlayersService["query"]>> & {
  page?: {
    returnedCount: number;
    rankStart: number | null;
    rankEnd: number | null;
    hasMore: boolean;
    nextCursor: string | null;
  };
  mapPage?: {
    returnedCount: number;
    rankStart: number | null;
    rankEnd: number | null;
    hasMore: boolean;
    nextMapCursor: string | null;
  };
};
const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const fix = (longitude = 37.6173, accuracyMeters = 10, latitude = 55.7558) => ({
  latitude,
  longitude,
  accuracyMeters,
  capturedAt: new Date().toISOString(),
});
dbDescribe("Unified Players / isolated synthetic PostGIS and HTTP", () => {
  let admin: Pool,
    pool: Pool,
    app: NestFastifyApplication,
    env: AppEnv,
    sessions: SessionService,
    viewer: Person;
  const dbName = `unified_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = "/" + dbName;
    env = loadEnv({
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: u.href,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
      COOKIE_SECURE: "false",
      SOCIAL_DIRECTORY_ENABLED: "1",
      SOCIAL_DM_ENABLED: "1",
      SOCIAL_RADAR_ENABLED: "1",
      SOCIAL_RADAR_DEMO_ENABLED: "1",
      SOCIAL_RADAR_GEOGRAPHIC_ENABLED: "1",
      SOCIAL_RADAR_UNIFIED_ENABLED: "1",
      SOCIAL_RADAR_PUBLISHING_V2_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "fake",
      GAME_MODERATION_INTERNAL_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED:"1", ADMIN_ORIGIN:"http://localhost:19470",
      ADMIN_AUTH_PEPPER:"p4-unified-synthetic-admin-pepper-only", USER_RESTRICTIONS_INTERNAL_ENABLED:"1",
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const dir = path.resolve(__dirname, "../../migrations");
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(path.join(dir, file), "utf8"));
    const m = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AuthModule,
        ProfilesModule,
        SafetyModule,
        RadarModule,
        MessagingModule,
      ],
    }).compile();
    app = m.createNestApplication(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionService);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.end();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  });
  async function person(
    name = "Fictional Unified",
    visible = true,
    city = MOSCOW_CITY_ID,
    id: string = randomUUID(),
  ): Promise<Person> {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      id,
      name,
    ]);
    const publicId = randomUUID();
    await pool.query(
      "INSERT INTO player_social_profiles(user_id,public_player_id,display_name,city_id,directory_visible,contact_policy,consent_policy_version,opted_in_at) VALUES($1,$2,$3,$4,$5,'requests','social-directory-v1',clock_timestamp())",
      [id, publicId, name, city, visible],
    );
    return { id, publicId, issued: await sessions.createConsumerSession(id) };
  }
  beforeEach(async () => {
    await pool.query("DELETE FROM radar_presences");
    await pool.query("DELETE FROM radar_rate_budgets");
    await pool.query(
      "UPDATE player_social_profiles SET directory_visible=false",
    );
    viewer = await person("Viewer", false);
  });
  const headers = (p = viewer) => ({
    cookie: `${SESSION_COOKIE}=${p.issued.sessionToken}`,
    origin: env.PUBLIC_WEB_ORIGIN,
    "x-csrf-token": p.issued.csrfToken,
    "idempotency-key": randomUUID(),
  });
  const initial = (
    limit = 50,
    origin: unknown = { kind: "none" },
    filters: Record<string, unknown> = { cityId: MOSCOW_CITY_ID },
  ) => ({ contractVersion: UNIFIED_WIRE, filters, origin, limit });
  async function request(input: unknown = initial(), p = viewer, map = false) {
    return app.inject({
      method: "POST",
      url: map ? "/v1/players/query/map" : "/v1/players/query",
      headers: headers(p),
      payload: input as Record<string, unknown>,
    });
  }
  async function query(
    input: unknown = initial(),
    p = viewer,
    map = false,
  ): Promise<Snapshot> {
    const r = await request(input, p, map);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  }
  async function clearBudget(p = viewer) {
    await pool.query("DELETE FROM radar_rate_budgets WHERE user_id=$1", [p.id]);
  }
  const startBody = (location = fix()) => ({
    contractVersion: UNIFIED_WIRE,
    consentPolicyVersion: UNIFIED_POLICY,
    consent: {
      disclosureId: UNIFIED_DISCLOSURE_ID,
      disclosureHash: UNIFIED_DISCLOSURE_HASH,
      accepted: true,
    },
    location,
  });
  async function start(p: Person, location = fix()) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: headers(p),
      payload: startBody(location),
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<{
      activationId: string;
      version: number;
      model: string;
      gridSizeMeters: number;
      locationValidUntil: string;
      hardExpiresAt: string;
    }>();
  }
  async function preview(proof: string, p = viewer) {
    return app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: headers(p),
      payload: { resultRef: proof },
    });
  }
  async function next(s: Snapshot, limit = 50) {
    return query({
      contractVersion: UNIFIED_WIRE,
      queryRef: s.query.queryRef,
      cursor: s.page!.nextCursor,
      limit,
    });
  }
  // Source fixture recovery D2: current Venue schema has no lifecycle default.
  // Normalized identity fields are explicit, as in the accepted venue fixtures.
  async function gameFixture(creator: Person, options: { status?: string; visibility?: string; hours?: number; classified?: boolean; startsAt?: string } = {}) {
    const venueId = randomUUID();
    await pool.query(`INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      VALUES($1,$2,'Synthetic Radar court','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$3,'unverified',$4,$5)`,
      [venueId, MOSCOW_CITY_ID, creator.id, `radar court ${venueId}`, `radar address ${venueId}`]);
    const start = new Date(options.startsAt ?? Date.now() + (options.hours ?? 24) * 3600000);
    const id = randomUUID();
    await pool.query(`INSERT INTO games(id,venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,
      capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,settlement_mode,settlement_terms,
      created_by_user_id,host_display_name,host_public_contact,activity_kind,settlement_purpose)
      VALUES($1,$2,'Synthetic public game',$3,$4,$5,$6,'Europe/Moscow',$5,20,0,'doubles','synthetic',1,'[]','external','External settlement',$7,'Synthetic host','private-fixture-contact',$8,$9)`,
      [id, venueId, options.status ?? 'published', options.visibility ?? 'public', start, new Date(start.getTime()+3600000), creator.id,
        options.classified === false ? null : 'regular', options.classified === false ? null : 'no_trainer_fee']);
    return id;
  }
  async function scheduleProof(target: Person) {
    await start(target);
    const snapshot = await query();
    return snapshot.items.find(row => row.publicPlayerId === target.publicId)!.radar!.resultRef;
  }
  async function queryAfterBudget() { await clearBudget(); return query(); }
  async function gamesFor(proof: string) {
    const response = await preview(proof);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    return response.json().upcomingGames as Array<{ id: string; startsAt: string }>;
  }
  async function confirmed(gameId: string, target: Person, status = 'confirmed') {
    await pool.query("INSERT INTO participations(game_id,user_id,status) VALUES($1,$2,$3)", [gameId,target.id,status]);
  }
  async function manage(gameId: string, role = 'manager', status = 'active') {
    await pool.query("INSERT INTO game_managers(game_id,user_id,role,status) VALUES($1,$2,$3,$4)", [gameId,viewer.id,role,status]);
  }
  it("schedule returns <=3 distinct sorted public creator games through a strict allowlist", async () => {
    const target = await person('Public creator');
    const sameTime = new Date(Date.now()+86400000).toISOString();
    const ids = [];
    for (let i=0;i<5;i++) ids.push(await gameFixture(target,{startsAt:sameTime}));
    await confirmed(ids[0]!,target); await manage(ids[0]!);
    const proof = await scheduleProof(target), games = await gamesFor(proof);
    expect(games.map(g=>g.id)).toEqual(ids.sort().slice(0,3));
    for (const g of games) {
      expect(Object.keys(g).sort()).toEqual(['activityKind','cover','endsAt','id','startsAt','timezone','title','venue']);
      expect(Object.keys((g as unknown as {venue:object}).venue).sort()).toEqual(['cover','name']);
    }
    const body = JSON.stringify(games);
    expect(body).not.toMatch(/private-fixture-contact|createdBy|userId|publicPlayerId|participation|manager|latitude|longitude|address|booking|phone|provider|confirmedCount/i);
  });
  it("radar-only creator has no directory-public creator shortcut", async () => {
    const target = await person('Radar creator',false); await gameFixture(target);
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
    // Directory opt-in alone is insufficient while the directory capability is off.
    await pool.query('UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1',[target.id]);
    env.SOCIAL_DIRECTORY_ENABLED=false;
    try {expect(await gamesFor((await queryAfterBudget()).items.find(r=>r.publicPlayerId===target.publicId)!.radar!.resultRef)).toEqual([]);}
    finally {env.SOCIAL_DIRECTORY_ENABLED=true;}
  });
  it("ordinary viewer cannot infer confirmed participation in a public game", async () => {
    const target=await person(), host=await person('Other host');
    const id=await gameFixture(host); await confirmed(id,target);
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
  });
  for (const role of ['owner','manager']) it(`active ${role} sees confirmed radar-only target through current roster authority`, async () => {
    const target=await person('Private roster target',false), host=await person('Roster host');
    const id=await gameFixture(host); await confirmed(id,target); await manage(id,role);
    expect((await gamesFor(await scheduleProof(target))).map(g=>g.id)).toEqual([id]);
  });
  it("revoked manager cannot see target participation", async () => {
    const target=await person(), host=await person('Host');const id=await gameFixture(host);
    await confirmed(id,target);await manage(id,'manager','revoked');
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
  });
  for (const status of ['pending','rejected','withdrawn','removed','expired','cancelled_by_game']) it(`schedule excludes ${status} membership even for roster manager`, async () => {
    const target=await person(),host=await person('Host');const id=await gameFixture(host);
    await confirmed(id,target,status);await manage(id);
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
  });
  for (const excluded of ['draft','cancelled','completed','unlisted','past','unclassified','hidden','taken_down']) it(`schedule excludes ${excluded} games before limiting`, async () => {
    const target=await person();
    const options = ['draft','cancelled','completed'].includes(excluded) ? {status:excluded} :
      excluded==='unlisted' ? {visibility:'unlisted'} : excluded==='past' ? {hours:-24} : excluded==='unclassified' ? {classified:false} : {};
    const id=await gameFixture(target,options);
    if (excluded==='hidden'||excluded==='taken_down') await pool.query("INSERT INTO game_moderation_state(game_id,state) VALUES($1,$2)",[id,excluded]);
    const good=await gameFixture(target,{hours:48});
    expect((await gamesFor(await scheduleProof(target))).map(g=>g.id)).toEqual([good]);
  });
  it("invitation-only relation never contributes a game", async () => {
    const target=await person(),host=await person('Host');const id=await gameFixture(host);
    const pairs=app.get((await import('../../src/safety/pair-fence.service')).PairFenceService);
    const c=await pool.connect();let pairId:string;
    try {await c.query('BEGIN');pairId=(await pairs.lockOrCreate(c,host.id,target.id)).id;await c.query('COMMIT');} finally {c.release();}
    await pool.query("INSERT INTO game_invitations(game_id,inviter_user_id,invitee_user_id,pair_id,status,expires_at) VALUES($1,$2,$3,$4,'pending',clock_timestamp()+interval '1 hour')",[id,host.id,target.id,pairId]);
    await manage(id);
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
  });
  it("target manager identity is not immutable creator identity", async () => {
    const target=await person(),host=await person('Host');const id=await gameFixture(host);
    await pool.query("INSERT INTO game_managers(game_id,user_id,role,status) VALUES($1,$2,'manager','active')",[id,target.id]);
    expect(await gamesFor(await scheduleProof(target))).toEqual([]);
  });
  // Hold a real Game writer fence and observe a real pg lock wait before
  // committing. No fixed sleep is used as evidence that the reader waited.
  async function waitingSchedule(target: Person, gameId: string, change: (client: import('pg').PoolClient) => Promise<void>) {
    const proof=await scheduleProof(target), writer=await pool.connect();
    await writer.query('BEGIN');await writer.query('SELECT id FROM games WHERE id=$1 FOR UPDATE',[gameId]);
    let pending: ReturnType<typeof preview> | undefined;
    try {
      await change(writer);
      pending=preview(proof);
      let blocked=false;
      for(let i=0;i<100;i++) {
        const activity=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM games WHERE id=ANY%' LIMIT 1");
        if(activity.rowCount){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked,'preview must wait for the shared Game fence').toBe(true);
      await writer.query('COMMIT');
      return await pending;
    } finally {await writer.query('ROLLBACK');writer.release();if(pending) await pending;}
  }
  it("withdrawal committed during Game wait cannot release stale membership", async () => {
    const target=await person('Race target',false),host=await person('Host');const id=await gameFixture(host);
    await confirmed(id,target);await manage(id);
    const result=await waitingSchedule(target,id,async c=>{await c.query("UPDATE participations SET status='withdrawn' WHERE game_id=$1 AND user_id=$2",[id,target.id]);});
    expect(result.statusCode,result.body).toBe(200);expect(result.json().upcomingGames).toEqual([]);
  });
  it("manager revocation committed during Game wait cannot release stale roster", async () => {
    const target=await person('Race target',false),host=await person('Host');const id=await gameFixture(host);
    await confirmed(id,target);await manage(id);
    const result=await waitingSchedule(target,id,async c=>{await c.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[id,viewer.id]);});
    expect(result.statusCode,result.body).toBe(200);expect(result.json().upcomingGames).toEqual([]);
  });
  it("cancellation, moderation, directory opt-out and session revocation during Game waits cannot release stale games", async () => {
    for(const action of ['cancel','moderate','directory-off','session-revoke']) {
      await clearBudget();const target=await person(`Race ${action}`);const id=await gameFixture(target);
      const result=await waitingSchedule(target,id,async c=>{
        if(action==='cancel') await c.query("UPDATE games SET status='cancelled' WHERE id=$1",[id]);
        else if(action==='moderate') await c.query("INSERT INTO game_moderation_state(game_id,state) VALUES($1,'hidden')",[id]);
        else if(action==='directory-off') await c.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[target.id]);
        else await c.query("UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE id=$1",[target.issued.session.id]);
      });
      if(action==='directory-off'||action==='session-revoke') {expect(result.statusCode,result.body).toBe(409);expect(result.json().code).toBe('PLAYERS_QUERY_STALE');expect(result.json()).not.toHaveProperty('upcomingGames');}
      else {expect(result.statusCode,result.body).toBe(200);expect(result.json().upcomingGames).toEqual([]);}
    }
  });
  it("P4 restrictions preserve directory/Radar separation and deny fresh publication and old proofs", async () => {
    const publisher=await person("P4 publisher",true);await gameFixture(publisher);await start(publisher);
    const initialPage=await query();const proof=initialPage.items.find(x=>x.publicPlayerId===publisher.publicId)!.radar!.resultRef;
    const principal=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[viewer.id])).rows[0].id;
    const restrict=async(capability:string)=>{const row=(await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,$2,'synthetic_fixture',clock_timestamp()+interval '1 hour',$3) RETURNING id",[publisher.id,capability,principal])).rows[0];await pool.query("UPDATE users SET updated_at=clock_timestamp() WHERE id=$1",[publisher.id]);return row.id;};
    expect(await gamesFor(proof)).toHaveLength(1);
    await restrict('social.directory');expect(await gamesFor(proof)).toEqual([]);await clearBudget();const radarOnly=await query();expect(radarOnly.items.find(x=>x.publicPlayerId===publisher.publicId)?.radar).not.toBeNull();
    const radarRestriction=await restrict('social.radar');await clearBudget();expect((await query()).items.some(x=>x.publicPlayerId===publisher.publicId)).toBe(false);expect((await preview(proof)).statusCode).toBe(404);
    const denied=await app.inject({method:'POST',url:'/v1/me/radar/activations',headers:headers(publisher),payload:startBody()});expect(denied.statusCode,denied.body).toBe(403);
    await pool.query("UPDATE user_restrictions SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason_code='synthetic_reversal',version=version+1 WHERE id=$1",[radarRestriction,principal]);await pool.query("UPDATE users SET updated_at=clock_timestamp() WHERE id=$1",[publisher.id]);await clearBudget();expect((await query()).items.find(x=>x.publicPlayerId===publisher.publicId)?.radar).not.toBeNull();
    await restrict('profile.public');await clearBudget();expect((await query()).items.some(x=>x.publicPlayerId===publisher.publicId)).toBe(false);
  });
  for (const n of [0, 1, 20, 21, 100])
    it(`${n} publishers form the complete prefix followed by full ordinary tail`, async () => {
      for (let i = 0; i < n; i++) {
        const p = await person(`P${String(i).padStart(3, "0")}`, i % 2 === 0);
        await start(p, fix(37.6173 + i * 0.0005));
      }
      const d1 = await person("A ordinary"),
        d2 = await person("Z ordinary");
      let s = await query(
        initial(17, { kind: "foreground_fix", location: fix() }),
      );
      const all = [...s.items];
      let rank = 1;
      expect(s.totals).toMatchObject({
        matchingTotal: n + 2,
        radarTotal: n,
        ordinaryOnlyTotal: 2,
      });
      while (s.page!.hasMore) {
        expect(s.page!.rankStart).toBe(rank);
        rank = s.page!.rankEnd! + 1;
        s = await next(s, 13);
        all.push(...s.items);
      }
      expect(all).toHaveLength(n + 2);
      expect(new Set(all.map((x) => x.publicPlayerId)).size).toBe(n + 2);
      expect(all.slice(0, n).every((x) => x.radar !== null)).toBe(true);
      expect(all.slice(n).map((x) => x.publicPlayerId)).toEqual([
        d1.publicId,
        d2.publicId,
      ]);
    });
  it("promotes an ordinary page2 member and the true nearest beyond20; exact distance drives sort", async () => {
    const people = [];
    for (let i = 0; i < 60; i++)
      people.push(await person(`Directory ${String(i).padStart(3, "0")}`));
    for (let i = 0; i < 27; i++)
      await start(people[i + 30]!, fix(37.72 - i * 0.003));
    const s = await query(
      initial(10, { kind: "foreground_fix", location: fix(37.642) }),
    );
    expect(s.items[0]!.publicPlayerId).toBe(people[56]!.publicId);
    expect(s.totals).toMatchObject({
      matchingTotal: 60,
      radarTotal: 27,
      ordinaryOnlyTotal: 33,
    });
    const first = s.items[0]!.radar!;
    expect(first.distance).not.toBeNull();
    expect(first.geo.gridSizeMeters).toBe(100);
  });
  it("no origin gives city order, no numerical distances and no viewer consent/presence", async () => {
    const z = await person("Zed"),
      a = await person("Alpha");
    await start(z);
    await start(a);
    const s = await query();
    expect(s.items.map((i) => i.publicPlayerId)).toEqual([
      a.publicId,
      z.publicId,
    ]);
    expect(s.items.every((i) => i.radar!.distance === null)).toBe(true);
    expect(s.query.ordering).toBe("radar_city_then_directory");
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          viewer.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM radar_consent_events WHERE user_id=$1",
          [viewer.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("P-only projection withholds bio/area/looking and cannot unlock directory detail or DM", async () => {
    const p = await person("Private", false);
    await pool.query(
      "UPDATE player_social_profiles SET bio='private text',area_key='private-area' WHERE user_id=$1",
      [p.id],
    );
    await start(p);
    const s = await query();
    expect(s.items[0]!.projection).toBe("radar_public");
    expect(s.items[0]!.player).not.toHaveProperty("bio");
    expect(s.items[0]!.player.areaKey).toBeNull();
    expect(s.items[0]!.player.lookingForGame).toBeNull();
    expect(s.items[0]!.player.canRequestContact).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/players/${p.publicId}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    const dm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: headers(),
      payload: {
        targetPublicPlayerId: p.publicId,
        text: "Synthetic first contact",
        clientMessageId: randomUUID(),
        discoveryProof: s.items[0]!.radar!.resultRef,
      },
    });
    expect(dm.statusCode).toBe(404);
    await clearBudget();
    const f = await query(
      initial(
        50,
        { kind: "none" },
        { cityId: MOSCOW_CITY_ID, areaKey: "private-area" },
      ),
    );
    expect(f.totals.matchingTotal).toBe(0);
  });
  it("filters/name normalization and literal LIKE metacharacters precede counts", async () => {
    const p = await person("Al_% Player"),
      q = await person("Alice Other");
    await start(p);
    await start(q);
    await pool.query(
      "UPDATE player_social_profiles SET area_key='north' WHERE user_id=$1",
      [p.id],
    );
    const s = await query(
      initial(
        50,
        { kind: "none" },
        { cityId: MOSCOW_CITY_ID, name: " AL_% ", areaKey: "north" },
      ),
    );
    expect(s.items.map((i) => i.publicPlayerId)).toEqual([p.publicId]);
    expect(s.totals.matchingTotal).toBe(1);
    await clearBudget();
    expect(
      (
        await query(
          initial(50, { kind: "none" }, { cityId: MOSCOW_CITY_ID, name: "A" }),
        )
      ).totals.matchingTotal,
    ).toBe(2);
  });
  it("different profile/presence cities select ordinary Moscow and geographic SPB without cross-city point", async () => {
    const v = await person(
        "Demo viewer",
        false,
        MOSCOW_CITY_ID,
        demoUserId(410),
      ),
      p = await person("Demo sharer", true, MOSCOW_CITY_ID, demoUserId(411));
    await start(p, fix(30.3158, 20, 59.9391));
    const m = await query(initial(), v);
    expect(m.items[0]!.radar).toBeNull();
    await clearBudget(v);
    const s = await query(
      initial(50, { kind: "none" }, { cityId: DEMO_SPB_CITY_ID }),
      v,
    );
    expect(s.items[0]!.radar!.geo.latitude).toBeGreaterThan(59);
    expect((await query()).totals.matchingTotal).toBe(0);
  });
  it("independent map cursor shares context/order and rejects purpose transplant", async () => {
    for (let i = 0; i < 21; i++) await start(await person(`Pin ${i}`));
    await person("Ordinary");
    const s = await query(initial(5));
    const m = await query(
      { contractVersion: UNIFIED_WIRE, queryRef: s.query.queryRef, limit: 7 },
      viewer,
      true,
    );
    // A continuation MUST preserve the exact encrypted query reference:
    // sealUnified uses randomized AES-GCM and its raw tokens cannot otherwise
    // be compared by the Web client even for the same valid signed context.
    expect(m.query.queryRef).toBe(s.query.queryRef);
    expect(m.items).toHaveLength(7);
    expect(m.totals).toEqual(s.totals);
    expect(m.items.every((i) => i.radar !== null)).toBe(true);
    const n = await query(
      {
        contractVersion: UNIFIED_WIRE,
        queryRef: s.query.queryRef,
        mapCursor: m.mapPage!.nextMapCursor,
        limit: 7,
      },
      viewer,
      true,
    );
    expect(n.query.queryRef).toBe(s.query.queryRef);
    expect(n.mapPage!.rankStart).toBe(8);
    expect(
      (
        await request({
          contractVersion: UNIFIED_WIRE,
          queryRef: s.query.queryRef,
          cursor: m.mapPage!.nextMapCursor,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("ordinary page2 repeats stably with changed page size and rejects changed filters", async () => {
    for (let i = 0; i < 61; i++)
      await person(`Ordinary ${String(i).padStart(3, "0")}`);
    const s = await query(initial(50));
    const n = await next(s, 11),
      r = await next(s, 11);
    expect(n.items).toEqual(r.items);
    expect(n.query.queryRef).toBe(s.query.queryRef);
    expect(r.query.queryRef).toBe(s.query.queryRef);
    expect(n.page).toMatchObject({
      rankStart: 51,
      rankEnd: 61,
      hasMore: false,
    });
    expect(n.items.every((i) => i.radar === null)).toBe(true);
    expect(
      (
        await request({
          contractVersion: UNIFIED_WIRE,
          queryRef: s.query.queryRef,
          cursor: s.page!.nextCursor,
          filters: { cityId: MOSCOW_CITY_ID },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("revision change after page1 is stale, including changes outside returned page", async () => {
    await person("A");
    const z = await person("Z");
    const s = await query(initial(1));
    await pool.query(
      "UPDATE player_social_profiles SET display_name='0' WHERE user_id=$1",
      [z.id],
    );
    const n = await request({
      contractVersion: UNIFIED_WIRE,
      queryRef: s.query.queryRef,
      cursor: s.page!.nextCursor,
    });
    expect(n.statusCode).toBe(409);
    expect(n.json().code).toBe("PLAYERS_QUERY_STALE");
  });
  it("full-set expiry includes looking intent and publisher beyond page1", async () => {
    await start(await person("A"));
    const z = await person("Z");
    await start(z);
    await pool.query(
      "UPDATE radar_presences SET foreground_until=clock_timestamp()+interval '10 seconds' WHERE user_id=$1",
      [z.id],
    );
    const s = await query(initial(1));
    expect(Date.parse(s.validUntil) - Date.now()).toBeLessThan(10000);
  });
  it("unified enabled with G1 disabled preserves legacy MVP proof contact", async () => {
    env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED = false;
    try {
      const target = await person("Legacy flag matrix");
      let viewerActivation: string | undefined;
      for (const p of [viewer, target]) {
        await pool.query(
          "UPDATE player_social_profiles SET radar_consented=true,radar_consented_at=clock_timestamp(),radar_consent_policy_version='radar-mvp-v1' WHERE user_id=$1",
          [p.id],
        );
        const r = await app.inject({
          method: "POST",
          url: "/v1/me/radar/activations",
          headers: headers(p),
          payload: { location: fix(), consentPolicyVersion: "radar-mvp-v1" },
        });
        expect(r.statusCode, r.body).toBe(201);
        if (p === viewer) viewerActivation = r.json().activationId;
      }
      const nearby = await app.inject({
        method: "GET",
        url: "/v1/me/radar/nearby",
        headers: { ...headers(), "x-radar-activation-id": viewerActivation! },
      });
      expect(nearby.statusCode, nearby.body).toBe(200);
      const row = nearby
        .json()
        .items.find(
          (item: { player: { publicPlayerId: string } }) =>
            item.player.publicPlayerId === target.publicId,
        );
      expect(row).toBeDefined();
      const contact = await app.inject({
        method: "POST",
        url: "/v1/conversations/requests",
        headers: headers(),
        payload: {
          targetPublicPlayerId: target.publicId,
          text: "Synthetic legacy compatibility",
          clientMessageId: randomUUID(),
          discoveryProof: row.resultRef,
        },
      });
      expect(contact.statusCode, contact.body).toBe(201);
    } finally {
      env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED = true;
    }
  });
  it("legacy v1 publication never becomes a refined publisher and old renew cannot mutate v2", async () => {
    const p = await person("Legacy");
    const r = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: headers(p),
      payload: {
        location: fix(),
        consentPolicyVersion: GEO_POLICY,
        consent: { disclosureId: GEO_DISCLOSURE_ID, accepted: true },
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect((await query()).items[0]!.radar).toBeNull();
    const q = await person("Refined");
    const a = await start(q);
    const old = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/renew",
      headers: headers(q),
      payload: {
        activationId: a.activationId,
        expectedVersion: a.version,
        location: fix(),
      },
    });
    expect(old.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (
        await pool.query(
          "SELECT policy_version,location_model FROM radar_presences WHERE user_id=$1",
          [q.id],
        )
      ).rows[0],
    ).toMatchObject({
      policy_version: UNIFIED_POLICY,
      location_model: "regional_grid_100m_v1",
    });
    const geo = await app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: headers(),
      payload: {
        cityId: MOSCOW_CITY_ID,
        scope: "city",
        origin: { kind: "none" },
      },
    });
    expect(geo.statusCode, geo.body).toBe(200);
    expect(
      geo
        .json()
        .items.map(
          (i: { player: { publicPlayerId: string } }) =>
            i.player.publicPlayerId,
        ),
    ).not.toContain(q.publicId);
  });
  for (const accuracy of [100, 100.01, 1000])
    it(`model boundary ${accuracy} is disclosed`, async () => {
      const p = await person();
      const a = await start(p, fix(37.6173, accuracy));
      expect(a.gridSizeMeters).toBe(accuracy <= 100 ? 100 : 1000);
    });
  it("wrong disclosure/hash, invalid metadata and expired/future fix never publish", async () => {
    const p = await person();
    for (const payload of [
      {
        ...startBody(),
        consent: {
          disclosureId: UNIFIED_DISCLOSURE_ID,
          disclosureHash: "bad",
          accepted: true,
        },
      },
      startBody({
        ...fix(),
        capturedAt: new Date(Date.now() - 61000).toISOString(),
      }),
      startBody({
        ...fix(),
        capturedAt: new Date(Date.now() + 31000).toISOString(),
      }),
      startBody(fix(37.61, 1000.01)),
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/me/radar/activations",
        headers: headers(p),
        payload,
      });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          p.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("private origin references never extend expiry and wrong session is rejected", async () => {
    await start(await person());
    const s = await query(
      initial(50, {
        kind: "foreground_fix",
        location: {
          ...fix(),
          capturedAt: new Date(Date.now() - 40000).toISOString(),
        },
      }),
    );
    const o = openUnified(
      env,
      "origin",
      s.query.originRef!,
      (await import("../../src/radar/unified-contract")).originSchema,
    )!;
    expect(o.expiresAt - Date.now()).toBeLessThan(20000);
    await clearBudget();
    const n = await query(
      initial(50, { kind: "reference", originRef: s.query.originRef }),
    );
    expect(Date.parse(n.validUntil)).toBeLessThanOrEqual(o.expiresAt);
    const other = await person("Other viewer", false);
    expect(
      (
        await request(
          initial(50, { kind: "reference", originRef: s.query.originRef }),
          other,
        )
      ).statusCode,
    ).toBe(400);
  });
  it("preview revalidates exact model/identity/receipt without reciprocal activation or cap20", async () => {
    for (let i = 0; i < 21; i++)
      await start(await person(`Proof ${String(i).padStart(2, "0")}`, false));
    const s = await query();
    const proof = s.items[20]!.radar!.resultRef;
    const r = await preview(proof);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().radar.geo.model).toBe("regional_grid_100m_v1");
    expect(r.json().upcomingGames).toEqual([]);
    const p = openUnified(env, "result", proof, proofSchema)!;
    for (const mutated of [
      { ...p, publicId: randomUUID() },
      { ...p, receiptId: randomUUID() },
      { ...p, model: "regional_grid_1000m_v1" as const },
      { ...p, context: { ...p.context, sessionId: randomUUID() } },
      {
        ...p,
        context: { ...p.context, filters: { cityId: DEMO_SPB_CITY_ID } },
      },
    ])
      expect(
        (await preview(sealUnified(env, "result", mutated))).statusCode,
      ).toBe(404);
  });
  it("Stop invalidates proof and query while feature flags off, status remains truthful", async () => {
    const p = await person();
    await gameFixture(p);
    const a = await start(p);
    const s = await query();
    env.SOCIAL_RADAR_UNIFIED_ENABLED = false;
    env.SOCIAL_RADAR_PUBLISHING_V2_ENABLED = false;
    env.SOCIAL_RADAR_ENABLED = false;
    try {
      const status = await app.inject({
        method: "GET",
        url: "/v1/me/radar/activations/current",
        headers: headers(p),
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        state: "active",
        model: "regional_grid_100m_v1",
        updateRequired: true,
      });
      const stop = await app.inject({
        method: "DELETE",
        url: "/v1/me/radar/activations/current",
        headers: { ...headers(p), "x-radar-activation-id": a.activationId },
      });
      expect(stop.statusCode, stop.body).toBe(204);
    } finally {
      env.SOCIAL_RADAR_UNIFIED_ENABLED = true;
      env.SOCIAL_RADAR_PUBLISHING_V2_ENABLED = true;
      env.SOCIAL_RADAR_ENABLED = true;
    }
    expect((await preview(s.items[0]!.radar!.resultRef)).statusCode).toBe(404);
  });
  it("owner session revocation and consent withdrawal atomically remove presence", async () => {
    const p = await person();
    await gameFixture(p);
    await start(p);
    const s = await query();
    await sessions.revokeSession(p.issued.session.id);
    expect((await preview(s.items[0]!.radar!.resultRef)).statusCode).toBe(404);
    const q = await person();
    await start(q);
    const version = (
      await pool.query<{ version: number }>(
        "SELECT version FROM player_social_profiles WHERE user_id=$1",
        [q.id],
      )
    ).rows[0]!.version;
    await app
      .get(ProfilesService)
      .patchOwn(q.id, q.issued.session.id, randomUUID(), {
        expectedVersion: version,
        radarConsented: false,
      });
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          q.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("bilateral block excludes geography and retires current proof", async () => {
    const p = await person();
    await gameFixture(p);
    await start(p);
    const s = await query();
    await app
      .get(SafetyService)
      .block(p.id, p.issued.session.id, randomUUID(), viewer.publicId);
    expect((await preview(s.items[0]!.radar!.resultRef)).statusCode).toBe(404);
    await clearBudget();
    expect((await query()).totals.matchingTotal).toBe(0);
  });
  it("takeover generation survives stale owner Stop, heartbeat never extends fix/hard lifetime", async () => {
    const p = await person();
    const a = await start(p);
    const issued = await sessions.createConsumerSession(p.id);
    const replacement = { ...p, issued };
    const r = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/takeover",
      headers: headers(replacement),
      payload: {
        ...startBody(),
        activationId: a.activationId,
        expectedVersion: a.version,
        confirm: true,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.activationId).not.toBe(a.activationId);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/me/radar/activations/current",
          headers: { ...headers(p), "x-radar-activation-id": a.activationId },
        })
      ).statusCode,
    ).toBe(204);
    const h = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/heartbeat",
      headers: headers(replacement),
      payload: {
        contractVersion: UNIFIED_WIRE,
        consentPolicyVersion: UNIFIED_POLICY,
        activationId: b.activationId,
      },
    });
    expect(h.statusCode, h.body).toBe(200);
    expect(h.json().locationValidUntil).toBe(b.locationValidUntil);
    expect(h.json().hardExpiresAt).toBe(b.hardExpiresAt);
  });
  it("query flood and CSRF/guest/unknown-field failures expose no geo and remain no-store", async () => {
    await query();
    const r = await request();
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBeDefined();
    expect(r.headers["cache-control"]).toBe("no-store");
    for (const h of [
      {},
      { ...headers(), "x-csrf-token": "bad" },
      { ...headers(), authorization: "Bearer conflicting" },
    ]) {
      const e = await app.inject({
        method: "POST",
        url: "/v1/players/query",
        headers: h,
        payload: initial(),
      });
      expect(e.statusCode).toBeGreaterThanOrEqual(400);
      expect(e.headers["cache-control"]).toBe("no-store");
      expect(e.json()).not.toHaveProperty("items");
    }
    await clearBudget();
    expect((await request({ ...initial(), unknown: 1 })).statusCode).toBe(400);
    expect((await request({ ...initial(), filters: {} })).statusCode).toBe(422);
  });
  it("racing page reader after committed stop returns stale and no mixed epoch", async () => {
    const p = await person("A"),
      q = await person("Z");
    await start(p);
    await start(q);
    const s = await query(initial(1));
    const service = app.get(ProfilesService),
      original = service.contactableTargets.bind(service);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
        entered = r;
      }),
      wait = new Promise<void>((r) => {
        release = r;
      });
    const spy = vi
      .spyOn(service, "contactableTargets")
      .mockImplementationOnce(async (...args) => {
        entered();
        await wait;
        return original(...args);
      });
    const pending = request({
      contractVersion: UNIFIED_WIRE,
      queryRef: s.query.queryRef,
      cursor: s.page!.nextCursor,
    });
    await gate;
    await pool.query("DELETE FROM radar_presences WHERE user_id=$1", [p.id]);
    release();
    const r = await pending;
    spy.mockRestore();
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().code).toBe("PLAYERS_QUERY_STALE");
  });
  it("stop wins while preview waits on pair and presence fences", async () => {
    const p = await person();
    const a = await start(p);
    const s = await query();
    const pairs = app.get(
      (await import("../../src/safety/pair-fence.service")).PairFenceService,
    );
    const lock = await pool.connect();
    await lock.query("BEGIN");
    await pairs.lockOrCreate(lock, viewer.id, p.id);
    const pending = preview(s.items[0]!.radar!.resultRef);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const stop = await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: { ...headers(p), "x-radar-activation-id": a.activationId },
    });
    expect(stop.statusCode).toBe(204);
    await lock.query("COMMIT");
    lock.release();
    expect((await pending).statusCode).toBe(404);
  });
  it("full snapshot final revision fence rejects a concurrent projection write", async () => {
    const p = await person("A"),
      q = await person("Z");
    const service = app.get(ProfilesService);
    const original = service.contactableTargets.bind(service);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      entered = r;
    });
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const spy = vi
      .spyOn(service, "contactableTargets")
      .mockImplementationOnce(async (...args) => {
        entered();
        await wait;
        return original(...args);
      });
    const pending = request(initial(1));
    await gate;
    await pool.query(
      "UPDATE player_social_profiles SET display_name='0' WHERE user_id=$1",
      [q.id],
    );
    release();
    const r = await pending;
    spy.mockRestore();
    expect(r.statusCode, r.body).toBe(409);
    expect(p.publicId).toBeDefined();
  });
  it("restore/reset clears ephemeral presence and old epoch rejects query tokens", async () => {
    await start(await person());
    const s = await query();
    await resetRadarPresenceBeforeServingTraffic(sqlExecutorFromPg(pool));
    expect((await pool.query("SELECT 1 FROM radar_presences")).rowCount).toBe(
      0,
    );
    expect(
      openUnified(
        { ...env, RADAR_GEOGRAPHIC_TOKEN_EPOCH: "after-restore" },
        "query",
        s.query.queryRef,
        contextSchema,
      ),
    ).toBeNull();
  });
  it("a valid publisher beyond20 can request contact under current directory policy", async () => {
    const targets = [];
    for (let i = 0; i < 21; i++) {
      const p = await person(`Contact ${String(i).padStart(2, "0")}`);
      targets.push(p);
      await start(p);
    }
    const s = await query();
    const row = s.items[20]!;
    const r = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: headers(),
      payload: {
        targetPublicPlayerId: row.publicPlayerId,
        text: "Synthetic bounded contact",
        clientMessageId: randomUUID(),
        discoveryProof: row.radar!.resultRef,
      },
    });
    expect(r.statusCode, r.body).toBe(201);
  });
  it("expired target lease/fix/TTL/hard/session deadlines independently remove P", async () => {
    for (const column of [
      "foreground_until",
      "location_valid_until",
      "expires_at",
      "hard_expires_at",
    ]) {
      await pool.query("DELETE FROM radar_presences");
      const p = await person("Expiry", false);
      await start(p);
      // TTL CHECK requires started<expires<=hard even in a synthetic expired fixture.
      const values: Record<string, string> = {
        started_at: "clock_timestamp()-interval '40 minutes'",
        expires_at: "clock_timestamp()+interval '5 minutes'",
        hard_expires_at: "clock_timestamp()+interval '10 minutes'",
      };
      values[column] = "clock_timestamp()-interval '1 second'";
      if (column === "hard_expires_at")
        values.expires_at = "clock_timestamp()-interval '2 seconds'";
      await pool.query(
        `UPDATE radar_presences SET ${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join(",")} WHERE user_id=$1`,
        [p.id],
      );
      await clearBudget();
      expect((await query()).totals.radarTotal).toBe(0);
    }
    await pool.query("DELETE FROM radar_presences");
    const p = await person("Session expiry", false);
    await start(p);
    await pool.query(
      "UPDATE app_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [p.issued.session.id],
    );
    await clearBudget();
    expect((await query()).totals.radarTotal).toBe(0);
  });
  it("current_activation origin is owning-session bound and old generation is unavailable", async () => {
    const a = await start(viewer);
    await start(await person("Peer"));
    const s = await query(
      initial(50, { kind: "current_activation", activationId: a.activationId }),
    );
    expect(s.query.originState).toBe("authorized");
    const replacement = {
      ...viewer,
      issued: await sessions.createConsumerSession(viewer.id),
    };
    expect(
      (
        await request(
          initial(50, {
            kind: "current_activation",
            activationId: a.activationId,
          }),
          replacement,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: { ...headers(), "x-radar-activation-id": a.activationId },
    });
    await clearBudget();
    expect(
      (
        await request(
          initial(50, { kind: "reference", originRef: s.query.originRef }),
        )
      ).statusCode,
    ).toBe(404);
  });
  it("duration budgets never consume Stop/status and command receipts contain no fix metadata", async () => {
    const p = await person("Receipt"),
      payload = startBody(),
      h = headers(p);
    const r = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: h,
      payload,
    });
    expect(r.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: h,
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().activationId).toBe(r.json().activationId);
    const receipts = await pool.query<{
      response_body: Record<string, unknown>;
    }>(
      "SELECT response_body FROM idempotency_records WHERE actor_id=$1 AND operation LIKE 'radar.unified.%'",
      [p.id],
    );
    expect(Object.keys(receipts.rows[0]!.response_body).sort()).toEqual([
      "activationId",
      "version",
    ]);
    const before = (
      await pool.query(
        "SELECT count(*) n FROM idempotency_records WHERE actor_id=$1",
        [viewer.id],
      )
    ).rows[0].n;
    await query();
    expect(
      (
        await pool.query(
          "SELECT count(*) n FROM idempotency_records WHERE actor_id=$1",
          [viewer.id],
        )
      ).rows[0].n,
    ).toBe(before);
  });
  it("accurate/poor fixes use real UTM centers and public geodesic estimates, never raw GPS", async () => {
    const p = await person("Fine"),
      q = await person("Coarse");
    await start(p, fix(37.65, 10));
    await start(q, fix(37.7, 600));
    const s = await query(
      initial(50, { kind: "foreground_fix", location: fix() }),
    );
    const fine = s.items.find((i) => i.publicPlayerId === p.publicId)!.radar!,
      coarse = s.items.find((i) => i.publicPlayerId === q.publicId)!.radar!;
    expect(fine.geo.gridSizeMeters).toBe(100);
    expect(fine.geo.longitude).not.toBe(37.65);
    expect(coarse.geo.quality).toBe("degraded");
    expect(coarse.distance!.roundingStepMeters).toBe(1000);
    expect(fine.geo).not.toHaveProperty("source_accuracy_meters");
    const points = await pool.query<{ cell_error: number }>(
      "SELECT abs(mod(ST_X(ST_Transform(coarse_center::geometry,32637))::numeric,grid_size_meters)-grid_size_meters/2) AS cell_error FROM radar_presences",
    );
    expect(points.rows.every((r) => Number(r.cell_error) < 0.001)).toBe(true);
  });
  it("origin60s boundary, unsupported city and expired queryRef reject without fallback", async () => {
    expect(
      (
        await request(
          initial(50, {
            kind: "foreground_fix",
            location: {
              ...fix(),
              capturedAt: new Date(Date.now() - 60000).toISOString(),
            },
          }),
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (await request(initial(50, { kind: "none" }, { cityId: randomUUID() })))
        .statusCode,
    ).toBe(422);
    const s = await query(initial(1));
    const c = openUnified(env, "query", s.query.queryRef, contextSchema)!;
    const expired = sealUnified(env, "query", {
      ...c,
      expiresAt: Date.now() - 1,
    });
    expect(
      (
        await request(
          {
            contractVersion: UNIFIED_WIRE,
            queryRef: expired,
            mapCursor: undefined,
          },
          viewer,
          true,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("trainer and unexpired looking filters apply to the whole effective public set", async () => {
    const p = await person("Filtered pass"),
      q = await person("Filtered fail"),
      hidden = await person("Filtered hidden", false);
    for (const target of [p, q, hidden]) await start(target);
    for (const target of [p, hidden]) {
      await pool.query(
        "INSERT INTO trainer_profiles(user_id,display_name) VALUES($1,'Fictional trainer')",
        [target.id],
      );
      await pool.query(
        "INSERT INTO player_looking_intents(user_id,active,city_id,starts_at,ends_at,expires_at) VALUES($1,true,$2,clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 minute')",
        [target.id, MOSCOW_CITY_ID],
      );
    }
    const filters = {
      cityId: MOSCOW_CITY_ID,
      name: " FILTERED ",
      trainer: true,
      looking: true,
    };
    const r = await query(initial(50, { kind: "none" }, filters));
    expect(r.items.map((i) => i.publicPlayerId)).toEqual([p.publicId]);
    expect(r.totals.matchingTotal).toBe(1);
    await pool.query(
      "UPDATE player_looking_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [p.id],
    );
    await clearBudget();
    expect(
      (await query(initial(50, { kind: "none" }, filters))).totals
        .matchingTotal,
    ).toBe(0);
  });
  it("profileless authenticated viewer reads publishers without consent and telemetry cannot stale page2", async () => {
    await pool.query("DELETE FROM player_social_profiles WHERE user_id=$1", [
      viewer.id,
    ]);
    for (let i = 0; i < 2; i++)
      await start(await person(`Anonymous read ${i}`));
    const s = await query(initial(1));
    expect(s.items[0]!.player.canRequestContact).toBe(false);
    const before = (
      await pool.query("SELECT revision FROM players_query_revision")
    ).rows[0].revision;
    await pool.query(
      "UPDATE app_sessions SET last_seen_at=clock_timestamp() WHERE id=$1",
      [viewer.issued.session.id],
    );
    expect(
      (await pool.query("SELECT revision FROM players_query_revision")).rows[0]
        .revision,
    ).toBe(before);
    expect((await next(s)).items).toHaveLength(1);
  });
  it("v2 update/renew preserve pacing, radius budget, hard lifetime and exact version CAS", async () => {
    const p = await person("Update lifecycle");
    const a = await start(p);
    const command = {
      contractVersion: UNIFIED_WIRE,
      consentPolicyVersion: UNIFIED_POLICY,
      activationId: a.activationId,
      expectedVersion: a.version,
    };
    const radius = await app.inject({
      method: "PATCH",
      url: "/v1/me/radar/activations/current",
      headers: headers(p),
      payload: { ...command, radiusBucketKm: 10 },
    });
    expect(radius.statusCode, radius.body).toBe(200);
    expect(radius.json().radiusBucketKm).toBe(10);
    const tooSoon = await app.inject({
      method: "PATCH",
      url: "/v1/me/radar/activations/current",
      headers: headers(p),
      payload: {
        ...command,
        expectedVersion: radius.json().version,
        radiusBucketKm: 3,
      },
    });
    expect(tooSoon.statusCode).toBe(429);
    const stale = await app.inject({
      method: "PATCH",
      url: "/v1/me/radar/activations/current",
      headers: headers(p),
      payload: { ...command, location: fix() },
    });
    expect(stale.statusCode).toBe(409);
    await pool.query(
      "UPDATE radar_presences SET next_location_update_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [p.id],
    );
    const update = await app.inject({
      method: "PATCH",
      url: "/v1/me/radar/activations/current",
      headers: headers(p),
      payload: {
        ...command,
        expectedVersion: radius.json().version,
        location: fix(37.65, 300),
      },
    });
    expect(update.statusCode, update.body).toBe(200);
    expect(update.json().gridSizeMeters).toBe(1000);
    const renew = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/renew",
      headers: headers(p),
      payload: {
        ...command,
        expectedVersion: update.json().version,
        extendMinutes: 15,
      },
    });
    expect(renew.statusCode, renew.body).toBe(200);
    expect(renew.json().hardExpiresAt).toBe(a.hardExpiresAt);
    expect(renew.json().locationValidUntil).toBe(
      update.json().locationValidUntil,
    );
  });
  it("all authenticated DEV viewers see fixtures, refresh before RR and retain proof isolation", async () => {
    const saved = { APP_ENV: env.APP_ENV, PUBLIC_WEB_ORIGIN: env.PUBLIC_WEB_ORIGIN, PUBLIC_API_ORIGIN: env.PUBLIC_API_ORIGIN, RADAR_DEV_TEST_OWNER_USER_ID: env.RADAR_DEV_TEST_OWNER_USER_ID, RADAR_DEV_TEST_SECOND_USER_ID: env.RADAR_DEV_TEST_SECOND_USER_ID };
    const owner = await person("Synthetic owner", false, MOSCOW_CITY_ID);
    const service = app.get(UnifiedPlayersService);
    const before = (await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [owner.id])).rows[0];
    try {
      env.APP_ENV = "stage";
      env.PUBLIC_WEB_ORIGIN = env.PUBLIC_API_ORIGIN = "https://dev.gobadminton.ru";
      env.RADAR_DEV_TEST_OWNER_USER_ID = owner.id;
      expect((await app.get(GeographicRadarService).config(owner.id, owner.issued.session.id))).toHaveProperty("devMoscowTest", { latitude:55.7558, longitude:37.6173, accuracyMeters:25 });
      expect((await app.get(GeographicRadarService).config(viewer.id, viewer.issued.session.id))).not.toHaveProperty("devMoscowTest");
      const second = await person("Second test actor", false, MOSCOW_CITY_ID);
      env.RADAR_DEV_TEST_SECOND_USER_ID = second.id;
      const secondConfig = await app.get(GeographicRadarService).config(second.id, second.issued.session.id);
      expect(secondConfig).toHaveProperty("devMoscowTest");
      expect(JSON.stringify(secondConfig)).not.toContain(second.id);
      expect(JSON.stringify(secondConfig)).not.toContain(owner.id);
      expect((await app.get(GeographicRadarService).config(viewer.id, viewer.issued.session.id))).not.toHaveProperty("devMoscowTest");
      // Capability does not bypass an explicit disclosure receipt.
      const noConsent = await app.inject({ method: "POST", url: "/v1/me/radar/activations", headers: headers(second), payload: { contractVersion: UNIFIED_WIRE, consentPolicyVersion: UNIFIED_POLICY, location: fix() } });
      expect(noConsent.statusCode).toBeGreaterThanOrEqual(400);
      expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [second.id])).rowCount).toBe(0);
      const configWithoutOrigin = await app.inject({ method: "GET", url: "/v1/radar/config", headers: { cookie: `${SESSION_COOKIE}=${owner.issued.sessionToken}` } });
      expect(configWithoutOrigin.statusCode).toBe(200);
      expect(configWithoutOrigin.json()).toHaveProperty("devMoscowTest");

      env.PUBLIC_API_ORIGIN = "https://gobadminton.ru";
      expect((await app.get(GeographicRadarService).config(owner.id, owner.issued.session.id))).not.toHaveProperty("devMoscowTest");
      expect((await service.query(owner.id, owner.issued.session.id, initial())).items.some(r=>r.player.displayName.startsWith("TEST"))).toBe(false);
      expect((await pool.query("SELECT 1 FROM users WHERE id=ANY($1::uuid[])",[DEV_MOSCOW_PEER_IDS])).rowCount).toBe(0);
      env.PUBLIC_API_ORIGIN = "https://dev.gobadminton.ru";
      await expect(service.query(owner.id, viewer.issued.session.id, initial(), false)).rejects.toThrow();
      expect((await pool.query("SELECT 1 FROM users WHERE id=ANY($1::uuid[])",[DEV_MOSCOW_PEER_IDS])).rowCount).toBe(0);
      await clearBudget(owner);
      await clearBudget(viewer);
      const first = await service.query(viewer.id, viewer.issued.session.id, initial(50, { kind:"foreground_fix", location:fix() }), false);
      const peers = first.items.filter(r => r.player.displayName.startsWith("TEST · DEV Москва"));
      expect(peers).toHaveLength(6);
      expect(peers.every(r => r.projection === "radar_public" && r.radar?.geo.gridSizeMeters === 100 && r.radar.distance !== null)).toBe(true);
      const evidence = await pool.query(`SELECT r.*,ST_AsText(coarse_center) center FROM radar_presences r WHERE user_id=ANY($1::uuid[])`, [DEV_MOSCOW_PEER_IDS]);
      expect(new Set(evidence.rows.map(r => r.center)).size).toBe(6);
      for (const r of evidence.rows) {
        // DEV fixtures use a stable 15-minute lease (not real-user 90s foreground).
        expect(r.foreground_until.getTime()-r.started_at.getTime()).toBeCloseTo(900000,-2);
        expect(r.location_valid_until.getTime()-r.started_at.getTime()).toBeCloseTo(900000,-2);
        expect(r.expires_at.getTime()-r.started_at.getTime()).toBeCloseTo(900000,-2);
        expect(r.hard_expires_at.getTime()-r.started_at.getTime()).toBeCloseTo(1800000,-2);
      }
      expect((await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [owner.id])).rows[0]).toEqual(before);
      expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [owner.id])).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM external_identities WHERE user_id=ANY($1::uuid[])", [DEV_MOSCOW_PEER_IDS])).rowCount).toBe(0);
      expect((await pool.query("SELECT csrf_ciphertext FROM app_sessions WHERE user_id=ANY($1::uuid[])", [DEV_MOSCOW_PEER_IDS])).rows.every(r => r.csrf_ciphertext === "!fixture-no-login")).toBe(true);
      const proof = openUnified(env,"result",peers[0]!.radar!.resultRef,proofSchema)!;
      const client = await pool.connect();
      try {
        expect((await redeemUnifiedProof(client,proof,false,false,env)).displayName).toMatch(/^TEST/);
        await expect(redeemUnifiedProof(client,{...proof,context:{...proof.context,sessionId:owner.issued.session.id}},false,false,env)).rejects.toThrow();
        await expect(redeemUnifiedProof(client,proof,false,false,{...env,RADAR_DEV_TEST_OWNER_USER_ID:undefined})).rejects.toThrow();
        await expect(redeemUnifiedProof(client,proof,false,false,{...env,APP_ENV:"prod"})).rejects.toThrow();
      } finally { client.release(); }
      await clearBudget(owner);
      await service.query(owner.id,owner.issued.session.id,initial(), false);
      expect((await pool.query("SELECT activation_id FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id",[DEV_MOSCOW_PEER_IDS])).rows.map(r=>r.activation_id)).toEqual(evidence.rows.sort((a,b)=>a.user_id.localeCompare(b.user_id)).map(r=>r.activation_id));
      await clearBudget(viewer);
      expect((await service.query(viewer.id,viewer.issued.session.id,initial())).items.filter(r=>r.player.displayName.startsWith("TEST"))).toHaveLength(6);
      await pool.query("UPDATE radar_presences SET foreground_until=clock_timestamp()-interval '1 second' WHERE user_id=ANY($1::uuid[])",[DEV_MOSCOW_PEER_IDS]);
      await clearBudget(owner);
      await clearBudget(viewer);
      const beforeRenew = (await pool.query("SELECT user_id,activation_id FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id",[DEV_MOSCOW_PEER_IDS])).rows;
      const refreshed = await service.query(viewer.id,viewer.issued.session.id,initial(), false);
      expect(refreshed.items.filter(r=>r.player.displayName.startsWith("TEST"))).toHaveLength(6);
      expect(refreshed.items.find(r=>r.publicPlayerId===peers[0]!.publicPlayerId)!.radar!.resultRef).not.toBe(peers[0]!.radar!.resultRef);
      // Due renew extends leases in place; activation churn is not required for fixture stability.
      expect((await pool.query("SELECT user_id,activation_id FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id",[DEV_MOSCOW_PEER_IDS])).rows).toEqual(beforeRenew);
      const expiredClient = await pool.connect();
      try { await expect(redeemUnifiedProof(expiredClient,proof,false,false,env)).rejects.toThrow(); }
      finally { expiredClient.release(); }
      // Adversarial over-budget request must fail before obtaining the shared
      // fixture lock: even expired peers may not be refreshed by a 429.
      await pool.query("UPDATE radar_presences SET foreground_until=clock_timestamp()-interval '1 second' WHERE user_id=ANY($1::uuid[])", [DEV_MOSCOW_PEER_IDS]);
      const before429 = (await pool.query("SELECT user_id,activation_id,foreground_until FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id", [DEV_MOSCOW_PEER_IDS])).rows;
      const revision429 = (await pool.query("SELECT revision::text AS revision FROM players_query_revision WHERE singleton")).rows[0].revision;
      await expect(service.query(viewer.id,viewer.issued.session.id,initial())).rejects.toMatchObject({status:429});
      expect((await pool.query("SELECT user_id,activation_id,foreground_until FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id", [DEV_MOSCOW_PEER_IDS])).rows).toEqual(before429);
      expect((await pool.query("SELECT revision::text AS revision FROM players_query_revision WHERE singleton")).rows[0].revision).toBe(revision429);
      env.APP_ENV = "prod";
      await clearBudget(viewer);
      expect((await service.query(viewer.id,viewer.issued.session.id,initial())).items.some(r=>r.player.displayName.startsWith("TEST"))).toBe(false);
      expect((await app.get(GeographicRadarService).config(owner.id, owner.issued.session.id))).not.toHaveProperty("devMoscowTest");
      env.APP_ENV = "stage";
      env.RADAR_DEV_TEST_OWNER_USER_ID = undefined;
      await clearBudget(owner);
      expect((await service.query(owner.id,owner.issued.session.id,initial(), false)).items.some(r=>r.player.displayName.startsWith("TEST"))).toBe(false);
    } finally { Object.assign(env,saved); }
  });

});
