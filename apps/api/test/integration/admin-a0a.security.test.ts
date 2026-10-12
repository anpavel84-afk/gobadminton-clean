import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_PROVIDER_OVERRIDES } from "../../src/admin/admin-providers";
import {
  adminTransaction,
  bootstrapFirstAdmin,
} from "../../src/admin/admin-db";
import {
  ADMIN_BINDING_COOKIE,
  ADMIN_COOKIE,
  ADMIN_TICKET_COOKIE,
  type AdminRole,
} from "../../src/admin/rbac";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret } from "../../src/auth/crypto";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { buildTestCoreModule } from "./test-core.module";
import { SyntheticAuthenticator } from "./admin-webauthn.fixture";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18540";
const pepper = "a0a-synthetic-admin-pepper-isolated-32-chars";
function cookies(res: { headers: Record<string, unknown> }) {
  const values = res.headers["set-cookie"];
  return Object.fromEntries(
    (Array.isArray(values) ? values : values ? [values] : []).map((v) => {
      const [name, value] = String(v).split(";")[0]!.split("=");
      return [name!, decodeURIComponent(value!)];
    }),
  );
}
type Login = {
  principalId: string;
  token: string;
  csrf: string;
  authenticator: SyntheticAuthenticator;
  sessionId: string;
  version: number;
};
run("Admin A0a isolated identity / WebAuthn / DB authority", () => {
  let app: NestFastifyApplication, pool: Pool, env: AppEnv;
  let identity: VerifiedIdentity;
  let superadmin: Login, otherSuper: Login;
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.PUBLIC_API_ORIGIN = "http://127.0.0.1:18541";
    process.env.PUBLIC_WEB_ORIGIN = "http://127.0.0.1:18542";
    process.env.ALLOWED_WEB_ORIGINS = "http://127.0.0.1:18542";
    env = loadEnv({
      ...process.env,
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
      ADMIN_VK_REDIRECT_URI: origin + "/v1/admin/auth/vk/callback",
      COOKIE_SECURE: "false",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env },
      stdio: "inherit",
    });
    pool = new Pool({ connectionString: env.DATABASE_URL });
    const adapter: AuthProviderAdapter = {
      key: "vk",
      configured: true,
      async startAuthorization(i) {
        return { authorizationUrl: "https://provider.test?state=" + i.state };
      },
      async exchangeCode() {
        return { accessToken: "synthetic-never-audited-token" };
      },
      async fetchVerifiedIdentity() {
        return identity;
      },
    };
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AuthModule, AdminModule],
    })
      .overrideProvider(ADMIN_PROVIDER_OVERRIDES)
      .useValue([adapter])
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    superadmin = await provision(["superadmin"]);
    otherSuper = await provision(["superadmin"]);
  }, 120_000);
  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  async function user() {
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES('A0a synthetic') RETURNING id",
      )
    ).rows[0]!.id;
    const subject = randomUUID();
    await pool.query(
      "INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject) VALUES($1,'vk','a0a:test',$2)",
      [id, subject],
    );
    return {
      id,
      identity: {
        provider: "vk",
        issuerNamespace: "a0a:test",
        subject,
      } as VerifiedIdentity,
    };
  }
  async function oauth(who: VerifiedIdentity) {
    identity = who;
    const start = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/vk/start",
      payload: {},
      headers: { origin },
    });
    expect(start.statusCode).toBe(200);
    const state = new URL(start.json().authorizationUrl).searchParams.get(
      "state",
    )!;
    const callback = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/vk/callback?code=fake&state=" + state,
      cookies: cookies(start),
    });
    return {
      callback,
      ticket: cookies(callback)[ADMIN_TICKET_COOKIE]!,
      csrf: callback.json().csrfToken as string,
      state,
      binding: cookies(start)[ADMIN_BINDING_COOKIE]!,
    };
  }
  async function mfaOptions(
    ticket: string,
    csrf: string,
    purpose = "login",
    activationToken?: string,
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/auth/webauthn/options",
      cookies: { [ADMIN_TICKET_COOKIE]: ticket },
      headers: { origin, "x-csrf-token": csrf },
      payload: { purpose, ...(activationToken ? { activationToken } : {}) },
    });
  }
  async function verify(
    ticket: string,
    csrf: string,
    challengeId: string,
    response: object,
    activationToken?: string,
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/auth/webauthn/verify",
      cookies: { [ADMIN_TICKET_COOKIE]: ticket },
      headers: { origin, "x-csrf-token": csrf },
      payload: {
        challengeId,
        response,
        ...(activationToken ? { activationToken } : {}),
      },
    });
  }
  async function enroll(
    principalId: string,
    who: VerifiedIdentity,
    activationToken: string,
  ) {
    const a = new SyntheticAuthenticator(),
      auth = await oauth(who);
    expect(auth.callback.statusCode).toBe(200);
    const opts = await mfaOptions(
      auth.ticket,
      auth.csrf,
      "enroll",
      activationToken,
    );
    expect(opts.statusCode).toBe(200);
    const verified = await verify(
      auth.ticket,
      auth.csrf,
      opts.json().challengeId,
      a.register(opts.json().options.challenge),
      activationToken,
    );
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toEqual({ mfaEnrolled: true });
    expect(cookies(verified)[ADMIN_COOKIE]).toBeUndefined();
    const assertionOptions = await mfaOptions(auth.ticket, auth.csrf, "login");
    expect(assertionOptions.statusCode).toBe(200);
    const signed = await verify(
      auth.ticket,
      auth.csrf,
      assertionOptions.json().challengeId,
      a.assert(assertionOptions.json().options.challenge),
    );
    expect(signed.statusCode).toBe(200);
    const token = cookies(signed)[ADMIN_COOKIE]!;
    expect(token).toBeTruthy();
    expect(String(signed.headers["set-cookie"])).toMatch(/Secure/);
    expect(String(signed.headers["set-cookie"])).toMatch(/HttpOnly/);
    expect(String(signed.headers["set-cookie"])).not.toMatch(/Domain=/);
    const info = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      cookies: { [ADMIN_COOKIE]: token },
      headers: { origin },
    });
    expect(info.statusCode).toBe(200);
    return {
      principalId,
      token,
      csrf: signed.json().csrfToken,
      authenticator: a,
      sessionId: info.json().sessionId,
      version: info.json().version,
    } as Login;
  }
  async function provision(roles: AdminRole[]) {
    const u = await user(),
      token = randomUUID() + randomUUID();
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",
        [u.id],
      )
    ).rows[0]!.id;
    for (const r of roles)
      await pool.query(
        "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
        [id, r],
      );
    await pool.query(
      "INSERT INTO admin_activation_tokens(principal_id,token_hash) VALUES($1,$2)",
      [id, hashSecret(pepper, token)],
    );
    return enroll(id, u.identity, token);
  }
  function headers(a: Login) {
    return { origin, "x-csrf-token": a.csrf, "idempotency-key": randomUUID() };
  }
  async function command(a: Login, payload: object, key = randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/identity/commands",
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { ...headers(a), "idempotency-key": key },
      payload,
    });
  }
  async function version(id: string) {
    return (
      await pool.query<{ version: number }>(
        "SELECT version FROM admin_principals WHERE id=$1",
        [id],
      )
    ).rows[0]!.version;
  }
  async function stepup(a: Login) {
    const opts = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/webauthn/options",
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: headers(a),
      payload: { purpose: "step_up" },
    });
    expect(opts.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/webauthn/verify",
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: headers(a),
      payload: {
        challengeId: opts.json().challengeId,
        response: a.authenticator.assert(opts.json().options.challenge),
      },
    });
    expect(res.statusCode).toBe(200);
  }
  it("requires preexisting principal; unknown identity creates neither user nor ticket; provider state replay fails", async () => {
    const u = await user();
    const counts = (await pool.query("SELECT count(*) AS n FROM users"))
      .rows[0]!.n;
    const auth = await oauth(u.identity);
    expect(auth.callback.statusCode).toBe(401);
    expect(
      (await pool.query("SELECT count(*) AS n FROM users")).rows[0]!.n,
    ).toBe(counts);
    const replay = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/vk/callback?code=fake&state=" + auth.state,
      cookies: { [ADMIN_BINDING_COOKIE]: auth.binding },
    });
    expect(replay.statusCode).toBe(401);
    expect(
      (
        await pool.query(
          "SELECT count(*) AS n FROM admin_mfa_tickets WHERE principal_id IN (SELECT id FROM admin_principals WHERE user_id=$1)",
          [u.id],
        )
      ).rows[0]!.n,
    ).toBe("0");
  });
  it("consumer cookies/tokens never authorize admin; admin cookies/tokens never authorize consumer", async () => {
    const consumer = await app
      .get(SessionService)
      .createConsumerSession((await user()).id);
    const consumerJars: Record<string, string>[] = [
      { [SESSION_COOKIE]: consumer.sessionToken },
      { [ADMIN_COOKIE]: consumer.sessionToken },
    ];
    for (const jar of consumerJars) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/me",
        cookies: jar,
        headers: { origin },
      });
      expect(res.statusCode).toBe(401);
    }
    const consumerMe = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [ADMIN_COOKIE]: superadmin.token },
    });
    expect(consumerMe.statusCode).toBe(401);
    const forged = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: superadmin.token },
    });
    expect(forged.statusCode).toBe(401);
    const valid = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: consumer.sessionToken },
    });
    expect(valid.statusCode).toBe(200);
  });
  it("rejects missing/wrong Origin, CSRF and wrong cookie namespace on mutations and reads", async () => {
    const payload = {
      action: "create_principal",
      userId: (await user()).id,
      reasonCode: "synthetic_test",
    };
    for (const h of [
      { ...headers(superadmin), origin: "http://127.0.0.1:18542" },
      { ...headers(superadmin), origin: "" },
      { ...headers(superadmin), "x-csrf-token": "wrong" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/identity/commands",
        cookies: { [ADMIN_COOKIE]: superadmin.token },
        headers: h,
        payload,
      });
      expect(res.statusCode).toBe(403);
    }
    const read = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      cookies: { [ADMIN_COOKIE]: superadmin.token },
    });
    expect(read.statusCode).toBe(403);
  });
  it("cross-role matrix denies identity/security audit; additive roles remain current DB truth", async () => {
    for (const role of [
      "content_manager",
      "moderator",
      "support",
    ] as AdminRole[]) {
      const a = await provision([role]);
      const c = await command(a, {
        action: "create_principal",
        userId: (await user()).id,
        reasonCode: "synthetic_test",
      });
      expect(c.statusCode).toBe(403);
      const audit = await app.inject({
        method: "GET",
        url: "/v1/admin/audit/security",
        cookies: { [ADMIN_COOKIE]: a.token },
        headers: { origin },
      });
      expect(audit.statusCode).toBe(403);
    }
    const a = await provision(["content_manager", "support"]);
    await pool.query(
      "UPDATE admin_role_grants SET active=false WHERE principal_id=$1 AND role='support'",
      [a.principalId],
    );
    const me = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
    expect(me.json().roles).toEqual(["content_manager"]);
  });
  it("security audit rechecks withdrawn roles, suspended/revoked principals and expired sessions", async () => {
    async function audit(a: Login) {
      return app.inject({
        method: "GET",
        url: "/v1/admin/audit/security",
        cookies: { [ADMIN_COOKIE]: a.token },
        headers: { origin },
      });
    }
    const a = await provision(["superadmin"]);
    expect((await audit(a)).statusCode).toBe(200);
    await pool.query(
      "UPDATE admin_role_grants SET active=false WHERE principal_id=$1 AND role='superadmin'",
      [a.principalId],
    );
    expect((await audit(a)).statusCode).toBe(403);
    for (const status of ["suspended", "revoked"]) {
      const b = await provision(["superadmin"]);
      expect((await audit(b)).statusCode).toBe(200);
      await pool.query("UPDATE admin_principals SET status=$2 WHERE id=$1", [
        b.principalId, status,
      ]);
      expect((await audit(b)).statusCode).toBe(401);
    }
    const c = await provision(["superadmin"]);
    await pool.query(
      "UPDATE admin_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [c.sessionId],
    );
    expect((await audit(c)).statusCode).toBe(401);
  });
  it("creates pending only, grants fixed roles with version/reason/idempotency and fresh step-up", async () => {
    const u = await user();
    const payload = {
        action: "create_principal",
        userId: u.id,
        reasonCode: "synthetic_test",
      },
      key = randomUUID();
    const first = await command(superadmin, payload, key);
    expect(first.statusCode).toBe(200);
    const p = first.json();
    expect(p.status).toBe("pending_mfa");
    const replay = await command(superadmin, payload, key);
    expect(replay.json()).toEqual(p);
    const changed = await command(
      superadmin,
      { ...payload, userId: (await user()).id },
      key,
    );
    expect(changed.statusCode).toBe(409);
    const before = (
      await pool.query(
        "SELECT count(*) AS n FROM privileged_audit_events WHERE target_id=$1 AND action_key='admin.create_principal'",
        [p.principalId],
      )
    ).rows[0]!.n;
    expect(before).toBe("1");
    const grant = await command(superadmin, {
      action: "role",
      principalId: p.principalId,
      role: "support",
      active: true,
      expectedVersion: p.version,
      reasonCode: "synthetic_test",
    });
    expect(grant.statusCode).toBe(200);
    const stale = await command(superadmin, {
      action: "role",
      principalId: p.principalId,
      role: "moderator",
      active: true,
      expectedVersion: p.version,
      reasonCode: "synthetic_test",
    });
    expect(stale.statusCode).toBe(409);
    await pool.query(
      "UPDATE admin_sessions SET step_up_at=clock_timestamp()-interval '11 minutes' WHERE id=$1",
      [superadmin.sessionId],
    );
    const expired = await command(superadmin, {
      action: "create_principal",
      userId: (await user()).id,
      reasonCode: "synthetic_test",
    });
    expect(expired.statusCode).toBe(403);
    expect(expired.json().code).toBe("ADMIN_STEP_UP_REQUIRED");
    await stepup(superadmin);
    const after = await command(superadmin, {
      action: "create_principal",
      userId: (await user()).id,
      reasonCode: "synthetic_test",
    });
    expect(after.statusCode).toBe(200);
  });
  it("requires activation and cryptographic WebAuthn UV; malformed enrollment burns challenge, pending ticket is never session", async () => {
    const u = await user(),
      a = new SyntheticAuthenticator();
    const created = await command(superadmin, {
      action: "create_principal",
      userId: u.id,
      reasonCode: "synthetic_test",
    });
    const p = created.json();
    const auth = await oauth(u.identity);
    expect(auth.callback.statusCode).toBe(200);
    const access = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      cookies: { [ADMIN_COOKIE]: auth.ticket },
      headers: { origin },
    });
    expect(access.statusCode).toBe(401);
    expect(
      (await mfaOptions(auth.ticket, auth.csrf, "enroll")).statusCode,
    ).toBe(403);
    const opts = await mfaOptions(
      auth.ticket,
      auth.csrf,
      "enroll",
      p.activationToken,
    );
    const invalid = await verify(
      auth.ticket,
      auth.csrf,
      opts.json().challengeId,
      a.register(opts.json().options.challenge, origin, false),
      p.activationToken,
    );
    expect(invalid.statusCode).toBe(401);
    const retry = await verify(
      auth.ticket,
      auth.csrf,
      opts.json().challengeId,
      a.register(opts.json().options.challenge),
      p.activationToken,
    );
    expect(retry.statusCode).toBe(401);
    expect(
      (
        await pool.query("SELECT status FROM admin_principals WHERE id=$1", [
          p.principalId,
        ])
      ).rows[0]!.status,
    ).toBe("pending_mfa");
    const validOpts = await mfaOptions(
      auth.ticket,
      auth.csrf,
      "enroll",
      p.activationToken,
    );
    const valid = await verify(
      auth.ticket,
      auth.csrf,
      validOpts.json().challengeId,
      a.register(validOpts.json().options.challenge),
      p.activationToken,
    );
    expect(valid.statusCode).toBe(200);
  });
  it("assertion verifies RP ID/origin/UV/signature/counter and bound ticket; replay and expired challenge fail closed", async () => {
    const u = await user();
    const p = await command(superadmin, {
      action: "create_principal",
      userId: u.id,
      reasonCode: "synthetic_test",
    });
    const a = await enroll(
      p.json().principalId,
      u.identity,
      p.json().activationToken,
    );
    await stepup(a);
    for (const invalid of [
      { origin: "https://evil.test" },
      { rpId: "evil.test" },
      { uv: false },
      { invalidSignature: true },
      { counter: 0 },
    ]) {
      const auth = await oauth(u.identity),
        opts = await mfaOptions(auth.ticket, auth.csrf);
      const res = await verify(
        auth.ticket,
        auth.csrf,
        opts.json().challengeId,
        a.authenticator.assert(opts.json().options.challenge, invalid),
      );
      expect(res.statusCode).toBe(401);
      const replay = await verify(
        auth.ticket,
        auth.csrf,
        opts.json().challengeId,
        a.authenticator.assert(opts.json().options.challenge),
      );
      expect(replay.statusCode).toBe(401);
    }
    const auth = await oauth(u.identity),
      opts = await mfaOptions(auth.ticket, auth.csrf);
    await pool.query(
      "UPDATE admin_webauthn_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [opts.json().challengeId],
    );
    expect(
      (
        await verify(
          auth.ticket,
          auth.csrf,
          opts.json().challengeId,
          a.authenticator.assert(opts.json().options.challenge),
        )
      ).statusCode,
    ).toBe(401);
    const fresh = await mfaOptions(auth.ticket, auth.csrf),
      response = a.authenticator.assert(fresh.json().options.challenge);
    const foreign = await oauth(u.identity);
    expect(
      (
        await verify(
          foreign.ticket,
          foreign.csrf,
          fresh.json().challengeId,
          response,
        )
      ).statusCode,
    ).toBe(403);
    const concurrent = await Promise.all([
      verify(auth.ticket, auth.csrf, fresh.json().challengeId, response),
      verify(auth.ticket, auth.csrf, fresh.json().challengeId, response),
    ]);
    expect(concurrent.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });
  it("admin session expires and idle/revoked credential fails closed", async () => {
    const a = await provision(["support"]);
    await pool.query(
      "UPDATE admin_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes' WHERE id=$1",
      [a.sessionId],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/auth/me",
          cookies: { [ADMIN_COOKIE]: a.token },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
    await pool.query(
      "UPDATE admin_sessions SET last_seen_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [a.sessionId],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/auth/me",
          cookies: { [ADMIN_COOKIE]: a.token },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
    const b = await provision(["support"]);
    await pool.query(
      "UPDATE admin_webauthn_credentials SET status='revoked' WHERE principal_id=$1",
      [b.principalId],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/auth/me",
          cookies: { [ADMIN_COOKIE]: b.token },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("serializes revoke-before-command race and does not permit stale superadmin session roles", async () => {
    const a = await provision(["superadmin"]),
      u = await user(),
      client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('gobadminton_admin_authority'))",
    );
    await client.query(
      "UPDATE admin_role_grants SET active=false WHERE principal_id=$1 AND role='superadmin'",
      [a.principalId],
    );
    let settled = false;
    const pending = command(a, {
      action: "create_principal",
      userId: u.id,
      reasonCode: "synthetic_test",
    }).then((r) => {
      settled = true;
      return r;
    });
    try {
      await new Promise((r) => setTimeout(r, 80));
      expect(settled).toBe(false);
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    const result = await pending;
    expect(result.statusCode).toBe(403);
    expect(
      (
        await pool.query("SELECT 1 FROM admin_principals WHERE user_id=$1", [
          u.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("rollback on audit failure keeps mutation/session/bootstrap atomic; audit UPDATE/DELETE/TRUNCATE blocked", async () => {
    const u = await user(),
      a = await provision(["support"]);
    await pool.query(
      "CREATE FUNCTION a0a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit unavailable'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER a0a_fail_audit BEFORE INSERT ON privileged_audit_events FOR EACH ROW EXECUTE FUNCTION a0a_fail_audit()",
    );
    try {
      const res = await command(superadmin, {
        action: "create_principal",
        userId: u.id,
        reasonCode: "synthetic_test",
      });
      expect(res.statusCode).toBe(500);
      expect(
        (
          await pool.query("SELECT 1 FROM admin_principals WHERE user_id=$1", [
            u.id,
          ])
        ).rowCount,
      ).toBe(0);
      const logout = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/logout",
        payload: {},
        cookies: { [ADMIN_COOKIE]: a.token },
        headers: headers(a),
      });
      expect(logout.statusCode).toBe(500);
      expect(
        (
          await pool.query(
            "SELECT revoked_at FROM admin_sessions WHERE id=$1",
            [a.sessionId],
          )
        ).rows[0]!.revoked_at,
      ).toBeNull();
    } finally {
      await pool.query(
        "DROP TRIGGER a0a_fail_audit ON privileged_audit_events",
      );
      await pool.query("DROP FUNCTION a0a_fail_audit()");
    }
    for (const sql of [
      "UPDATE privileged_audit_events SET reason_code='tamper'",
      "DELETE FROM privileged_audit_events",
      // A2a history references audit; CASCADE tests the immutable trigger beyond the FK fence.
      "TRUNCATE privileged_audit_events CASCADE",
    ])
      await expect(pool.query(sql)).rejects.toMatchObject({ code: "42501" });
    const content = JSON.stringify(
      (await pool.query("SELECT * FROM privileged_audit_events")).rows,
    );
    expect(content).not.toContain("synthetic-never-audited-token");
    expect(content).not.toContain(pepper);
    expect(content).not.toContain(superadmin.token);
    expect(content).not.toContain(superadmin.csrf);
  });
  it("role changes clear step-up; revoked principal/session/credential and credential IDOR are rejected", async () => {
    const a = await provision(["support"]),
      b = await provision(["support"]);
    const wrong = await command(superadmin, {
      action: "revoke_credential",
      principalId: a.principalId,
      credentialId: b.authenticator.id,
      expectedVersion: await version(a.principalId),
      reasonCode: "synthetic_test",
    });
    expect(wrong.statusCode).toBe(404);
    const grant = await command(superadmin, {
      action: "role",
      principalId: a.principalId,
      role: "superadmin",
      active: true,
      expectedVersion: await version(a.principalId),
      reasonCode: "synthetic_test",
    });
    expect(grant.statusCode).toBe(200);
    const stale = await command(a, {
      action: "create_principal",
      userId: (await user()).id,
      reasonCode: "synthetic_test",
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().code).toBe("ADMIN_STEP_UP_REQUIRED");
    await stepup(a);
    const own = await command(a, {
      action: "create_principal",
      userId: (await user()).id,
      reasonCode: "synthetic_test",
    });
    expect(own.statusCode).toBe(200);
    const revoke = await command(superadmin, {
      action: "status",
      principalId: a.principalId,
      status: "revoked",
      expectedVersion: await version(a.principalId),
      reasonCode: "synthetic_test",
    });
    expect(revoke.statusCode).toBe(200);
    expect(
      (
        await command(a, {
          action: "create_principal",
          userId: (await user()).id,
          reasonCode: "synthetic_test",
        })
      ).statusCode,
    ).toBe(401);
    const logout = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/logout",
      payload: {},
      cookies: { [ADMIN_COOKIE]: b.token },
      headers: headers(b),
    });
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/auth/me",
          cookies: { [ADMIN_COOKIE]: b.token },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("MFA recovery revokes sessions/credentials and issues only pending activation", async () => {
    const a = await provision(["support"]);
    const recovery = await command(superadmin, {
      action: "recover_mfa",
      principalId: a.principalId,
      expectedVersion: await version(a.principalId),
      reasonCode: "synthetic_recovery",
    });
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json().activationToken).toBeTruthy();
    expect(
      (
        await pool.query("SELECT status FROM admin_principals WHERE id=$1", [
          a.principalId,
        ])
      ).rows[0]!.status,
    ).toBe("pending_mfa");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/auth/me",
          cookies: { [ADMIN_COOKIE]: a.token },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("bootstrap one-time exact retries/concurrency, real source primitive only, no second first superadmin", async () => {
    // Isolated schema avoids confusing already-enrolled fixture supers with first bootstrap.
    const schema = "a0a_bootstrap_" + randomUUID().replaceAll("-", "");
    const client = await pool.connect();
    const { readFileSync, readdirSync } = await import("node:fs");
    const root = path.resolve(__dirname, "../../migrations");
    try {
      await client.query("CREATE SCHEMA " + schema);
      await client.query("SET search_path TO " + schema + ",public");
      for (const f of readdirSync(root)
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await client.query(readFileSync(path.join(root, f), "utf8"));
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
    const isolated = new Pool({
      connectionString: env.DATABASE_URL,
      options: "-c search_path=" + schema + ",public",
    });
    try {
      const userId = (
        await isolated.query<{ id: string }>(
          "INSERT INTO users DEFAULT VALUES RETURNING id",
        )
      ).rows[0]!.id;
      const input = {
        userId,
        operationId: randomUUID(),
        activationToken: randomUUID() + randomUUID(),
      };
      const both = await Promise.all([
        bootstrapFirstAdmin(isolated, pepper, input),
        bootstrapFirstAdmin(isolated, pepper, input),
      ]);
      expect(both[0]!.principalId).toBe(both[1]!.principalId);
      expect(both.map((x) => x.replayed).sort()).toEqual([false, true]);
      expect(
        (await isolated.query("SELECT count(*) AS n FROM admin_principals"))
          .rows[0]!.n,
      ).toBe("1");
      await expect(
        bootstrapFirstAdmin(isolated, pepper, {
          ...input,
          operationId: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(
        (
          await isolated.query(
            "SELECT count(*) AS n FROM privileged_audit_events",
          )
        ).rows[0]!.n,
      ).toBe("1");
      expect(
        (await isolated.query("SELECT * FROM admin_sessions")).rowCount,
      ).toBe(0);
      await expect(
        adminTransaction(isolated, async (c) => {
          await c.query("UPDATE admin_principals SET status='active'");
          throw new Error("rollback fixture");
        }),
      ).rejects.toThrow();
      expect(
        (await isolated.query("SELECT status FROM admin_principals")).rows[0]!
          .status,
      ).toBe("pending_mfa");
    } finally {
      await isolated.end();
      await pool.query("DROP SCHEMA " + schema + " CASCADE");
    }
  });
  it("concurrent commands use version fence; last active Superadmin cannot revoke own authority", async () => {
    const a = await provision(["support"]),
      v = await version(a.principalId);
    const outcomes = await Promise.all(
      ["moderator", "content_manager"].map((role) =>
        command(superadmin, {
          action: "role",
          principalId: a.principalId,
          role,
          active: true,
          expectedVersion: v,
          reasonCode: "synthetic_test",
        }),
      ),
    );
    expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    // Synthetic fixture setup temporarily leaves exactly one active Superadmin.
    await pool.query(
      "UPDATE admin_role_grants SET active=false WHERE role='superadmin' AND principal_id<>$1",
      [superadmin.principalId],
    );
    try {
      for (const action of [
        "status",
        "role",
        "revoke_credential",
        "recover_mfa",
      ]) {
        const commandBody = {
          action,
          principalId: superadmin.principalId,
          expectedVersion: await version(superadmin.principalId),
          reasonCode: "synthetic_test",
          ...(action === "status" ? { status: "suspended" } : {}),
          ...(action === "role" ? { role: "superadmin", active: false } : {}),
          ...(action === "revoke_credential"
            ? { credentialId: superadmin.authenticator.id }
            : {}),
        };
        const result = await command(superadmin, commandBody);
        expect(result.statusCode).toBe(409);
        expect(result.json().code).toBe("ADMIN_LAST_SUPERADMIN");
      }
    } finally {
      await pool.query(
        "UPDATE admin_role_grants SET active=true WHERE principal_id=$1 AND role='superadmin'",
        [otherSuper.principalId],
      );
    }
  });
  it("default-disabled module refuses HTTP without touching DB or provider adapters", async () => {
    const disabled = loadEnv({ ...process.env, ADMIN_INTERNAL_ENABLED: "0" });
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(disabled, pool), AdminModule],
    }).compile();
    const closed = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await closed.register(cookie);
    closed.setGlobalPrefix("v1");
    closed.useGlobalFilters(new ProblemExceptionFilter());
    await closed.init();
    await closed.getHttpAdapter().getInstance().ready();
    const before = (
      await pool.query("SELECT count(*) AS n FROM admin_rate_windows")
    ).rows[0]!.n;
    try {
      for (const [method, url, payload] of [
        ["GET", "/v1/admin/auth/me", undefined],
        ["POST", "/v1/admin/auth/webauthn/options", {}],
        ["POST", "/v1/admin/identity/commands", {}],
        ["POST", "/v1/admin/auth/vk/start", undefined],
      ] as const) {
        const res = await closed.inject({
          method,
          url,
          payload,
          headers: { origin },
        });
        expect(res.statusCode).toBe(404);
      }
      expect(
        (await pool.query("SELECT count(*) AS n FROM admin_rate_windows"))
          .rows[0]!.n,
      ).toBe(before);
    } finally {
      await closed.close();
    }
  });
  it("rate-limits auth attempts, exposes no audit mutation/arbitrary editor endpoints", async () => {
    await pool.query(
      "INSERT INTO admin_rate_windows(key_hash,window_start,attempts) VALUES($1,date_trunc('minute',clock_timestamp()),121)",
      [hashSecret(pepper, "ip:127.0.0.1")],
    );
    const limited = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/vk/start",
      payload: {},
      headers: { origin },
    });
    expect(limited.statusCode).toBe(429);
    for (const method of ["PATCH", "DELETE"] as const)
      expect(
        (
          await app.inject({
            method,
            url: "/v1/admin/audit/security",
            headers: headers(superadmin),
            cookies: { [ADMIN_COOKIE]: superadmin.token },
          })
        ).statusCode,
      ).toBe(404);
  });
});
