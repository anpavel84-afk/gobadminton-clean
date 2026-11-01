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
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_feedback_disposable";
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("PG-3 GameFeedback — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let manager: Actor;
  let anna: Actor;
  let ilya: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "pg3-feedback-synthetic",
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
      AUTH_PEPPER: "pg3-synthetic-fixture-pepper-only!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "pg3-synthetic-fingerprint-fixture!!",
      POST_GAME_INTERNAL_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), GamesModule, VenuesModule, ProfilesModule],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, "rollback/0048_game_reviews_notes.sql"), "utf8"));
      expect((await client.query("SELECT to_regclass('game_reviews') AS name")).rows[0].name).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
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
    env.POST_GAME_INTERNAL_ENABLED = true;
    manager = await actor("PG3 manager");
    anna = await actor("PG3 Anna");
    ilya = await actor("PG3 Ilya");
    outsider = await actor("PG3 outsider");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  const key = () => `pg3-synthetic-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return { cookie: who.cookie, origin, "x-csrf-token": who.csrfToken, "idempotency-key": idem };
  }
  function get(who: Actor, url: string): Promise<Response> {
    return app.inject({ method: "GET", url, headers: { cookie: who.cookie } }) as Promise<Response>;
  }
  function put(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "PUT",
      url,
      payload: payload as object,
      headers: headers(who, idem),
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
  function patch(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "PATCH",
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

  async function confirmWithTransition(gameId: string, userId: string, atOffsetHours = -4) {
    const part = await pool.query<{ id: string }>(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', clock_timestamp() + ($3 || ' hours')::interval)
       RETURNING id`,
      [gameId, userId, String(atOffsetHours)],
    );
    const id = part.rows[0]!.id;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version, at)
       VALUES ($1, NULL, 'confirmed', $2, 'test_confirm', 1, 1, clock_timestamp() + ($3 || ' hours')::interval)`,
      [id, userId, String(atOffsetHours)],
    );
    return id;
  }

  async function createEndedGameWithPlayers() {
    const venue = await post(manager, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `PG3 court ${randomUUID()}`,
      address: "Synthetic Moscow",
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await post(manager, "/v1/games", {
      hostDisplayName: "Synthetic host",
      hostPublicContact: "telegram:@synthetic_private",
      venueId: venue.json().id,
      title: "PG3 disposable game",
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
    const published = await post(manager, `/v1/games/${draft.json().id}/publish`, {
      expectedVersion: draft.json().version,
    });
    expect(published.statusCode).toBe(200);
    const gameId = published.json().id as string;
    await pool.query(
      `UPDATE games
       SET starts_at = clock_timestamp() - interval '3 hours',
           application_deadline_at = clock_timestamp() - interval '4 hours',
           ends_at = clock_timestamp() - interval '1 hour'
       WHERE id = $1`,
      [gameId],
    );
    const annaContext = await confirmWithTransition(gameId, anna.userId, -4);
    const ilyaContext = await confirmWithTransition(gameId, ilya.userId, -4);
    await put(manager, `/v1/games/${gameId}/outcome`, {
      expectedVersion: 0,
      outcome: "held",
    });
    const results = await get(anna, `/v1/games/${gameId}/results`);
    expect(results.statusCode).toBe(200);
    expect(results.json().feedback.installed).toBe(true);
    expect(
      results.json().feedback.capabilities.peerSubjects.some(
        (s: { contextId: string }) => s.contextId === ilyaContext,
      ),
    ).toBe(true);
    return { gameId, ilyaContext, annaContext };
  }

  it("creates peer review, reply, edit, note delete+replay and guards foreign/self/duplicate", async () => {
    const { gameId, ilyaContext, annaContext } = await createEndedGameWithPlayers();
    const skillsBefore = (
      await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM trainer_profiles")
    ).rows[0]!.n;
    const reportsBefore = (
      await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM abuse_reports")
    ).rows[0]!.n;

    const missingAssertion = await post(anna, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "play_again",
    });
    expect(missingAssertion.statusCode).toBe(422);

    const self = await post(anna, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: annaContext,
      peerRating: "play_again",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "не отмечено, но я была",
    });
    expect([422, 404]).toContain(self.statusCode);

    const foreign = await post(outsider, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "play_again",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "не относится",
    });
    expect(foreign.statusCode).toBe(404);

    const createIdem = key();
    const created = await post(
      anna,
      `/v1/games/${gameId}/reviews`,
      {
        kind: "peer",
        subjectContextId: ilyaContext,
        peerRating: "play_again",
        comment: "Спасибо за игру",
        tags: ["communication"],
        experienceAssertion: "i_experienced_this_game",
        discrepancyExplanation: "отметка ещё неизвестна, но я играла",
      },
      createIdem,
    );
    expect([200, 201]).toContain(created.statusCode);
    const reviewId = created.json().id as string;
    expect(created.json().direction).toBe("sent");
    expect(created.json().recipientDisplay).toContain("Ilya");

    const replay = await post(
      anna,
      `/v1/games/${gameId}/reviews`,
      {
        kind: "peer",
        subjectContextId: ilyaContext,
        peerRating: "play_again",
        comment: "Спасибо за игру",
        tags: ["communication"],
        experienceAssertion: "i_experienced_this_game",
        discrepancyExplanation: "отметка ещё неизвестна, но я играла",
      },
      createIdem,
    );
    expect(replay.statusCode).toBe(created.statusCode);
    expect(replay.json().id).toBe(reviewId);

    const dup = await post(anna, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "neutral",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "повтор",
    });
    // Owned duplicate must not 500 (aborted txn 25P02). 200 = existing receipt only.
    expect([200, 409]).toContain(dup.statusCode);
    if (dup.statusCode === 200) {
      expect(dup.json().id).toBe(reviewId);
      expect(dup.json().peerRating).toBe("play_again");
      expect(dup.json().peerRating).not.toBe("neutral");
    }

    const patched = await patch(anna, `/v1/reviews/${reviewId}`, {
      expectedVersion: created.json().version,
      comment: "Спасибо ещё раз",
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().version).toBe(created.json().version + 1);
    expect(patched.json().editedAt).toBeTruthy();

    const conflictPatch = await patch(anna, `/v1/reviews/${reviewId}`, {
      expectedVersion: created.json().version,
      comment: "stale",
    });
    expect(conflictPatch.statusCode).toBe(409);

    const foreignRead = await get(manager, `/v1/me/reviews?direction=received`);
    expect(foreignRead.statusCode).toBe(200);
    expect(foreignRead.json().items.some((r: { id: string }) => r.id === reviewId)).toBe(false);

    const received = await get(ilya, `/v1/me/reviews?direction=received`);
    expect(received.statusCode).toBe(200);
    expect(received.json().items.some((r: { id: string }) => r.id === reviewId)).toBe(true);

    const managerPeek = await get(manager, `/v1/games/${gameId}/results`);
    expect(managerPeek.statusCode).toBe(200);
    expect(
      (managerPeek.json().feedback.gameReviews as Array<{ id: string }>).some((r) => r.id === reviewId),
    ).toBe(false);

    const reply = await put(ilya, `/v1/reviews/${reviewId}/reply`, {
      expectedVersion: 0,
      text: "Взаимно",
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().reply.text).toBe("Взаимно");
    expect(reply.json().reply.version).toBe(1);

    const org = await post(anna, `/v1/games/${gameId}/reviews`, {
      kind: "organization",
      organizationScore: 5,
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "не отмечено, но встреча была",
    });
    expect([200, 201]).toContain(org.statusCode);
    expect(org.json().kind).toBe("organization");

    const note = await put(manager, `/v1/games/${gameId}/notes/${annaContext}`, {
      expectedVersion: 0,
      text: "Личная заметка менеджера",
    });
    expect([200, 201]).toContain(note.statusCode);
    expect(note.json().text).toBe("Личная заметка менеджера");

    const foreignNote = await get(anna, `/v1/games/${gameId}/notes/${annaContext}`);
    expect(foreignNote.statusCode).toBe(404);

    const delIdem = key();
    const deleted = await del(
      manager,
      `/v1/games/${gameId}/notes/${annaContext}`,
      { expectedVersion: note.json().version },
      delIdem,
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);

    const resurrect = await put(manager, `/v1/games/${gameId}/notes/${annaContext}`, {
      expectedVersion: deleted.json().version,
      text: "нельзя вернуть",
    });
    expect([409, 404]).toContain(resurrect.statusCode);

    const delReplay = await del(
      manager,
      `/v1/games/${gameId}/notes/${annaContext}`,
      { expectedVersion: note.json().version },
      delIdem,
    );
    expect(delReplay.statusCode).toBe(200);
    expect(delReplay.json().deleted).toBe(true);

    // No skill mutation / abuse side effect: persisted counts unchanged (empty fixture stays empty).
    const skillsAfter = (
      await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM trainer_profiles")
    ).rows[0]!.n;
    const reportsAfter = (
      await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM abuse_reports")
    ).rows[0]!.n;
    expect(skillsAfter).toBe(skillsBefore);
    expect(reportsAfter).toBe(reportsBefore);
  });

  it("playing manager peer create/capabilities; pending/nonplaying manager denied; note after revoke", async () => {
    const { gameId, ilyaContext, annaContext } = await createEndedGameWithPlayers();

    // Nonplaying manager: access role manager, no eligible own participation → no peer create.
    const nonplayingCaps = await get(manager, `/v1/games/${gameId}/results`);
    expect(nonplayingCaps.statusCode).toBe(200);
    expect(nonplayingCaps.json().feedback.capabilities.canCreatePeer).toBe(false);
    expect(nonplayingCaps.json().feedback.capabilities.canCreateNote).toBe(true);
    const nonplayingPeer = await post(manager, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "neutral",
      experienceAssertion: "i_experienced_this_game",
    });
    expect([404, 422]).toContain(nonplayingPeer.statusCode);

    // Pending-only manager participation is not eligible peer authorship.
    await pool.query(
      `INSERT INTO participations (game_id, user_id, status)
       VALUES ($1, $2, 'pending') ON CONFLICT (game_id, user_id) DO UPDATE SET status = 'pending', confirmed_at = NULL`,
      [gameId, manager.userId],
    );
    const pendingCaps = await get(manager, `/v1/games/${gameId}/results`);
    expect(pendingCaps.statusCode).toBe(200);
    expect(pendingCaps.json().feedback.capabilities.canCreatePeer).toBe(false);
    const pendingPeer = await post(manager, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "neutral",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "только pending",
    });
    expect([404, 422]).toContain(pendingPeer.statusCode);

    // Upgrade to concrete eligible confirmed participation (same proof path as peers).
    await pool.query(`DELETE FROM participations WHERE game_id = $1 AND user_id = $2`, [
      gameId,
      manager.userId,
    ]);
    const managerContext = await confirmWithTransition(gameId, manager.userId, -4);
    const playingCaps = await get(manager, `/v1/games/${gameId}/results`);
    expect(playingCaps.statusCode).toBe(200);
    expect(playingCaps.json().feedback.capabilities.canCreatePeer).toBe(true);
    expect(
      playingCaps.json().feedback.capabilities.peerSubjects.some(
        (s: { contextId: string }) => s.contextId === ilyaContext,
      ),
    ).toBe(true);
    expect(
      playingCaps.json().feedback.capabilities.peerSubjects.some(
        (s: { contextId: string }) => s.contextId === managerContext,
      ),
    ).toBe(false);

    const playingPeer = await post(manager, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "play_again",
      comment: "Играли вместе",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "организатор тоже играл",
    });
    expect([200, 201]).toContain(playingPeer.statusCode);
    expect(playingPeer.json().direction).toBe("sent");
    expect(playingPeer.json().kind).toBe("peer");

    // Personal note: create as manager, then revoke — author retains read/edit/delete; foreign forbidden.
    const note = await put(manager, `/v1/games/${gameId}/notes/${annaContext}`, {
      expectedVersion: 0,
      text: "Заметка до revoke",
    });
    expect([200, 201]).toContain(note.statusCode);
    await pool.query(
      `UPDATE game_managers SET status = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE game_id = $1 AND user_id = $2`,
      [gameId, manager.userId],
    );

    const ownRead = await get(manager, `/v1/games/${gameId}/notes/${annaContext}`);
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.json().text).toBe("Заметка до revoke");

    const foreignAfterRevoke = await get(anna, `/v1/games/${gameId}/notes/${annaContext}`);
    expect(foreignAfterRevoke.statusCode).toBe(404);
    const outsiderAfterRevoke = await get(outsider, `/v1/games/${gameId}/notes/${annaContext}`);
    expect(outsiderAfterRevoke.statusCode).toBe(404);

    const edited = await put(manager, `/v1/games/${gameId}/notes/${annaContext}`, {
      expectedVersion: note.json().version,
      text: "Заметка после revoke",
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().text).toBe("Заметка после revoke");

    const deleted = await del(manager, `/v1/games/${gameId}/notes/${annaContext}`, {
      expectedVersion: edited.json().version,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect((await get(manager, `/v1/games/${gameId}/notes/${annaContext}`)).statusCode).toBe(404);

    // New note create after revoke remains forbidden (current manager required).
    const createAfterRevoke = await put(manager, `/v1/games/${gameId}/notes/${ilyaContext}`, {
      expectedVersion: 0,
      text: "новая после revoke",
    });
    expect([403, 404]).toContain(createAfterRevoke.statusCode);
  });

  it("refuses writes when POST_GAME_INTERNAL_ENABLED is off", async () => {
    const { gameId, ilyaContext } = await createEndedGameWithPlayers();
    env.POST_GAME_INTERNAL_ENABLED = false;
    const denied = await post(anna, `/v1/games/${gameId}/reviews`, {
      kind: "peer",
      subjectContextId: ilyaContext,
      peerRating: "neutral",
      experienceAssertion: "i_experienced_this_game",
      discrepancyExplanation: "флаг выключен",
    });
    expect(denied.statusCode).toBe(503);
  });
});
