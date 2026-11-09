/**
 * MOD-V2-B1a public comment text gate — isolated PostgreSQL + fake provider.
 * Skips when RUN_DB_INTEGRATION≠1. No real provider / live DB / harmful material.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { CommentsModule } from "../../src/comments/comments.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { LOCAL_TEXT_POLICY_VERSION } from "../../src/moderation/local-text-policy";
import { PUBLIC_TEXT_POLICY_VERSION } from "../../src/moderation/text-policy";
import { ModerationModule } from "../../src/moderation/moderation.module";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  safeTextBatchDecision,
  TEXT_CATEGORIES,
} from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const webOrigin = "http://127.0.0.1:3012";

function assertDisposableDatabase(url: string): void {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    throw new Error("RUN_DB_INTEGRATION=1 required before migrate");
  }
  if (process.env.GMAP1_DISPOSABLE_DB !== "1") {
    throw new Error("GMAP1_DISPOSABLE_DB=1 required before migrate");
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Loopback disposable PostgreSQL required");
  }
}

function flaggedTextBatch(count: number, flaggedIndex = 0) {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-comment",
    results: Array.from({ length: count }, (_, i) => ({
      flagged: i === flaggedIndex,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, i === flaggedIndex && key === "harassment"]),
      ) as Record<(typeof TEXT_CATEGORIES)[number], boolean>,
    })),
  };
}

type Actor = {
  userId: string;
  sessionId: string;
  csrfToken: string;
  cookie: string;
};

describeIntegration("MOD-V2-B1a public comment moderation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fake: FakeModerationProvider;
  let sessions: SessionService;
  let pairs: PairFenceService;
  let author: Actor;
  let peer: Actor;

  beforeAll(async () => {
    assertDisposableDatabase(databaseUrl);
    // Self-contained Admin simulation (do not rely on parent env; matches comments.disposable).
    const adminOrigin = "http://localhost:19494";
    const adminPepper = "comment-mod-synthetic-admin-pepper-only!!";
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3012",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "comment-mod-synthetic-fingerprint-secret!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
      GAME_MODERATION_INTERNAL_ENABLED: "1",
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "comment-mod-synthetic-pepper-only!!",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    const db = createDatabase(databaseUrl);
    pool = db.pool;
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3012",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "comment-mod-synthetic-fingerprint-secret!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
      GAME_MODERATION_INTERNAL_ENABLED: "1",
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "comment-mod-synthetic-pepper-only!!",
    });
    fake = new FakeModerationProvider(env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        ProfilesModule,
        GamesModule,
        VenuesModule,
        SafetyModule,
        CommentsModule,
        ModerationModule,
      ],
    })
      .overrideProvider(MODERATION_PROVIDER)
      .useValue(fake)
      .compile();
    sessions = moduleRef.get(SessionService);
    pairs = moduleRef.get(PairFenceService);
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fake.textCalls = 0;
    fake.calls = 0;
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    author = await actor("Comment mod author");
    peer = await actor("Comment mod peer");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, display_name, directory_visible, contact_policy, directory_visibility_provenance, social_eligible, version)
       VALUES ($1, $2, true, 'requests', 'owner_default', true, 1)`,
      [userId, name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  const key = () => `comment-mod-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin: webOrigin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }

  async function createPublishedGame(owner: Actor) {
    const venue = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: headers(owner),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `Comment mod venue ${randomUUID()}`,
        address: "Synthetic Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(owner),
      payload: {
        hostDisplayName: "Synthetic host",
        hostPublicContact: "telegram:@synthetic_comment_mod",
        venueId: venue.json().id,
        title: "Comment moderation disposable game",
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(starts + 7200000).toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: new Date(starts - 86400000).toISOString(),
        capacity: 4,
        externalReservedCount: 0,
        visibility: "public",
        formatKey: "doubles",
        activityKind: "regular",
        levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
        settlement: {
          mode: "external",
          purpose: "no_trainer_fee",
          priceMinor: null,
          currency: null,
          terms: "Synthetic settlement terms for comment moderation",
        },
      },
    });
    expect(draft.statusCode).toBe(201);
    const published = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.json().id}/publish`,
      headers: headers(owner),
      payload: { expectedVersion: draft.json().version },
    });
    expect(published.statusCode).toBe(200);
    fake.textCalls = 0;
    return {
      gameId: published.json().id as string,
      venueId: venue.json().id as string,
    };
  }

  it.each(["game", "venue"] as const)("%s masks public DTOs and raw receipts without changing source/evidence", async (kind) => {
    const { gameId, venueId } = await createPublishedGame(author);
    const url = kind === "game" ? `/v1/games/${gameId}/comments` : `/v1/venues/${venueId}/comments`;
    const raw = `Он написал «БЛЯДЬ», организация слабая. José 🙂 ${gameId}; х у блядь й`;
    const masked = `Он написал «*****», организация слабая. José 🙂 ${gameId}; х у ***** й`;
    const edited = `Он написал «pizda», это недопустимо. Волан! ${gameId}`;
    const editedMask = `Он написал «*****», это недопустимо. Волан! ${gameId}`;
    const providerInputs: string[][] = [];
    fake.textFixture = async (input) => {
      providerInputs.push([...input.texts]);
      return safeTextBatchDecision(input.texts.length);
    };
    const createKey = key();
    const created = await app.inject({ method: "POST", url, headers: headers(author, createKey),
      payload: { text: raw, parentCommentId: null } });
    expect(created.statusCode).toBe(201);
    expect(created.json().body).toBe(masked);
    const id = created.json().id as string;
    const replied = await app.inject({ method: "POST", url, headers: headers(peer),
      payload: { text: edited, parentCommentId: id } });
    expect(replied.statusCode).toBe(201);
    expect(replied.json().body).toBe(editedMask);
    const editKey = key();
    const updated = await app.inject({ method: "PUT", url: `/v1/comments/${id}`, headers: headers(author, editKey),
      payload: { text: edited, expectedVersion: 1 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().body).toBe(editedMask);
    expect(updated.json().version).toBe(2);
    // The fake sees complete original context, including the quote. Never display bytes.
    expect(providerInputs).toContainEqual([raw]);
    expect(providerInputs).toContainEqual([edited]);
    expect(providerInputs.flat()).not.toContain(masked);
    expect(providerInputs.flat()).not.toContain(editedMask);

    async function snapshot() {
      const stored = await pool.query(`SELECT body, version FROM entity_comments WHERE id=$1`, [id]);
      const revisions = await pool.query(
        `SELECT resource_version, before_body, after_body, tombstone FROM entity_comment_revisions
         WHERE comment_id=$1 ORDER BY resource_version`, [id]);
      const approvals = await pool.query(
        `SELECT b.resource_version, b.approval_id, a.content_fingerprint, a.policy_version,
                a.local_policy_version, a.provider_model, a.checked_at, a.decision
         FROM content_moderation_bindings b JOIN content_moderation_approvals a ON a.id=b.approval_id
         WHERE b.entity_id=$1 AND b.surface_key='comment_body' ORDER BY b.resource_version`, [id]);
      const receipts = await pool.query(
        `SELECT operation, request_hash, status_code, response_body FROM idempotency_records
         WHERE actor_id=$1 AND response_body->>'id'=$2 ORDER BY operation`, [author.userId, id]);
      return { stored: stored.rows, revisions: revisions.rows, approvals: approvals.rows, receipts: receipts.rows };
    }
    const before = await snapshot();
    expect(before.stored).toEqual([{ body: edited, version: 2 }]);
    expect(before.revisions).toEqual([
      { resource_version: 1, before_body: null, after_body: raw, tombstone: false },
      { resource_version: 2, before_body: raw, after_body: edited, tombstone: false },
    ]);
    for (const [index, text] of [raw, edited].entries()) {
      const fingerprint = createHmac("sha256", "comment-mod-synthetic-fingerprint-secret!!")
        .update("moderation-fingerprint:v1:text:comment_body:").update(text, "utf8").digest("hex");
      expect(before.approvals[index]).toMatchObject({ content_fingerprint: fingerprint,
        resource_version: index + 1, policy_version: PUBLIC_TEXT_POLICY_VERSION,
        local_policy_version: LOCAL_TEXT_POLICY_VERSION, provider_model: MODERATION_MODEL, decision: "allow" });
    }
    // Legacy-shaped raw CommentViews remain durable receipts; the final response masks copies.
    expect(before.receipts.map((row) => row.response_body.body)).toEqual([raw, edited]);
    const calls = fake.textCalls;
    fake.textFixture = async () => { throw new ModerationProviderError("unavailable", 3); };
    for (const cookie of [undefined, author.cookie]) {
      const listed = await app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().items.find((item: { id: string }) => item.id === id).body).toBe(editedMask);
      const replies = await app.inject({ method: "GET", url: `${url}?parentCommentId=${id}`,
        headers: cookie ? { cookie } : {} });
      expect(replies.json().items.find((item: { id: string }) => item.id === replied.json().id).body).toBe(editedMask);
    }
    const replay = await app.inject({ method: "POST", url, headers: headers(author, createKey),
      payload: { text: raw, parentCommentId: null } });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    const editReplay = await app.inject({ method: "PUT", url: `/v1/comments/${id}`, headers: headers(author, editKey),
      payload: { text: edited, expectedVersion: 1 } });
    expect(editReplay.statusCode).toBe(200);
    expect(editReplay.json()).toEqual(updated.json());
    expect(fake.textCalls).toBe(calls);
    expect(await snapshot()).toEqual(before);

    const foreign = await app.inject({ method: "PUT", url: `/v1/comments/${id}`, headers: headers(peer),
      payload: { text: raw, expectedVersion: 2 } });
    expect(foreign.statusCode).toBe(404);
    expect(fake.textCalls).toBe(calls);
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const rejected = await app.inject({ method: "PUT", url: `/v1/comments/${id}`, headers: headers(author),
      payload: { text: "Отклонённая замена", expectedVersion: 2 } });
    expect(rejected.statusCode).toBe(422);
    fake.textFixture = async () => { throw new ModerationProviderError("unavailable", 3); };
    const failed = await app.inject({ method: "PUT", url: `/v1/comments/${id}`, headers: headers(author),
      payload: { text: "Замена при сбое провайдера", expectedVersion: 2 } });
    expect(failed.statusCode).toBe(503);
    expect(await snapshot()).toEqual(before);

    await pool.query(`UPDATE entity_comments SET moderation_state='withheld' WHERE id=$1`, [id]);
    const hidden = await app.inject({ method: "GET", url });
    expect(hidden.json().items.some((item: { id: string }) => item.id === id)).toBe(false);
    const own = await app.inject({ method: "GET", url, headers: { cookie: author.cookie } });
    expect(own.json().items.find((item: { id: string }) => item.id === id).body).toBe(editedMask);
    await pool.query(`UPDATE entity_comments SET moderation_state='clear' WHERE id=$1`, [id]);
    const deleted = await app.inject({ method: "DELETE", url: `/v1/comments/${id}`, headers: headers(author),
      payload: { expectedVersion: 2 } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().body).toBeNull();
    const tombstones = await app.inject({ method: "GET", url });
    expect(tombstones.json().items.find((item: { id: string }) => item.id === id).body).toBeNull();
  });

  it("safe create/reply/edit bind publication evidence; criticism allowed", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const create = await app.inject({
      method: "POST",
      url,
      headers: headers(author),
      payload: { text: "Слабая организация на корте, время сдвинули", parentCommentId: null },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().body).toContain("Слабая организация");
    expect(fake.textCalls).toBe(1);
    const commentId = create.json().id as string;
    const binding = await pool.query(
      `SELECT surface_key, resource_version, binding_kind, entity_kind
       FROM content_moderation_bindings
       WHERE entity_id = $1::uuid AND surface_key = 'comment_body'`,
      [commentId],
    );
    expect(binding.rows[0]).toMatchObject({
      surface_key: "comment_body",
      resource_version: 1,
      binding_kind: "publication",
      entity_kind: "entity_comment",
    });

    const reply = await app.inject({
      method: "POST",
      url,
      headers: headers(peer),
      payload: {
        text: 'Он написал «хуйня», но я цитирую для отчёта о нарушении',
        parentCommentId: commentId,
      },
    });
    expect(reply.statusCode).toBe(201);
    expect(fake.textCalls).toBe(2);

    const edit = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(author),
      payload: { text: "Обновлённый нейтральный комментарий про игру", expectedVersion: 1 },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().body).toBe("Обновлённый нейтральный комментарий про игру");
    expect(edit.json().version).toBe(2);
    expect(fake.textCalls).toBe(3);
    const v2 = await pool.query(
      `SELECT resource_version FROM content_moderation_bindings
       WHERE entity_id = $1::uuid AND resource_version = 2 AND binding_kind = 'publication'`,
      [commentId],
    );
    expect(v2.rowCount).toBe(1);
  });

  it("reject and provider error retain old body; no new version; fields.text", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const create = await app.inject({
      method: "POST",
      url,
      headers: headers(author),
      payload: { text: "Исходный принятый комментарий", parentCommentId: null },
    });
    expect(create.statusCode).toBe(201);
    const commentId = create.json().id as string;
    const baselineCalls = fake.textCalls;

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const rejected = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(author),
      payload: { text: "Замена с отказом провайдера", expectedVersion: 1 },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.text).toBeTruthy();
    expect(fake.textCalls).toBe(baselineCalls + 1);

    const afterReject = await app.inject({
      method: "GET",
      url,
      headers: { cookie: author.cookie },
    });
    const row = afterReject.json().items.find((i: { id: string }) => i.id === commentId);
    expect(row.body).toBe("Исходный принятый комментарий");
    expect(row.version).toBe(1);

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const unavailable = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(author),
      payload: { text: "Ещё одна замена при сбое", expectedVersion: 1 },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");
    const after503 = await app.inject({
      method: "GET",
      url,
      headers: { cookie: author.cookie },
    });
    const still = after503.json().items.find((i: { id: string }) => i.id === commentId);
    expect(still.body).toBe("Исходный принятый комментарий");
    expect(still.version).toBe(1);
  });

  it("paid comment reject same-key seals 422 receipt; replay provider0", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const idem = key();
    const text = "Комментарий с отказом провайдера для durable receipt";
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    fake.textCalls = 0;
    const rejected = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text, parentCommentId: null },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.text).toBeTruthy();
    expect(fake.textCalls).toBe(1);
    const receipt = await pool.query<{ status_code: number; reservation_state: string }>(
      `SELECT status_code, reservation_state FROM idempotency_records
       WHERE actor_id=$1 AND operation='comments.create' AND status_code=422`,
      [author.userId],
    );
    expect(receipt.rows[0]?.reservation_state).toBe("completed");
    expect(receipt.rows[0]?.status_code).toBe(422);
    const replay = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text, parentCommentId: null },
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(replay.json().fields?.text).toBe(rejected.json().fields?.text);
    expect(fake.textCalls).toBe(1);
  });

  it("unauthorized/blocked/stale do not call provider", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const create = await app.inject({
      method: "POST",
      url,
      headers: headers(author),
      payload: { text: "Комментарий для fence-тестов", parentCommentId: null },
    });
    expect(create.statusCode).toBe(201);
    const commentId = create.json().id as string;
    fake.textCalls = 0;

    const stale = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(author),
      payload: { text: "Устаревшая версия", expectedVersion: 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(fake.textCalls).toBe(0);

    const foreign = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(peer),
      payload: { text: "Чужой комментарий", expectedVersion: 1 },
    });
    expect(foreign.statusCode).toBe(404);
    expect(fake.textCalls).toBe(0);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pair = await pairs.lockOrCreate(client, author.userId, peer.userId);
      await client.query(
        `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, pair_id)
         VALUES ($1, $2, $3)`,
        [author.userId, peer.userId, pair.id],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const blocked = await app.inject({
      method: "POST",
      url,
      headers: headers(peer),
      payload: { text: "Блок с организатором", parentCommentId: null },
    });
    expect(blocked.statusCode).toBe(403);
    expect(fake.textCalls).toBe(0);
  });

  // #507 Owner: open public venue discussion — auth write through text provider; no attendance.
  it("venue auth comment 201 binds publication; reject/timeout keep prior; replay/delete while provider down", async () => {
    const { venueId } = await createPublishedGame(author);
    const url = `/v1/venues/${venueId}/comments`;
    fake.textCalls = 0;

    const create = await app.inject({
      method: "POST",
      url,
      headers: headers(peer),
      payload: { text: "Есть парковка у площадки?", parentCommentId: null },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      entityKind: "venue",
      entityId: venueId,
      body: "Есть парковка у площадки?",
      deleted: false,
      version: 1,
    });
    expect(fake.textCalls).toBe(1);
    const commentId = create.json().id as string;
    const binding = await pool.query(
      `SELECT surface_key, resource_version, binding_kind, entity_kind
       FROM content_moderation_bindings
       WHERE entity_id = $1::uuid AND surface_key = 'comment_body'`,
      [commentId],
    );
    expect(binding.rows[0]).toMatchObject({
      surface_key: "comment_body",
      resource_version: 1,
      binding_kind: "publication",
      entity_kind: "entity_comment",
    });

    // Guest create denied — no provider.
    fake.textCalls = 0;
    const guest = await app.inject({
      method: "POST",
      url,
      headers: {
        origin: webOrigin,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: { text: "guest write", parentCommentId: null },
    });
    expect([401, 403]).toContain(guest.statusCode);
    expect(fake.textCalls).toBe(0);

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const rejected = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(peer),
      payload: { text: "Замена с отказом на площадке", expectedVersion: 1 },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.text).toBeTruthy();

    const afterReject = await app.inject({
      method: "GET",
      url,
      headers: { cookie: peer.cookie },
    });
    const kept = afterReject.json().items.find((i: { id: string }) => i.id === commentId);
    expect(kept.body).toBe("Есть парковка у площадки?");
    expect(kept.version).toBe(1);

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const unavailable = await app.inject({
      method: "PUT",
      url: `/v1/comments/${commentId}`,
      headers: headers(peer),
      payload: { text: "Ещё одна замена при сбое площадки", expectedVersion: 1 },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");
    const after503 = await app.inject({
      method: "GET",
      url,
      headers: { cookie: peer.cookie },
    });
    const still = after503.json().items.find((i: { id: string }) => i.id === commentId);
    expect(still.body).toBe("Есть парковка у площадки?");
    expect(still.version).toBe(1);

    // Same-key replay and deletion remain safe while provider is down.
    const idem = key();
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const first = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Идемпотентный комментарий площадки", parentCommentId: null },
    });
    expect(first.statusCode).toBe(201);
    const afterCreate = fake.textCalls;
    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const replay = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Идемпотентный комментарий площадки", parentCommentId: null },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(fake.textCalls).toBe(afterCreate);

    fake.textCalls = 0;
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${first.json().id}`,
      headers: headers(author),
      payload: { expectedVersion: first.json().version },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);
    expect(fake.textCalls).toBe(0);
  });

  it("same-key replay skips provider; mismatched hash 409; delete zero calls", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const idem = key();
    const first = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Идемпотентный комментарий", parentCommentId: null },
    });
    expect(first.statusCode).toBe(201);
    const afterCreate = fake.textCalls;
    const replay = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Идемпотентный комментарий", parentCommentId: null },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(fake.textCalls).toBe(afterCreate);

    const mismatch = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Другой текст с тем же ключом", parentCommentId: null },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(fake.textCalls).toBe(afterCreate);

    fake.textCalls = 0;
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${first.json().id}`,
      headers: headers(author),
      payload: { expectedVersion: first.json().version },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);
    expect(fake.textCalls).toBe(0);
  });

  it("final fence rejects when parent game is no longer public after preflight", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    let sawProvider = false;
    fake.textFixture = async (input) => {
      sawProvider = true;
      await pool.query(
        `UPDATE games SET status = 'cancelled', version = version + 1, updated_at = clock_timestamp()
         WHERE id = $1::uuid`,
        [gameId],
      );
      return safeTextBatchDecision(input.texts.length);
    };
    const create = await app.inject({
      method: "POST",
      url,
      headers: headers(author),
      payload: { text: "Комментарий после отмены родителя", parentCommentId: null },
    });
    expect(sawProvider).toBe(true);
    expect(create.statusCode).toBe(404);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM entity_comments WHERE entity_id = $1::uuid`,
      [gameId],
    );
    expect(count.rows[0]!.n).toBe(0);
  });

  it("concurrent same-key create: one provider attempt; loser CIP then safe replay", async () => {
    const { gameId } = await createPublishedGame(author);
    const url = `/v1/games/${gameId}/comments`;
    const idem = key();
    let releaseProvider!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let enteredProvider = 0;
    fake.textFixture = async (input) => {
      enteredProvider += 1;
      await blocked;
      return safeTextBatchDecision(input.texts.length);
    };

    const first = app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Параллельный один ключ", parentCommentId: null },
    });
    // Wait until the winner has entered provider (claim already durable).
    for (let i = 0; i < 100 && enteredProvider === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(enteredProvider).toBe(1);

    const second = app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Параллельный один ключ", parentCommentId: null },
    });
    // Second must resolve as CIP without a second provider entry while first is blocked.
    const secondResult = await second;
    expect(enteredProvider).toBe(1);
    expect(secondResult.statusCode).toBe(409);
    expect(secondResult.json().code).toBe("COMMAND_IN_PROGRESS");

    releaseProvider();
    const firstResult = await first;
    expect(firstResult.statusCode).toBe(201);
    expect(fake.textCalls).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Параллельный один ключ", parentCommentId: null },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(firstResult.json().id);
    expect(fake.textCalls).toBe(1);

    const mismatch = await app.inject({
      method: "POST",
      url,
      headers: headers(author, idem),
      payload: { text: "Другое тело того же ключа", parentCommentId: null },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(fake.textCalls).toBe(1);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM entity_comments WHERE entity_id = $1::uuid AND deleted_at IS NULL`,
      [gameId],
    );
    expect(count.rows[0]!.n).toBe(1);
  });
});
