import { availablePlaces, type CapacityInput } from "../domain/capacity";
import { ProblemHttpException } from "../auth/problem";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { Pool, PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import { serviceUnavailable, unprocessable } from "../auth/problem";
import type { DiscoveryFilter } from "./games-discovery.query";
import { gamesMapQuery, MAP_MAX_BYTES, MAP_REQUEST_MS, MAP_STATEMENT_MS } from "./games-map.query";

// Compile the wire schema itself, so serialization cannot drift into a second
// hand-maintained contract. Load via the package export in source and build.
const openapi = JSON.parse(readFileSync(require.resolve("@gobadminton/contracts/openapi.json"), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: false });
addFormats(ajv);
const validateMap = ajv.compile({ $ref: "#/components/schemas/GameMap", components: openapi.components });

export type GameMapPreview = {
  cover?: { uploadedUrl: string | null };
  id: string; version: number; title: string; startsAt: string; endsAt: string;
  timezone: string; activityKind: "regular" | "trainer_led"; availablePlaces: number;
};
export type GameMapItem = {
  venue: { id: string; name: string; cityId: string; address: string; timezone: string;
    latitude: number; longitude: number; lifecycleState: "verified" | "unverified" | "retired" };
  matchingGameCount: number; nextGameAt: string; games: GameMapPreview[]; hasMoreGames: boolean;
};
export type GameMapDto = {
  schemaVersion: 1; scope: "city"; cityId: string;
  filters: Omit<DiscoveryFilter, "cityId">;
  generatedAt: string; validUntil: string; refreshAfterSeconds: 30;
  complete: true; coverage: "all_mappable_matching_venues";
  counts: { matchingGames: number; mappableGames: number; unmappedGames: number; venues: number };
  warnings: { code: "VENUE_CANONICAL_UNRESOLVED" | "VENUE_COORDINATES_INVALID"; gameCount: number }[];
  items: GameMapItem[];
};
type MapRow = {
  generated_at: Date; earliest_start: Date | null;
  matching_games: number; mappable_games: number; unmapped_games: number; venues: number;
  integrity_failure: boolean; items: (Omit<GameMapItem, "games"> & { games: (Omit<GameMapPreview, "availablePlaces"> & CapacityInput)[] })[]; warnings: GameMapDto["warnings"];
};
const unavailable = () => serviceUnavailable("GAME_MAP_TEMPORARILY_UNAVAILABLE", "Карта игр временно недоступна");
const tooBroad = () => unprocessable("GAME_MAP_QUERY_TOO_BROAD", "Слишком много игр для карты", "Уточните дату, вид игры или уровень");

export function serializeMap(row: MapRow, filter: DiscoveryFilter): GameMapDto {
  if (row.matching_games > 20000 || row.venues > 200) throw tooBroad();
  if (row.integrity_failure) throw unavailable();
  const { cityId, ...filters } = filter;
  const generatedAt = row.generated_at;
  const validUntil = new Date(Math.min(generatedAt.getTime() + 30000, row.earliest_start?.getTime() ?? Infinity));
  const items: GameMapItem[] = row.items.map(item => ({
    ...item,
    nextGameAt: new Date(item.nextGameAt).toISOString(),
    games: item.games.map(game => {
      const { capacity, externalReservedCount, confirmedCount, ...preview } = game;
      return { ...preview,
        startsAt: new Date(game.startsAt).toISOString(), endsAt: new Date(game.endsAt).toISOString(),
        availablePlaces: availablePlaces({ capacity, externalReservedCount, confirmedCount }),
      };
    }),
  }));
  const result: GameMapDto = {
    schemaVersion: 1, scope: "city", cityId: cityId!, filters,
    generatedAt: generatedAt.toISOString(), validUntil: validUntil.toISOString(), refreshAfterSeconds: 30,
    complete: true, coverage: "all_mappable_matching_venues",
    counts: { matchingGames: row.matching_games, mappableGames: row.mappable_games, unmappedGames: row.unmapped_games, venues: row.venues },
    warnings: row.warnings, items,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAP_MAX_BYTES) throw tooBroad();
  if (!validateMap(result)) throw unavailable();
  return result;
}

/** Whole operation deadline includes pool acquisition; a late acquisition is
 * immediately released. On timeout/disconnect destroy the connection to cancel
 * pending SQL, rather than leave a live transaction in the pool. No row locks.
 */
export async function readGamesMap(pool: Pool, filter: DiscoveryFilter, signal?: AbortSignal, moderationEnabled = false): Promise<GameMapDto> {
  const started = performance.now();
  let client: PoolClient | undefined;
  let stopped = false;
  let committed = false;
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => {
      stopped = true;
      if (client) { client.release(true); client = undefined; }
      reject(unavailable());
    };
  });
  const timer = setTimeout(stop, MAP_REQUEST_MS);
  signal?.addEventListener("abort", stop, { once: true });
  const operation = async () => {
    const acquired = await pool.connect();
    if (stopped) { acquired.release(); throw unavailable(); }
    client = acquired;
    await acquired.query(`BEGIN READ ONLY; SET LOCAL statement_timeout = '${MAP_STATEMENT_MS}ms'; SET LOCAL TIME ZONE 'UTC'`);
    const query = gamesMapQuery(filter, moderationEnabled);
    const result = await acquired.query<MapRow>(query.sql, query.params);
    const dto = serializeMap(result.rows[0]!, filter);
    await acquired.query("COMMIT");
    committed = true;
    if (performance.now() - started >= MAP_REQUEST_MS) throw unavailable();
    return dto;
  };
  try {
    if (signal?.aborted) stop();
    return await Promise.race([operation(), interrupted]);
  } catch (error) {
    // Preserve only the explicit bounded query error; DB/internal details never escape.
    if (error instanceof ProblemHttpException &&
        (error.getResponse() as { code?: string }).code === "GAME_MAP_QUERY_TOO_BROAD") throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    // Destruction also rolls back any transaction after statement/integrity failure.
    if (client) client.release(!committed || stopped);
  }
}
