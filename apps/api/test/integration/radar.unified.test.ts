import type { UnifiedPreview, UnifiedUpcomingGame } from "@gobadminton/contracts/src/unified.generated";
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
  // Issue #149. Authored for the existing disposable-DB harness only.
  // SOURCE-ONLY EXECUTION: NOT_TESTED; integrator must run this suite.
  describe("u1 player upcomingGames relationship privacy", () => {
    async function gameFixture(creator: Person, offsetMinutes = 60) {
      const venue = (await pool.query<{ id: string }>(`INSERT INTO venues
        (city_id,name,address,timezone,location,created_by_user_id,contact_phone,booking_note)
        VALUES($1,'Synthetic public hall','Synthetic address','Europe/Moscow',
          ST_SetSRID(ST_MakePoint(37.61,55.75),4326)::geography,$2,'PRIVATE_PHONE','PRIVATE_NOTE') RETURNING id`,
      [MOSCOW_CITY_ID, creator.id])).rows[0]!.id;
      return (await pool.query<{ id: string }>(`INSERT INTO games
        (venue_id,title,host_display_name,host_public_contact,status,visibility,starts_at,ends_at,timezone,
         application_deadline_at,capacity,format_key,level_scale_id,level_scale_version,allowed_level_ids,
         settlement_mode,settlement_terms,activity_kind,settlement_purpose,created_by_user_id)
        VALUES($1,'Synthetic public game','Host','PRIVATE_CONTACT','published','public',
         clock_timestamp()+$3::int*interval '1 minute',clock_timestamp()+($3::int+60)*interval '1 minute',
         'Europe/Moscow',clock_timestamp(),4,'doubles','synthetic',1,'[]','external','PRIVATE_TERMS',
         'regular','no_trainer_fee',$2) RETURNING id`, [venue, creator.id, offsetMinutes])).rows[0]!.id;
    }
    async function participation(gameId: string, target: Person, status = 'confirmed') {
      await pool.query("INSERT INTO participations(game_id,user_id,status,decision_reason) VALUES($1,$2,$3,'PRIVATE_REASON')", [gameId, target.id, status]);
    }
    async function manager(gameId: string, p = viewer, role = 'manager', status = 'active') {
      await pool.query("INSERT INTO game_managers(game_id,user_id,role,status) VALUES($1,$2,$3,$4)", [gameId, p.id, role, status]);
    }
    async function proofFor(p: Person) {
      await clearBudget(); return (await query()).items.find(row => row.publicPlayerId === p.publicId)!.radar!.resultRef;
    }
    async function optOut(p: Person) {
      const profile = await pool.query<{ version: number }>(
        "SELECT version FROM player_social_profiles WHERE user_id=$1", [p.id],
      );
      const result = await app.get(ProfilesService).patchOwn(p.id, p.issued.session.id, randomUUID(), {
        expectedVersion: profile.rows[0]!.version,
        radarConsented: false,
      });
      expect(result.statusCode).toBe(200);
      expect(result.body.radarConsented).toBe(false);
      expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [p.id])).rowCount).toBe(0);
    }
    async function gamesFor(proof: string, p = viewer): Promise<UnifiedUpcomingGame[]> {
      await clearBudget(p); const response = await preview(proof, p);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      return response.json<UnifiedPreview>().upcomingGames;
    }
    it("limits distinct eligible creator games AFTER privacy/discovery filtering and uses only canonical media", async () => {
      const target = await person('Public creator'); await start(target);
      const permitted = [await gameFixture(target, 90), await gameFixture(target, 60), await gameFixture(target, 60), await gameFixture(target, 120)];
      // A game authorized by both branches must occur only once.
      await participation(permitted[1]!, target); await manager(permitted[1]!);
      const tie = new Date(Date.now() + 3600000);
      await pool.query("UPDATE games SET starts_at=$2,ends_at=$2::timestamptz+interval '1 hour' WHERE id=ANY($1::uuid[])", [permitted.slice(1, 3), tie]);
      for (const kind of ['unlisted', 'draft', 'cancelled', 'past', 'unclassified', 'hidden', 'taken_down']) {
        const id = await gameFixture(target, 10);
        if (kind === 'unlisted') await pool.query("UPDATE games SET visibility='unlisted' WHERE id=$1", [id]);
        if (kind === 'draft' || kind === 'cancelled') await pool.query("UPDATE games SET status=$2 WHERE id=$1", [id, kind]);
        if (kind === 'past') await pool.query("UPDATE games SET application_deadline_at=clock_timestamp()-interval '3 hours',starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [id]);
        if (kind === 'unclassified') await pool.query("UPDATE games SET activity_kind=NULL,settlement_purpose=NULL WHERE id=$1", [id]);
        if (kind === 'hidden' || kind === 'taken_down') await pool.query("INSERT INTO game_moderation_state(game_id,state) VALUES($1,$2)", [id, kind]);
      }
      const result = await gamesFor(await proofFor(target));
      const expected = (await pool.query<{ id: string }>("SELECT id FROM games WHERE id=ANY($1::uuid[]) ORDER BY starts_at,id LIMIT 3", [permitted])).rows.map(row => row.id);
      expect(result.map(row => row.id)).toEqual(expected); expect(new Set(result.map(row => row.id)).size).toBe(3);
      for (const game of result) {
        expect(Object.keys(game).sort()).toEqual(['activityKind','cover','endsAt','id','startsAt','timezone','title','venue']);
        expect(Object.keys(game.venue).sort()).toEqual(['cover','name']);
        expect(Object.keys(game.cover)).toEqual(['uploadedUrl']); expect(Object.keys(game.venue.cover)).toEqual(['uploadedUrl']);
        const media = (await pool.query("SELECT game_effective_cover_url($1) game,venue_cover_url(venue_id) venue FROM games WHERE id=$1", [game.id])).rows[0];
        expect(game.cover.uploadedUrl).toBe(media.game); expect(game.venue.cover.uploadedUrl).toBe(media.venue);
      }
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|userId|participation|manager|latitude|longitude|organizer|contact|booking|provider/);
    });
    it.each(['owner','manager'])("permits confirmed target participation only for the current active viewer %s", async role => {
      const creator = await person('Creator', false), target = await person('Radar only', false); await start(target);
      const id = await gameFixture(creator); await participation(id, target); await manager(id, viewer, role);
      expect((await gamesFor(await proofFor(target))).map(row => row.id)).toEqual([id]);
      // An ordinary viewer's OWN confirmed membership confers no roster authority.
      await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1", [id]);
      await participation(id, viewer);
      expect(await gamesFor(await proofFor(target))).toEqual([]);
    });
    it("does not equate public creator, arbitrary manager/trainer, invitation or nonconfirmed participation", async () => {
      const target = await person('Radar only', false), creator = await person('Other creator', false); await start(target);
      await gameFixture(target); // Radar-only creator shortcut is forbidden.
      const unrelated = await gameFixture(creator); await manager(unrelated, target);
      const trainer=(await pool.query("INSERT INTO trainer_profiles(user_id,display_name) VALUES($1,'Synthetic trainer') RETURNING id", [target.id])).rows[0].id;
      await pool.query("UPDATE games SET activity_kind='trainer_led',trainer_profile_id=$2,trainer_display_name_snapshot='Synthetic trainer',settlement_purpose='trainer_fee',price_status='by_agreement' WHERE id=$1",[unrelated,trainer]);
      for (const status of ['pending','rejected','withdrawn','removed','expired','cancelled_by_game']) {
        const id = await gameFixture(creator); await participation(id, target, status); await manager(id);
      }
      // Invitation has no participation and must not contribute even for a roster manager.
      const invited = await gameFixture(creator); await manager(invited);
      const pair=(await pool.query("INSERT INTO social_pairs(user_low,user_high) VALUES(LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid)) ON CONFLICT(user_low,user_high) DO UPDATE SET version=social_pairs.version RETURNING id",[target.id,viewer.id])).rows[0].id;
      await pool.query("INSERT INTO game_invitations(game_id,invitee_user_id,inviter_user_id,pair_id,status,expires_at) VALUES($1,$2,$3,$4,'pending',clock_timestamp()+interval '1 hour')", [invited,target.id,viewer.id,pair]);
      expect(await gamesFor(await proofFor(target))).toEqual([]);
    });
    it.each([true,false])("confirmed membership stays private to ordinary viewers, directoryVisible=%s", async visible => {
      const target=await person('Member',visible), creator=await person('Other creator',false); await start(target);
      const id=await gameFixture(creator); await participation(id,target); await participation(id,viewer);
      expect(await gamesFor(await proofFor(target))).toEqual([]);
    });
    it("directory opt-out, feature and directory restriction remove only the creator shortcut", async () => {
      const target = await person('Creator'); await start(target); const id = await gameFixture(target);
      expect((await gamesFor(await proofFor(target))).map(row => row.id)).toEqual([id]);
      await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1", [target.id]);
      expect(await gamesFor(await proofFor(target))).toEqual([]);
      await pool.query("UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1", [target.id]);
      env.SOCIAL_DIRECTORY_ENABLED = false;
      try { expect(await gamesFor(await proofFor(target))).toEqual([]); } finally { env.SOCIAL_DIRECTORY_ENABLED = true; }
      const principal = (await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [viewer.id])).rows[0].id;
      await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,'social.directory','synthetic_fixture',clock_timestamp()+interval '1 hour',$2)", [target.id,principal]);
      expect(await gamesFor(await proofFor(target))).toEqual([]);
    });
    it.each(['withdraw','revoke','cancel','hide','takedown'])("fresh relationship/eligibility after Game lock wait: %s", async change => {
      const target = await person('Radar only',false), creator = await person('Creator',false); await start(target);
      const id = await gameFixture(creator); await participation(id,target); await manager(id);
      const proof = await proofFor(target), lock = await pool.connect();
      try {
        await lock.query('BEGIN'); await lock.query('SELECT id FROM games WHERE id=$1 FOR UPDATE',[id]);
        const pid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending = preview(proof);
        // Observe an actual blocked reader, rather than infer a race from a sleep.
        let waiting = false;
        for (let n=0;n<100;n++) {
          waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) waiting",[pid])).rows[0].waiting;
          if (waiting) break; await new Promise(resolve => setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);
        if (change==='withdraw') await lock.query("UPDATE participations SET status='withdrawn' WHERE game_id=$1 AND user_id=$2",[id,target.id]);
        if (change==='revoke') await lock.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[id,viewer.id]);
        if (change==='cancel') await lock.query("UPDATE games SET status='cancelled' WHERE id=$1",[id]);
        if (change==='hide' || change==='takedown') await lock.query("INSERT INTO game_moderation_state(game_id,state) VALUES($1,$2)",[id,change==='hide'?'hidden':'taken_down']);
        await lock.query('COMMIT'); const response=await pending;
        expect(response.statusCode,response.body).toBe(200); expect(response.json<UnifiedPreview>().upcomingGames).toEqual([]);
      } finally { await lock.query('ROLLBACK'); lock.release(); }
    });
    it("final revision retires directory identity changed during a Game wait", async () => {
      const target=await person('Creator'); await start(target); const id=await gameFixture(target);
      const proof=await proofFor(target), lock=await pool.connect();
      try {
        await lock.query('BEGIN'); await lock.query('SELECT id FROM games WHERE id=$1 FOR UPDATE',[id]);
        const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending=preview(proof); let waiting=false;
        for(let n=0;n<100;n++) { waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) waiting",[pid])).rows[0].waiting; if(waiting)break; await new Promise(resolve=>setTimeout(resolve,10)); }
        expect(waiting).toBe(true);
        await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[target.id]);
        await lock.query('COMMIT'); const response=await pending;
        expect(response.statusCode,response.body).toBe(404); expect(response.json()).not.toHaveProperty('upcomingGames');
      } finally { await lock.query('ROLLBACK'); lock.release(); }
    });
    it("proof TTL expiring across a Game wait fails closed at final wall clock", async () => {
      const target=await person('Creator'); await start(target); const id=await gameFixture(target);
      const original=await proofFor(target), opened=openUnified(env,'result',original,proofSchema)!;
      const proof=sealUnified(env,'result',{...opened,expiresAt:Date.now()+500});
      const lock=await pool.connect();
      try {
        await lock.query('BEGIN'); await lock.query('SELECT id FROM games WHERE id=$1 FOR UPDATE',[id]);
        const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending=preview(proof); let waiting=false;
        for(let n=0;n<100;n++) { waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) waiting",[pid])).rows[0].waiting; if(waiting)break; await new Promise(resolve=>setTimeout(resolve,5)); }
        expect(waiting).toBe(true); await new Promise(resolve=>setTimeout(resolve,550));
        await lock.query('COMMIT'); const response=await pending;
        expect(response.statusCode,response.body).toBe(404); expect(response.json()).not.toHaveProperty('upcomingGames');
      } finally { await lock.query('ROLLBACK'); lock.release(); }
    });
    it("opt-out committed during the existing pair wait cannot release a schedule", async () => {
      const target=await person('Creator'); await start(target); await gameFixture(target); const proof=await proofFor(target);
      const pairs=app.get((await import('../../src/safety/pair-fence.service')).PairFenceService),lock=await pool.connect();
      try {
        await lock.query('BEGIN'); await pairs.lockOrCreate(lock,viewer.id,target.id);
        const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending=preview(proof); let waiting=false;
        for(let n=0;n<100;n++) { waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) waiting",[pid])).rows[0].waiting; if(waiting)break; await new Promise(resolve=>setTimeout(resolve,10)); }
        expect(waiting).toBe(true);
        await optOut(target);
        await lock.query('COMMIT'); const response=await pending;
        expect(response.statusCode,response.body).toBe(404); expect(response.json()).not.toHaveProperty('upcomingGames');
      } finally { await lock.query('ROLLBACK'); lock.release(); }
    });
    it("missing/forged/expired/cross-viewer/cross-session/namespace proofs never return games", async () => {
      const target=await person('Creator'); await start(target); await gameFixture(target);
      const proof=await proofFor(target), opened=openUnified(env,'result',proof,proofSchema)!;
      const second={...viewer,issued:await sessions.createConsumerSession(viewer.id)}, other=await person('Other viewer',false);
      for(const [token,actor] of [[undefined,viewer],['u1.forged',viewer],[proof,second],[proof,other],
        [sealUnified(env,'result',{...opened,expiresAt:Date.now()-1}),viewer],
        [sealUnified(env,'result',{...opened,context:{...opened.context,mode:'synthetic_demo'}}),viewer]] as const) {
        const response=await app.inject({method:'POST',url:'/v1/radar/results/preview',headers:headers(actor),payload:token?{resultRef:token}:{}});
        expect(response.statusCode,response.body).toBe(404); expect(response.json()).not.toHaveProperty('upcomingGames');
      }
    });
    it.each(['opt-out','block','restriction','owner-session','ttl'])("retires games with the existing target proof fence: %s", async change => {
      const target=await person('Creator'); await start(target); await gameFixture(target); const proof=await proofFor(target);
      if(change==='opt-out') await optOut(target);
      if(change==='block') await app.get(SafetyService).block(target.id,target.issued.session.id,randomUUID(),viewer.publicId);
      if(change==='restriction') {
        const principal=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[viewer.id])).rows[0].id;
        await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,'profile.public','synthetic_fixture',clock_timestamp()+interval '1 hour',$2)",[target.id,principal]);
      }
      if(change==='owner-session') await sessions.revokeSession(target.issued.session.id);
      if(change==='ttl') await pool.query("UPDATE radar_presences SET foreground_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",[target.id]);
      const response=await preview(proof); expect(response.statusCode,response.body).toBe(404); expect(response.json()).not.toHaveProperty('upcomingGames');
    });
  });
  it("P4 restrictions preserve directory/Radar separation and deny fresh publication and old proofs", async () => {
    const publisher=await person("P4 publisher",true);await start(publisher);
    const initialPage=await query();const proof=initialPage.items.find(x=>x.publicPlayerId===publisher.publicId)!.radar!.resultRef;
    const principal=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[viewer.id])).rows[0].id;
    const restrict=async(capability:string)=>{const row=(await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,$2,'synthetic_fixture',clock_timestamp()+interval '1 hour',$3) RETURNING id",[publisher.id,capability,principal])).rows[0];await pool.query("UPDATE users SET updated_at=clock_timestamp() WHERE id=$1",[publisher.id]);return row.id;};
    await restrict('social.directory');await clearBudget();const radarOnly=await query();expect(radarOnly.items.find(x=>x.publicPlayerId===publisher.publicId)?.radar).not.toBeNull();
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
        expect(r.foreground_until.getTime()-r.started_at.getTime()).toBeCloseTo(90000,-2);
        expect(r.location_valid_until.getTime()-r.started_at.getTime()).toBeCloseTo(360000,-2);
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
      const refreshed = await service.query(viewer.id,viewer.issued.session.id,initial(), false);
      expect(refreshed.items.filter(r=>r.player.displayName.startsWith("TEST"))).toHaveLength(6);
      expect(refreshed.items.find(r=>r.publicPlayerId===peers[0]!.publicPlayerId)!.radar!.resultRef).not.toBe(peers[0]!.radar!.resultRef);
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
