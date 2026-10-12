import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
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
import { ParticipationsModule } from "../../src/participations/participations.module";
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
      return { ...identity };
    },
  };
}

type Session = {
  cookies: Record<string, string>;
  csrfToken: string;
  userId: string;
  cookie: string;
};

type VenueBody = {
  id: string;
  lifecycleState: string;
  dataStatus: string;
  provenance: string;
  name: string;
};

describeIntegration("Venue A1a catalog / exact-dedupe", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:a1a",
    subject: uniqueSuffix("owner-a1a"),
    email: "owner-a1a@example.com",
    displayName: "Owner A1a",
  };
  const playerIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:a1a",
    subject: uniqueSuffix("player-a1a"),
    email: "player-a1a@example.com",
    displayName: "Player A1a",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_POOL_MAX = "20";
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
    process.env.GIT_SHA = "integration-venue-a1a";

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
        ParticipationsModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(playerIdentity)])
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

  async function login(provider: "vk" | "yandex"): Promise<Session> {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
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

  function mutationHeaders(session: Session, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  function payload(name: string, address: string) {
    return {
      cityId: MOSCOW_CITY_ID,
      name,
      address,
      timezone: "Europe/Moscow",
      latitude: 55.751244,
      longitude: 37.618423,
    };
  }

  function isolated(label: string) {
    const token = uniqueSuffix(label);
    const address = `улица ${token}`;
    return {
      token,
      address,
      key: (part: string) => `idem-${part}-${token}`,
      body: (name: string, addr = address) => payload(name, addr),
    };
  }

  it("reuses exact equivalents and never self-verifies on legacy POST", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const iso = isolated("exact");
    const name = `Точное ${iso.token}`;
    const first = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(a, iso.key("exact-a")),
      payload: iso.body(name),
    });
    expect(first.statusCode).toBe(201);
    const created = first.json() as VenueBody;
    expect(created.lifecycleState).toBe("unverified");
    expect(created.dataStatus).toBe("unverified");
    expect(created.provenance).toBe("user_submitted");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(a, iso.key("exact-a")),
      payload: iso.body(name),
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as VenueBody).id).toBe(created.id);

    const other = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(b, iso.key("exact-b")),
      payload: iso.body(`  ${name.toUpperCase()}  `, `улица, ${iso.token}`),
    });
    expect(other.statusCode).toBe(200);
    expect((other.json() as VenueBody).id).toBe(created.id);
    expect((other.json() as VenueBody).lifecycleState).toBe("unverified");
  });

  it("commits a single venue under concurrent exact submits", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const iso = isolated("race");
    const name = `Гонка ${iso.token}`;
    const [left, right] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/venue-proposals",
        headers: mutationHeaders(a, iso.key("race-a")),
        payload: iso.body(name),
      }),
      app.inject({
        method: "POST",
        url: "/v1/venue-proposals",
        headers: mutationHeaders(b, iso.key("race-b")),
        payload: iso.body(name),
      }),
    ]);
    expect([200, 201]).toContain(left.statusCode);
    expect([200, 201]).toContain(right.statusCode);
    const leftId = (left.json() as VenueBody).id;
    const rightId = (right.json() as VenueBody).id;
    expect(leftId).toBe(rightId);
    const count = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM venues WHERE name = $1`,
      [name],
    );
    expect(count.rows[0]!.c).toBe(1);
  });

  it("keeps distinct halls and treats fuzzy neighbors as advisory only", async () => {
    const a = await login("vk");
    const iso = isolated("halls");
    const hall1 = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("hall1")),
      payload: iso.body(`Олимпийский зал 1 ${iso.token}`),
    });
    expect(hall1.statusCode).toBe(201);
    const hall2 = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("hall2")),
      payload: iso.body(`Олимпийский зал 2 ${iso.token}`),
    });
    expect(hall2.statusCode).toBe(409);
    const problem = hall2.json() as {
      code: string;
      confirmationToken: string;
      candidates: VenueBody[];
    };
    expect(problem.code).toBe("VENUE_POSSIBLE_DUPLICATE");
    expect(problem.candidates.some((c) => c.id === (hall1.json() as VenueBody).id)).toBe(
      true,
    );

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: mutationHeaders(a, iso.key("hall2-confirm")),
      payload: {
        ...iso.body(`Олимпийский зал 2 ${iso.token}`),
        confirmationToken: problem.confirmationToken,
      },
    });
    expect(confirmed.statusCode).toBe(201);
    expect((confirmed.json() as VenueBody).id).not.toBe((hall1.json() as VenueBody).id);

    const replayToken = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: mutationHeaders(a, iso.key("hall2-reuse")),
      payload: {
        ...iso.body(`Олимпийский зал 2 ${iso.token}`),
        confirmationToken: problem.confirmationToken,
      },
    });
    expect(replayToken.statusCode).toBe(422);
  });

  it("rejects stale and cross-session confirm tokens", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const iso = isolated("tokens");
    const base = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("tok-base")),
      payload: iso.body(`База ${iso.token}`),
    });
    expect(base.statusCode).toBe(201);
    const fuzzy = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("tok-fuzzy")),
      payload: iso.body(`База сосед ${iso.token}`),
    });
    expect(fuzzy.statusCode).toBe(409);
    const token = (fuzzy.json() as { confirmationToken: string }).confirmationToken;

    const cross = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: mutationHeaders(b, iso.key("tok-cross")),
      payload: {
        ...iso.body(`База сосед ${iso.token}`),
        confirmationToken: token,
      },
    });
    expect(cross.statusCode).toBe(422);

    await pool.query(
      `UPDATE venue_proposal_confirm_tokens
       SET expires_at = now() - interval '1 minute'
       WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
      [token],
    );
    const stale = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: mutationHeaders(a, iso.key("tok-stale")),
      payload: {
        ...iso.body(`База сосед ${iso.token}`),
        confirmationToken: token,
      },
    });
    expect(stale.statusCode).toBe(422);
  });

  it("hides retired/merged from catalog, resolves merged ids, denies verify", async () => {
    const a = await login("vk");
    const iso = isolated("catalog");
    const created = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("cat")),
      payload: iso.body(`Каталог ${iso.token}`),
    });
    expect(created.statusCode).toBe(201);
    const venue = created.json() as VenueBody;
    const listed = await app.inject({
      method: "GET",
      url: `/v1/venues?cityId=${MOSCOW_CITY_ID}&q=${encodeURIComponent(iso.token)}`,
    });
    expect(listed.statusCode).toBe(200);
    const page = listed.json() as { items: VenueBody[] };
    expect(page.items.some((item) => item.id === venue.id)).toBe(true);

    await pool.query(
      `UPDATE venues SET lifecycle_state = 'retired', updated_at = now() WHERE id = $1`,
      [venue.id],
    );
    const listedRetired = await app.inject({
      method: "GET",
      url: `/v1/venues?cityId=${MOSCOW_CITY_ID}&q=${encodeURIComponent(iso.token)}`,
    });
    expect(
      (listedRetired.json() as { items: VenueBody[] }).items.some((item) => item.id === venue.id),
    ).toBe(false);

    const canonical = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("canon")),
      payload: iso.body(`Канон ${iso.token}`),
    });
    expect(canonical.statusCode).toBe(201);
    const canonicalId = (canonical.json() as VenueBody).id;
    await pool.query(
      `UPDATE venues
       SET lifecycle_state = 'merged', canonical_venue_id = $2, updated_at = now()
       WHERE id = $1`,
      [venue.id, canonicalId],
    );
    const resolved = await app.inject({
      method: "GET",
      url: `/v1/venues/${venue.id}`,
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedBody = resolved.json() as VenueBody & { resolvedFromVenueId?: string };
    expect(resolvedBody.id).toBe(canonicalId);
    expect(resolvedBody.resolvedFromVenueId).toBe(venue.id);

    const verify = await app.inject({
      method: "POST",
      url: `/v1/venues/${canonicalId}/verify`,
      headers: mutationHeaders(a, iso.key("verify")),
      payload: {},
    });
    expect(verify.statusCode).toBe(404);
  });

  it("legacy backfill reserves one exact key and does not silent-merge", async () => {
    const a = await login("vk");
    const iso = isolated("legacy");
    const name = `Наследие ${iso.token}`;
    const first = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(a, iso.key("legacy-a")),
      payload: iso.body(name),
    });
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as VenueBody).id;
    const secondId = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues (
           city_id, name, address, timezone, location,
           data_status, provenance, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address,
           normalization_version, identity_discriminator
         )
         SELECT
           city_id, name, address, timezone, location,
           'unverified', 'legacy', created_by_user_id,
           'unverified', normalized_name, normalized_address,
           normalization_version, identity_discriminator
         FROM venues WHERE id = $1
         RETURNING id`,
        [firstId],
      )
    ).rows[0]!.id;

    await pool.query(`SELECT venue_backfill_identity_keys()`);

    const keys = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM venue_identity_keys k
       INNER JOIN venues v ON v.id = k.venue_id
       WHERE v.name = $1`,
      [name],
    );
    expect(keys.rows[0]!.c).toBe(1);
    const both = await pool.query<{ id: string }>(
      `SELECT id FROM venues WHERE id = ANY($1::uuid[])`,
      [[firstId, secondId]],
    );
    expect(both.rows).toHaveLength(2);
    const candidates = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM venue_duplicate_candidates
       WHERE source = 'legacy_exact_collision'
         AND (left_venue_id = ANY($1::uuid[]) OR right_venue_id = ANY($1::uuid[]))`,
      [[firstId, secondId]],
    );
    expect(candidates.rows[0]!.c).toBeGreaterThanOrEqual(1);
  });

  it("returns every selectable venue across name and geographic catalog pages", async () => {
    const a = await login("vk");
    const iso = isolated("pages");
    const tag = randomBytes(6).toString("hex");
    const zuluId = `10000000-0000-4000-8000-${tag}`;
    const alphaId = `20000000-0000-4000-8000-${tag}`;
    const bravoId = `30000000-0000-4000-8000-${tag}`;
    const retiredId = `01000000-0000-4000-8000-${tag}`;
    await pool.query(
      `INSERT INTO venues (
         id, city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES
         ($1,$5,$6,$9,'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.80,55.80),4326)::geography,
          'unverified','legacy',$4,'unverified', venue_normalize_v1($6), venue_normalize_v1($9), ''),
         ($2,$5,$7,$9,'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.618423,55.751244),4326)::geography,
          'unverified','legacy',$4,'unverified', venue_normalize_v1($7), venue_normalize_v1($9), ''),
         ($3,$5,$8,$9,'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.70,55.76),4326)::geography,
          'unverified','legacy',$4,'unverified', venue_normalize_v1($8), venue_normalize_v1($9), ''),
         ($11,$5,$10,$9,'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.61,55.75),4326)::geography,
          'unverified','legacy',$4,'retired', venue_normalize_v1($10), venue_normalize_v1($9), '')`,
      [
        zuluId,
        alphaId,
        bravoId,
        a.userId,
        MOSCOW_CITY_ID,
        `Zulu ${iso.token}`,
        `Alpha ${iso.token}`,
        `Bravo ${iso.token}`,
        iso.address,
        `Aardvark ${iso.token}`,
        retiredId,
      ],
    );

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let pageNo = 0; pageNo < 6; pageNo += 1) {
      const qs = new URLSearchParams({
        cityId: MOSCOW_CITY_ID,
        q: iso.token,
        limit: "1",
      });
      if (cursor) qs.set("cursor", cursor);
      const page = await app.inject({ method: "GET", url: `/v1/venues?${qs}` });
      expect(page.statusCode).toBe(200);
      const body = page.json() as { items: VenueBody[]; nextCursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(1);
      collected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(collected).toEqual([alphaId, bravoId, zuluId]);
    expect(collected).not.toContain(retiredId);

    const geoCollected: string[] = [];
    cursor = null;
    for (let pageNo = 0; pageNo < 6; pageNo += 1) {
      const qs = new URLSearchParams({
        cityId: MOSCOW_CITY_ID,
        q: iso.token,
        lat: "55.751244",
        lng: "37.618423",
        limit: "1",
      });
      if (cursor) qs.set("cursor", cursor);
      const page = await app.inject({ method: "GET", url: `/v1/venues?${qs}` });
      expect(page.statusCode).toBe(200);
      const body = page.json() as { items: VenueBody[]; nextCursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(1);
      geoCollected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(geoCollected).toEqual([alphaId, bravoId, zuluId]);
  });

  it("reuses a backfilled legacy hall venue without inserting a second row", async () => {
    const a = await login("vk");
    const iso = isolated("legacy-hall");
    const name = `QA Спортзал зал 2 ${iso.token}`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES (
         $1,$2,$3,'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.7,55.8),4326)::geography,
         'unverified','legacy',$4,
         'unverified', venue_normalize_v1($2), venue_normalize_v1($3), ''
       )
       RETURNING id`,
      [MOSCOW_CITY_ID, name, iso.address, a.userId],
    );
    const legacyId = inserted.rows[0]!.id;
    await pool.query(`SELECT venue_backfill_identity_keys()`);
    const beforeRekey = await pool.query<{ d: string; k: string }>(
      `SELECT v.identity_discriminator AS d, i.dedupe_key AS k
       FROM venues v
       LEFT JOIN venue_identity_keys i ON i.venue_id = v.id
       WHERE v.id = $1`,
      [legacyId],
    );
    expect(beforeRekey.rows[0]!.d).toBe("");

    await pool.query(`SELECT venue_rekey_extracted_legacy_discriminators()`);
    const afterRekey = await pool.query<{ d: string }>(
      `SELECT identity_discriminator AS d FROM venues WHERE id = $1`,
      [legacyId],
    );
    expect(afterRekey.rows[0]!.d).toBe("hall:2");

    const proposed = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("hall-reuse")),
      payload: iso.body(name),
    });
    expect(proposed.statusCode).toBe(200);
    expect((proposed.json() as VenueBody).id).toBe(legacyId);
    const count = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM venues WHERE normalized_name = venue_normalize_v1($1)`,
      [name],
    );
    expect(count.rows[0]!.c).toBe(1);
  });

  it("runtime-promotes an unmigrated empty-discriminator hall key and does not silent-merge leftovers", async () => {
    const a = await login("vk");
    const iso = isolated("legacy-runtime");
    const name = `QA Спортзал зал 2 ${iso.token}`;
    const first = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES (
         $1,$2,$3,'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.7,55.8),4326)::geography,
         'unverified','legacy',$4,
         'unverified', venue_normalize_v1($2), venue_normalize_v1($3), ''
       )
       RETURNING id`,
      [MOSCOW_CITY_ID, name, iso.address, a.userId],
    );
    const leftover = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES (
         $1,$2,$3,'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.7,55.8),4326)::geography,
         'unverified','legacy',$4,
         'unverified', venue_normalize_v1($2), venue_normalize_v1($3), ''
       )
       RETURNING id`,
      [MOSCOW_CITY_ID, name, iso.address, a.userId],
    );
    await pool.query(`SELECT venue_backfill_identity_keys()`);
    const firstId = first.rows[0]!.id;
    const leftoverId = leftover.rows[0]!.id;

    const proposed = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("runtime-reuse")),
      payload: iso.body(name),
    });
    expect(proposed.statusCode).toBe(200);
    expect((proposed.json() as VenueBody).id).toBe(firstId);
    const both = await pool.query<{ id: string }>(
      `SELECT id FROM venues WHERE id = ANY($1::uuid[])`,
      [[firstId, leftoverId]],
    );
    expect(both.rows).toHaveLength(2);
    const keys = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM venue_identity_keys k
       INNER JOIN venues v ON v.id = k.venue_id
       WHERE v.name = $1`,
      [name],
    );
    expect(keys.rows[0]!.c).toBe(1);
  });

  it("QA reverify: confirm-distinct reuses a hall cataloged after token issuance", async () => {
    const a = await login("vk");
    const iso = isolated("qa-confirm-hall");
    const name = `QA Спортзал зал 2 ${iso.token}`;
    const neighbor = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("neighbor")),
      payload: iso.body(`QA Спортзал зал 1 ${iso.token}`),
    });
    expect(neighbor.statusCode).toBe(201);
    const fuzzy = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: mutationHeaders(a, iso.key("fuzzy")),
      payload: iso.body(name),
    });
    expect(fuzzy.statusCode).toBe(409);
    const token = (fuzzy.json() as { confirmationToken: string }).confirmationToken;

    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES (
         $1,$2,$3,'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.7,55.8),4326)::geography,
         'unverified','legacy',$4,
         'unverified', venue_normalize_v1($2), venue_normalize_v1($3), ''
       ) RETURNING id`,
      [MOSCOW_CITY_ID, name, iso.address, a.userId],
    );
    await pool.query(`SELECT venue_backfill_identity_keys()`);
    await pool.query(`SELECT venue_rekey_extracted_legacy_discriminators()`);

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: mutationHeaders(a, iso.key("confirm")),
      payload: { ...iso.body(name), confirmationToken: token },
    });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as VenueBody).id).toBe(legacy.rows[0]!.id);
    const count = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM venues WHERE name = $1 AND address = $2`,
      [name, iso.address],
    );
    expect(count.rows[0]!.c).toBe(1);
  });
});
