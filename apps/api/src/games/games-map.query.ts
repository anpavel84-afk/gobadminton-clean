import { eligibleGames, normalizeDiscovery, type DiscoveryFilter, type DiscoveryInput } from "./games-discovery.query";
import { effectiveVenueCtes } from "../venues/effective-venue.query";
import { unprocessable } from "../auth/problem";

const keys = new Set(["cityId", "temporalScope", "startsFrom", "startsBefore", "activityKind", "levelScaleId", "levelId", "venueId"]);
/** Inspect the raw query: framework parsing can hide duplicates/arrays. */
export function parseMapQuery(rawUrl: string): DiscoveryFilter {
  const question = rawUrl.indexOf("?");
  const raw = question < 0 ? "" : rawUrl.slice(question + 1);
  if (Buffer.byteLength(raw, "utf8") > 8192) throw unprocessable("MAP_QUERY_INVALID", "Слишком длинный запрос карты");
  const search = new URLSearchParams(raw);
  const input: DiscoveryInput = {};
  const seen = new Set<string>();
  for (const [key, value] of search) {
    if (!keys.has(key) || seen.has(key) || !value) throw unprocessable("MAP_QUERY_INVALID", "Некорректные параметры карты");
    seen.add(key);
    Object.assign(input, { [key]: value });
  }
  if (!input.cityId || input.temporalScope !== "upcoming") throw unprocessable("MAP_QUERY_INVALID", "Требуются cityId и temporalScope=upcoming");
  for (const key of ["startsFrom", "startsBefore"] as const) {
    const value = input[key];
    if (value && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw unprocessable("DATETIME_INVALID", `Некорректный ${key}`);
  }
  for (const key of ["startsFrom", "startsBefore"] as const) {
    const value = input[key];
    if (!value) continue;
    const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
    const days = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
    if (month! < 1 || month! > 12 || day! < 1 || day! > days || hour! > 23 || minute! > 59 || second! > 59) {
      throw unprocessable("DATETIME_INVALID", `Некорректный ${key}`);
    }
  }
  for (const key of ["levelScaleId", "levelId"] as const) {
    if (input[key] && input[key].length > 64) throw unprocessable("LEVEL_FILTER_INVALID", "Слишком длинный фильтр уровня");
  }
  return normalizeDiscovery(input);
}

export const MAP_MAX_BYTES = 2 * 1024 * 1024;
export const MAP_STATEMENT_MS = 1500;
export const MAP_REQUEST_MS = 2500;

/** All counts, canonical identities and previews share one statement snapshot.
 * Overflow gates stop downstream ranking/occupancy work. The participation join
 * only visits the selected <=600 Games, never multiplies aggregate Game counts.
 */
export function gamesMapQuery(filter: DiscoveryFilter, moderationEnabled = false): { sql: string; params: unknown[] } {
  const eligible = eligibleGames(filter, moderationEnabled);
  return { params: eligible.params, sql: `
    ${effectiveVenueCtes()},
    eligible AS MATERIALIZED (
      SELECT g.id, g.version, g.title, g.starts_at, g.ends_at, g.timezone,
             g.activity_kind, g.capacity, g.external_reserved_count,
             v.id AS venue_id, v.name, v.city_id, v.address, v.timezone AS venue_timezone,
             v.lifecycle_state, v.canonical_resolved,
             ST_Y(v.location::geometry) AS latitude, ST_X(v.location::geometry) AS longitude
      FROM games g JOIN effective_venues v ON v.source_id = g.venue_id
      WHERE ${eligible.where}
      LIMIT 20001
    ),
    classified AS MATERIALIZED (
      SELECT *, CASE
        WHEN NOT canonical_resolved THEN 'VENUE_CANONICAL_UNRESOLVED'
        WHEN latitude IS NULL OR longitude IS NULL
          OR NOT (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
          THEN 'VENUE_COORDINATES_INVALID'
        ELSE NULL END AS omission
      FROM eligible WHERE (SELECT count(*) FROM eligible) <= 20000
    ),
    groups AS MATERIALIZED (
      SELECT venue_id, count(*)::int AS game_count, min(starts_at) AS next_start
      FROM classified WHERE omission IS NULL GROUP BY venue_id LIMIT 201
    ),
    ranked AS (
      SELECT c.*, row_number() OVER (PARTITION BY venue_id ORDER BY starts_at, id) AS rank
      FROM classified c WHERE omission IS NULL AND (SELECT count(*) FROM groups) <= 200
    ),
    previews AS MATERIALIZED (SELECT * FROM ranked WHERE rank <= 3),
    occupancy AS (
      SELECT p.game_id, count(*)::int AS confirmed_count FROM participations p
      JOIN previews g ON g.id = p.game_id WHERE p.status = 'confirmed' GROUP BY p.game_id
    ),
    preview_json AS (
      SELECT g.*, COALESCE(o.confirmed_count, 0) AS confirmed_count,
        jsonb_build_object('id', g.id, 'version', g.version, 'title', g.title,
          'startsAt', g.starts_at, 'endsAt', g.ends_at, 'timezone', g.timezone,
          'activityKind', g.activity_kind,
          'capacity', g.capacity, 'externalReservedCount', g.external_reserved_count,
          'confirmedCount', COALESCE(o.confirmed_count, 0)) AS game
      FROM previews g LEFT JOIN occupancy o ON o.game_id = g.id
    ),
    items AS (
      SELECT gr.venue_id, gr.next_start,
        jsonb_build_object('venue', jsonb_build_object('id', p.venue_id, 'name', p.name,
          'cityId', p.city_id, 'address', p.address, 'timezone', p.venue_timezone,
          'latitude', p.latitude, 'longitude', p.longitude, 'lifecycleState', p.lifecycle_state),
          'matchingGameCount', gr.game_count, 'nextGameAt', gr.next_start,
          'games', jsonb_agg(p.game ORDER BY p.starts_at, p.id),
          'hasMoreGames', gr.game_count > 3) AS item
      FROM groups gr JOIN preview_json p ON p.venue_id = gr.venue_id
      GROUP BY gr.venue_id, gr.game_count, gr.next_start, p.name, p.city_id, p.address,
               p.venue_timezone, p.latitude, p.longitude, p.lifecycle_state, p.venue_id
    )
    SELECT statement_timestamp() AS generated_at, (SELECT min(starts_at) FROM eligible) AS earliest_start,
      (SELECT count(*)::int FROM eligible) AS matching_games,
      (SELECT count(*)::int FROM classified WHERE omission IS NULL) AS mappable_games,
      (SELECT count(*)::int FROM classified WHERE omission IS NOT NULL) AS unmapped_games,
      (SELECT count(*)::int FROM groups) AS venues,
      EXISTS(SELECT 1 FROM preview_json WHERE confirmed_count + external_reserved_count > capacity
        OR activity_kind NOT IN ('regular', 'trainer_led')) AS integrity_failure,
      COALESCE((SELECT jsonb_agg(item ORDER BY next_start, venue_id) FROM items), '[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', omission, 'gameCount', n) ORDER BY omission)
        FROM (SELECT omission, count(*)::int AS n FROM classified WHERE omission IS NOT NULL GROUP BY omission) w), '[]'::jsonb) AS warnings
  ` };
}
