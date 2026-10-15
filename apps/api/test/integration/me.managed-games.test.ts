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
import { SESSION_COOKIE } from "../../src/auth/constants";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GameAuthorityService } from "../../src/games/game-authority.service";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
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

type ManagedGameItem = {
  id: string;
  status: string;
  visibility: string;
  management: { role: string; createdByMe: boolean };
};

describeIntegration("GET /v1/me/games managed games read contract", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:mgapi",
    subject: uniqueSuffix("owner-mgapi"),
    email: "owner-mgapi@example.com",
    displayName: "Owner MGAPI",
  };
  const otherIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:mgapi",
    subject: uniqueSuffix("other-mgapi"),
    email: "other-mgapi@example.com",
    displayName: "Other MGAPI",
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
    process.env.GIT_SHA = "integration-mgapi";

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
        GamesModule,
        ParticipationsModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(otherIdentity)])
      .compile();

    gameAuthority = moduleRef.get(GameAuthorityService);

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
    expect(sessionCookies[SESSION_COOKIE]).toBeTruthy();
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

  async function createVenue(owner: Session, suffix: string): Promise<string> {
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "MGAPI Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    return (venueRes.json() as { id: string }).id;
  }

  async function createDraft(
    owner: Session,
    venueId: string,
    opts: { title: string; visibility?: "public" | "unlisted"; suffix: string },
  ) {
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${opts.suffix}-abcdefgh`),
      payload: baseGamePayload(venueId, {
        title: opts.title,
        visibility: opts.visibility ?? "public",
        hostDisplayName: `Host ${opts.title}`,
      }),
    });
    expect(draftRes.statusCode).toBe(201);
    return draftRes.json() as { id: string; version: number; status: string };
  }

  it("lists own draft/unlisted, excludes foreign/revoked, preserves discovery", async () => {
    const owner = await login("vk");
    const other = await login("yandex");
    expect(owner.userId).not.toBe(other.userId);

    const unauth = await app.inject({ method: "GET", url: "/v1/me/games" });
    expect(unauth.statusCode).toBe(401);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const venueId = await createVenue(owner, suffix);

    const draft = await createDraft(owner, venueId, {
      title: `MGAPI draft ${suffix}`,
      visibility: "unlisted",
      suffix: `${suffix}-d`,
    });
    expect(draft.status).toBe("draft");

    const publishedDraft = await createDraft(owner, venueId, {
      title: `MGAPI published ${suffix}`,
      visibility: "public",
      suffix: `${suffix}-p`,
    });
    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${publishedDraft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: publishedDraft.version },
    });
    expect(publishedRes.statusCode).toBe(200);

    // Synthetic DB fixture only: exercise real game HTTP boundaries with current creator media.
    const avatarKey = "a".repeat(64) + ".png";
    await pool.query(`INSERT INTO player_social_profiles(user_id, display_name, directory_visible, social_eligible, avatar_key)
      VALUES ($1, 'Avatar Creator', true, true, $2)
      ON CONFLICT(user_id) DO UPDATE SET directory_visible=true, social_eligible=true, avatar_key=$2`, [owner.userId, avatarKey]);
    const readAvatar = async (url: string, cookie = owner.cookie) => {
      const res = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const item = body.items ? body.items.find((g: { id: string }) => g.id === publishedDraft.id) : body;
      expect(item).toBeTruthy();
      return item.organizer.avatar;
    };
    const boundaries = [`/v1/games/${publishedDraft.id}`, `/v1/games?venueId=${venueId}`, "/v1/me/games?limit=100"];
    try {
      for (const url of boundaries) expect((await readAvatar(url)).uploadedUrl).toBe(`/v1/media/avatars/${avatarKey}`);
      const replacement = "b".repeat(64) + ".png";
      await pool.query("UPDATE player_social_profiles SET avatar_key=$2 WHERE user_id=$1", [owner.userId, replacement]);
      for (const url of boundaries) expect((await readAvatar(url)).uploadedUrl).toBe(`/v1/media/avatars/${replacement}`);
      await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1", [owner.userId]);
      for (const url of boundaries) expect(await readAvatar(url)).toEqual({ uploadedUrl: null, providerUrl: null });
      await pool.query("UPDATE player_social_profiles SET directory_visible=true, avatar_key=NULL WHERE user_id=$1", [owner.userId]);
      for (const url of boundaries) expect((await readAvatar(url)).uploadedUrl).toBeNull();
      await pool.query("UPDATE player_social_profiles SET avatar_key=$2 WHERE user_id=$1", [owner.userId, replacement]);
      await pool.query("INSERT INTO user_blocks(blocker_user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [other.userId, owner.userId]);
      for (const url of boundaries.slice(0, 2)) expect(await readAvatar(url, other.cookie)).toEqual({ uploadedUrl: null, providerUrl: null });
    } finally {
      await pool.query("DELETE FROM user_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2", [other.userId, owner.userId]);
      await pool.query("UPDATE player_social_profiles SET avatar_key=NULL WHERE user_id=$1", [owner.userId]);
    }

    const foreignDraft = await createDraft(other, venueId, {
      title: `MGAPI foreign ${suffix}`,
      suffix: `${suffix}-f`,
    });

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/games?limit=100",
      headers: { cookie: owner.cookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["cache-control"]).toBe("no-store");
    const mineBody = mine.json() as {
      items: ManagedGameItem[];
      nextCursor: string | null;
    };
    const mineIds = mineBody.items.map((item) => item.id);
    expect(mineIds).toContain(draft.id);
    expect(mineIds).toContain(publishedDraft.id);
    expect(mineIds).not.toContain(foreignDraft.id);

    const draftItem = mineBody.items.find((item) => item.id === draft.id)!;
    expect(draftItem.status).toBe("draft");
    expect(draftItem.visibility).toBe("unlisted");
    expect(draftItem.management).toEqual({ role: "owner", createdByMe: true });
    expect(
      (draftItem as ManagedGameItem & { applicants?: unknown }).applicants,
    ).toBeUndefined();
    expect(
      (draftItem as ManagedGameItem & { requestCount?: unknown }).requestCount,
    ).toBeUndefined();

    // userId query must not change the authoritative session projection.
    const spoof = await app.inject({
      method: "GET",
      url: `/v1/me/games?userId=${encodeURIComponent(other.userId)}`,
      headers: { cookie: owner.cookie },
    });
    expect(spoof.statusCode).toBe(200);
    const spoofIds = (spoof.json() as { items: ManagedGameItem[] }).items.map(
      (item) => item.id,
    );
    expect(spoofIds).toEqual(mineIds);
    expect(spoofIds).not.toContain(foreignDraft.id);

    const otherList = await app.inject({
      method: "GET",
      url: "/v1/me/games",
      headers: { cookie: other.cookie },
    });
    expect(otherList.statusCode).toBe(200);
    const otherIds = (otherList.json() as { items: ManagedGameItem[] }).items.map(
      (item) => item.id,
    );
    expect(otherIds).toContain(foreignDraft.id);
    expect(otherIds).not.toContain(draft.id);
    expect(otherIds).not.toContain(publishedDraft.id);

    // Non-creator active manager sees the game with createdByMe=false.
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'manager', 'active')
       ON CONFLICT (game_id, user_id) DO UPDATE
         SET role = 'manager', status = 'active', revoked_at = NULL, updated_at = now()`,
      [draft.id, other.userId],
    );
    const otherAsManager = await app.inject({
      method: "GET",
      url: "/v1/me/games",
      headers: { cookie: other.cookie },
    });
    const managerItem = (
      otherAsManager.json() as { items: ManagedGameItem[] }
    ).items.find((item) => item.id === draft.id);
    expect(managerItem).toBeTruthy();
    // A manager's own photo must never replace the creator's current avatar.
    await pool.query(`INSERT INTO player_social_profiles(user_id, display_name, avatar_key)
      VALUES ($1, 'Different Manager', $2) ON CONFLICT(user_id) DO UPDATE SET avatar_key=$2`, [other.userId, "c".repeat(64) + ".png"]);
    const managerRead = await app.inject({ method: "GET", url: "/v1/me/games", headers: { cookie: other.cookie } });
    const managedAvatar = managerRead.json().items.find((item: { id: string }) => item.id === draft.id).organizer.avatar;
    expect(managedAvatar.uploadedUrl).toBeNull();
    expect(JSON.stringify(managedAvatar)).not.toContain("c".repeat(64));
    await pool.query("UPDATE player_social_profiles SET avatar_key=NULL WHERE user_id=$1", [other.userId]);
    expect(managerItem!.management).toEqual({
      role: "manager",
      createdByMe: false,
    });

    await gameAuthority.revokeForTests(draft.id, owner.userId);
    const afterRevoke = await app.inject({
      method: "GET",
      url: "/v1/me/games",
      headers: { cookie: owner.cookie },
    });
    const afterRevokeIds = (
      afterRevoke.json() as { items: ManagedGameItem[] }
    ).items.map((item) => item.id);
    expect(afterRevokeIds).not.toContain(draft.id);
    expect(afterRevokeIds).toContain(publishedDraft.id);

    // Public discovery must still exclude drafts/unlisted and ignore private management.
    const discovery = await app.inject({
      method: "GET",
      url: "/v1/games?limit=100",
    });
    expect(discovery.statusCode).toBe(200);
    const discoveryIds = (
      discovery.json() as { items: { id: string }[] }
    ).items.map((item) => item.id);
    expect(discoveryIds).toContain(publishedDraft.id);
    expect(discoveryIds).not.toContain(draft.id);
    expect(discoveryIds).not.toContain(foreignDraft.id);
  }, 120_000);
});

function baseGamePayload(venueId: string, overrides: Record<string, unknown>) {
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
  return {
    hostDisplayName: "MGAPI Host",
    hostPublicContact: "telegram:@mgapi",
    venueId,
    title: "MGAPI doubles",
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
      terms: "Court terms arranged outside the platform",
    },
    ...overrides,
  };
}
