import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { SessionService } from "../../src/auth/session.service";
import { COMMENT_PHOTO_RIGHTS } from "../../src/comments/comment-photos";
import { CommentsModule } from "../../src/comments/comments.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { MODERATION_PROVIDER, safeImageDecision } from "../../src/moderation/provider";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { buildTestCoreModule } from "./test-core.module";
import { execFileSync } from "node:child_process";

/**
 * Native bearer opt-in on the 4 private comment-photo routes (#598 part B step 1).
 * Author does not execute DB; skipped unless RUN_DB_INTEGRATION=1.
 * Cookie Origin/CSRF path remains covered by comment-photos.disposable; this suite adds principal parity.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native comment-photos principal upload/status/content/withdraw foundation", () => {
  let app: NestFastifyApplication;
  let disabledApp: NestFastifyApplication;
  let pool: Pool;
  let png: Buffer;
  let provider: FakeModerationProvider;
  const media = path.resolve(__dirname, "../../../../.qa-runtime/native-comment-photos-foundation-media");
  const origin = "https://localhost:3001";
  const clientId = "native.comment-photos.fixture";
  const env = loadEnv({
    NODE_ENV: "test",
    APP_ENV: "local",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton",
    PUBLIC_API_ORIGIN: "https://localhost:3000",
    PUBLIC_WEB_ORIGIN: origin,
    ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true",
    NATIVE_AUTH_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake",
    CONTENT_MODERATION_FINGERPRINT_SECRET: "native-comment-photos-synthetic-fingerprint-only",
    AVATAR_MEDIA_ROOT: media,
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: ["https://app.example.test/auth/callback"] }]),
  });
  async function build(enabled: boolean) {
    provider = new FakeModerationProvider({ ...env, NATIVE_AUTH_ENABLED: enabled });
    provider.fixture = async () => safeImageDecision();
    const module = await Test.createTestingModule({
      imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule, CommentsModule],
    }).overrideProvider(MODERATION_PROVIDER).useValue(provider).compile();
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
      throw new Error("native comment-photos foundation requires the local disposable test database");
    }
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_ENV: "local",
        DATABASE_URL: env.DATABASE_URL,
        PUBLIC_API_ORIGIN: env.PUBLIC_API_ORIGIN,
        PUBLIC_WEB_ORIGIN: origin,
        ALLOWED_WEB_ORIGINS: origin,
        CONTENT_MODERATION_PROVIDER: "fake",
        CONTENT_MODERATION_FINGERPRINT_SECRET: env.CONTENT_MODERATION_FINGERPRINT_SECRET!,
        COREPACK_ENABLE_NETWORK: "0",
      },
      stdio: "inherit",
    });
    pool = createDatabase(env.DATABASE_URL).pool;
    expect((await pool.query("SELECT to_regclass('native_refresh_tokens')::text AS name")).rows[0]?.name).toBe("native_refresh_tokens");
    expect((await pool.query("SELECT to_regclass('venue_photo_submissions')::text AS name")).rows[0]?.name).toBe("venue_photo_submissions");
    await mkdir(media, { recursive: true });
    app = await build(true);
    disabledApp = await build(false);
    png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "red" } }).png().toBuffer();
  }, 120_000);
  afterAll(async () => {
    await disabledApp?.close();
    await app?.close();
    await pool?.end();
    await rm(media, { recursive: true, force: true }).catch(() => undefined);
  });
  async function actor() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Native Comment Photo')", [id]);
    await pool.query(
      "INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url) VALUES ($1::uuid,'yandex','native-comment-photos',$1::text,'https://avatars.yandex.net/native-comment-photos')",
      [id],
    );
    const browser = await app.get(SessionService).createConsumerSession(id);
    const issued = await app.get(NativeSessionService).transaction(client =>
      app.get(NativeSessionService).issue(client, id, clientId),
    );
    return {
      id,
      cookie: `${SESSION_COOKIE}=${browser.sessionToken}`,
      csrfToken: browser.csrfToken,
      accessToken: issued.accessToken,
    };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function newVenue(who: Actor): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      SELECT id,$1,'Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$2,'unverified',venue_normalize_v1($1),venue_normalize_v1('Synthetic address')
      FROM cities LIMIT 1 RETURNING id`,
      [`Native photo venue ${randomUUID()}`, who.id],
    );
    return row.rows[0]!.id;
  }
  const key = () => `native-photo-${randomUUID()}`;
  const bearer = (a: Actor, idem = key()) => ({
    authorization: `Bearer ${a.accessToken}`,
    "idempotency-key": idem,
    "content-type": "image/png",
    "x-photo-rights": COMMENT_PHOTO_RIGHTS,
  });
  const browser = (a: Actor, idem = key()) => ({
    origin,
    cookie: a.cookie,
    "x-csrf-token": a.csrfToken,
    "idempotency-key": idem,
    "content-type": "image/png",
    "x-photo-rights": COMMENT_PHOTO_RIGHTS,
  });
  function uploadUrl(venueId: string) {
    return `/v1/venues/${venueId}/comment-photos`;
  }
  function statusUrl(id: string) {
    return `/v1/me/venue-photo-submissions/${id}`;
  }
  function contentUrl(id: string) {
    return `/v1/me/venue-photo-submissions/${id}/content`;
  }

  it("native bearer upload/status/content/withdraw with idempotent replay; cookie CSRF and negatives", async () => {
    const a = await actor();
    const venueId = await newVenue(a);
    const putKey = key();
    const uploaded = await app.inject({
      method: "POST",
      url: uploadUrl(venueId),
      headers: bearer(a, putKey),
      payload: png,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const receipt = uploaded.json<{ id: string; status: string; previewPath: string | null; version: number }>();
    expect(receipt.status).toBe("ready");
    expect(receipt.previewPath).toBe(contentUrl(receipt.id));
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(venueId),
      headers: bearer(a, putKey),
      payload: png,
    })).json()).toEqual(receipt);

    const status = await app.inject({
      url: statusUrl(receipt.id),
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({ id: receipt.id, status: "ready", version: 1 });

    const content = await app.inject({
      url: contentUrl(receipt.id),
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(content.statusCode, content.body).toBe(200);
    expect(content.headers["cache-control"]).toBe("no-store");
    expect(await sharp(content.rawPayload).metadata()).toMatchObject({ format: "png", width: 900, height: 600 });

    const delKey = key();
    const withdrawn = await app.inject({
      method: "DELETE",
      url: statusUrl(receipt.id),
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        "idempotency-key": delKey,
        "x-photo-version": "1",
        "content-type": "application/json",
      },
      payload: { expectedVersion: 1 },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(withdrawn.json()).toMatchObject({ id: receipt.id, status: "withdrawn", version: 2, previewPath: null });
    expect((await app.inject({
      method: "DELETE",
      url: statusUrl(receipt.id),
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        "idempotency-key": delKey,
        "x-photo-version": "1",
        "content-type": "application/json",
      },
      payload: { expectedVersion: 1 },
    })).json()).toEqual(withdrawn.json());

    // No credentials → 401 (mutations with Origin+CSRF but no session; GETs bare).
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(venueId),
      headers: {
        origin,
        "x-csrf-token": "any-nonempty-csrf",
        "idempotency-key": key(),
        "content-type": "image/png",
        "x-photo-rights": COMMENT_PHOTO_RIGHTS,
      },
      payload: png,
    })).statusCode).toBe(401);
    expect((await app.inject({ url: statusUrl(receipt.id) })).statusCode).toBe(401);
    expect((await app.inject({ url: contentUrl(receipt.id) })).statusCode).toBe(401);
    expect((await app.inject({
      method: "DELETE",
      url: statusUrl(receipt.id),
      headers: {
        origin,
        "x-csrf-token": "any-nonempty-csrf",
        "idempotency-key": key(),
        "x-photo-version": "1",
        "content-type": "application/json",
      },
      payload: { expectedVersion: 1 },
    })).statusCode).toBe(401);

    // Invalid bearer → 401; never cookie fallback.
    for (const route of [
      { method: "POST" as const, url: uploadUrl(venueId), headers: { authorization: "Bearer invalid", "idempotency-key": key(), "content-type": "image/png", "x-photo-rights": COMMENT_PHOTO_RIGHTS }, payload: png },
      { method: "GET" as const, url: statusUrl(receipt.id), headers: { authorization: "Bearer invalid" } },
      { method: "GET" as const, url: contentUrl(receipt.id), headers: { authorization: "Bearer invalid" } },
      { method: "DELETE" as const, url: statusUrl(receipt.id), headers: { authorization: "Bearer invalid", "idempotency-key": key(), "x-photo-version": "1", "content-type": "application/json" }, payload: { expectedVersion: 1 } },
    ]) {
      expect((await app.inject(route)).statusCode).toBe(401);
    }
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(venueId),
      headers: { authorization: "Bearer invalid", cookie: a.cookie, "idempotency-key": key(), "content-type": "image/png", "x-photo-rights": COMMENT_PHOTO_RIGHTS },
      payload: png,
    })).statusCode).not.toBeLessThan(400);

    // Wrong owner: user B cannot read/withdraw user A's photo.
    const owner = await actor();
    const stranger = await actor();
    const ownerVenue = await newVenue(owner);
    const owned = await app.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: bearer(owner),
      payload: png,
    });
    expect(owned.statusCode, owned.body).toBe(201);
    const ownedId = owned.json<{ id: string }>().id;
    expect((await app.inject({
      url: statusUrl(ownedId),
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })).statusCode).toBe(404);
    expect((await app.inject({
      url: contentUrl(ownedId),
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "DELETE",
      url: statusUrl(ownedId),
      headers: {
        authorization: `Bearer ${stranger.accessToken}`,
        "idempotency-key": key(),
        "x-photo-version": "1",
        "content-type": "application/json",
      },
      payload: { expectedVersion: 1 },
    })).statusCode).toBe(404);
    expect((await app.inject({
      url: statusUrl(ownedId),
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).json()).toMatchObject({ id: ownedId, status: "ready", version: 1 });

    // Cookie path unchanged: missing CSRF / foreign Origin → 403; bearer+cookie → 403.
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: { ...browser(owner), "x-csrf-token": "" },
      payload: png,
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: { ...browser(owner), origin: "https://evil.invalid" },
      payload: png,
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: { ...bearer(owner), cookie: owner.cookie },
      payload: png,
    })).statusCode).toBe(403);

    // Idempotency-Key still required for bearer mutations.
    expect((await app.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        "content-type": "image/png",
        "x-photo-rights": COMMENT_PHOTO_RIGHTS,
      },
      payload: png,
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "DELETE",
      url: statusUrl(ownedId),
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        "x-photo-version": "1",
        "content-type": "application/json",
      },
      payload: { expectedVersion: 1 },
    })).statusCode).toBe(400);

    // Native auth disabled: bearer never succeeds.
    expect((await disabledApp.inject({
      method: "POST",
      url: uploadUrl(ownerVenue),
      headers: bearer(owner),
      payload: png,
    })).statusCode).toBe(404);
    expect((await disabledApp.inject({
      url: statusUrl(ownedId),
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).statusCode).toBe(404);
  });
});
