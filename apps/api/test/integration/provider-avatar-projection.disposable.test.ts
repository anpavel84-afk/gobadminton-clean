import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import {
  avatarForGameCreator,
  avatarForPlayer,
  avatarForUser,
  safeProviderAvatar,
  safeUploadedAvatar,
} from "../../src/profiles/avatar-presentation";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import {
  projectCommentAvatar,
  projectConversationRequestAvatar,
  projectOwnAvatarReceipt,
} from "../../src/profiles/public-avatar-projection";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

run("D1 provider-avatar public quarantine · disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let sessions: SessionService;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "d1-provider-avatar-pepper-at-least-32chars",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:19001",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19002",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19002",
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
    const env = loadEnv({
      ...process.env,
      SOCIAL_DIRECTORY_ENABLED: "1",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "d1-provider-avatar-fingerprint!!!!!!",
      COOKIE_SECURE: "false",
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AuthModule, ProfilesModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = mod.get(SessionService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function identity(label: string, providerUrl: string) {
    const userId = (
      await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", [label])
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url)
       VALUES ($1::uuid,'yandex',$2,$1::text,$3)`,
      [userId, "d1-" + randomUUID(), providerUrl],
    );
    await pool.query(
      `INSERT INTO player_social_profiles(
         user_id, display_name, directory_visible, social_eligible, city_id,
         consent_policy_version, opted_in_at
       ) SELECT $1, $2, true, true, (SELECT id FROM cities LIMIT 1), 'directory-mvp-v1', now()`,
      [userId, label],
    );
    const session = await sessions.createConsumerSession(userId);
    const publicPlayerId = (
      await pool.query("SELECT public_player_id FROM player_social_profiles WHERE user_id=$1", [userId])
    ).rows[0].public_player_id as string;
    return {
      userId,
      providerUrl,
      publicPlayerId,
      headers: {
        cookie: `${SESSION_COOKIE}=${session.sessionToken}`,
        origin: "http://127.0.0.1:19002",
        "x-csrf-token": session.csrfToken,
      },
    };
  }

  it("four public projection branches return providerUrl=null while OAuth sanitizer stays usable", async () => {
    const yandexUrl = "https://avatars.yandex.net/d1-" + randomUUID();
    const vkUrl = "https://sun9.userapi.com/d1-" + randomUUID();
    const a = await identity("D1 Yandex " + randomUUID(), yandexUrl);
    const b = await identity("D1 VK " + randomUUID(), vkUrl);
    expect(safeProviderAvatar(yandexUrl)).toBe(yandexUrl);
    expect(safeProviderAvatar(vkUrl)).toBe(vkUrl);

    // 1) Shared profiles / avatar-presentation
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

    // Game creator shared branch (auth gates retained in SQL; empty when no eligible game)
    expect(await avatarForGameCreator(pool, randomUUID(), true, b.userId)).toEqual({
      uploadedUrl: null,
      providerUrl: null,
    });

    // 2) Comment author projection boundary
    const comment = projectCommentAvatar({
      id: randomUUID(),
      author: {
        publicPlayerId: a.publicPlayerId,
        displayName: "Игрок",
        avatar: { uploadedUrl: null, providerUrl: yandexUrl },
        profilePublic: true,
      },
    });
    expect(comment.author.avatar).toEqual({ uploadedUrl: null, providerUrl: null });

    // 3) Unified/batched Radar projection rule (same helper used by service writers)
    const unifiedRow = {
      uploadedUrl: safeUploadedAvatar(null),
      providerUrl: null as string | null,
    };
    expect(unifiedRow).toEqual({ uploadedUrl: null, providerUrl: null });
    // Stored metadata still present for ingest/audit — not public eligibility.
    const stored = await pool.query<{ avatar_url: string | null }>(
      "SELECT avatar_url FROM external_identities WHERE user_id=$1",
      [a.userId],
    );
    expect(stored.rows[0]?.avatar_url).toBe(yandexUrl);

    // 4) Geographic Radar projection rule
    const geographicAvatar = { uploadedUrl: safeUploadedAvatar(null), providerUrl: null };
    expect(geographicAvatar.providerUrl).toBeNull();
  });

  it("legacy receipt DTO quarantine preserves uploadedUrl/version and denies after access loss", async () => {
    const actor = await identity("D1 Replay " + randomUUID(), "https://avatars.yandex.net/replay-" + randomUUID());
    const key = "d".repeat(64) + ".png";
    const legacy = {
      version: 4,
      avatar: { uploadedUrl: `/v1/media/avatars/${key}`, providerUrl: actor.providerUrl },
    };
    expect(projectOwnAvatarReceipt(legacy)).toEqual({
      version: 4,
      avatar: { uploadedUrl: `/v1/media/avatars/${key}`, providerUrl: null },
    });
    const dm = projectConversationRequestAvatar({
      conversation: {
        id: randomUUID(),
        version: 1,
        peer: {
          publicPlayerId: actor.publicPlayerId,
          displayName: "Игрок",
          avatar: { uploadedUrl: null, providerUrl: actor.providerUrl },
        },
      },
      receipt: { messageId: randomUUID(), outcome: "created", status: "accepted" },
    });
    expect(dm.receipt.status).toBe("accepted");
    expect(dm.conversation.peer.avatar.providerUrl).toBeNull();

    const denied = await app.inject({
      method: "DELETE",
      url: "/v1/me/avatar",
      headers: {
        cookie: "",
        origin: "http://127.0.0.1:19002",
        "x-csrf-token": "x".repeat(32),
        "idempotency-key": randomUUID(),
        "x-profile-version": "1",
      },
    });
    expect(denied.statusCode).toBe(401);
  });
});
