import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { CommentsModule } from "../../src/comments/comments.module";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { MessagingModule } from "../../src/messaging/messaging.module";
import {
  avatarForGameCreator,
  avatarForPlayer,
  avatarForUser,
  safeProviderAvatar,
} from "../../src/profiles/avatar-presentation";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import {
  GEO_DISCLOSURE_ID,
  GEO_POLICY,
} from "../../src/radar/geographic-contract";
import { RadarModule } from "../../src/radar/radar.module";
import { UNIFIED_WIRE } from "../../src/radar/unified-contract";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const webOrigin = "http://127.0.0.1:19002";
const apiOrigin = "http://127.0.0.1:19001";

run("D1 provider-avatar public quarantine · disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let sessions: SessionService;
  let idempotency: IdempotencyService;
  let mediaRoot: string;
  let png: Buffer;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "d1-provider-avatar-pepper-at-least-32chars",
      PUBLIC_API_ORIGIN: apiOrigin,
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname)) {
      throw new Error("D1 fixtures require disposable loopback PostgreSQL");
    }
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "d1_provider_avatar_" + randomUUID().replaceAll("-", "");
    await databaseAdmin.query("CREATE DATABASE " + fixtureDatabase);
    sourceUrl.pathname = "/" + fixtureDatabase;
    process.env.DATABASE_URL = sourceUrl.toString();
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    mediaRoot = await mkdtemp(
      path.resolve(__dirname, "../../../../.qa-runtime/d1-provider-avatar-"),
    );
    const env = loadEnv({
      ...process.env,
      SOCIAL_DIRECTORY_ENABLED: "1",
      SOCIAL_DM_ENABLED: "1",
      SOCIAL_RADAR_ENABLED: "1",
      SOCIAL_RADAR_GEOGRAPHIC_ENABLED: "1",
      SOCIAL_RADAR_UNIFIED_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "d1-provider-avatar-fingerprint!!!!!!",
      COOKIE_SECURE: "false",
      AVATAR_MEDIA_ROOT: mediaRoot,
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AuthModule,
        ProfilesModule,
        SafetyModule,
        CommentsModule,
        RadarModule,
        MessagingModule,
      ],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }), {
      logger: false,
    });
    registerAvatarHttp(app.getHttpAdapter().getInstance());
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = mod.get(SessionService);
    idempotency = mod.get(IdempotencyService);
    png = await sharp(randomBytes(32 * 32 * 3), {
      raw: { width: 32, height: 32, channels: 3 },
    })
      .png()
      .toBuffer();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  type Actor = {
    userId: string;
    sessionId: string;
    providerUrl: string;
    publicPlayerId: string;
    headers: Record<string, string>;
  };

  async function identity(
    label: string,
    providerUrl: string,
    providerKey: "yandex" | "vk" = "yandex",
  ): Promise<Actor> {
    const userId = (
      await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", [label])
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url)
       VALUES ($1::uuid,$2,$3,$1::text,$4)`,
      [userId, providerKey, "d1-" + randomUUID(), providerUrl],
    );
    await pool.query(
      `INSERT INTO player_social_profiles(
         user_id, display_name, directory_visible, social_eligible, city_id,
         contact_policy, consent_policy_version, opted_in_at
       ) SELECT $1, $2, true, true, $3, 'requests', 'directory-mvp-v1', now()`,
      [userId, label, MOSCOW_CITY_ID],
    );
    const session = await sessions.createConsumerSession(userId);
    const publicPlayerId = (
      await pool.query("SELECT public_player_id FROM player_social_profiles WHERE user_id=$1", [
        userId,
      ])
    ).rows[0].public_player_id as string;
    return {
      userId,
      sessionId: session.session.id,
      providerUrl,
      publicPlayerId,
      headers: {
        cookie: `${SESSION_COOKIE}=${session.sessionToken}`,
        origin: webOrigin,
        "x-csrf-token": session.csrfToken,
      },
    };
  }

  async function publishedGame(creator: Actor): Promise<string> {
    const venueId = randomUUID();
    await pool.query(
      `INSERT INTO venues(
         id, city_id, name, address, timezone, location, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address
       ) VALUES (
         $1, $2, $3, 'Synthetic address', 'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $4,
         'unverified', $5, 'synthetic address'
       )`,
      [
        venueId,
        MOSCOW_CITY_ID,
        "D1 court " + venueId.slice(0, 8),
        creator.userId,
        "d1 court " + venueId.slice(0, 8),
      ],
    );
    const gameId = randomUUID();
    const starts = new Date(Date.now() + 7 * 86400000);
    await pool.query(
      `INSERT INTO games(
         id, venue_id, title, status, visibility, starts_at, ends_at, timezone,
         application_deadline_at, capacity, external_reserved_count, format_key,
         level_scale_id, level_scale_version, allowed_level_ids, settlement_mode,
         settlement_purpose, settlement_terms, created_by_user_id,
         host_display_name, host_public_contact, activity_kind, published_at
       ) VALUES (
         $1, $2, 'D1 published game', 'published', 'public', $3, $4, 'Europe/Moscow',
         $3, 4, 0, 'doubles', 'ntrp', 1, '["3.0"]'::jsonb, 'external',
         'no_trainer_fee', 'Synthetic settlement', $5, 'Host', 'host@example.test',
         'regular', clock_timestamp()
       )`,
      [gameId, venueId, starts.toISOString(), new Date(starts.getTime() + 7200000).toISOString(), creator.userId],
    );
    return gameId;
  }

  async function avatarReceiptRow(actorId: string, key: string) {
    return (
      await pool.query<{
        reservation_state: string;
        status_code: number;
        response_body: Record<string, unknown>;
        request_hash: string;
      }>(
        `SELECT reservation_state, status_code, response_body, request_hash
         FROM idempotency_records
         WHERE actor_id=$1 AND operation='profiles.avatar.mutate' AND key_hash=$2`,
        [actorId, idempotency.keyHash(key)],
      )
    ).rows[0];
  }

  async function dmReceiptRow(actorId: string, key: string) {
    return (
      await pool.query<{
        reservation_state: string;
        status_code: number;
        response_body: Record<string, unknown>;
        request_hash: string;
      }>(
        `SELECT reservation_state, status_code, response_body, request_hash
         FROM idempotency_records
         WHERE actor_id=$1 AND operation='dm.request.create' AND key_hash=$2`,
        [actorId, idempotency.keyHash(key)],
      )
    ).rows[0];
  }

  it("four public projection branches return providerUrl=null via real entrypoints; OAuth sanitizer stays usable", async () => {
    const yandexUrl = "https://avatars.yandex.net/d1-" + randomUUID();
    const vkUrl = "https://sun9.userapi.com/d1-" + randomUUID();
    const a = await identity("D1 Yandex " + randomUUID(), yandexUrl, "yandex");
    const b = await identity("D1 VK " + randomUUID(), vkUrl, "vk");
    expect(safeProviderAvatar(yandexUrl)).toBe(yandexUrl);
    expect(safeProviderAvatar(vkUrl)).toBe(vkUrl);

    // 1) Shared profiles / avatar-presentation + authorized HTTP GETs
    expect(await avatarForUser(pool, a.userId)).toEqual({ uploadedUrl: null, providerUrl: null });
    expect(await avatarForPlayer(pool, a.publicPlayerId)).toEqual({
      uploadedUrl: null,
      providerUrl: null,
    });
    const own = await app.inject({ method: "GET", url: "/v1/me/social-profile", headers: a.headers });
    expect(own.statusCode).toBe(200);
    expect(own.json().avatar).toEqual({ uploadedUrl: null, providerUrl: null });
    const publicPlayer = await app.inject({
      method: "GET",
      url: `/v1/players/${a.publicPlayerId}`,
      headers: b.headers,
    });
    expect(publicPlayer.statusCode).toBe(200);
    expect(publicPlayer.json().avatar.providerUrl).toBeNull();

    const gameId = await publishedGame(a);
    expect(await avatarForGameCreator(pool, gameId, true, b.userId)).toEqual({
      uploadedUrl: null,
      providerUrl: null,
    });

    // 2) Comment author — actual published-game create + list (service projectAuthor path)
    const created = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/comments`,
      headers: { ...a.headers, "idempotency-key": randomUUID() },
      payload: { text: "D1 comment avatar quarantine", parentCommentId: null },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().author.avatar).toEqual({ uploadedUrl: null, providerUrl: null });
    const listed = await app.inject({
      method: "GET",
      url: `/v1/games/${gameId}/comments`,
      headers: b.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].author.avatar).toEqual({ uploadedUrl: null, providerUrl: null });

    // 3) Unified Players — real HTTP query with directory/geo-authorized profiles
    const unified = await app.inject({
      method: "POST",
      url: "/v1/players/query",
      headers: { ...b.headers, "idempotency-key": randomUUID() },
      payload: {
        contractVersion: UNIFIED_WIRE,
        filters: { cityId: MOSCOW_CITY_ID },
        origin: { kind: "none" },
        limit: 50,
      },
    });
    expect(unified.statusCode, unified.body).toBe(200);
    const unifiedPeer = unified
      .json()
      .items.find((row: { publicPlayerId: string }) => row.publicPlayerId === a.publicPlayerId);
    expect(unifiedPeer).toBeTruthy();
    expect(unifiedPeer.player.avatar).toEqual({ uploadedUrl: null, providerUrl: null });

    // 4) Geographic Radar — real activation + results query
    const started = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: { ...a.headers, "idempotency-key": randomUUID() },
      payload: {
        location: {
          latitude: 55.7558,
          longitude: 37.6173,
          accuracyMeters: 40,
          capturedAt: new Date().toISOString(),
        },
        consentPolicyVersion: GEO_POLICY,
        consent: { disclosureId: GEO_DISCLOSURE_ID, accepted: true },
      },
    });
    expect(started.statusCode, started.body).toBe(201);
    const geographic = await app.inject({
      method: "POST",
      url: "/v1/radar/results/query",
      headers: { ...b.headers, "idempotency-key": randomUUID() },
      payload: { cityId: MOSCOW_CITY_ID, scope: "city", origin: { kind: "none" } },
    });
    expect(geographic.statusCode, geographic.body).toBe(200);
    const geoPeer = geographic
      .json()
      .items.find(
        (row: { player: { publicPlayerId: string } }) =>
          row.player.publicPlayerId === a.publicPlayerId,
      );
    expect(geoPeer).toBeTruthy();
    expect(geoPeer.player.avatar).toEqual({ uploadedUrl: null, providerUrl: null });

    // Stored OAuth metadata remains for ingest/audit — not public eligibility.
    const stored = await pool.query<{ avatar_url: string | null }>(
      "SELECT avatar_url FROM external_identities WHERE user_id=$1",
      [a.userId],
    );
    expect(stored.rows[0]?.avatar_url).toBe(yandexUrl);
    expect(safeProviderAvatar(stored.rows[0]?.avatar_url)).toBe(yandexUrl);
  });

  it("sealed legacy HTTP receipt replay nulls providerUrl without rewriting stored bytes; revoke/logout denies replay", async () => {
    // High-risk receipt 1: own avatar upload (real M1 HTTP + matching key/hash/version)
    const avatarActor = await identity(
      "D1 Avatar Replay " + randomUUID(),
      "https://avatars.yandex.net/replay-avatar-" + randomUUID(),
    );
    const avatarKey = randomUUID();
    const profileVersion = (
      await pool.query<{ version: number }>(
        "SELECT version FROM player_social_profiles WHERE user_id=$1",
        [avatarActor.userId],
      )
    ).rows[0]!.version;
    const uploadHeaders = {
      ...avatarActor.headers,
      "idempotency-key": avatarKey,
      "x-profile-version": String(profileVersion),
      "content-type": "image/png",
    };
    const firstUpload = await app.inject({
      method: "PUT",
      url: "/v1/me/avatar",
      headers: uploadHeaders,
      payload: png,
    });
    expect(firstUpload.statusCode, firstUpload.body).toBe(200);
    const uploadBody = firstUpload.json() as {
      version: number;
      avatar: { uploadedUrl: string | null; providerUrl: string | null };
    };
    expect(uploadBody.avatar.providerUrl).toBeNull();
    expect(uploadBody.avatar.uploadedUrl).toMatch(/^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/);

    const avatarStored = await avatarReceiptRow(avatarActor.userId, avatarKey);
    expect(avatarStored).toMatchObject({
      reservation_state: "completed",
      status_code: 200,
    });
    expect(avatarStored!.response_body).toEqual(uploadBody);
    const legacyAvatarProvider =
      "https://avatars.yandex.net/legacy-sealed-" + randomUUID();
    expect(safeProviderAvatar(legacyAvatarProvider)).toBe(legacyAvatarProvider);
    const legacyAvatarBody = {
      ...uploadBody,
      avatar: { ...uploadBody.avatar, providerUrl: legacyAvatarProvider },
    };
    await pool.query(
      `UPDATE idempotency_records
       SET response_body=$1::jsonb
       WHERE actor_id=$2 AND operation='profiles.avatar.mutate' AND key_hash=$3`,
      [JSON.stringify(legacyAvatarBody), avatarActor.userId, idempotency.keyHash(avatarKey)],
    );
    const embeddedAvatar = await avatarReceiptRow(avatarActor.userId, avatarKey);
    expect(embeddedAvatar!.response_body).toEqual(legacyAvatarBody);
    expect(embeddedAvatar!.request_hash).toBe(avatarStored!.request_hash);
    expect(embeddedAvatar!.reservation_state).toBe("completed");
    expect(embeddedAvatar!.status_code).toBe(200);

    const avatarReplay = await app.inject({
      method: "PUT",
      url: "/v1/me/avatar",
      headers: uploadHeaders,
      payload: png,
    });
    expect(avatarReplay.statusCode).toBe(200);
    expect(avatarReplay.json()).toEqual({
      version: uploadBody.version,
      avatar: { uploadedUrl: uploadBody.avatar.uploadedUrl, providerUrl: null },
    });
    const avatarAfterReplay = await avatarReceiptRow(avatarActor.userId, avatarKey);
    expect(avatarAfterReplay!.response_body).toEqual(legacyAvatarBody);
    expect(avatarAfterReplay!.request_hash).toBe(avatarStored!.request_hash);

    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1", [
      avatarActor.sessionId,
    ]);
    const avatarDenied = await app.inject({
      method: "PUT",
      url: "/v1/me/avatar",
      headers: uploadHeaders,
      payload: png,
    });
    expect(avatarDenied.statusCode).toBe(401);
    expect((await avatarReceiptRow(avatarActor.userId, avatarKey))!.response_body).toEqual(
      legacyAvatarBody,
    );

    // High-risk receipt 2: first DM create (real HTTP) with sealed legacy peer providerUrl
    const dmSender = await identity(
      "D1 DM Sender " + randomUUID(),
      "https://sun9.userapi.com/dm-sender-" + randomUUID(),
      "vk",
    );
    const dmPeer = await identity(
      "D1 DM Peer " + randomUUID(),
      "https://avatars.yandex.net/dm-peer-" + randomUUID(),
      "yandex",
    );
    const dmKey = randomUUID();
    const clientMessageId = randomUUID();
    const dmPayload = {
      targetPublicPlayerId: dmPeer.publicPlayerId,
      text: "D1 sealed legacy DM",
      clientMessageId,
    };
    const firstDm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: { ...dmSender.headers, "idempotency-key": dmKey },
      payload: dmPayload,
    });
    expect(firstDm.statusCode, firstDm.body).toBe(201);
    const dmBody = firstDm.json() as {
      conversation: {
        id: string;
        version: number;
        requestState: string;
        peer: {
          publicPlayerId: string;
          displayName: string;
          avatar: { uploadedUrl: string | null; providerUrl: string | null };
        };
      };
      receipt: {
        messageId: string;
        conversationId: string;
        seq: string;
        createdAt: string;
        outcome: string;
      };
    };
    expect(dmBody.receipt.outcome).toBe("created");
    expect(dmBody.conversation.requestState).toBe("accepted");
    expect(dmBody.conversation.peer.avatar.providerUrl).toBeNull();

    const dmStored = await dmReceiptRow(dmSender.userId, dmKey);
    expect(dmStored).toMatchObject({ reservation_state: "completed", status_code: 201 });
    expect(dmStored!.response_body).toEqual(dmBody);
    const legacyDmProvider = "https://sun1.userapi.com/legacy-dm-" + randomUUID();
    expect(safeProviderAvatar(legacyDmProvider)).toBe(legacyDmProvider);
    const legacyDmBody = {
      ...dmBody,
      conversation: {
        ...dmBody.conversation,
        peer: {
          ...dmBody.conversation.peer,
          avatar: {
            uploadedUrl: dmBody.conversation.peer.avatar.uploadedUrl,
            providerUrl: legacyDmProvider,
          },
        },
      },
    };
    await pool.query(
      `UPDATE idempotency_records
       SET response_body=$1::jsonb
       WHERE actor_id=$2 AND operation='dm.request.create' AND key_hash=$3`,
      [JSON.stringify(legacyDmBody), dmSender.userId, idempotency.keyHash(dmKey)],
    );
    expect((await dmReceiptRow(dmSender.userId, dmKey))!.response_body).toEqual(legacyDmBody);

    const dmReplay = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: { ...dmSender.headers, "idempotency-key": dmKey },
      payload: dmPayload,
    });
    expect(dmReplay.statusCode).toBe(201);
    expect(dmReplay.json().receipt).toEqual(dmBody.receipt);
    expect(dmReplay.json().conversation.id).toBe(dmBody.conversation.id);
    expect(dmReplay.json().conversation.version).toBe(dmBody.conversation.version);
    expect(dmReplay.json().conversation.requestState).toBe(dmBody.conversation.requestState);
    expect(dmReplay.json().conversation.peer.publicPlayerId).toBe(
      dmBody.conversation.peer.publicPlayerId,
    );
    expect(dmReplay.json().conversation.peer.avatar).toEqual({
      uploadedUrl: dmBody.conversation.peer.avatar.uploadedUrl,
      providerUrl: null,
    });
    expect((await dmReceiptRow(dmSender.userId, dmKey))!.response_body).toEqual(legacyDmBody);
    expect((await dmReceiptRow(dmSender.userId, dmKey))!.request_hash).toBe(dmStored!.request_hash);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...dmSender.headers, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(logout.statusCode).toBe(204);
    const dmDenied = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: { ...dmSender.headers, "idempotency-key": dmKey },
      payload: dmPayload,
    });
    expect(dmDenied.statusCode).toBe(401);
    expect((await dmReceiptRow(dmSender.userId, dmKey))!.response_body).toEqual(legacyDmBody);
  });
});
