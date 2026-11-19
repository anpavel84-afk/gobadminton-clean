import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { buildTestCoreModule } from "./test-core.module";
import { execFileSync } from "node:child_process";

/**
 * Native bearer PUT/DELETE/GET /me/cover + owner media read while directory-hidden.
 * Skipped unless RUN_DB_INTEGRATION=1. Cookie cover path remains cover-upload.test.ts.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native cover principal PUT/DELETE/GET foundation", () => {
  let app: NestFastifyApplication;
  let disabledApp: NestFastifyApplication;
  let pool: Pool;
  let png: Buffer;
  const media = path.resolve(__dirname, "../../../../.qa-runtime/native-cover-foundation-media");
  const origin = "https://localhost:3001";
  const clientId = "native.cover.fixture";
  const env = loadEnv({
    NODE_ENV: "test",
    APP_ENV: "local",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton",
    PUBLIC_API_ORIGIN: "https://localhost:3000",
    PUBLIC_WEB_ORIGIN: origin,
    ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true",
    NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake",
    CONTENT_MODERATION_FINGERPRINT_SECRET: "native-cover-synthetic-fingerprint-only",
    AVATAR_MEDIA_ROOT: media,
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: ["https://app.example.test/auth/callback"] }]),
  });
  async function build(enabled: boolean) {
    const module = await Test.createTestingModule({
      imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule, ProfilesModule],
    }).compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    registerAvatarHttp(instance.getHttpAdapter().getInstance());
    await instance.register(cookie);
    instance.setGlobalPrefix("v1");
    instance.useGlobalFilters(new ProblemExceptionFilter());
    await instance.init();
    await instance.getHttpAdapter().getInstance().ready();
    return instance;
  }
  beforeAll(async () => {
    const target = new URL(env.DATABASE_URL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/^\/gobadminton(?:_[a-z0-9_]+)?$/.test(target.pathname)) {
      throw new Error("native-cover foundation requires the local disposable test database");
    }
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: env.DATABASE_URL, PUBLIC_API_ORIGIN: env.PUBLIC_API_ORIGIN, PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin, CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: env.CONTENT_MODERATION_FINGERPRINT_SECRET!, COREPACK_ENABLE_NETWORK: "0" },
      stdio: "inherit",
    });
    pool = createDatabase(env.DATABASE_URL).pool;
    expect((await pool.query("SELECT to_regclass('native_refresh_tokens')::text AS name")).rows[0]?.name).toBe("native_refresh_tokens");
    await mkdir(media, { recursive: true });
    app = await build(true);
    disabledApp = await build(false);
    png = await sharp(randomBytes(600 * 400 * 3), { raw: { width: 600, height: 400, channels: 3 } }).png().toBuffer();
  }, 120_000);
  afterAll(async () => {
    await disabledApp?.close();
    await app?.close();
    await pool?.end();
  });
  async function actor() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Native Cover')", [id]);
    await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url) VALUES ($1::uuid,'yandex','native-cover',$1::text,'https://avatars.yandex.net/native-cover')", [id]);
    const browser = await app.get(SessionService).createConsumerSession(id);
    const issued = await app.get(NativeSessionService).transaction(client => app.get(NativeSessionService).issue(client, id, clientId));
    return {
      id,
      cookie: `${SESSION_COOKIE}=${browser.sessionToken}`,
      csrfToken: browser.csrfToken,
      accessToken: issued.accessToken,
    };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const bearer = (a: Actor, key = randomUUID(), version = 0) => ({
    authorization: `Bearer ${a.accessToken}`,
    "idempotency-key": key,
    "x-profile-version": String(version),
    "content-type": "image/png",
  });
  it("native bearer PUT/GET/DELETE; hidden own media with bearer 200; anonymous 404; negatives", async () => {
    const a = await actor();
    const putKey = randomUUID();
    const put = await app.inject({ method: "PUT", url: "/v1/me/cover", headers: bearer(a, putKey, 0), payload: png });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().cover.uploadedUrl).toMatch(/^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/);
    const version = put.json().version as number;
    const url = put.json().cover.uploadedUrl as string;
    const own = await app.inject({ url: "/v1/me/cover", headers: { authorization: `Bearer ${a.accessToken}` } });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual({ version, cover: { uploadedUrl: url } });
    // Visibility mutation remains cookie-only; hide via SQL so media auth is the subject under test.
    await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1", [a.id]);
    const mediaBearer = await app.inject({ url, headers: { authorization: `Bearer ${a.accessToken}` } });
    expect(mediaBearer.statusCode, mediaBearer.body).toBe(200);
    expect(mediaBearer.headers.vary).toBe("Authorization, Cookie, Accept");
    const mediaAnon = await app.inject({ url });
    expect(mediaAnon.statusCode).toBe(404);
    const anonBody = typeof mediaAnon.json === "function" ? mediaAnon.json() : JSON.parse(mediaAnon.body);
    expect(anonBody.code).toBe("COVER_UNAVAILABLE");
    const delKey = randomUUID();
    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/me/cover",
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        "idempotency-key": delKey,
        "x-profile-version": String(version),
        "content-type": "application/json",
      },
      payload: { expectedVersion: version },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().cover).toEqual({ uploadedUrl: null });
    // Negatives on a fresh actor so CAS state stays independent.
    const n = await actor();
    // No auth + allowed Origin → 401 (session); no Origin → 403 (ORIGIN_REJECTED before session).
    expect((await app.inject({ method: "PUT", url: "/v1/me/cover", headers: { origin, "idempotency-key": randomUUID(), "x-profile-version": "0", "content-type": "image/png" }, payload: png })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/v1/me/cover", headers: { origin, "idempotency-key": randomUUID(), "x-profile-version": "0", "content-type": "application/json" }, payload: { expectedVersion: 0 } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/me/cover", headers: { "idempotency-key": randomUUID(), "x-profile-version": "0", "content-type": "image/png" }, payload: png })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/v1/me/cover", headers: { "idempotency-key": randomUUID(), "x-profile-version": "0", "content-type": "application/json" }, payload: { expectedVersion: 0 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/me/cover", headers: { authorization: "Bearer invalid", "idempotency-key": randomUUID(), "x-profile-version": "0", "content-type": "image/png" }, payload: png })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/me/cover", headers: { ...bearer(n), cookie: n.cookie }, payload: png })).statusCode).toBe(403);
    const first = await app.inject({ method: "PUT", url: "/v1/me/cover", headers: bearer(n, randomUUID(), 0), payload: png });
    expect(first.statusCode, first.body).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/v1/me/cover", headers: bearer(n, randomUUID(), 0), payload: png })).statusCode).toBe(409);
    expect((await disabledApp.inject({ method: "PUT", url: "/v1/me/cover", headers: bearer(n), payload: png })).statusCode).toBe(404);
  });
});
