/** Set-based read projection only: eight merge edges, no writes or guessed identity.
 * Seeds are trusted SQL owned by the caller, never request text. Invalid chains
 * retain the original row for legacy list/detail and are flagged for map omission.
 */
export function effectiveVenueCtes(seeds = "SELECT id FROM venues"): string {
  return `WITH RECURSIVE
    venue_walk AS (
      SELECT v.id AS source_id, v.id, v.lifecycle_state, v.canonical_venue_id,
             ARRAY[v.id] AS path, 0 AS depth
      FROM venues v JOIN (${seeds}) seeds ON seeds.id = v.id
      UNION ALL
      SELECT w.source_id, n.id, n.lifecycle_state, n.canonical_venue_id,
             w.path || n.id, w.depth + 1
      FROM venue_walk w JOIN venues n ON n.id = w.canonical_venue_id
      WHERE w.lifecycle_state = 'merged' AND w.depth < 8 AND NOT n.id = ANY(w.path)
    ),
    venue_terminal AS (
      SELECT DISTINCT ON (source_id) source_id, id, lifecycle_state <> 'merged' AS canonical_resolved
      FROM venue_walk ORDER BY source_id, depth DESC
    ),
    effective_venues AS (
      SELECT t.source_id, t.canonical_resolved, v.*
      FROM venue_terminal t JOIN venues v
        ON v.id = CASE WHEN t.canonical_resolved THEN t.id ELSE t.source_id END
    )`;
}
