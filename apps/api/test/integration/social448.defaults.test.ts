import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { deliverEmail } from "../../src/auth/email-delivery";
import { EMAIL_BINDING_COOKIE } from "../../src/auth/email-security";
import { FakeMailTransport } from "../../src/auth/mail-transport";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { DEMO_ISSUER_NAMESPACE } from "../../src/database/demo-ids";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import {
  DIRECTORY_VISIBILITY_PROVENANCE,
  SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
  ensureDefaultSocialProfile,
} from "../../src/profiles/social-profile-defaults";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
  }
  return out;
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

run("Owner #448 social profile defaults", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let env: AppEnv;
  let mail: FakeMailTransport;
  let sessions: SessionService;

  const oauthIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:social448",
    subject: uniqueSuffix("s448-oauth"),
    email: `s448-oauth-${uniqueSuffix("m")}@example.com`,
    displayName: "Social448 OAuth Name",
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      ALLOWED_WEB_ORIGINS: origin,
      AUTH_PEPPER: "social448-auth-pepper-32chars!!!!",
      COOKIE_SECURE: "false",
      VK_CLIENT_ID: "vk-test",
      VK_CLIENT_SECRET: "vk-secret",
      VK_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/vk/callback",
      YANDEX_CLIENT_ID: "ya-test",
      YANDEX_CLIENT_SECRET: "ya-secret",
      YANDEX_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/yandex/callback",
      EMAIL_AUTH_TRANSPORT: "fake",
      EMAIL_AUTH_HMAC_SECRET: "social448-hmac-secret-only-32chars!",
      EMAIL_AUTH_ENCRYPTION_SECRET: "social448-encrypt-secret-only-32ch!",
      EMAIL_AUTH_RATE_SECRET: "social448-rate-secret-only-32chars!",
      GIT_SHA: "integration-social448",
      SOCIAL_DIRECTORY_ENABLED: "1",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    env = loadEnv(process.env);
    pool = createDatabase(env.DATABASE_URL).pool;
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AuthModule,
        ProfilesModule,
        SafetyModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(oauthIdentity)])
      .compile();
    mail = moduleRef.get(FakeMailTransport);
    sessions = moduleRef.get(SessionService);
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function oauthLogin(): Promise<{
    userId: string;
    cookies: Record<string, string>;
    csrfToken: string;
  }> {
    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/profile",
    });
    expect(start.statusCode).toBe(200);
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const state = new URL(String(start.json().authorizationUrl)).searchParams.get(
      "state",
    )!;
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=test-code&state=${encodeURIComponent(state)}&device_id=s448`,
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
    return {
      userId: me.json().id as string,
      cookies: sessionCookies,
      csrfToken: me.json().csrfToken as string,
    };
  }

  async function emailSignup(email: string) {
    const headers = { origin, "x-gb-email-auth": "1" };
    const issued = await app.inject({
      method: "POST",
      url: "/v1/auth/email/challenges",
      headers,
      payload: { email, returnPath: "/profile" },
    });
    expect(issued.statusCode).toBe(202);
    const id = issued.json().challengeId as string;
    const binding = parseSetCookie(issued.headers["set-cookie"])[EMAIL_BINDING_COOKIE];
    await deliverEmail({
      pool,
      env,
      transport: mail,
      payload: { challengeId: id, generation: 1 },
    });
    const code = mail.read(`${id}:1`)?.code;
    expect(code).toMatch(/^\d{8}$/);
    const verified = await app.inject({
      method: "POST",
      url: `/v1/auth/email/challenges/${id}/verify`,
      headers,
      payload: { code },
      cookies: { [EMAIL_BINDING_COOKIE]: binding! },
    });
    expect(verified.statusCode).toBe(200);
    const session = parseSetCookie(verified.headers["set-cookie"]);
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: session,
    });
    expect(me.statusCode).toBe(200);
    return {
      userId: me.json().id as string,
      cookies: session,
      csrfToken: me.json().csrfToken as string,
      email,
    };
  }

  it("OAuth signup materializes directory ON + requests without fake city/consent or email name", async () => {
    const session = await oauthLogin();
    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      directoryVisible: true,
      contactPolicy: "requests",
      cityId: null,
      consentPolicyVersion: null,
      optedInAt: null,
      displayName: "Social448 OAuth Name",
    });
    const wire = JSON.stringify(own.json());
    expect(wire).not.toContain(oauthIdentity.email);
    expect(wire).not.toContain(session.userId);

    const row = await pool.query<{
      directory_visible: boolean;
      contact_policy: string;
      directory_visibility_provenance: string;
      city_id: string | null;
      consent_policy_version: string | null;
      opted_in_at: Date | null;
      display_name: string;
    }>("SELECT directory_visible, contact_policy, directory_visibility_provenance, city_id, consent_policy_version, opted_in_at, display_name FROM player_social_profiles WHERE user_id=$1", [
      session.userId,
    ]);
    expect(row.rows[0]).toMatchObject({
      directory_visible: true,
      contact_policy: "requests",
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
      city_id: null,
      consent_policy_version: null,
      opted_in_at: null,
      display_name: "Social448 OAuth Name",
    });
  });

  it("email signup defaults ON with Игрок and never leaks mailbox as public name", async () => {
    const email = `s448-${randomUUID()}@example.test`;
    const session = await emailSignup(email);
    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      directoryVisible: true,
      contactPolicy: "requests",
      displayName: SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
      cityId: null,
      consentPolicyVersion: null,
      optedInAt: null,
    });
    expect(JSON.stringify(own.json())).not.toContain(email);
    const users = await pool.query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE id=$1",
      [session.userId],
    );
    expect(users.rows[0]!.display_name).toBe(SOCIAL_PROFILE_SAFE_DISPLAY_NAME);
  });

  it("missing old profile initializes once; explicit OFF survives ensure/retry", async () => {
    const userId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name,locale) VALUES('Legacy Missing','ru') RETURNING id",
      )
    ).rows[0]!.id;

    await ensureDefaultSocialProfile(pool, {
      userId,
      displayName: "Legacy Missing",
    });
    const first = await pool.query(
      "SELECT directory_visible, contact_policy, directory_visibility_provenance, version FROM player_social_profiles WHERE user_id=$1",
      [userId],
    );
    expect(first.rows[0]).toMatchObject({
      directory_visible: true,
      contact_policy: "requests",
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
      version: 1,
    });

    await pool.query(
      `UPDATE player_social_profiles
       SET directory_visible=false,
           contact_policy='closed',
           directory_visibility_provenance=$2,
           version = version + 1
       WHERE user_id=$1`,
      [userId, DIRECTORY_VISIBILITY_PROVENANCE.USER_OPT_OUT],
    );

    await ensureDefaultSocialProfile(pool, { userId, displayName: "Should Not Win" });
    await ensureDefaultSocialProfile(pool, { userId, displayName: "Should Not Win" });
    const retained = await pool.query<{
      directory_visible: boolean;
      contact_policy: string;
      directory_visibility_provenance: string;
      display_name: string;
      version: number;
    }>(
      "SELECT directory_visible, contact_policy, directory_visibility_provenance, display_name, version FROM player_social_profiles WHERE user_id=$1",
      [userId],
    );
    expect(retained.rows[0]).toMatchObject({
      directory_visible: false,
      contact_policy: "closed",
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.USER_OPT_OUT,
      display_name: "Legacy Missing",
      version: 2,
    });
  });

  it("directory hide, user block, and restricted actor fences stay negative", async () => {
    const viewerId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES('S448 Viewer') RETURNING id",
      )
    ).rows[0]!.id;
    await ensureDefaultSocialProfile(pool, {
      userId: viewerId,
      displayName: "S448 Viewer",
    });
    const targetId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES('S448 Target') RETURNING id",
      )
    ).rows[0]!.id;
    await ensureDefaultSocialProfile(pool, {
      userId: targetId,
      displayName: "S448 Target",
    });
    const targetPublic = (
      await pool.query<{ public_player_id: string; version: number }>(
        "SELECT public_player_id, version FROM player_social_profiles WHERE user_id=$1",
        [targetId],
      )
    ).rows[0]!;

    await pool.query(
      `UPDATE player_social_profiles
       SET directory_visible=false,
           directory_visibility_provenance=$2,
           version = version + 1
       WHERE user_id=$1`,
      [targetId, DIRECTORY_VISIBILITY_PROVENANCE.USER_OPT_OUT],
    );
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/players/${targetPublic.public_player_id}`,
    });
    expect(hidden.statusCode).toBe(404);

    await pool.query(
      `UPDATE player_social_profiles
       SET directory_visible=true,
           directory_visibility_provenance=$2,
           version = version + 1
       WHERE user_id=$1`,
      [targetId, DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT],
    );
    const low = viewerId < targetId ? viewerId : targetId;
    const high = viewerId < targetId ? targetId : viewerId;
    const pair = await pool.query<{ id: string }>(
      `INSERT INTO social_pairs(user_low, user_high) VALUES($1,$2)
       ON CONFLICT (user_low, user_high) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [low, high],
    );
    await pool.query(
      `INSERT INTO user_blocks(blocker_user_id, blocked_user_id, pair_id)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [viewerId, targetId, pair.rows[0]!.id],
    );
    const issued = await sessions.createConsumerSession(viewerId);
    const blocked = await app.inject({
      method: "GET",
      url: `/v1/players/${targetPublic.public_player_id}`,
      cookies: { [SESSION_COOKIE]: issued.sessionToken },
    });
    expect(blocked.statusCode).toBe(404);

    await pool.query(
      "DELETE FROM user_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2",
      [viewerId, targetId],
    );
    // Ineligible / restricted actor gate (social_eligible) — always enforced without Admin simulation flags.
    await pool.query(
      "UPDATE player_social_profiles SET social_eligible=false WHERE user_id=$1",
      [targetId],
    );
    const restricted = await app.inject({
      method: "GET",
      url: `/v1/players/${targetPublic.public_player_id}`,
      cookies: { [SESSION_COOKIE]: issued.sessionToken },
    });
    expect(restricted.statusCode).toBe(404);
  });

  it("ensure normalizes email-shaped automatic name; never fabricates consent", async () => {
    const userId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name,locale) VALUES($1,'ru') RETURNING id",
        ["mailbox.user@example.test"],
      )
    ).rows[0]!.id;
    await ensureDefaultSocialProfile(pool, {
      userId,
      displayName: "mailbox.user@example.test",
    });
    const row = await pool.query<{
      display_name: string;
      city_id: string | null;
      consent_policy_version: string | null;
      opted_in_at: Date | null;
      directory_visibility_provenance: string;
    }>(
      `SELECT display_name, city_id, consent_policy_version, opted_in_at,
              directory_visibility_provenance
       FROM player_social_profiles WHERE user_id=$1`,
      [userId],
    );
    expect(row.rows[0]).toMatchObject({
      display_name: SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
      city_id: null,
      consent_policy_version: null,
      opted_in_at: null,
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
    });
  });

  it("scoped demo/pristine enable is CAS-once; modified and explicit OFF stay off", async () => {
    // Demo-shaped private closed fixture (operator cohort identity guards).
    const demoUserId = "d0f00001-0000-4000-8000-00000000a448";
    await pool.query("DELETE FROM player_social_profiles WHERE user_id=$1", [
      demoUserId,
    ]);
    await pool.query("DELETE FROM external_identities WHERE user_id=$1", [
      demoUserId,
    ]);
    await pool.query("DELETE FROM users WHERE id=$1", [demoUserId]);
    await pool.query(
      `INSERT INTO users(id, display_name, locale, status)
       VALUES($1,'Demo Private 448','ru','active')`,
      [demoUserId],
    );
    await pool.query(
      `INSERT INTO external_identities
         (id, user_id, provider_key, issuer_namespace, subject, email, display_name)
       VALUES($1,$2,'vk',$3,'s448-demo-private',NULL,'Demo Private 448')`,
      [
        "d0f00002-0000-4000-8000-00000000a448",
        demoUserId,
        DEMO_ISSUER_NAMESPACE,
      ],
    );
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, display_name, directory_visible, contact_policy,
         directory_visibility_provenance, social_eligible, version, social_action_epoch
       ) VALUES ($1,'Demo Private 448', false, 'closed', $2, false, 1, 1)`,
      [demoUserId, DIRECTORY_VISIBILITY_PROVENANCE.LEGACY],
    );

    const enableDemoSql = `
      UPDATE player_social_profiles AS p
      SET directory_visible = true,
          contact_policy = 'requests',
          directory_visibility_provenance = CASE
            WHEN p.directory_visible = true
              AND p.consent_policy_version IS NOT NULL
              AND p.opted_in_at IS NOT NULL
              THEN 'user_consent'
            ELSE 'owner_default'
          END,
          version = p.version + 1,
          updated_at = now()
      WHERE p.user_id::text ~* '^d0f00001-0000-4000-8000-[0-9a-f]{12}$'
        AND p.version = 1
        AND p.social_action_epoch = 1
        AND (p.directory_visible = false OR p.contact_policy = 'closed')
        AND EXISTS (
          SELECT 1 FROM external_identities ei
          WHERE ei.user_id = p.user_id
            AND ei.issuer_namespace = '${DEMO_ISSUER_NAMESPACE}'
        )
        AND p.user_id = $1`;
    const first = await pool.query(enableDemoSql, [demoUserId]);
    expect(first.rowCount).toBe(1);
    const afterDemo = await pool.query<{
      directory_visible: boolean;
      contact_policy: string;
      social_eligible: boolean;
      version: number;
      social_action_epoch: string;
      directory_visibility_provenance: string;
    }>(
      `SELECT directory_visible, contact_policy, social_eligible, version,
              social_action_epoch::text, directory_visibility_provenance
       FROM player_social_profiles WHERE user_id=$1`,
      [demoUserId],
    );
    expect(afterDemo.rows[0]).toMatchObject({
      directory_visible: true,
      contact_policy: "requests",
      social_eligible: false,
      version: 2,
      social_action_epoch: "1",
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
    });
    const repeat = await pool.query(enableDemoSql, [demoUserId]);
    expect(repeat.rowCount).toBe(0);

    // Pristine non-demo hidden (contact stays requests; directory enables once).
    const pristineId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name,locale) VALUES('Pristine Hidden','ru') RETURNING id",
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, display_name, directory_visible, contact_policy,
         directory_visibility_provenance, version, social_action_epoch
       ) VALUES ($1,'Pristine Hidden', false, 'requests', $2, 1, 1)`,
      [pristineId, DIRECTORY_VISIBILITY_PROVENANCE.LEGACY],
    );
    const enablePristineSql = `
      UPDATE player_social_profiles AS p
      SET directory_visible = true,
          directory_visibility_provenance = 'owner_default',
          version = p.version + 1,
          updated_at = now()
      WHERE p.user_id = $1
        AND p.directory_visible = false
        AND p.directory_visibility_provenance = 'legacy'
        AND p.version = 1
        AND p.social_action_epoch = 1
        AND p.consent_policy_version IS NULL
        AND p.opted_in_at IS NULL
        AND p.user_id::text !~* '^d0f00001-0000-4000-8000-[0-9a-f]{12}$'`;
    expect((await pool.query(enablePristineSql, [pristineId])).rowCount).toBe(1);
    expect((await pool.query(enablePristineSql, [pristineId])).rowCount).toBe(0);

    // Modified / explicit OFF must not be re-enabled by ensure or version=1 CAS.
    const modifiedId = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name,locale) VALUES('Modified Off','ru') RETURNING id",
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, display_name, directory_visible, contact_policy,
         directory_visibility_provenance, version, social_action_epoch
       ) VALUES ($1,'Modified Off', false, 'closed', $2, 26, 1)`,
      [modifiedId, DIRECTORY_VISIBILITY_PROVENANCE.USER_OPT_OUT],
    );
    await ensureDefaultSocialProfile(pool, {
      userId: modifiedId,
      displayName: "Should Not Win",
    });
    expect((await pool.query(enablePristineSql, [modifiedId])).rowCount).toBe(0);
    expect((await pool.query(enableDemoSql, [modifiedId])).rowCount).toBe(0);
    const retained = await pool.query(
      `SELECT directory_visible, contact_policy, directory_visibility_provenance, version, display_name
       FROM player_social_profiles WHERE user_id=$1`,
      [modifiedId],
    );
    expect(retained.rows[0]).toMatchObject({
      directory_visible: false,
      contact_policy: "closed",
      directory_visibility_provenance: DIRECTORY_VISIBILITY_PROVENANCE.USER_OPT_OUT,
      version: 26,
      display_name: "Modified Off",
    });
  });
});
