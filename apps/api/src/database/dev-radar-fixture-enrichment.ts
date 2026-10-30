/**
 * DEV-only radar fixture enrichment entrypoint (six a17e… identities).
 * Build output: apps/api/dist/database/dev-radar-fixture-enrichment.js
 *
 *   node dist/database/dev-radar-fixture-enrichment.js --manifest ./manifest.json --as-of 2026-10-30T00:00:00.000Z
 *   node dist/database/dev-radar-fixture-enrichment.js --manifest ./manifest.json --as-of 2026-10-30T00:00:00.000Z --apply
 *
 * Defaults to dry-run. Refuses outside exact DEV Moscow fixture gate. No binaries in Git.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { loadEnv } from "../config/env";
import { createDatabase } from "./client";
import {
  DEV_MOSCOW_PEER_IDS,
  DEV_MOSCOW_FIXTURE_IDENTITY_SQL,
  ensureDevMoscowFixtureSessions,
  devMoscowFixturesEnabled,
} from "../radar/dev-moscow-test";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
import { DIRECTORY_CONSENT_POLICY_VERSION } from "../profiles/constants";

/** Truthful Russian notice: fictitious DEV organizer, contact unavailable. Never a fake phone/email/link. */
export function fixtureHostPublicContact(ordinal: number): string {
  return `Организатор тестовый (фикстура DEV Москва ${ordinal}); контакт недоступен`;
}

export type FixturePersona = {
  userId: string;
  ordinal: number;
  displayName: string;
  bio: string;
  areaKey: string;
  levelId: string;
  coverFileKey: "courts" | "gear";
  games: number;
};

export type EnrichmentManifest = {
  asOf: string;
  operationKey: string;
  venueId: string;
  coverPaths: { courts: string; gear: string };
  avatars: Array<{ userId: string; path: string; sha256: string }>;
};

export const FIXTURE_PERSONAS: FixturePersona[] = [
  {
    userId: DEV_MOSCOW_PEER_IDS[0]!,
    ordinal: 1,
    displayName: "TEST · DEV Москва 1",
    bio: "Синтетический игрок DEV. Люблю спокойные парные на Соколе, обычно вечером после работы. Ищу партнёров уровня около 3.0, без турнирного давления.",
    areaKey: "Сокол",
    levelId: "3.0",
    coverFileKey: "courts",
    games: 2,
  },
  {
    userId: DEV_MOSCOW_PEER_IDS[1]!,
    ordinal: 2,
    displayName: "TEST · DEV Москва 2",
    bio: "Тестовый профиль DEV. Играю в Хамовниках по выходным, предпочитаю смешанные пары и дружеский темп. Рада новым знакомым из каталога.",
    areaKey: "Хамовники",
    levelId: "2.5",
    coverFileKey: "gear",
    games: 1,
  },
  {
    userId: DEV_MOSCOW_PEER_IDS[2]!,
    ordinal: 3,
    displayName: "TEST · DEV Москва 3",
    bio: "DEV-фикстура. Базовый уровень, часто на Измайлово. Ищу регулярные вечерние игры 3.5, короткие ротации на двух кортах.",
    areaKey: "Измайлово",
    levelId: "3.5",
    coverFileKey: "courts",
    games: 2,
  },
  {
    userId: DEV_MOSCOW_PEER_IDS[3]!,
    ordinal: 4,
    displayName: "TEST · DEV Москва 4",
    bio: "Синтетический DEV-профиль. Живу у метро Аэропорт, играю утром в будни. Открыта к одиночным и парным на комфортном темпе.",
    areaKey: "Аэропорт",
    levelId: "3.0",
    coverFileKey: "gear",
    games: 1,
  },
  {
    userId: DEV_MOSCOW_PEER_IDS[4]!,
    ordinal: 5,
    displayName: "TEST · DEV Москва 5",
    bio: "Тестовый игрок DEV из Марьиной Рощи. Люблю быстрые ротации и разминку перед игрой. Ищу компанию уровня около 4.0 на публичные игры.",
    areaKey: "Марьина Роща",
    levelId: "4.0",
    coverFileKey: "courts",
    games: 2,
  },
  {
    userId: DEV_MOSCOW_PEER_IDS[5]!,
    ordinal: 6,
    displayName: "TEST · DEV Москва 6",
    bio: "DEV-фикстура. Район Крылатское, спокойные парные в выходные. Без реальных контактов — только каталог и будущие тестовые игры.",
    areaKey: "Крылатское",
    levelId: "2.5",
    coverFileKey: "gear",
    games: 1,
  },
];

export function parseEnrichmentArgs(argv: string[]): { apply: boolean; manifestPath: string; asOf: string } {
  const options = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply" && !apply) { apply = true; continue; }
    if (!arg || !["--manifest", "--as-of"].includes(arg) || options.has(arg)) throw new Error("INVALID_ARGUMENTS");
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS");
    options.set(arg, value);
  }
  const manifestPath = options.get("--manifest");
  const asOf = options.get("--as-of");
  if (!manifestPath || !asOf || Number.isNaN(Date.parse(asOf))) throw new Error("INVALID_ARGUMENTS");
  return { apply, manifestPath, asOf };
}

export function validateManifest(raw: unknown, asOf: string): EnrichmentManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_MANIFEST");
  const m = raw as Record<string, unknown>;
  if (typeof m.asOf !== "string" || m.asOf !== asOf || Number.isNaN(Date.parse(m.asOf))) throw new Error("AS_OF_MISMATCH");
  if (typeof m.operationKey !== "string" || !/^[a-z0-9][a-z0-9._-]{2,64}$/i.test(m.operationKey)) throw new Error("INVALID_OPERATION_KEY");
  if (typeof m.venueId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.venueId)) throw new Error("INVALID_VENUE_ID");
  const covers = m.coverPaths;
  if (!covers || typeof covers !== "object" || Array.isArray(covers)) throw new Error("INVALID_COVER_PATHS");
  const c = covers as Record<string, unknown>;
  if (typeof c.courts !== "string" || typeof c.gear !== "string") throw new Error("INVALID_COVER_PATHS");
  if (!Array.isArray(m.avatars) || m.avatars.length !== 6) throw new Error("INVALID_AVATARS");
  const avatars = m.avatars.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("INVALID_AVATARS");
    const row = item as Record<string, unknown>;
    if (typeof row.userId !== "string" || typeof row.path !== "string" || typeof row.sha256 !== "string") throw new Error("INVALID_AVATARS");
    if (!DEV_MOSCOW_PEER_IDS.includes(row.userId)) throw new Error("FOREIGN_AVATAR_IDENTITY");
    if (!/^[0-9a-f]{64}$/i.test(row.sha256)) throw new Error("INVALID_AVATAR_HASH");
    return { userId: row.userId, path: row.path, sha256: row.sha256.toLowerCase() };
  });
  if (new Set(avatars.map((a) => a.userId)).size !== 6) throw new Error("DUPLICATE_AVATAR_IDENTITY");
  return {
    asOf: m.asOf,
    operationKey: m.operationKey,
    venueId: m.venueId,
    coverPaths: { courts: c.courts, gear: c.gear },
    avatars,
  };
}

export function operationId(manifest: EnrichmentManifest, userId: string, action: string, slot = ""): string {
  const base = `radar-fixture:${manifest.operationKey}:${manifest.asOf}:${userId}:${action}${slot ? `:${slot}` : ""}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 64);
}

export function gameTitle(persona: FixturePersona, slot: number): string {
  return `TEST · DEV Москва ${persona.ordinal} · игра ${slot}`;
}

export function planGameSchedule(asOf: string, ordinal: number, slot: number): { startsAt: string; endsAt: string; deadlineAt: string } {
  const start = Date.parse(asOf) + ((ordinal + slot) * 36 + 24) * 3_600_000;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3_600_000).toISOString(),
    deadlineAt: new Date(start - 3_600_000).toISOString(),
  };
}

export type PersonaPlan = {
  userId: string;
  displayName: string;
  actions: string[];
  skipReasons: string[];
};

export function planPersonaActions(input: {
  persona: FixturePersona;
  profile: { bio: string | null; city_id: string | null; area_key: string | null; level_id: string | null; directory_visible: boolean; avatar_key: string | null; cover_key: string | null; version: number } | null;
  gameTitles: string[];
}): PersonaPlan {
  const actions: string[] = [];
  const skipReasons: string[] = [];
  const p = input.persona;
  if (!input.profile) {
    skipReasons.push("PROFILE_MISSING");
    return { userId: p.userId, displayName: p.displayName, actions, skipReasons };
  }
  if (input.profile.bio !== p.bio || input.profile.city_id !== MOSCOW_CITY_ID || input.profile.area_key !== p.areaKey || input.profile.level_id !== p.levelId) {
    actions.push("patch_profile");
  } else skipReasons.push("PROFILE_ALREADY_ENRICHED");
  if (!input.profile.directory_visible) actions.push("set_visibility");
  else skipReasons.push("DIRECTORY_ALREADY_VISIBLE");
  if (!input.profile.avatar_key) actions.push("upload_avatar");
  else skipReasons.push("AVATAR_PRESENT");
  if (!input.profile.cover_key) actions.push("upload_cover");
  else skipReasons.push("COVER_PRESENT");
  for (let slot = 1; slot <= p.games; slot++) {
    const title = gameTitle(p, slot);
    if (input.gameTitles.includes(title)) skipReasons.push(`GAME_EXISTS:${slot}`);
    else actions.push(`create_game:${slot}`);
  }
  return { userId: p.userId, displayName: p.displayName, actions, skipReasons };
}

async function readBoundedFile(filePath: string, limit: number): Promise<Buffer> {
  if (!path.isAbsolute(filePath)) throw new Error("INVALID_MEDIA_PATH");
  const resolved = await realpath(filePath);
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("INVALID_MEDIA_FILE");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new Error("INVALID_MEDIA_FILE");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Outer table must stay `users` (no alias): DEV_MOSCOW_FIXTURE_IDENTITY_SQL correlates to users.display_name. */
export async function assertFixtureActor(client: PoolClient, userId: string): Promise<{ sessionId: string; publicPlayerId: string; version: number }> {
  if (!DEV_MOSCOW_PEER_IDS.includes(userId)) throw new Error("FOREIGN_IDENTITY");
  const expectedName = FIXTURE_PERSONAS.find((p) => p.userId === userId)?.displayName;
  if (!expectedName) throw new Error("FOREIGN_IDENTITY");
  const row = await client.query<{
    display_name: string;
    credentials: boolean;
    fixture: boolean;
    session_id: string | null;
    public_player_id: string;
    version: number;
  }>(
    `SELECT users.display_name,
            EXISTS(SELECT 1 FROM external_identities e WHERE e.user_id=users.id) credentials,
            ${DEV_MOSCOW_FIXTURE_IDENTITY_SQL} fixture,
            (SELECT s.id FROM app_sessions s WHERE s.user_id=users.id AND s.revoked_at IS NULL AND s.csrf_ciphertext='!fixture-no-login' AND s.expires_at>clock_timestamp() ORDER BY s.created_at DESC LIMIT 1) session_id,
            p.public_player_id, p.version
     FROM users JOIN player_social_profiles p ON p.user_id=users.id WHERE users.id=$1`,
    [userId],
  );
  const current = row.rows[0];
  if (!current) throw new Error("FIXTURE_NOT_MATERIALIZED");
  if (current.display_name !== expectedName || current.credentials || !current.fixture) throw new Error("FIXTURE_IDENTITY_COLLISION");
  if (!current.session_id) throw new Error("FIXTURE_SESSION_INACTIVE");
  return { sessionId: current.session_id, publicPlayerId: current.public_player_id, version: current.version };
}

export async function loadDryRunReport(pool: Pool, manifest: EnrichmentManifest): Promise<object[]> {
  const report: object[] = [];
  for (const persona of FIXTURE_PERSONAS) {
    const profile = (await pool.query(
      `SELECT bio, city_id, area_key, level_id, directory_visible, avatar_key, cover_key, version, public_player_id
       FROM player_social_profiles WHERE user_id=$1`, [persona.userId])).rows[0] ?? null;
    const games = await pool.query<{ title: string; id: string; status: string }>(
      `SELECT id, title, status FROM games WHERE created_by_user_id=$1 AND title LIKE $2`,
      [persona.userId, `TEST · DEV Москва ${persona.ordinal} · игра %`]);
    const plan = planPersonaActions({
      persona,
      profile,
      gameTitles: games.rows.map((g) => g.title),
    });
    // Readonly fixture session status for operators; never materializes or renews in dry-run.
    const fixture = await pool.query<{
      display_name: string | null;
      credentials: boolean;
      fixture: boolean;
      session_id: string | null;
      session_expires_at: Date | null;
    }>(
      `SELECT users.display_name,
              EXISTS(SELECT 1 FROM external_identities e WHERE e.user_id=users.id) credentials,
              COALESCE(${DEV_MOSCOW_FIXTURE_IDENTITY_SQL}, false) fixture,
              (SELECT s.id FROM app_sessions s WHERE s.user_id=users.id AND s.revoked_at IS NULL AND s.csrf_ciphertext='!fixture-no-login' AND s.expires_at>clock_timestamp() ORDER BY s.created_at DESC LIMIT 1) session_id,
              (SELECT s.expires_at FROM app_sessions s WHERE s.user_id=users.id AND s.revoked_at IS NULL AND s.csrf_ciphertext='!fixture-no-login' ORDER BY s.created_at DESC LIMIT 1) session_expires_at
       FROM users WHERE users.id=$1`,
      [persona.userId],
    );
    const status = fixture.rows[0];
    let fixtureStatus: string;
    if (!status || !status.display_name) fixtureStatus = "FIXTURE_MISSING";
    else if (status.display_name !== persona.displayName || status.credentials || !status.fixture) fixtureStatus = "FIXTURE_IDENTITY_COLLISION";
    else if (!status.session_id) fixtureStatus = status.session_expires_at ? "FIXTURE_SESSION_EXPIRED" : "FIXTURE_SESSION_MISSING";
    else fixtureStatus = "FIXTURE_SESSION_ACTIVE";
    report.push({
      ...plan,
      publicPlayerId: profile?.public_player_id ?? null,
      existingGames: games.rows.map((g) => ({ id: g.id, title: g.title, status: g.status })),
      fixtureStatus,
      mode: "dry-run",
    });
  }
  return report;
}

type OwnProfile = {
  version: number;
  bio: string | null;
  cityId: string | null;
  areaKey: string | null;
  level: { levelId: string } | null;
  directoryVisible: boolean;
  avatar?: { uploadedUrl: string | null } | null;
  cover?: { uploadedUrl: string | null } | null;
};

type ApplyServices = {
  profiles: {
    getOwn: (userId: string) => Promise<OwnProfile>;
    patchOwn: (userId: string, sessionId: string, key: string, input: Record<string, unknown>) => Promise<{ body: OwnProfile }>;
    setVisibility: (userId: string, sessionId: string, key: string, input: Record<string, unknown>) => Promise<{ body: OwnProfile }>;
  };
  avatars: {
    mutate: (
      actor: { userId: string; sessionId: string },
      key: string,
      version: unknown,
      upload: { body: Buffer; mime: string },
      slot: "avatar" | "cover",
    ) => Promise<{ version: number; avatar?: unknown; cover?: unknown }>;
  };
  games: {
    createDraft: (userId: string, sessionId: string, key: string, input: Record<string, unknown>) => Promise<{ body: { id: string; version: number; status: string } }>;
    publish: (userId: string, sessionId: string, gameId: string, key: string, version: number) => Promise<{ body: { id: string; version: number; status: string } }>;
  };
};

async function applyPersona(
  pool: Pool,
  services: ApplyServices,
  manifest: EnrichmentManifest,
  persona: FixturePersona,
  emit: (line: object) => void,
): Promise<void> {
  const client = await pool.connect();
  let actor: { sessionId: string; publicPlayerId: string; version: number };
  try {
    await client.query("BEGIN");
    actor = await assertFixtureActor(client, persona.userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const receipt: Record<string, unknown> = {
    userId: persona.userId,
    publicPlayerId: actor.publicPlayerId,
    mode: "apply",
    affected: {} as Record<string, unknown>,
  };
  const affected = receipt.affected as Record<string, unknown>;

  try {
    const profile = await services.profiles.getOwn(persona.userId);
    if (profile.bio !== persona.bio || profile.cityId !== MOSCOW_CITY_ID || profile.areaKey !== persona.areaKey || profile.level?.levelId !== persona.levelId) {
      const patched = await services.profiles.patchOwn(persona.userId, actor.sessionId, operationId(manifest, persona.userId, "profile"), {
        expectedVersion: profile.version,
        displayName: persona.displayName,
        cityId: MOSCOW_CITY_ID,
        areaKey: persona.areaKey,
        bio: persona.bio,
        contactPolicy: "requests",
        level: { scaleId: "ntrp", scaleVersion: 1, levelId: persona.levelId, provenance: "self_declared" },
      });
      affected.profileVersion = patched.body.version;
    }
    const afterPatch = await services.profiles.getOwn(persona.userId);
    if (!afterPatch.directoryVisible) {
      const visible = await services.profiles.setVisibility(persona.userId, actor.sessionId, operationId(manifest, persona.userId, "visibility"), {
        expectedVersion: afterPatch.version,
        directoryVisible: true,
        consentPolicyVersion: DIRECTORY_CONSENT_POLICY_VERSION,
      });
      affected.directoryVisible = visible.body.directoryVisible;
      affected.profileVersion = visible.body.version;
    }

    const avatarMeta = manifest.avatars.find((a) => a.userId === persona.userId);
    if (!avatarMeta) throw new Error("AVATAR_MANIFEST_MISSING");
    const latest = await services.profiles.getOwn(persona.userId);
    if (!latest.avatar?.uploadedUrl) {
      const bytes = await readBoundedFile(avatarMeta.path, 3 * 1024 * 1024);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== avatarMeta.sha256) throw new Error("AVATAR_HASH_MISMATCH");
      const uploaded = await services.avatars.mutate(
        { userId: persona.userId, sessionId: actor.sessionId },
        operationId(manifest, persona.userId, "avatar"),
        String(latest.version),
        { body: bytes, mime: "image/png" },
        "avatar",
      );
      affected.avatar = uploaded.avatar ?? null;
      affected.profileVersion = uploaded.version;
    }

    const afterAvatar = await services.profiles.getOwn(persona.userId);
    if (!afterAvatar.cover?.uploadedUrl) {
      const coverPath = persona.coverFileKey === "courts" ? manifest.coverPaths.courts : manifest.coverPaths.gear;
      const coverBytes = await readBoundedFile(coverPath, 3 * 1024 * 1024);
      const mime = coverPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const uploaded = await services.avatars.mutate(
        { userId: persona.userId, sessionId: actor.sessionId },
        operationId(manifest, persona.userId, "cover"),
        String(afterAvatar.version),
        { body: coverBytes, mime },
        "cover",
      );
      affected.cover = uploaded.cover ?? null;
      affected.profileVersion = uploaded.version;
    }

    const games: object[] = [];
    for (let slot = 1; slot <= persona.games; slot++) {
      const title = gameTitle(persona, slot);
      const existing = await pool.query<{ id: string; status: string; version: number }>(
        `SELECT id, status, version FROM games WHERE created_by_user_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1`,
        [persona.userId, title],
      );
      if (existing.rows[0]) {
        const game = existing.rows[0];
        if (game.status === "draft") {
          const published = await services.games.publish(
            persona.userId,
            actor.sessionId,
            game.id,
            operationId(manifest, persona.userId, "publish", String(slot)),
            game.version,
          );
          games.push({ id: published.body.id, title, status: published.body.status, action: "published_existing" });
        } else {
          games.push({ id: game.id, title, status: game.status, action: "reused" });
        }
        continue;
      }
      const schedule = planGameSchedule(manifest.asOf, persona.ordinal, slot);
      const created = await services.games.createDraft(
        persona.userId,
        actor.sessionId,
        operationId(manifest, persona.userId, "game", String(slot)),
        {
          hostDisplayName: persona.displayName,
          hostPublicContact: fixtureHostPublicContact(persona.ordinal),
          venueId: manifest.venueId,
          title,
          startsAt: schedule.startsAt,
          endsAt: schedule.endsAt,
          timezone: "Europe/Moscow",
          applicationDeadlineAt: schedule.deadlineAt,
          capacity: 4,
          externalReservedCount: 0,
          visibility: "public",
          formatKey: "doubles",
          activityKind: "regular",
          levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: [persona.levelId] },
          settlement: {
            mode: "external",
            purpose: "no_trainer_fee",
            priceMinor: null,
            currency: null,
            terms: "TEST · DEV fixture game. External settlement unset; no real booking.",
          },
        },
      );
      const published = await services.games.publish(
        persona.userId,
        actor.sessionId,
        created.body.id,
        operationId(manifest, persona.userId, "publish", String(slot)),
        created.body.version,
      );
      games.push({ id: published.body.id, title, status: published.body.status, action: "created" });
    }
    affected.games = games;
    emit({ ok: true, ...receipt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPLY_FAILED";
    const body = typeof error === "object" && error && "getResponse" in error
      ? (error as { getResponse: () => unknown }).getResponse()
      : undefined;
    const code = body && typeof body === "object" && body !== null && "code" in body && typeof (body as { code: unknown }).code === "string"
      ? (body as { code: string }).code
      : message;
    emit({ ok: false, userId: persona.userId, publicPlayerId: actor.publicPlayerId, blocker: code, mode: "apply" });
    throw error;
  }
}

export async function main(argv: string[], rawEnv: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args = parseEnrichmentArgs(argv);
  const env = loadEnv(rawEnv) as AppEnv;
  if (!devMoscowFixturesEnabled(env)) throw new Error("DEV_MOSCOW_GATE_REFUSED");
  const manifestRaw = JSON.parse(await readFile(args.manifestPath, "utf8"));
  const manifest = validateManifest(manifestRaw, args.asOf);
  const { pool } = createDatabase(env.DATABASE_URL);
  try {
    const venue = await pool.query<{ id: string; lifecycle_state: string; city_id: string }>(
      `SELECT id, lifecycle_state, city_id FROM venues WHERE id=$1`, [manifest.venueId]);
    if (!venue.rows[0] || venue.rows[0].city_id !== MOSCOW_CITY_ID || !["verified", "unverified"].includes(venue.rows[0].lifecycle_state)) {
      throw new Error("VENUE_NOT_APPROVED_FOR_DEV_FIXTURE");
    }
    if (!args.apply) {
      const report = await loadDryRunReport(pool, manifest);
      for (const line of report) console.log(JSON.stringify(line));
      console.log(JSON.stringify({ mode: "dry-run", asOf: manifest.asOf, operationKey: manifest.operationKey, personas: 6 }));
      return 0;
    }
    if (env.CONTENT_MODERATION_PROVIDER !== "openai" || !env.AVATAR_MEDIA_ROOT) {
      throw new Error("MEDIA_PIPELINE_UNAVAILABLE");
    }
    // Nest boots only for --apply so dry-run/unit imports stay free of CoreModule side effects.
    // Minimal transient context: Core + Profiles + Games (+ JobEnqueue DI). No AppModule/JobsModule workers.
    await import("reflect-metadata");
    const { Module, Global } = await import("@nestjs/common");
    const { NestFactory } = await import("@nestjs/core");
    const { CoreModule } = await import("../core.module");
    const { ProfilesModule } = await import("../profiles/profiles.module");
    const { GamesModule } = await import("../games/games.module");
    const { JobEnqueueService } = await import("../jobs/job-enqueue.service");
    const { ProfilesService } = await import("../profiles/profiles.service");
    const { AvatarService } = await import("../profiles/avatar.service");
    const { GamesService } = await import("../games/games.service");
    const { APP_ENV, DATABASE_POOL } = await import("../tokens");
    @Global()
    @Module({ providers: [JobEnqueueService], exports: [JobEnqueueService] })
    class EnrichmentJobEnqueueBridge {}
    @Module({ imports: [CoreModule, EnrichmentJobEnqueueBridge, ProfilesModule, GamesModule] })
    class EnrichmentApplyModule {}
    const app = await NestFactory.createApplicationContext(EnrichmentApplyModule, { logger: false });
    try {
      const runtimeEnv = app.get<AppEnv>(APP_ENV);
      if (!devMoscowFixturesEnabled(runtimeEnv)) throw new Error("DEV_MOSCOW_GATE_REFUSED");
      const runtimePool = app.get<Pool>(DATABASE_POOL);
      // Trusted --apply may renew the six fixture sessions without Owner login priming.
      const boot = await runtimePool.connect();
      try {
        await boot.query("BEGIN");
        await ensureDevMoscowFixtureSessions(boot, runtimeEnv);
        await boot.query("COMMIT");
      } catch (error) {
        await boot.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        boot.release();
      }
      const services: ApplyServices = {
        profiles: app.get(ProfilesService),
        avatars: app.get(AvatarService),
        games: app.get(GamesService),
      };
      let failed = 0;
      for (const persona of FIXTURE_PERSONAS) {
        try {
          await applyPersona(runtimePool, services, manifest, persona, (line) => console.log(JSON.stringify(line)));
        } catch {
          failed += 1;
        }
      }
      console.log(JSON.stringify({ mode: "apply", asOf: manifest.asOf, operationKey: manifest.operationKey, failed }));
      return failed === 0 ? 0 : 1;
    } finally {
      await app.close();
      await CoreModule.close().catch(() => undefined);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    const message = error instanceof Error ? error.message : "ENRICHMENT_REFUSED";
    console.error(JSON.stringify({ ok: false, blocker: message }));
    process.exitCode = 1;
  });
}
