import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { CommentsModule } from "../../src/comments/comments.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_comments_disposable";
  const hosted = url.pathname === "/gobadminton" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GMAP1_DISPOSABLE_DB === "1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "")
    && url.port === process.env.CI_DB_PORT;
  if (process.env.NODE_ENV !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search || url.hash || !(dedicated || hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type Actor = { userId: string; publicPlayerId: string; sessionId: string; csrfToken: string; cookie: string };
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("#394 EntityComments — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let pairs: PairFenceService;
  let author: Actor;
  let peer: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "comments-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await migrate(file);
    }
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "comments-synthetic-fixture-pepper!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "comments-fingerprint-fixture!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
      GAME_MODERATION_INTERNAL_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        GamesModule,
        VenuesModule,
        ProfilesModule,
        SafetyModule,
        CommentsModule,
      ],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
    pairs = ref.get(PairFenceService);
  }, 120000);

  async function migrate(file: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    author = await actor("Comment author");
    peer = await actor("Comment peer");
    outsider = await actor("Comment outsider");
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
    const publicPlayerId = (
      await pool.query<{ public_player_id: string }>(
        "SELECT public_player_id FROM player_social_profiles WHERE user_id=$1",
        [userId],
      )
    ).rows[0]!.public_player_id;
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      publicPlayerId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  const key = () => `comments-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }
  function get(who: Actor | null, url: string): Promise<Response> {
    return app.inject({
      method: "GET",
      url,
      headers: who ? { cookie: who.cookie } : {},
    }) as Promise<Response>;
  }
  function post(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: headers(who, idem),
    }) as Promise<Response>;
  }
  function put(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "PUT",
      url,
      payload: payload as object,
      headers: headers(who, idem),
    }) as Promise<Response>;
  }
  function del(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "DELETE",
      url,
      payload: payload as object,
      headers: headers(who, idem),
    }) as Promise<Response>;
  }

  async function createPublishedGame(owner: Actor) {
    const venue = await post(owner, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `Comments venue ${randomUUID()}`,
      address: "Synthetic Moscow",
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await post(owner, "/v1/games", {
      hostDisplayName: "Synthetic host",
      hostPublicContact: "telegram:@synthetic_private",
      venueId: venue.json().id,
      title: "Comments disposable game",
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
        terms: "PRIVATE TERMS SENTINEL",
      },
    });
    expect(draft.statusCode).toBe(201);
    const published = await post(owner, `/v1/games/${draft.json().id}/publish`, {
      expectedVersion: draft.json().version,
    });
    expect(published.statusCode).toBe(200);
    return {
      game: published.json() as { id: string; version: number; capacity: number },
      venueId: venue.json().id as string,
    };
  }

  it("create/read/reply/own edit/tombstone, foreign denial, unavailable parent, block and replay/CAS", async () => {
    const { game, venueId } = await createPublishedGame(author);
    const gameUrl = `/v1/games/${game.id}/comments`;
    const venueUrl = `/v1/venues/${venueId}/comments`;

    const guestEmpty = await get(null, gameUrl);
    expect(guestEmpty.statusCode).toBe(200);
    expect(guestEmpty.headers["cache-control"]).toBe("no-store");
    expect(guestEmpty.json()).toMatchObject({
      entityKind: "game",
      entityId: game.id,
      items: [],
      visibleCount: 0,
      canCreate: false,
    });

    const createIdem = key();
    const created = await post(author, gameUrl, { text: "Во сколько встречаемся?", parentCommentId: null }, createIdem);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      entityKind: "game",
      entityId: game.id,
      body: "Во сколько встречаемся?",
      deleted: false,
      version: 1,
      mine: true,
      parentCommentId: null,
    });
    const rootId = created.json().id as string;

    const replay = await post(author, gameUrl, { text: "Во сколько встречаемся?", parentCommentId: null }, createIdem);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(rootId);
    expect(replay.json().version).toBe(1);

    const reply = await post(peer, gameUrl, { text: "В 18:00 у входа", parentCommentId: rootId });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({
      parentCommentId: rootId,
      body: "В 18:00 у входа",
      mine: true,
    });

    const nested = await post(author, gameUrl, {
      text: "reply-to-reply rejected",
      parentCommentId: reply.json().id,
    });
    expect([400, 404, 422]).toContain(nested.statusCode);

    const listed = await get(null, gameUrl);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().visibleCount).toBe(2);
    expect(listed.json().items[0].replyCount).toBe(1);

    const replies = await get(null, `${gameUrl}?parentCommentId=${rootId}`);
    expect(replies.statusCode).toBe(200);
    expect(replies.json().items).toHaveLength(1);
    expect(replies.json().items[0].body).toBe("В 18:00 у входа");

    const foreignEdit = await put(peer, `/v1/comments/${rootId}`, {
      text: "hijack",
      expectedVersion: 1,
    });
    expect(foreignEdit.statusCode).toBe(404);

    const edited = await put(author, `/v1/comments/${rootId}`, {
      text: "Во сколько точно встречаемся?",
      expectedVersion: 1,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      body: "Во сколько точно встречаемся?",
      version: 2,
      edited: true,
      deleted: false,
    });

    const stale = await put(author, `/v1/comments/${rootId}`, {
      text: "stale",
      expectedVersion: 1,
    });
    expect(stale.statusCode).toBe(409);

    const deleted = await del(author, `/v1/comments/${rootId}`, { expectedVersion: 2 });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      body: null,
      deleted: true,
      version: 3,
    });
    const afterDelete = await get(null, gameUrl);
    expect(afterDelete.json().items[0].body).toBeNull();
    expect(afterDelete.json().items[0].deleted).toBe(true);
    expect(JSON.stringify(afterDelete.json())).not.toMatch(/Во сколько точно встречаемся/);

    // Replies remain usable under tombstone root.
    const repliesAfter = await get(null, `${gameUrl}?parentCommentId=${rootId}`);
    expect(repliesAfter.json().items[0].body).toBe("В 18:00 у входа");

    // Venue path works on canonical id.
    const venueComment = await post(peer, venueUrl, { text: "Есть парковка?", parentCommentId: null });
    expect(venueComment.statusCode).toBe(201);
    expect((await get(null, venueUrl)).json().items).toHaveLength(1);

    // Unavailable / private parent → indistinguishable 404, no count leak.
    const draftOnly = await post(author, "/v1/games", {
      hostDisplayName: "Synthetic host",
      hostPublicContact: "telegram:@synthetic_private",
      venueId,
      title: "Draft comments deny",
      startsAt: new Date(Date.now() + 8 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 8 * 86400000 + 7200000).toISOString(),
      timezone: "Europe/Moscow",
      applicationDeadlineAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      capacity: 4,
      externalReservedCount: 0,
      visibility: "public",
      formatKey: "doubles",
      activityKind: "regular",
      levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] },
      settlement: {
        mode: "external",
        purpose: "no_trainer_fee",
        priceMinor: null,
        currency: null,
        terms: "PRIVATE",
      },
    });
    expect(draftOnly.statusCode).toBe(201);
    const draftId = draftOnly.json().id as string;
    expect((await get(null, `/v1/games/${draftId}/comments`)).statusCode).toBe(404);
    expect((await post(author, `/v1/games/${draftId}/comments`, { text: "nope" })).statusCode).toBe(404);
    expect((await get(null, `/v1/games/${randomUUID()}/comments`)).statusCode).toBe(404);

    // Block hides author identity/body/count for authenticated reader; writer cannot reply.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pair = await pairs.lockOrCreate(client, author.userId, outsider.userId);
      await client.query(
        `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, pair_id)
         VALUES ($1, $2, $3)`,
        [outsider.userId, author.userId, pair.id],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const blockedList = await get(outsider, gameUrl);
    expect(blockedList.statusCode).toBe(200);
    expect(blockedList.json().items.every((row: { author?: { publicPlayerId?: string | null } }) =>
      row.author?.publicPlayerId !== author.publicPlayerId)).toBe(true);
    // Live non-deleted peer reply may remain; author's tombstone row must not expose author identity as public.
    const blockedReply = await post(outsider, gameUrl, {
      text: "blocked reply",
      parentCommentId: rootId,
    });
    expect([403, 404]).toContain(blockedReply.statusCode);

    // Capacity / public game projection unchanged by comments.
    const publicGame = await get(outsider, `/v1/games/${game.id}`);
    expect(publicGame.statusCode).toBe(200);
    expect(publicGame.json().capacity).toBe(game.capacity);
  });
});
