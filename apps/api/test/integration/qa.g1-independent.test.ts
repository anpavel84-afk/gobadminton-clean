// Historical independent assertions from QA commit337bdc5b, rerun here as author regression.
// These checks do not constitute independent QA of the current-main candidate.
import { GamesModule } from "../../src/games/games.module";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import cookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Writable } from "node:stream";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
import { RadarModule } from "../../src/radar/radar.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { SafetyModule } from "../../src/safety/safety.module";
import type { RadarService } from "../../src/radar/radar.service";
import { RadarProofService } from "../../src/radar/radar-proof.service";
import { GeographicRadarService } from "../../src/radar/geographic.service";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { DEMO_SPB_CITY_ID } from "../../src/database/demo-ids";
import {
  GEO_POLICY,
  GEO_DISCLOSURE_ID,
  geographicPepper,
  signGeographicToken,
} from "../../src/radar/geographic-contract";


type Snapshot = Awaited<ReturnType<GeographicRadarService["query"]>>;
type Person = { id: string; publicId: string; issued: IssuedSession };
const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const fix = () => ({
  latitude: 55.7558,
  longitude: 37.6173,
  accuracyMeters: 40,
  capturedAt: new Date().toISOString(),
});

dbDescribe("G1 current-main author regression / historical QA assertions", () => {
  const httpLogs: string[] = [];
  let pool: Pool;
  let app: NestFastifyApplication;
  let env: AppEnv;
  let sessions: SessionService;
  let proofs: RadarProofService;
  let pairs: PairFenceService;
  let fence: ActorFenceService;
  let a: Person;
  let b: Person;
  beforeAll(async () => {
    env = loadEnv({
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "local",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:3001",
      COOKIE_SECURE: "false",
      SOCIAL_DIRECTORY_ENABLED: "1",
      SOCIAL_DM_ENABLED: "1",
      SOCIAL_INVITATIONS_ENABLED: "1",
      SOCIAL_RADAR_ENABLED: "1",
      SOCIAL_RADAR_DEMO_ENABLED: "1",
      SOCIAL_RADAR_GEOGRAPHIC_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "fake",
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const module = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AuthModule,
        ProfilesModule,
        SafetyModule,
        RadarModule,
        MessagingModule,
        GamesModule,
        InvitationsModule,
        ParticipationsModule,
        VenuesModule,
        OrganizersModule,
        TrainersModule,
      ],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter({ logger: { stream: new Writable({ write(chunk, _encoding, callback) { httpLogs.push(chunk.toString()); callback(); } }) } }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionService);
    proofs = app.get(RadarProofService);
    pairs = app.get(PairFenceService);
    fence = app.get(ActorFenceService);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });
  async function person(
    id: string = randomUUID(),
    profile = true,
  ): Promise<Person> {
    await pool.query(
      "INSERT INTO users(id,display_name) VALUES($1,'Fictional G1 fixture')",
      [id],
    );
    const publicId = randomUUID();
    if (profile)
      await pool.query(
        `INSERT INTO player_social_profiles(user_id,public_player_id,display_name,city_id,directory_visible,contact_policy,consent_policy_version,opted_in_at)
      VALUES($1,$2,'Fictional G1 fixture',$3,true,'requests','social-directory-v1',clock_timestamp())`,
        [id, publicId, MOSCOW_CITY_ID],
      );
    return { id, publicId, issued: await sessions.createConsumerSession(id) };
  }
  beforeEach(async () => {
    httpLogs.length = 0;
    await pool.query("DELETE FROM radar_presences");
    await pool.query("DELETE FROM radar_rate_budgets");
    a = await person();
    b = await person();
  });
  const headers = (p: Person) => ({
    cookie: `${SESSION_COOKIE}=${p.issued.sessionToken}`,
    origin: env.PUBLIC_WEB_ORIGIN,
    "x-csrf-token": p.issued.csrfToken,
    "idempotency-key": randomUUID(),
  });
  const cityQuery = {
    cityId: MOSCOW_CITY_ID,
    scope: "city",
    origin: { kind: "none" },
  };
  async function requestQuery(p = a, input: unknown = cityQuery) {
    return app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: headers(p),
      payload: input as Record<string, unknown>,
    });
  }
  async function query(p = a, input: unknown = cityQuery): Promise<Snapshot> {
    const r = await requestQuery(p, input);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Snapshot;
  }
  async function start(p = b, location = fix()) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: headers(p),
      payload: {
        location,
        consentPolicyVersion: GEO_POLICY,
        consent: { disclosureId: GEO_DISCLOSURE_ID, accepted: true },
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as Awaited<ReturnType<RadarService["start"]>>["body"];
  }
  async function clearQueryBudget(p = a) {
    await pool.query(
      "DELETE FROM radar_rate_budgets WHERE user_id=$1 AND bucket IN ('nearby_hour','nearby_interval')",
      [p.id],
    );
  }
  async function preview(ref: string, p = a) {
    return app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: headers(p),
      payload: { resultRef: ref },
    });
  }
  async function contact(p: Person, target: Person, proof?: string) {
    return app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: headers(p),
      payload: {
        targetPublicPlayerId: target.publicId,
        text: "Synthetic request",
        clientMessageId: randomUUID(),
        ...(proof === undefined ? {} : { discoveryProof: proof }),
      },
    });
  }
  async function heldProof(p: Person, ref: string, target: Person) {
    const c = await pool.connect();
    await c.query("BEGIN");
    await fence.assertActiveConsumerInTransaction(c, {
      actorId: p.id,
      sessionId: p.issued.session.id,
    });
    await pairs.lockOrCreate(c, p.id, target.id);
    await proofs.redeem(c, {
      actorId: p.id,
      sessionId: p.issued.session.id,
      proof: ref,
      expectedTargetUserId: target.id,
    });
    return c;
  }
  async function waitForBlocked() {
    // Observe an actual lock waiter on the dedicated test database, not timing alone.
    for (let n = 0; n < 80; n++) {
      const r = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()",
      );
      if (r.rows.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("expected visibility lock waiter");
  }
  async function release(c: PoolClient) {
    await c.query("COMMIT");
    c.release();
  }

  it("QA GEO-01/02/05: two profileless OFF viewers see the same public coarse anchor with no consent", async () => {
    await start();
    const x = await person(randomUUID(), false);
    const y = await person(randomUUID(), false);
    const qx = await query(x); const qy = await query(y);
    expect(qx.items).toHaveLength(1); expect(qy.items).toHaveLength(1);
    expect(qx.items[0]!.displayLocation).toEqual(qy.items[0]!.displayLocation);
    await clearQueryBudget(x);
    expect((await query(x)).items[0]!.displayLocation).toEqual(qx.items[0]!.displayLocation);
    expect((await preview(qx.items[0]!.resultRef, y)).statusCode).toBe(404);
    expect((await preview(qx.items[0]!.resultRef, x)).statusCode).toBe(200);
    expect((await contact(x, b, qx.items[0]!.resultRef)).statusCode).toBe(404);
    const r=await pool.query("SELECT count(*)::int n FROM radar_consent_events WHERE user_id=ANY($1::uuid[])", [[x.id,y.id]]);
    expect(r.rows[0].n).toBe(0);
  });
  it("QA GEO-18/20: independently signed wrong account/city/region/policy/namespace/public ID proofs all fail with no contact side effect", async () => {
    await start(); const ref=(await query()).items[0]!.resultRef;
    const payload=JSON.parse(Buffer.from(ref.split(".")[0]!, "base64url").toString());
    for(const delta of [
      {viewerUserId: randomUUID()}, {cityId: DEMO_SPB_CITY_ID}, {regionId:"saint-petersburg-demo"},
      {policyVersion:"radar-mvp-v1"}, {exposureMode:"synthetic_demo"}, {targetPublicPlayerId:randomUUID()},
      {targetActivationId:randomUUID()}, {targetUserId:randomUUID()}, {origin:{kind:"none"}},
    ]) {
      const bad=signGeographicToken(geographicPepper(env), "result", {...payload,...delta});
      expect((await preview(bad)).statusCode).toBe(404);
      expect((await contact(a,b,bad)).statusCode).toBe(404);
    }
    expect((await pool.query("SELECT count(*)::int n FROM conversations WHERE initiator_user_id=$1",[a.id])).rows[0].n).toBe(0);
    expect((await preview(ref)).statusCode).toBe(200);
  });
  it("QA GEO-21: avatarless account retirement waits on visibility fence then removes target and prevents real HTTP contact", async () => {
    await start(); const ref=(await query()).items[0]!.resultRef;
    const gate=await heldProof(a,ref,b);
    const retire=pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[b.id]);
    await waitForBlocked(); await release(gate); await retire;
    expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1",[b.id])).rows).toHaveLength(0);
    expect((await preview(ref)).statusCode).toBe(404);
    expect((await contact(a,b,ref)).statusCode).toBe(404);
    await clearQueryBudget(); expect((await query()).items).toHaveLength(0);
  });
  it("QA GEO-21: real HTTP contact linearizes before concurrent STOP, session revoke, and consent withdrawal", async () => {
    for (const op of ["stop", "revoke", "withdraw"]) {
      await pool.query("DELETE FROM radar_presences");
      a = await person(); b = await person();
      const active = await start(); const ref = (await query()).items[0]!.resultRef;
      let signal!: () => void; let unlock!: () => void;
      const reached = new Promise<void>((resolve) => { signal = resolve; });
      const gate = new Promise<void>((resolve) => { unlock = resolve; });
      const original = proofs.redeem.bind(proofs);
      const spy = vi.spyOn(proofs, "redeem").mockImplementationOnce(async (client, input) => {
        const result = await original(client, input); signal(); await gate; return result;
      });
      const pending = contact(a, b, ref);
      await reached;
      let revoke: Promise<unknown>;
      if (op === "stop") revoke = Promise.resolve(app.inject({method:"DELETE",url:"/v1/me/radar/activations/current",headers:{...headers(b),"x-radar-activation-id":active.activationId}}));
      else if (op === "revoke") revoke = sessions.revokeSession(b.issued.session.id);
      else {
        const version=(await pool.query("SELECT version FROM player_social_profiles WHERE user_id=$1",[b.id])).rows[0].version;
        revoke=Promise.resolve(app.inject({method:"PATCH",url:"/v1/me/social-profile",headers:headers(b),payload:{expectedVersion:version,radarConsented:false}}));
      }
      try { await waitForBlocked(); } finally { unlock(); }
      const committed = await pending; await revoke; spy.mockRestore();
      expect(committed.statusCode, committed.body).toBe(201);
      expect((await preview(ref)).statusCode).toBe(404);
      expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1",[b.id])).rows).toHaveLength(0);
      expect((await pool.query("SELECT count(*)::int n FROM conversations WHERE initiator_user_id=$1 AND recipient_user_id=$2",[a.id,b.id])).rows[0].n).toBe(1);
    }
  });
  it("QA GEO-25: candidate Fastify request logging omits valid and rejected GPS bodies and proof tokens", async () => {
    await start();
    const q = await query(a, {...cityQuery, origin:{kind:"foreground_fix", location:fix()}});
    await preview(q.items[0]!.resultRef);
    await clearQueryBudget();
    expect((await requestQuery(a,{...cityQuery,origin:{kind:"foreground_fix",location:{...fix(),latitude:0}}})).statusCode).toBe(422);
    await new Promise((resolve)=>setImmediate(resolve));
    const logs=httpLogs.join("");
    expect(logs).toContain("/v1/radar/results/query");
    expect(logs).not.toMatch(/55\.7558|37\.6173|latitude|longitude|accuracyMeters|capturedAt|resultRef|originRef/);
    expect(logs).not.toContain(q.items[0]!.resultRef);
    expect(logs).not.toContain(q.query.originRef!);
  });
});
