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
import { RadarService } from "../../src/radar/radar.service";
import { RadarProofService } from "../../src/radar/radar-proof.service";
import { GeographicRadarService } from "../../src/radar/geographic.service";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { DEMO_SPB_CITY_ID, demoUserId } from "../../src/database/demo-ids";
import {
  GEO_POLICY,
  GEO_DISCLOSURE_ID,
  GEO_DISCLOSURE_HASH,
  GEO_DISCLOSURE_TEXT,
  geographicPepper,
  signGeographicToken,
} from "../../src/radar/geographic-contract";
import {
  resetRadarPresenceBeforeServingTraffic,
  sqlExecutorFromPg,
} from "../../src/radar/radar-recovery";

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

dbDescribe("G1 geographic Radar / real disposable PostGIS", () => {
  let pool: Pool;
  let app: NestFastifyApplication;
  let env: AppEnv;
  let sessions: SessionService;
  let radar: RadarService;
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
    app = module.createNestApplication(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionService);
    radar = app.get(RadarService);
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

  it("config is authenticated, no-store, exact disclosure hash; OFF viewer creates no profile/presence/receipt", async () => {
    const p = await person(randomUUID(), false);
    const guest = await app.inject({ method: "GET", url: "/v1/radar/config" });
    expect(guest.statusCode).toBe(401);
    const r = await app.inject({
      method: "GET",
      url: "/v1/radar/config",
      headers: headers(p),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json().disclosure).toEqual({
      id: GEO_DISCLOSURE_ID,
      locale: "ru",
      sha256: GEO_DISCLOSURE_HASH,
      text: GEO_DISCLOSURE_TEXT,
    });
    const q = await query(p);
    expect(q.items).toHaveLength(0);
    expect(q.query.ordering).toBe("stable_city_sample");
    const counts = await pool.query(
      `SELECT (SELECT count(*)::int FROM player_social_profiles WHERE user_id=$1) AS profiles,
      (SELECT count(*)::int FROM radar_presences WHERE user_id=$1) AS presences,(SELECT count(*)::int FROM radar_consent_events WHERE user_id=$1) AS receipts`,
      [p.id],
    );
    expect(counts.rows[0]).toEqual({ profiles: 0, presences: 0, receipts: 0 });
  });
  it("one target visible with K=1 to OFF viewer, exact derived 1km WGS84 center; no random/raw fields", async () => {
    await start();
    const q = await query();
    expect(q.items).toHaveLength(1);
    expect(q.query.originRef).toBeNull();
    expect(q.items[0]!.proximityBand).toBeNull();
    expect(q.map.availability).toBe("missing");
    expect(q.items[0]!.displayLocation).toEqual({
      model: "regional_grid_center_v1",
      latitude: 55.75345,
      longitude: 37.62178,
      gridSizeMeters: 1000,
    });
    const stored = await pool.query(
      "SELECT round(ST_Y(coarse_center::geometry)::numeric,5)::float8 AS lat,round(ST_X(coarse_center::geometry)::numeric,5)::float8 AS lon FROM radar_presences WHERE user_id=$1",
      [b.id],
    );
    expect(q.items[0]!.displayLocation.latitude).toBe(stored.rows[0].lat);
    expect(q.items[0]!.displayLocation.longitude).toBe(stored.rows[0].lon);
    expect(JSON.stringify(q)).not.toMatch(
      /displaySlot|accuracyMeters|capturedAt|cell_i|owner_session_id|dist_m/,
    );
    expect((await preview(q.items[0]!.resultRef)).statusCode).toBe(200);
  });
  it("strict city/scope/origin unions, no strings/bbox/filters/arbitrary radius; guest and CSRF fail", async () => {
    for (const input of [
      { ...cityQuery, bbox: [] },
      { ...cityQuery, targetUserId: b.id },
      { ...cityQuery, radiusBucketKm: 5 },
      { ...cityQuery, scope: "nearby" },
      {
        ...cityQuery,
        scope: "nearby",
        radiusBucketKm: 7,
        origin: { kind: "foreground_fix", location: fix() },
      },
      {
        ...cityQuery,
        origin: {
          kind: "foreground_fix",
          location: { ...fix(), latitude: "55.7" },
        },
      },
      { ...cityQuery, origin: { kind: "none", latitude: 55.7 } },
      { ...cityQuery, cityId: randomUUID() },
    ]) {
      expect((await requestQuery(a, input)).statusCode).toBe(422);
    }
    const guest = await app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: { origin: env.PUBLIC_WEB_ORIGIN, "x-csrf-token": "test" },
      payload: cityQuery,
    });
    expect(guest.statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: { cookie: headers(a).cookie, origin: env.PUBLIC_WEB_ORIGIN },
      payload: cityQuery,
    });
    expect(noCsrf.statusCode).toBe(403);
    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: { ...headers(a), origin: "https://wrong.test" },
      payload: cityQuery,
    });
    expect(wrongOrigin.statusCode).toBe(403);
  });
  it("private origin reference is account/session/city fenced, expiry never extended, no publisher side effects", async () => {
    await start();
    const input = {
      cityId: MOSCOW_CITY_ID,
      scope: "nearby",
      radiusBucketKm: 5,
      origin: { kind: "foreground_fix", location: fix() },
    };
    const q = await query(a, input);
    expect(q.items).toHaveLength(1);
    expect(q.query.ordering).toBe("coarse_distance");
    expect(q.items[0]!.proximityBand).toBe("near");
    const origin = JSON.parse(
      Buffer.from(q.query.originRef!.split(".")[0]!, "base64url").toString(),
    );
    expect(origin.expiresAt).toBeLessThanOrEqual(
      Date.parse(input.origin.location.capturedAt) + 360_000,
    );
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          a.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM radar_consent_events WHERE user_id=$1",
          [a.id],
        )
      ).rows,
    ).toHaveLength(0);
    await clearQueryBudget();
    const reused = await query(a, {
      ...input,
      origin: { kind: "reference", originRef: q.query.originRef },
    });
    expect(reused.query.originRef).toBe(q.query.originRef);
    await clearQueryBudget();
    const expired = signGeographicToken(geographicPepper(env), "origin", {
      ...origin,
      expiresAt: Date.now() - 1,
    });
    const expiredResult = await requestQuery(a, {
      ...input,
      origin: { kind: "reference", originRef: expired },
    });
    expect(expiredResult.statusCode).toBe(422);
    expect(expiredResult.json().code).toBe("RADAR_QUERY_ORIGIN_EXPIRED");
    expect(
      (
        await requestQuery(b, {
          ...input,
          origin: { kind: "reference", originRef: q.query.originRef },
        })
      ).statusCode,
    ).toBe(422);
    const otherSession = await sessions.createConsumerSession(a.id);
    const other = { ...a, issued: otherSession };
    await clearQueryBudget();
    expect(
      (
        await requestQuery(other, {
          ...input,
          origin: { kind: "reference", originRef: q.query.originRef },
        })
      ).statusCode,
    ).toBe(422);
  });
  it("bad/stale/inaccurate/outside-city fixes fail without accepting consent", async () => {
    for (const location of [
      { ...fix(), latitude: 0 },
      { ...fix(), accuracyMeters: 1001 },
      { ...fix(), capturedAt: new Date(Date.now() - 61_000).toISOString() },
      { ...fix(), capturedAt: new Date(Date.now() + 31_000).toISOString() },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/me/radar/activations",
        headers: headers(b),
        payload: {
          location,
          consentPolicyVersion: GEO_POLICY,
          consent: { disclosureId: GEO_DISCLOSURE_ID, accepted: true },
        },
      });
      expect(r.statusCode).toBe(422);
    }
    expect(
      (
        await pool.query(
          "SELECT 1 FROM radar_consent_events WHERE user_id=$1",
          [b.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("legacy boolean/policy cannot publish or auto-upgrade; exact new ON receipt is idempotent and reusable", async () => {
    await pool.query(
      "UPDATE player_social_profiles SET radar_consented=true,radar_consent_policy_version='radar-mvp-v1',radar_consented_at=clock_timestamp() WHERE user_id=$1",
      [b.id],
    );
    const h = headers(b);
    const location = fix();
    const old = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: h,
      payload: { location, consentPolicyVersion: "radar-mvp-v1" },
    });
    expect(old.statusCode).toBe(422);
    const absent = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: headers(b),
      payload: { location, consentPolicyVersion: GEO_POLICY },
    });
    expect(absent.statusCode).toBe(403);
    const payload = {
      location,
      consentPolicyVersion: GEO_POLICY,
      consent: { disclosureId: GEO_DISCLOSURE_ID, accepted: true },
    };
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
    expect(replay.json()).toEqual(r.json());
    expect(
      (
        await pool.query(
          "SELECT * FROM radar_consent_events WHERE user_id=$1",
          [b.id],
        )
      ).rows,
    ).toHaveLength(1);
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      r.json().activationId,
    );
    const again = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: headers(b),
      payload: { location: fix(), consentPolicyVersion: GEO_POLICY },
    });
    expect(again.statusCode).toBe(201);
    expect(
      (
        await pool.query(
          "SELECT * FROM radar_consent_events WHERE user_id=$1",
          [b.id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("withdrawal reverses exact receipt and deletes presence; generic true rejected, reacceptance required", async () => {
    await start();
    const proof = (await query()).items[0]!.resultRef;
    const version = (
      await pool.query(
        "SELECT version FROM player_social_profiles WHERE user_id=$1",
        [b.id],
      )
    ).rows[0].version;
    const withdraw = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: headers(b),
      payload: { expectedVersion: version, radarConsented: false },
    });
    expect(withdraw.statusCode, withdraw.body).toBe(200);
    const events = await pool.query(
      "SELECT event_type,reverses_event_id FROM radar_consent_events WHERE user_id=$1 ORDER BY occurred_at",
      [b.id],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual([
      "accepted",
      "withdrawn",
    ]);
    expect((await preview(proof)).statusCode).toBe(404);
    const nextVersion = withdraw.json().version;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/me/social-profile",
          headers: headers(b),
          payload: { expectedVersion: nextVersion, radarConsented: true },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/me/radar/activations",
          headers: headers(b),
          payload: { location: fix(), consentPolicyVersion: GEO_POLICY },
        })
      ).statusCode,
    ).toBe(403);
    await start();
    expect(
      (
        await pool.query(
          "SELECT 1 FROM radar_consent_events WHERE user_id=$1",
          [b.id],
        )
      ).rows,
    ).toHaveLength(3);
  });
  it("2,20,105 targets: no JS ties, deterministic cap20 and nearest ordering before LIMIT", async () => {
    await start();
    await start(a);
    const c = await person();
    await start(c, { ...fix(), longitude: 37.9 });
    let q = await query();
    expect(q.items).toHaveLength(2); // self excluded
    for (let n = 0; n < 103; n++) {
      const p = await person();
      await start(p, { ...fix(), longitude: 37.62 + (n % 7) * 0.01 });
      if (n === 17) {
        await clearQueryBudget();
        expect((await query()).items).toHaveLength(20);
      }
    }
    await clearQueryBudget();
    q = await query();
    expect(q.items).toHaveLength(20);
    const ids = q.items.map((i) => i.resultId);
    await clearQueryBudget();
    expect((await query()).items.map((i) => i.resultId)).toEqual(ids);
    await clearQueryBudget();
    const near = await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "city",
      origin: { kind: "foreground_fix", location: fix() },
    });
    const distances = [];
    for (const item of near.items) {
      const r = await pool.query(
        "SELECT ST_Distance(coarse_center,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS d FROM radar_presences r JOIN player_social_profiles p ON p.user_id=r.user_id WHERE p.public_player_id=$1",
        [
          item.player.publicPlayerId,
          JSON.parse(
            Buffer.from(
              near.query.originRef!.split(".")[0]!,
              "base64url",
            ).toString(),
          ).longitude,
          JSON.parse(
            Buffer.from(
              near.query.originRef!.split(".")[0]!,
              "base64url",
            ).toString(),
          ).latitude,
        ],
      );
      distances.push(r.rows[0].d);
    }
    expect(distances).toEqual([...distances].sort((x, y) => x - y));
    await clearQueryBudget();
    const nearby = await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "nearby",
      radiusBucketKm: 3,
      origin: { kind: "reference", originRef: near.query.originRef },
    });
    expect(nearby.items).toHaveLength(20);
    expect(nearby.items.every((i) => i.proximityBand === "near")).toBe(true);
  });
  it("v2 has no peer coordinates, wrong session/target/version/audience/expiry/type rejected uniformly; no top20 recheck", async () => {
    await start();
    const q = await query();
    const ref = q.items[0]!.resultRef;
    const payload = JSON.parse(
      Buffer.from(ref.split(".")[0]!, "base64url").toString(),
    );
    expect(payload.v).toBe(2);
    expect(payload).not.toHaveProperty("viewerActivationId");
    expect(payload).not.toHaveProperty("latitude");
    expect(payload.origin).toBeNull();
    for (const changed of [
      { ...payload, viewerSessionId: randomUUID() },
      { ...payload, targetPublicPlayerId: randomUUID() },
      { ...payload, targetVersion: 2 },
      { ...payload, audience: "old" },
      { ...payload, expiresAt: Date.now() - 1 },
      { ...payload, targetVersion: "1" },
      { ...payload, v: 1 },
      { ...payload, targetUserId: randomUUID() },
    ]) {
      const r = await preview(
        signGeographicToken(geographicPepper(env), "result", changed),
      );
      expect(r.statusCode, r.body).toBe(404);
      expect(r.json().code).toBe("RESOURCE_UNAVAILABLE");
    }
    expect((await preview(ref + "x")).statusCode).toBe(404);
    expect((await preview("")).statusCode).toBe(404);
    await pool.query(
      "DELETE FROM radar_rate_budgets WHERE user_id=$1 AND bucket='preview'",
      [a.id],
    );
    // Cohort growth cannot revoke an issued, still-safe target.
    for (let n = 0; n < 21; n++) {
      const p = await person();
      await start(p);
    }
    expect((await preview(ref)).statusCode).toBe(200);
  });
  it("invalid supplied proof fails first contact; no-proof directory request remains independent after stop", async () => {
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
    expect((await contact(a, b, ref)).statusCode).toBe(404);
    expect((await contact(a, b, "")).statusCode).toBe(404);
    expect((await contact(a, b)).statusCode).toBe(201);
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          a.id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("OFF v2 first contact works, hidden directory still cannot be contacted", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    await pool.query(
      "UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",
      [b.id],
    );
    expect((await preview(ref)).statusCode).toBe(200);
    expect((await contact(a, b, ref)).statusCode).toBe(404);
    await pool.query(
      "UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1",
      [b.id],
    );
    expect((await contact(a, b, ref)).statusCode).toBe(201);
  });
  it("STOP/account budgets/policy switch: exact old owner cannot delete takeover; heartbeat never extends fix", async () => {
    const active = await start();
    const before = await pool.query(
      "SELECT expires_at,location_valid_until FROM radar_presences WHERE user_id=$1",
      [b.id],
    );
    await radar.heartbeat(b.id, b.issued.session.id, randomUUID(), {
      activationId: active.activationId,
    });
    expect(
      (
        await pool.query(
          "SELECT expires_at,location_valid_until FROM radar_presences WHERE user_id=$1",
          [b.id],
        )
      ).rows,
    ).toEqual(before.rows);
    const other = await sessions.createConsumerSession(b.id);
    const takeover = await radar.takeover(
      b.id,
      other.session.id,
      randomUUID(),
      {
        activationId: active.activationId,
        expectedVersion: 1,
        confirm: true,
        location: fix(),
        consentPolicyVersion: GEO_POLICY,
      },
    );
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
    expect(
      (
        await pool.query(
          "SELECT activation_id FROM radar_presences WHERE user_id=$1",
          [b.id],
        )
      ).rows[0].activation_id,
    ).toBe(takeover.body.activationId);
    await query();
    expect((await requestQuery()).statusCode).toBe(429);
    env.SOCIAL_RADAR_ENABLED = false;
    try {
      expect((await radar.getStatus(b.id, other.session.id)).state).toBe(
        "active",
      );
      env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED = false;
      await radar.stop(
        b.id,
        other.session.id,
        randomUUID(),
        takeover.body.activationId,
      );
    } finally {
      env.SOCIAL_RADAR_ENABLED = true;
      env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED = true;
    }
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          b.id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("expired target/fix/lease/session excludes immediately without cleanup worker; restore never resurrects", async () => {
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    await pool.query(
      "UPDATE radar_presences SET foreground_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [b.id],
    );
    await clearQueryBudget();
    expect((await query()).items).toHaveLength(0);
    expect((await preview(ref)).statusCode).toBe(404);
    await resetRadarPresenceBeforeServingTraffic(sqlExecutorFromPg(pool));
    expect((await preview(ref)).statusCode).toBe(404);
    const replay = await radar
      .heartbeat(b.id, b.issued.session.id, randomUUID(), {
        activationId: active.activationId,
      })
      .catch((e) => e);
    expect(replay.getStatus()).toBe(409);
  });
  it("bilateral blocks/ineligibility/current directory removal have distinct visibility meaning", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    await pool.query(
      "UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",
      [b.id],
    );
    await clearQueryBudget();
    expect((await query()).items).toHaveLength(1);
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${a.publicId}`,
      headers: headers(b),
    });
    expect(block.statusCode, block.body).toBe(200);
    await clearQueryBudget();
    expect((await query()).items).toHaveLength(0);
    expect((await preview(ref)).statusCode).toBe(404);
  });
  it("live/demo namespaces separate and city region derived from presence, not profile city", async () => {
    const d = await person(
      demoUserId(Math.floor(Math.random() * 100000) + 1000),
    );
    await start(d, { ...fix(), latitude: 59.9343, longitude: 30.3351 });
    expect((await query()).items).toHaveLength(0);
    const viewer = await person(
      demoUserId(Math.floor(Math.random() * 100000) + 101000),
    );
    const spb = await query(viewer, {
      cityId: DEMO_SPB_CITY_ID,
      scope: "city",
      origin: { kind: "none" },
    });
    expect(spb.items).toHaveLength(1);
    expect(spb.regionId).toBe("spb-mvp");
    expect(
      (
        await requestQuery(a, {
          cityId: DEMO_SPB_CITY_ID,
          scope: "city",
          origin: { kind: "none" },
        })
      ).statusCode,
    ).toBe(422);
  });
  it("query/geo/preview/config budgets survive sessions and origin renewal; radius churn not reset by STOP", async () => {
    await start();
    await query();
    const other = { ...a, issued: await sessions.createConsumerSession(a.id) };
    expect((await requestQuery(other)).statusCode).toBe(429);
    await pool.query(
      "UPDATE radar_rate_budgets SET count=120,next_allowed_at=NULL WHERE user_id=$1 AND bucket='nearby_hour'",
      [a.id],
    );
    expect((await requestQuery()).statusCode).toBe(429);
    await clearQueryBudget();
    await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "nearby",
      radiusBucketKm: 5,
      origin: { kind: "foreground_fix", location: fix() },
    });
    await clearQueryBudget();
    expect(
      (
        await requestQuery(a, {
          cityId: MOSCOW_CITY_ID,
          scope: "nearby",
          radiusBucketKm: 3,
          origin: { kind: "foreground_fix", location: fix() },
        })
      ).statusCode,
    ).toBe(429);
    await pool.query("DELETE FROM radar_rate_budgets WHERE user_id=$1", [a.id]);
    await pool.query(
      "INSERT INTO radar_rate_budgets(user_id,bucket,window_started_at,count) VALUES($1,'geo_update',clock_timestamp(),12)",
      [a.id],
    );
    expect(
      (
        await requestQuery(a, {
          cityId: MOSCOW_CITY_ID,
          scope: "city",
          origin: { kind: "foreground_fix", location: fix() },
        })
      ).statusCode,
    ).toBe(429);
  });
  it("contact holding final visibility fence commits before STOP; committed STOP makes stale contact unavailable", async () => {
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    const c = await heldProof(a, ref, b);
    const stopped = radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
    await waitForBlocked();
    expect(
      (
        await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [
          b.id,
        ])
      ).rows,
    ).toHaveLength(1);
    await release(c);
    await stopped;
    expect((await preview(ref)).statusCode).toBe(404);
  });
  it("session revoke is atomic with presence deletion and waits for visibility; OFF-viewer session revoke fences own contact", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    const c = await heldProof(a, ref, b);
    const revoked = sessions.revokeSession(b.issued.session.id);
    await waitForBlocked();
    const visible = await pool.query(
      "SELECT revoked_at FROM app_sessions WHERE id=$1",
      [b.issued.session.id],
    );
    expect(visible.rows[0].revoked_at).toBeNull();
    await release(c);
    await revoked;
    expect((await preview(ref)).statusCode).toBe(404);
    const viewerFence = await pool.connect();
    await viewerFence.query("BEGIN");
    await fence.assertActiveConsumerInTransaction(viewerFence, {
      actorId: a.id,
      sessionId: a.issued.session.id,
    });
    const offRevoke = sessions.revokeSession(a.issued.session.id);
    await waitForBlocked();
    await release(viewerFence);
    await offRevoke;
    expect((await preview(ref)).statusCode).toBe(401);
  });
  it("withdrawal blocks on final visibility and commits receipt/profile/presence together", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    const c = await heldProof(a, ref, b);
    const version = (
      await pool.query(
        "SELECT version FROM player_social_profiles WHERE user_id=$1",
        [b.id],
      )
    ).rows[0].version;
    const withdrawn = app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: headers(b),
      payload: { expectedVersion: version, radarConsented: false },
    });
    // LightMyRequest starts when awaited/then consumed.
    const running = Promise.resolve(withdrawn);
    await waitForBlocked();
    expect(
      (
        await pool.query(
          "SELECT radar_consented FROM player_social_profiles WHERE user_id=$1",
          [b.id],
        )
      ).rows[0].radar_consented,
    ).toBe(true);
    await release(c);
    expect((await running).statusCode).toBe(200);
    expect((await preview(ref)).statusCode).toBe(404);
  });
  it("proof expiry after lock wait uses server wall clock; no stale contact grant", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    const payload = JSON.parse(
      Buffer.from(ref.split(".")[0]!, "base64url").toString(),
    );
    const short = signGeographicToken(geographicPepper(env), "result", {
      ...payload,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 180,
    });
    const c = await pool.connect();
    await c.query("BEGIN");
    await c.query(
      "SELECT user_id FROM radar_presences WHERE user_id=$1 FOR UPDATE",
      [b.id],
    );
    const running = Promise.resolve(preview(short));
    await waitForBlocked();
    await new Promise((resolve) => setTimeout(resolve, 220));
    await release(c);
    expect((await running).statusCode).toBe(404);
  });
  it("opposed A→B/B→A first contacts complete on one Pair fence without reciprocal identity/FK deadlock", async () => {
    await start(a);
    await start(b);
    const qa = await query(a);
    const qb = await query(b);
    const refs = [
      qa.items.find((i) => i.player.publicPlayerId === b.publicId)!.resultRef,
      qb.items.find((i) => i.player.publicPlayerId === a.publicId)!.resultRef,
    ];
    const results = await Promise.all([
      contact(a, b, refs[0]),
      contact(b, a, refs[1]),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM conversations WHERE (initiator_user_id=$1 AND recipient_user_id=$2) OR (initiator_user_id=$2 AND recipient_user_id=$1)",
      [a.id, b.id],
    );
    expect(count.rows[0].n).toBe(1);
  });
  it("no location in durable evidence/idempotency/outbox; token epoch rotation invalidates independent origins", async () => {
    await start();
    const q = await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "city",
      origin: { kind: "foreground_fix", location: fix() },
    });
    const rows = await pool.query(
      "SELECT to_jsonb(e) AS body FROM radar_consent_events e WHERE user_id=$1",
      [b.id],
    );
    expect(JSON.stringify(rows.rows)).not.toMatch(
      /latitude|longitude|city_id|cell_|accuracy|resultRef|originRef/,
    );
    const columns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='idempotency_records'",
    );
    expect(columns.rows.length).toBeGreaterThan(0);
    const receipt = await pool.query(
      "SELECT to_jsonb(r) AS body FROM idempotency_records r WHERE actor_id=$1",
      [b.id],
    );
    expect(JSON.stringify(receipt.rows)).not.toMatch(
      /latitude|longitude|coarse_center|accuracyMeters|capturedAt/,
    );
    env.RADAR_GEOGRAPHIC_TOKEN_EPOCH = "test-restore-rotation";
    try {
      await clearQueryBudget();
      expect(
        (
          await requestQuery(a, {
            cityId: MOSCOW_CITY_ID,
            scope: "city",
            origin: { kind: "reference", originRef: q.query.originRef },
          })
        ).statusCode,
      ).toBe(422);
      expect((await preview(q.items[0]!.resultRef)).statusCode).toBe(404);
    } finally {
      env.RADAR_GEOGRAPHIC_TOKEN_EPOCH = "source-stage-v1";
    }
  });
  async function publishedGame() {
    const suffix = randomUUID();
    const venue = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: headers(a),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `Fictional G1 court ${suffix}`,
        address: `Test ${suffix}`,
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = new Date(Date.now() + 7 * 86400_000),
      ends = new Date(starts.getTime() + 7200_000),
      deadline = new Date(starts.getTime() - 86400_000);
    const created = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(a),
      payload: {
        hostDisplayName: "Fictional G1 host",
        hostPublicContact: "telegram:@fictional_g1",
        venueId: venue.json().id,
        title: "Fictional G1 game",
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: 4,
        externalReservedCount: 0,
        visibility: "public",
        formatKey: "doubles",
        activityKind: "regular",
        levelRule: {
          scaleId: "ntrp",
          scaleVersion: 1,
          allowedLevelIds: ["3.0", "3.5"],
        },
        settlement: {
          mode: "external",
          purpose: "no_trainer_fee",
          priceMinor: null,
          currency: null,
          terms: "Fictional external conditions",
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const publish = await app.inject({
      method: "POST",
      url: `/v1/games/${created.json().id}/publish`,
      headers: headers(a),
      payload: { expectedVersion: created.json().version },
    });
    expect(publish.statusCode, publish.body).toBe(200);
    return publish.json() as { id: string; version: number };
  }
  it("v2 OFF-viewer invitation preserves manager/capacity rights and survives subsequent Radar STOP", async () => {
    const game = await publishedGame();
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    const create = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: headers(a),
      payload: {
        inviteePublicPlayerId: b.publicId,
        expectedGameVersion: game.version,
        discoveryProof: ref,
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
    expect(
      (
        await pool.query("SELECT status FROM game_invitations WHERE id=$1", [
          create.json().id,
        ])
      ).rows[0].status,
    ).toBe("pending");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM participations WHERE game_id=$1",
          [game.id],
        )
      ).rows[0].n,
    ).toBe(1); // Only the initial creator; pending invitation takes no seat.
    const denied = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: headers(b),
      payload: {
        inviteePublicPlayerId: a.publicId,
        expectedGameVersion: game.version,
      },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });
  it("invitation cannot commit stale proof after STOP or cancelled Game; no capacity or invitation side effects", async () => {
    const game = await publishedGame();
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
    const denied = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: headers(a),
      payload: {
        inviteePublicPlayerId: b.publicId,
        expectedGameVersion: game.version,
        discoveryProof: ref,
      },
    });
    expect(denied.statusCode).toBe(404);
    await start();
    await clearQueryBudget();
    const fresh = (await query()).items[0]!.resultRef;
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM games WHERE id=$1 FOR UPDATE", [
      game.id,
    ]);
    const invitation = Promise.resolve(
      app.inject({
        method: "POST",
        url: `/v1/games/${game.id}/invitations`,
        headers: headers(a),
        payload: {
          inviteePublicPlayerId: b.publicId,
          expectedGameVersion: game.version,
          discoveryProof: fresh,
        },
      }),
    );
    await waitForBlocked();
    await blocker.query(
      "UPDATE games SET status='cancelled',version=version+1 WHERE id=$1",
      [game.id],
    );
    await release(blocker);
    expect((await invitation).statusCode).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM game_invitations WHERE game_id=$1",
          [game.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("block holding Pair fence commits first and prevents geographic first contact", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    const pair = await pairs.lockOrCreate(blocker, a.id, b.id);
    const pending = Promise.resolve(contact(a, b, ref));
    await waitForBlocked();
    await blocker.query(
      "INSERT INTO user_blocks(pair_id,blocker_user_id,blocked_user_id) VALUES($1,$2,$3)",
      [pair.id, b.id, a.id],
    );
    await release(blocker);
    expect((await pending).statusCode).toBe(404);
  });
  it("revoke-other-sessions and revoke-owned-session are atomic with their owned geographic generation", async () => {
    const other = await sessions.createConsumerSession(b.id);
    await start({ ...b, issued: other });
    const ref = (await query()).items[0]!.resultRef;
    const c = await heldProof(a, ref, b);
    const revoking = sessions.revokeOtherSessions({
      userId: b.id,
      currentSessionId: b.issued.session.id,
    });
    await waitForBlocked();
    expect(
      (
        await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1", [
          other.session.id,
        ])
      ).rows[0].revoked_at,
    ).toBeNull();
    await release(c);
    expect((await revoking).revokedCount).toBe(1);
    expect((await preview(ref)).statusCode).toBe(404);
    const another = await sessions.createConsumerSession(b.id);
    await start({ ...b, issued: another });
    await clearQueryBudget();
    const next = (await query()).items[0]!.resultRef;
    await sessions.revokeOwnedSession({
      userId: b.id,
      sessionId: another.session.id,
      currentSessionId: b.issued.session.id,
    });
    expect((await preview(next)).statusCode).toBe(404);
  });
  it("status cleanup cannot delete a concurrently refreshed expired foreground lease", async () => {
    const active = await start();
    await pool.query(
      "UPDATE radar_presences SET foreground_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [b.id],
    );
    const c = await pool.connect();
    await c.query("BEGIN");
    await c.query(
      "SELECT user_id FROM radar_presences WHERE user_id=$1 FOR UPDATE",
      [b.id],
    );
    const read = radar.getStatus(b.id, b.issued.session.id);
    await waitForBlocked();
    await c.query(
      "UPDATE radar_presences SET foreground_until=clock_timestamp()+interval '90 seconds' WHERE user_id=$1",
      [b.id],
    );
    await release(c);
    await read;
    expect(
      (
        await pool.query(
          "SELECT activation_id FROM radar_presences WHERE user_id=$1",
          [b.id],
        )
      ).rows[0].activation_id,
    ).toBe(active.activationId);
  });
  it("active-origin references are owning-session/generation fenced; fixes do not extend on heartbeat/renew", async () => {
    const active = await start(a);
    await start();
    const q = await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "nearby",
      radiusBucketKm: 5,
      origin: { kind: "current_activation", activationId: active.activationId },
    });
    const oldFix = (
      await pool.query(
        "SELECT location_valid_until FROM radar_presences WHERE user_id=$1",
        [a.id],
      )
    ).rows[0].location_valid_until;
    await radar.renew(a.id, a.issued.session.id, randomUUID(), {
      activationId: active.activationId,
      expectedVersion: active.version,
      extendMinutes: 15,
    });
    expect(
      (
        await pool.query(
          "SELECT location_valid_until FROM radar_presences WHERE user_id=$1",
          [a.id],
        )
      ).rows[0].location_valid_until,
    ).toEqual(oldFix);
    await clearQueryBudget();
    const reused = await query(a, {
      cityId: MOSCOW_CITY_ID,
      scope: "nearby",
      radiusBucketKm: 5,
      origin: { kind: "reference", originRef: q.query.originRef },
    });
    expect(reused.query.originRef).toBe(q.query.originRef);
    await radar.update(a.id, a.issued.session.id, randomUUID(), {
      activationId: active.activationId,
      expectedVersion: active.version,
      radiusBucketKm: 3,
    });
    await clearQueryBudget();
    expect(
      (
        await requestQuery(a, {
          cityId: MOSCOW_CITY_ID,
          scope: "nearby",
          radiusBucketKm: 5,
          origin: { kind: "reference", originRef: q.query.originRef },
        })
      ).statusCode,
    ).toBe(422);
    expect((await preview(q.items[0]!.resultRef)).statusCode).toBe(404);
  });
  it("preview/config limits and current policy fences do not impede exact-generation STOP", async () => {
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    for (let n = 0; n < 10; n++)
      expect((await preview(ref)).statusCode).toBe(200);
    expect((await preview(ref)).statusCode).toBe(429);
    await pool.query(
      "INSERT INTO radar_rate_budgets(user_id,bucket,window_started_at,count) VALUES($1,'config',clock_timestamp(),30)",
      [a.id],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/radar/config",
          headers: headers(a),
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/me/radar/nearby",
          headers: headers(a),
        })
      ).statusCode,
    ).toBe(426);
    await pool.query(
      "UPDATE radar_presences SET policy_version='radar-mvp-v1' WHERE user_id=$1",
      [b.id],
    );
    const heartbeat = await radar
      .heartbeat(b.id, b.issued.session.id, randomUUID(), {
        activationId: active.activationId,
      })
      .catch((e) => e);
    expect(heartbeat.getStatus()).toBe(409);
    await radar.stop(
      b.id,
      b.issued.session.id,
      randomUUID(),
      active.activationId,
    );
  });
  it.each(["stop", "withdraw", "revoke", "block", "disable"] as const)(
    "real DM commit holding geographic fence completes before %s without reciprocal FK lock",
    async (kind) => {
      const active = await start();
      const ref = (await query()).items[0]!.resultRef;
      let entered!: () => void;
      let resume!: () => void;
      const atFence = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const permit = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = proofs.redeem.bind(proofs);
      const spy = vi
        .spyOn(proofs, "redeem")
        .mockImplementationOnce(async (client, input) => {
          const result = await original(client, input);
          entered();
          await permit;
          return result;
        });
      const create = Promise.resolve(contact(a, b, ref));
      await atFence;
      let invalidation: Promise<unknown>;
      if (kind === "stop")
        invalidation = radar.stop(
          b.id,
          b.issued.session.id,
          randomUUID(),
          active.activationId,
        );
      else if (kind === "revoke")
        invalidation = sessions.revokeSession(b.issued.session.id);
      else if (kind === "disable")
        invalidation = pool.query(
          "UPDATE users SET status='disabled' WHERE id=$1",
          [b.id],
        );
      else if (kind === "block")
        invalidation = Promise.resolve(
          app.inject({
            method: "PUT",
            url: `/v1/me/blocks/${a.publicId}`,
            headers: headers(b),
          }),
        );
      else {
        const version = (
          await pool.query(
            "SELECT version FROM player_social_profiles WHERE user_id=$1",
            [b.id],
          )
        ).rows[0].version;
        invalidation = Promise.resolve(
          app.inject({
            method: "PATCH",
            url: "/v1/me/social-profile",
            headers: headers(b),
            payload: { expectedVersion: version, radarConsented: false },
          }),
        );
      }
      try {
        await waitForBlocked();
        resume();
        const created = await create;
        expect(created.statusCode, created.body).toBe(201);
        await invalidation;
        expect(
          (
            await pool.query("SELECT 1 FROM conversations WHERE id=$1", [
              created.json().conversation.id,
            ])
          ).rows,
        ).toHaveLength(1);
        expect((await preview(ref)).statusCode).toBe(404);
      } finally {
        resume();
        spy.mockRestore();
      }
    },
  );
  it("target movement/takeover and target social revocation invalidate original v2, lease expiry cannot revive", async () => {
    const active = await start();
    const ref = (await query()).items[0]!.resultRef;
    await pool.query(
      "UPDATE radar_presences SET next_location_update_at=clock_timestamp()-interval '1 second',location_valid_until=clock_timestamp()+interval '1 minute' WHERE user_id=$1",
      [b.id],
    );
    const moved = await radar.update(b.id, b.issued.session.id, randomUUID(), {
      activationId: active.activationId,
      expectedVersion: active.version,
      location: { ...fix(), longitude: 37.618 },
    });
    expect((await preview(ref)).statusCode).toBe(404);
    await clearQueryBudget();
    const afterMove = (await query()).items[0]!.resultRef;
    const other = await sessions.createConsumerSession(b.id);
    await radar.takeover(b.id, other.session.id, randomUUID(), {
      activationId: active.activationId,
      expectedVersion: moved.body.version,
      confirm: true,
      location: fix(),
      consentPolicyVersion: GEO_POLICY,
    });
    expect((await preview(afterMove)).statusCode).toBe(404);
    await clearQueryBudget();
    const afterTakeover = (await query()).items[0]!.resultRef;
    const version = (
      await pool.query(
        "SELECT version FROM player_social_profiles WHERE user_id=$1",
        [b.id],
      )
    ).rows[0].version;
    const revoked = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: headers({ ...b, issued: other }),
      payload: { expectedVersion: version, socialEligible: false },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await preview(afterTakeover)).statusCode).toBe(404);
    await clearQueryBudget();
    expect((await query()).items).toHaveLength(0);
  });
  it("proof expiring during persistence work rolls back real first contact at the final current-state check", async () => {
    await start();
    const ref = (await query()).items[0]!.resultRef;
    const payload = JSON.parse(
      Buffer.from(ref.split(".")[0]!, "base64url").toString(),
    );
    const short = signGeographicToken(geographicPepper(env), "result", {
      ...payload,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 350,
    });
    const original = proofs.redeem.bind(proofs);
    const spy = vi
      .spyOn(proofs, "redeem")
      .mockImplementationOnce(async (client, input) => {
        const result = await original(client, input);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return result;
      });
    try {
      const denied = await contact(a, b, short);
      expect(denied.statusCode, denied.body).toBe(404);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM conversations WHERE initiator_user_id=$1 AND recipient_user_id=$2",
            [a.id, b.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("opposed applicant context DM and manager invitation use Game before Pair and complete without a lock cycle", async () => {
    const game = await publishedGame();
    await start(a);
    await start(b);
    await pool.query(
      "INSERT INTO participations(game_id,user_id,status) VALUES($1,$2,'pending')",
      [game.id, b.id],
    );
    const qa = await query(a),
      qb = await query(b);
    const toB = qa.items.find(
        (i) => i.player.publicPlayerId === b.publicId,
      )!.resultRef,
      toA = qb.items.find(
        (i) => i.player.publicPlayerId === a.publicId,
      )!.resultRef;
    const gate = await pool.connect();
    await gate.query("BEGIN");
    await gate.query("SELECT id FROM games WHERE id=$1 FOR UPDATE", [game.id]);
    const invite = Promise.resolve(
      app.inject({
        method: "POST",
        url: `/v1/games/${game.id}/invitations`,
        headers: headers(a),
        payload: {
          inviteePublicPlayerId: b.publicId,
          expectedGameVersion: game.version,
          discoveryProof: toB,
        },
      }),
    );
    const dm = Promise.resolve(
      app.inject({
        method: "POST",
        url: "/v1/conversations/requests",
        headers: headers(b),
        payload: {
          targetPublicPlayerId: a.publicId,
          text: "Fictional applicant clarification",
          clientMessageId: randomUUID(),
          gameContextId: game.id,
          discoveryProof: toA,
        },
      }),
    );
    await waitForBlocked();
    await release(gate);
    const [created, denied] = await Promise.all([dm, invite]);
    expect(created.statusCode, created.body).toBe(201);
    expect(denied.statusCode, denied.body).toBe(409);
    expect(denied.json().code).toBe("PARTICIPATION_ACTIVE");
  });
});
