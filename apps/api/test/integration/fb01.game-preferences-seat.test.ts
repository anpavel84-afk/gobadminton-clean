import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) {
      out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    }
  }
  return out;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

function fakeAdapter(identity: VerifiedIdentity): AuthProviderAdapter {
  return {
    key: identity.provider,
    configured: true,
    async startAuthorization(input) {
      return {
        authorizationUrl: `https://provider.test/authorize?state=${encodeURIComponent(input.state)}`,
      };
    },
    async exchangeCode() {
      return { accessToken: "test-access" };
    },
    async fetchVerifiedIdentity() {
      return identity;
    },
  };
}

describeIntegration("FB01 private contact and real creator seat", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityOwner: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:fb01",
    subject: uniqueSuffix("owner-fb01"),
    email: "owner-fb01@example.com",
    displayName: "Owner RTG",
  };
  const identityOther: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:fb01",
    subject: uniqueSuffix("other-fb01"),
    email: "other-fb01@example.com",
    displayName: "Other RTG",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_API_ORIGIN = "http://127.0.0.1:3000";
    process.env.PUBLIC_WEB_ORIGIN = "http://127.0.0.1:3001";
    process.env.ALLOWED_WEB_ORIGINS = "http://127.0.0.1:3001";
    process.env.AUTH_PEPPER = "integration-auth-pepper-32chars!!";
    process.env.COOKIE_SECURE = "false";
    process.env.VK_CLIENT_ID = "vk-test";
    process.env.VK_CLIENT_SECRET = "vk-secret";
    process.env.VK_REDIRECT_URI = "http://127.0.0.1:3000/v1/auth/vk/callback";
    process.env.YANDEX_CLIENT_ID = "ya-test";
    process.env.YANDEX_CLIENT_SECRET = "ya-secret";
    process.env.YANDEX_REDIRECT_URI =
      "http://127.0.0.1:3000/v1/auth/yandex/callback";
    process.env.GIT_SHA = "integration-fb01";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const env = loadEnv(process.env);
    const database = createDatabase(env.DATABASE_URL);
    pool = database.pool;

    const TestCoreModule = buildTestCoreModule(env, pool);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TestCoreModule,
        AuthModule,
        OrganizersModule,
        VenuesModule,
        TrainersModule,
        GamesModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityOwner), fakeAdapter(identityOther)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function login(provider: "vk" | "yandex") {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/callback?code=ok&state=${encodeURIComponent(state!)}${provider === "vk" ? "&device_id=vk-device-test" : ""}`,
      cookies,
    });
    expect(callback.statusCode).toBe(302);
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: sessionCookies,
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { id: string; csrfToken: string };
    return {
      cookies: sessionCookies,
      csrfToken: meBody.csrfToken,
      userId: meBody.id,
      cookie: cookieHeader(sessionCookies),
    };
  }

  function mutationHeaders(session: { csrfToken: string; cookie: string }, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  type Session = Awaited<ReturnType<typeof login>>;
  let owner: Session;
  let other: Session;
  let venueId: string;
  beforeAll(async () => {
    owner = await login("vk"); other = await login("yandex");
    const venue = await app.inject({ method: "POST", url: "/v1/venues",
      headers: mutationHeaders(owner, uniqueSuffix("fb01-venue")),
      payload: { cityId: MOSCOW_CITY_ID, name: uniqueSuffix("FB01 Court"), address: "Synthetic Moscow",
        timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62 } });
    expect([200,201]).toContain(venue.statusCode); venueId = venue.json().id;
  });
  const getPrefs = (session: Session) => app.inject({ method: "GET", url: "/v1/me/game-preferences", cookies: session.cookies });
  const patch = (session: Session, payload: Record<string, unknown>, key = uniqueSuffix("fb01-patch")) =>
    app.inject({ method: "PATCH", url: "/v1/me/game-preferences", headers: mutationHeaders(session,key), payload });
  const stableTimes = baseGamePayload("", {});
  const create = (session: Session, overrides: Record<string, unknown> = {}, key = uniqueSuffix("fb01-create")) =>
    app.inject({ method: "POST", url: "/v1/games", headers: mutationHeaders(session,key), payload: {...baseGamePayload(venueId,overrides), startsAt:stableTimes.startsAt, endsAt:stableTimes.endsAt, applicationDeadlineAt:stableTimes.applicationDeadlineAt} });
  const command = (session: Session, url: string, payload: Record<string, unknown>, key = uniqueSuffix("fb01-command")) =>
    app.inject({ method: "POST", url, headers: mutationHeaders(session,key), payload });
  async function roster(id: string) {
    const r = await app.inject({ method: "GET", url: `/v1/games/${id}/participations`, cookies: owner.cookies });
    expect(r.statusCode).toBe(200); return r.json().items as Array<{ id: string; status: string; version: number; isCreatorOrganizer: boolean }>;
  }

  it("additive migration leaves historical rows untouched and never backfills contacts", async () => {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA fb01_upgrade_fixture");
      await client.query("SET LOCAL search_path=fb01_upgrade_fixture,public");
      await client.query("CREATE TABLE users(id uuid PRIMARY KEY,status text NOT NULL); CREATE TABLE games(id integer,host_public_contact text); CREATE TABLE participations(game_id integer,status text)");
      await client.query("INSERT INTO users VALUES($1,'active');",[owner.userId]);
      await client.query("INSERT INTO games VALUES(1,'historical-private-snapshot'); INSERT INTO participations VALUES(1,'confirmed')");
      await client.query(readFileSync(path.join(apiRoot,"migrations/0023_user_game_preferences.sql"),"utf8"));
      expect((await client.query("SELECT * FROM user_game_preferences")).rows).toEqual([]);
      expect((await client.query("SELECT * FROM games")).rows).toEqual([{id:1,host_public_contact:"historical-private-snapshot"}]);
      expect((await client.query("SELECT * FROM participations")).rows).toEqual([{game_id:1,status:"confirmed"}]);
      await client.query("INSERT INTO user_game_preferences(user_id,default_public_game_contact) VALUES($1,'test-clear')",[owner.userId]);
      await client.query("DELETE FROM users WHERE id=$1",[owner.userId]);
      expect((await client.query("SELECT * FROM user_game_preferences")).rows).toEqual([]);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("auth, own-only no-store, validation and first-write race", async () => {
    expect((await app.inject({ method:"GET",url:"/v1/me/game-preferences" })).statusCode).toBe(401);
    const empty = await getPrefs(owner); expect(empty.json()).toEqual({defaultPublicGameContact:null,version:0});
    expect(empty.headers["cache-control"]).toBe("no-store");
    const input = {expectedVersion:0,defaultPublicGameContact:"  private-template-A  "};
    const headers = mutationHeaders(owner,uniqueSuffix("fb01-bad-auth"));
    expect((await app.inject({method:"PATCH",url:"/v1/me/game-preferences",headers:{...headers,origin:"https://foreign.test"},payload:input})).statusCode).toBe(403);
    expect((await app.inject({method:"PATCH",url:"/v1/me/game-preferences",headers:{...headers,"x-csrf-token":"bad"},payload:input})).statusCode).toBe(403);
    for (const payload of [{...input,expectedVersion:2147483648}, {expectedVersion:0}, {...input,userId:other.userId}, {...input,defaultPublicGameContact:" "}, {...input,defaultPublicGameContact:"x".repeat(321)}, {...input,expectedVersion:-1}]) {
      expect((await patch(owner,payload)).statusCode).toBe(422);
    }
    const race = await Promise.all([patch(owner,input),patch(owner,input)]);
    expect(race.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect((await getPrefs(owner)).json()).toEqual({defaultPublicGameContact:"private-template-A",version:1});
    expect((await getPrefs(other)).json()).toEqual({defaultPublicGameContact:null,version:0});
    expect((await pool.query("SELECT count(*)::int AS n FROM user_game_preferences WHERE user_id=$1",[owner.userId])).rows[0].n).toBe(1);
  });

  it("atomic save, rollback, concurrent create and replay preserve newer defaults", async () => {
    const key=uniqueSuffix("fb01-replay");
    const overrides={capacity:2,hostPublicContact:"  game-B  ",savePublicContactDefault:{expectedVersion:1}};
    const created=await create(owner,overrides,key); expect(created.statusCode).toBe(201);
    const game=created.json(); expect(game.confirmedCount).toBe(1); expect(game.availablePlaces).toBe(1);
    expect(game.organizer.publicContact).toBe("game-B");
    expect((await getPrefs(owner)).json()).toEqual({defaultPublicGameContact:"game-B",version:2});
    expect((await patch(owner,{expectedVersion:2,defaultPublicGameContact:"newer-private"})).statusCode).toBe(200);
    expect((await create(owner,overrides,key)).json()).toEqual(game);
    expect((await getPrefs(owner)).json().defaultPublicGameContact).toBe("newer-private");
    expect((await create(owner,{...overrides,hostPublicContact:"different"},key)).statusCode).toBe(409);
    const before=(await pool.query("SELECT count(*)::int AS n FROM games WHERE created_by_user_id=$1",[owner.userId])).rows[0].n;
    const raced=await Promise.all([create(owner,{hostPublicContact:"race-C",savePublicContactDefault:{expectedVersion:3}}),create(owner,{hostPublicContact:"race-D",savePublicContactDefault:{expectedVersion:3}})]);
    expect(raced.map(r=>r.statusCode).sort()).toEqual([201,409]);
    expect((await pool.query("SELECT count(*)::int AS n FROM games WHERE created_by_user_id=$1",[owner.userId])).rows[0].n).toBe(before+1);
    const failedKey=uniqueSuffix("fb01-rollback");
    const failed=await create(owner,{hostPublicContact:"bad-save",savePublicContactDefault:{expectedVersion:3}},failedKey);
    expect(failed.statusCode).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM idempotency_records WHERE actor_id=$1 AND key_hash=$2",[owner.userId,app.get(IdempotencyService).keyHash(failedKey)])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM games WHERE host_public_contact='bad-save'")).rows[0].n).toBe(0);
    const onlyGame=await create(owner,{hostPublicContact:"public-override"}); expect(onlyGame.statusCode).toBe(201);
    expect((await getPrefs(owner)).json().version).toBe(4);
    expect((await patch(owner,{expectedVersion:4,defaultPublicGameContact:null})).statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/v1/games/${game.id}`,cookies:owner.cookies})).json().organizer.publicContact).toBe("game-B");
    expect((await pool.query("SELECT count(*)::int AS n FROM participations WHERE game_id=$1",[game.id])).rows[0].n).toBe(1);
    const rows=await roster(game.id); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({status:"confirmed",isCreatorOrganizer:true});
    const events=await pool.query("SELECT type,payload FROM outbox_events WHERE aggregate_id=$1",[rows[0]!.id]);
    expect((await pool.query("SELECT count(*)::int AS n FROM conversations WHERE game_id=$1",[game.id])).rows[0].n).toBe(0);
    expect(events.rows).toHaveLength(1); expect(events.rows[0]).toMatchObject({type:"participation.confirmed",payload:{origin:"creator_initial_seat"}});
    expect(JSON.stringify(events.rows)).not.toContain("game-B");
    expect((await app.inject({method:"GET",url:`/v1/games/${game.id}`})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:`/v1/games/${game.id}/participations`,cookies:other.cookies})).statusCode).toBe(404);
    expect((await command(other,`/v1/games/${game.id}/participations`,{expectedGameVersion:1})).statusCode).toBe(409);
  });

  it("capacity arithmetic, full creator request and publish never duplicate", async () => {
    for (const [capacity,external,free] of [[1,0,0],[2,0,1],[4,0,3],[2,1,0]]) {
      const draft=await create(owner,{capacity,externalReservedCount:external}); expect(draft.statusCode).toBe(201);
      const game=draft.json(); expect(game).toMatchObject({confirmedCount:1,availablePlaces:free,externalReservedCount:external});
      const key=uniqueSuffix("fb01-publish");
      const published=await command(owner,`/v1/games/${game.id}/publish`,{expectedVersion:1},key); expect(published.statusCode).toBe(200);
      expect((await command(owner,`/v1/games/${game.id}/publish`,{expectedVersion:1},key)).json()).toEqual(published.json());
      const existing=await command(owner,`/v1/games/${game.id}/participations`,{expectedGameVersion:published.json().version});
      expect(existing.statusCode).toBe(200); expect(existing.json()).toMatchObject({status:"confirmed",isCreatorOrganizer:true});
      const detail=await app.inject({method:"GET",url:`/v1/games/${game.id}`});
      expect(detail.json()).toMatchObject({confirmedCount:1,availablePlaces:free});
      expect(detail.json()).not.toHaveProperty("participations");
      expect((await roster(game.id))).toHaveLength(1);
    }
    const invalid=await create(owner,{capacity:2,externalReservedCount:2}); expect(invalid.statusCode).toBe(422); expect(invalid.json().code).toBe("CAPACITY_INVALID");
  });

  it("GMap composition uses the real creator seat and keeps private preferences out of public aggregates", async () => {
    const preferences = (await getPrefs(owner)).json();
    // Isolate map/creator-seat coverage from unrelated catalog fuzzy-dedup fixtures.
    const venue = await pool.query<{ id: string }>(`INSERT INTO venues
      (city_id, name, address, timezone, location, created_by_user_id, lifecycle_state, normalized_name, normalized_address)
      VALUES ($1, $2, $3, 'Europe/Moscow', ST_GeogFromText('SRID=4326;POINT(37.63 55.76)'), $4, 'unverified', $2, $3)
      RETURNING id`, [MOSCOW_CITY_ID, uniqueSuffix("gmap-fb01-court"), uniqueSuffix("gmap-fb01-address"), owner.userId]);
    const selectedVenue = venue.rows[0]!.id;
    const draft = await create(owner, { venueId: selectedVenue, capacity: 1, hostPublicContact: "public-game-snapshot" });
    expect(draft.statusCode).toBe(201);
    const game = draft.json();
    const published = await command(owner, `/v1/games/${game.id}/publish`, { expectedVersion: 1 });
    expect(published.statusCode).toBe(200);
    const mapUrl = `/v1/games/map?cityId=${MOSCOW_CITY_ID}&temporalScope=upcoming&venueId=${selectedVenue}`;
    const map = await app.inject({ method: "GET", url: mapUrl });
    expect(map.statusCode).toBe(200);
    expect(map.headers["cache-control"]).toBe("no-store");
    expect(map.json().counts.matchingGames).toBe(1);
    expect(map.json().items[0].games).toEqual([expect.objectContaining({ id: game.id, availablePlaces: 0 })]);
    expect(map.body).not.toContain("public-game-snapshot");
    expect(map.body).not.toContain("defaultPublicGameContact");
    const list = await app.inject({ method: "GET", url: `/v1/games?venueId=${selectedVenue}&temporalScope=upcoming` });
    expect(list.json().items[0]).toMatchObject({ id: game.id, confirmedCount: 1, availablePlaces: 0 });
    const seat = (await roster(game.id))[0]!;
    expect((await command(owner, `/v1/participations/${seat.id}/withdraw`, { expectedVersion: seat.version })).statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: mapUrl });
    expect(after.json().items[0].games[0].availablePlaces).toBe(1);
    expect((await getPrefs(owner)).json()).toEqual(preferences);
    const detail = await app.inject({ method: "GET", url: `/v1/games/${game.id}` });
    expect((await command(owner, `/v1/games/${game.id}/cancel`, { expectedVersion: detail.json().version, reason: "synthetic composition cleanup" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: mapUrl })).json().counts.matchingGames).toBe(0);
  });

  it("last-seat confirmations serialize and creator withdrawal/removal/cancel keep true counts", async () => {
    const draft=(await create(owner,{capacity:2})).json();
    const pub=await command(owner,`/v1/games/${draft.id}/publish`,{expectedVersion:1}); expect(pub.statusCode).toBe(200);
    const pending=await command(other,`/v1/games/${draft.id}/participations`,{expectedGameVersion:pub.json().version}); expect(pending.statusCode).toBe(201);
    // A second current session of the creator reuses the same internal identity.
    const third=await login("vk");
    // Reuse owner after withdrawing their real seat, then reapply: two pending compete for one free seat.
    const creator=(await roster(draft.id))[0]!;
    expect((await command(owner,`/v1/participations/${creator.id}/withdraw`,{expectedVersion:1})).statusCode).toBe(200);
    const reapply=await command(third,`/v1/games/${draft.id}/participations`,{expectedGameVersion:(await app.inject({method:"GET",url:`/v1/games/${draft.id}`})).json().version}); expect(reapply.statusCode).toBe(201);
    // One anonymous external seat leaves exactly one free place for the two pending rows.
    await pool.query("UPDATE games SET external_reserved_count=1 WHERE id=$1",[draft.id]);
    await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')",[draft.id,other.userId]);
    const confirmed=await Promise.all([command(other,`/v1/participations/${pending.json().id}/confirm`,{expectedVersion:1}),command(owner,`/v1/participations/${reapply.json().id}/confirm`,{expectedVersion:reapply.json().version})]);
    expect(confirmed.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const winner=confirmed.find(r=>r.statusCode===200)!.json();
    expect((await command(owner,`/v1/participations/${winner.id}/remove`,{expectedVersion:winner.version,reason:"fixture removal"})).statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/v1/games/${draft.id}`})).json().confirmedCount).toBe(0);
    const fresh=(await create(owner,{capacity:4})).json(); const seat=(await roster(fresh.id))[0]!;
    const cancelled=await command(owner,`/v1/games/${fresh.id}/cancel`,{expectedVersion:1,reason:"fixture cancel"}); expect(cancelled.statusCode).toBe(200);
    expect((await roster(fresh.id)).find(p=>p.id===seat.id)?.status).toBe("cancelled_by_game");
    const racing=(await create(owner)).json(); const racingSeat=(await roster(racing.id))[0]!;
    await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')",[racing.id,other.userId]);
    const transitions=await Promise.all([
      command(owner,`/v1/participations/${racingSeat.id}/withdraw`,{expectedVersion:1}),
      command(other,`/v1/games/${racing.id}/cancel`,{expectedVersion:1,reason:"concurrent cancel"})]);
    expect(transitions.some(r=>r.statusCode===200)).toBe(true);
    for (const r of transitions) expect([200,409]).toContain(r.statusCode);
    const actual=(await pool.query("SELECT status,version FROM games WHERE id=$1",[racing.id])).rows[0];
    if(actual.status!=="cancelled") expect((await command(other,`/v1/games/${racing.id}/cancel`,{expectedVersion:actual.version,reason:"finish cancel"})).statusCode).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS n FROM participations WHERE game_id=$1 AND status='confirmed'",[racing.id])).rows[0].n).toBe(0);
    const withdrawn=(await create(owner)).json(); const w=(await roster(withdrawn.id))[0]!;
    expect((await command(owner,`/v1/participations/${w.id}/withdraw`,{expectedVersion:1})).statusCode).toBe(200);
    const publish=await command(owner,`/v1/games/${withdrawn.id}/publish`,{expectedVersion:2}); expect(publish.statusCode).toBe(200); expect(publish.json().confirmedCount).toBe(0);
  });

  it("trainer-led retains zero automatic seats", async () => {
    const trainer=await app.inject({method:"PUT",url:"/v1/me/trainer-profile",headers:mutationHeaders(owner,uniqueSuffix("fb01-trainer")),payload:{selfDeclared:true,displayName:"Synthetic Coach"}});
    expect(trainer.statusCode).toBe(201);
    const result=await create(owner,{activityKind:"trainer_led",capacity:2,settlement:{mode:"external",purpose:"trainer_fee",priceStatus:"by_agreement",priceMinor:null,currency:null,terms:"External only"}});
    expect(result.statusCode).toBe(201); expect(result.json()).toMatchObject({confirmedCount:0,availablePlaces:2}); expect(await roster(result.json().id)).toHaveLength(0);
  });

  it("deletion transition clears private default and prevents read/replay; revoked sessions fail closed", async () => {
    const key=uniqueSuffix("fb01-delete-patch"); const input={expectedVersion:0,defaultPublicGameContact:"delete-private"};
    expect((await patch(other,input,key)).statusCode).toBe(200);
    // Existing account deletion endpoint is not enabled; exercise Identity's DB lifecycle fence.
    await pool.query("UPDATE users SET status='deletion_pending',deletion_requested_at=now() WHERE id=$1",[other.userId]);
    expect((await pool.query("SELECT default_public_game_contact,version FROM user_game_preferences WHERE user_id=$1",[other.userId])).rows[0]).toEqual({default_public_game_contact:null,version:2});
    expect((await getPrefs(other)).statusCode).toBe(401); expect((await patch(other,input,key)).statusCode).toBe(401);
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1",[owner.userId]);
    expect((await getPrefs(owner)).statusCode).toBe(401);
  });
});

function baseGamePayload(venueId: string, overrides: Record<string, unknown>) {
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
  return {
    hostDisplayName: "RTG Host",
    hostPublicContact: "telegram:@rtg",
    venueId,
    title: "RTG game",
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    timezone: "Europe/Moscow",
    applicationDeadlineAt: deadline.toISOString(),
    capacity: 8,
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
      terms: "Court terms outside platform",
    },
    ...overrides,
  };
}
