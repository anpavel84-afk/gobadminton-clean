// Preservation probes from accepted FB01 QA publication 3c389f8a3b83370edb69556421bc8f3aab37d8e6.
// Re-executed by the GMap integration producer; this is author regression evidence.
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describeIntegration("Independent QA FB01 supplemental", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityOwner: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:fb01",
    subject: uniqueSuffix("owner-fb01"),
    email: "owner-qa-fb01@example.com",
    displayName: "Owner RTG",
  };
  const identityOther: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:fb01",
    subject: uniqueSuffix("other-fb01"),
    email: "other-qa-fb01@example.com",
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


  it("GMap integration FB01 regression: PATCH replay cannot restore a cleared default; foreign DTO remains private", async () => {
    const key=uniqueSuffix("qa-pref-replay");
    const input={expectedVersion:0,defaultPublicGameContact:"qa-private-never-public"};
    const first=await patch(owner,input,key); expect(first.statusCode).toBe(200);
    expect((await patch(owner,{expectedVersion:1,defaultPublicGameContact:null})).statusCode).toBe(200);
    const replay=await patch(owner,input,key); expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(first.json());
    expect(replay.headers["cache-control"]).toBe("no-store");
    expect((await getPrefs(owner)).json()).toEqual({defaultPublicGameContact:null,version:2});
    expect((await getPrefs(other)).json()).toEqual({defaultPublicGameContact:null,version:0});
    expect((await app.inject({method:"GET",url:`/v1/users/${owner.userId}/game-preferences`,cookies:other.cookies})).statusCode).toBe(404);
    expect((await patch(owner,{...input,defaultPublicGameContact:"changed"},key)).statusCode).toBe(409);
  });

  it("GMap integration FB01 regression: injected database failure rolls back every composed create effect and key is reusable", async () => {
    const key=uniqueSuffix("qa-injected-failure");
    const input={hostPublicContact:"qa-injected-contact",savePublicContactDefault:{expectedVersion:2}};
    const counts=async()=> (await pool.query(`SELECT
      (SELECT count(*)::int FROM games) AS games,
      (SELECT count(*)::int FROM participations) AS seats,
      (SELECT count(*)::int FROM game_managers) AS managers,
      (SELECT count(*)::int FROM participation_transitions) AS transitions,
      (SELECT count(*)::int FROM outbox_events) AS events,
      (SELECT count(*)::int FROM idempotency_records) AS receipts`)).rows[0];
    await pool.query(`CREATE FUNCTION qa_fail_preference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.default_public_game_contact='qa-injected-contact' THEN RAISE EXCEPTION 'synthetic QA fault'; END IF;
      RETURN NEW; END; $$;
      CREATE TRIGGER qa_fail_preference BEFORE UPDATE ON user_game_preferences FOR EACH ROW EXECUTE FUNCTION qa_fail_preference()`);
    try {
      const before=await counts(); const failed=await create(owner,input,key); expect(failed.statusCode).toBe(500);
      expect(await counts()).toEqual(before);
      expect((await getPrefs(owner)).json()).toEqual({defaultPublicGameContact:null,version:2});
    } finally {
      await pool.query("DROP TRIGGER qa_fail_preference ON user_game_preferences; DROP FUNCTION qa_fail_preference()");
    }
    const retry=await create(owner,input,key); expect(retry.statusCode).toBe(201);
    expect(retry.json()).toMatchObject({confirmedCount:1,availablePlaces:7});
    expect((await getPrefs(owner)).json()).toEqual({defaultPublicGameContact:"qa-injected-contact",version:3});
    expect(await roster(retry.json().id)).toHaveLength(1);
  });

  it("GMap integration FB01 regression: full game retries respect version, manager marker and lost session fences", async () => {
    const game=(await create(owner,{capacity:1,hostPublicContact:"qa-public-snapshot"})).json();
    expect((await command(owner,`/v1/games/${game.id}/publish`,{expectedVersion:1})).statusCode).toBe(200);
    for(let attempt=0;attempt<3;attempt++) {
      const existing=await command(owner,`/v1/games/${game.id}/participations`,{expectedGameVersion:2});
      expect(existing.statusCode).toBe(200); expect(existing.json()).toMatchObject({status:"confirmed",isCreatorOrganizer:true});
    }
    expect((await command(owner,`/v1/games/${game.id}/participations`,{expectedGameVersion:1})).statusCode).toBe(409);
    expect((await command(other,`/v1/games/${game.id}/participations`,{expectedGameVersion:2})).json().code).toBe("GAME_FULL");
    expect(await roster(game.id)).toHaveLength(1);
    const publicDto=await app.inject({method:"GET",url:`/v1/games/${game.id}`});
    expect(publicDto.json().organizer.publicContact).toBe("qa-public-snapshot");
    expect(JSON.stringify(publicDto.json())).not.toContain("qa-injected-contact");
    expect(JSON.stringify(publicDto.json())).not.toContain(owner.userId);
    const another=(await create(owner,{capacity:2})).json();
    await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')",[another.id,other.userId]);
    expect((await command(owner,`/v1/games/${another.id}/publish`,{expectedVersion:1})).statusCode).toBe(200);
    const request=await command(other,`/v1/games/${another.id}/participations`,{expectedGameVersion:2});
    expect(request.statusCode).toBe(201); expect(request.json().isCreatorOrganizer).toBe(false);
    const key=uniqueSuffix("qa-lost-session"); const overrides={hostPublicContact:"qa-replay-auth"};
    expect((await create(owner,overrides,key)).statusCode).toBe(201);
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1",[owner.userId]);
    expect((await create(owner,overrides,key)).statusCode).toBe(401);
    expect((await patch(owner,{expectedVersion:3,defaultPublicGameContact:null})).statusCode).toBe(401);
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
