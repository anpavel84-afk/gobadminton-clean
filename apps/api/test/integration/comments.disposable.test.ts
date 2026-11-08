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
    // Isolated Admin simulation (HOST loopback, ADMIN_ORIGIN localhost ≠ PUBLIC_WEB, dedicated pepper).
    const adminOrigin = "http://localhost:19494";
    const adminPepper = "comments-synthetic-admin-pepper-only!!";
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "comments-synthetic-fixture-pepper!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "comments-synthetic-fingerprint-fixture-only",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
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

    const unrestrictedList = await get(author, gameUrl);
    expect(unrestrictedList.statusCode).toBe(200);
    expect(unrestrictedList.json().canCreate).toBe(true);

    // Restricted actor: list still readable, canCreate false, write 403 (capabilities unchanged).
    const adminUserId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [adminUserId, "Comments admin fixture"]);
    const principal = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [adminUserId],
      )
    ).rows[0]!.id;
    const restrictionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by)
         VALUES ($1,'profile.public','synthetic_fixture',clock_timestamp()+interval '1 hour',$2)
         RETURNING id`,
        [outsider.userId, principal],
      )
    ).rows[0]!.id;
    const restrictedList = await get(outsider, gameUrl);
    expect(restrictedList.statusCode).toBe(200);
    expect(restrictedList.json().canCreate).toBe(false);
    expect(restrictedList.json().visibleCount).toBe(0);
    const restrictedWrite = await post(outsider, gameUrl, { text: "restricted deny", parentCommentId: null });
    expect(restrictedWrite.statusCode).toBe(403);
    expect((await get(author, gameUrl)).json().canCreate).toBe(true);
    expect((await get(null, gameUrl)).json().canCreate).toBe(false);
    // Explicit reversal so later outsider block cases keep dedicated fixture semantics.
    await pool.query(
      `UPDATE user_restrictions
       SET revoked_at=clock_timestamp(), revoked_by=$2, revoke_reason_code='synthetic_reversal', version=version+1
       WHERE id=$1`,
      [restrictionId, principal],
    );

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

    // #507 I1: open public venue discussion (no attendance). Guest read; auth write.
    const venueListGuest = await get(null, venueUrl);
    expect(venueListGuest.statusCode).toBe(200);
    expect(venueListGuest.json()).toMatchObject({
      entityKind: "venue",
      entityId: venueId,
      items: [],
      visibleCount: 0,
      canCreate: false,
      nextCursor: null,
    });
    expect((await get(peer, venueUrl)).json().canCreate).toBe(true);

    const venueCreateIdem = key();
    const venueCreate = await post(peer, venueUrl, { text: "Есть парковка?", parentCommentId: null }, venueCreateIdem);
    expect(venueCreate.statusCode).toBe(201);
    expect(venueCreate.json()).toMatchObject({
      entityKind: "venue",
      entityId: venueId,
      body: "Есть парковка?",
      deleted: false,
      version: 1,
      mine: true,
    });
    const venueCreateReplay = await post(peer, venueUrl, { text: "Есть парковка?", parentCommentId: null }, venueCreateIdem);
    expect(venueCreateReplay.statusCode).toBe(201);
    expect(venueCreateReplay.json().id).toBe(venueCreate.json().id);
    expect(Number(
      (await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM entity_comments
         WHERE entity_kind='venue' AND entity_id=$1 AND body=$2`,
        [venueId, "Есть парковка?"],
      )).rows[0]?.n,
    )).toBe(1);

    const venueGuestList = await get(null, venueUrl);
    expect(venueGuestList.statusCode).toBe(200);
    expect(venueGuestList.json().items).toHaveLength(1);
    expect(venueGuestList.json().items[0].body).toBe("Есть парковка?");
    expect(venueGuestList.json().visibleCount).toBe(1);
    expect(venueGuestList.json().canCreate).toBe(false);

    const venueRootId = venueCreate.json().id as string;
    const venueReply = await post(author, venueUrl, {
      text: "Да, у главного входа",
      parentCommentId: venueRootId,
    });
    expect(venueReply.statusCode).toBe(201);
    expect(venueReply.json().parentCommentId).toBe(venueRootId);

    const venueUpdate = await put(peer, `/v1/comments/${venueRootId}`, {
      text: "Есть парковка у корпуса?",
      expectedVersion: 1,
    });
    expect(venueUpdate.statusCode).toBe(200);
    expect(venueUpdate.json()).toMatchObject({
      body: "Есть парковка у корпуса?",
      version: 2,
      edited: true,
    });

    const venueDeleteIdem = key();
    const ownedVenueDelete = await del(
      peer,
      `/v1/comments/${venueRootId}`,
      { expectedVersion: 2 },
      venueDeleteIdem,
    );
    expect(ownedVenueDelete.statusCode).toBe(200);
    expect(ownedVenueDelete.json()).toMatchObject({
      id: venueRootId,
      entityKind: "venue",
      body: null,
      deleted: true,
      version: 3,
    });
    const ownedVenueDeleteReplay = await del(
      peer,
      `/v1/comments/${venueRootId}`,
      { expectedVersion: 2 },
      venueDeleteIdem,
    );
    expect(ownedVenueDeleteReplay.statusCode).toBe(200);
    expect(ownedVenueDeleteReplay.json()).toEqual(ownedVenueDelete.json());

    // Guest create denied (no session)
    const guestCreate = await app.inject({
      method: "POST",
      url: venueUrl,
      headers: {
        origin,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: { text: "guest write", parentCommentId: null },
    });
    expect([401, 403]).toContain(guestCreate.statusCode);

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
