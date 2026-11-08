import type { PoolClient } from "pg";
import { unrestrictedSql } from "../restrictions/policy";
import { effectiveVenueCtes } from "./effective-venue.query";
import {
  availableSummary,
  emptySummary,
  unavailableSummary,
  type CommunityRatingSummary,
} from "./venue-community.policy";

/** Eligible aggregate predicates — single set-based statement per architecture. */
export function eligibleVoteWhereSql(
  restrictionsEnabled: boolean,
  voteAlias = "v",
  venueAlias = "term",
): string {
  return `
    ${voteAlias}.merged_into_vote_id IS NULL
    AND ${voteAlias}.withdrawn_at IS NULL
    AND ${voteAlias}.moderation_state = 'clear'
    AND ${voteAlias}.value BETWEEN 1 AND 5
    AND ${venueAlias}.canonical_venue_id IS NULL
    AND ${venueAlias}.lifecycle_state IN ('unverified', 'verified')
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = ${voteAlias}.user_id
        AND u.status = 'active'
        AND ${unrestrictedSql(restrictionsEnabled, "u.id", ["account.access", "profile.public"])}
    )
  `;
}

type AggregateRow = {
  source_id: string;
  canonical_id: string | null;
  lifecycle_state: string | null;
  canonical_resolved: boolean | null;
  vote_sum: string | null;
  vote_count: string | null;
};

/**
 * Batch community summaries for up to 200 requested venue IDs.
 * Resolves aliases via effectiveVenueCtes; retired/unresolved → unavailable.
 */
export async function batchCommunitySummaries(
  client: PoolClient,
  venueIds: string[],
  restrictionsEnabled: boolean,
): Promise<CommunityRatingSummary[]> {
  if (venueIds.length === 0) return [];
  const seeds = "SELECT unnest($1::uuid[]) AS id";
  const eligible = eligibleVoteWhereSql(restrictionsEnabled, "cv", "ev");
  const rows = (
    await client.query<AggregateRow>(
      `${effectiveVenueCtes(seeds)}
       SELECT
         s.id AS source_id,
         CASE WHEN ev.canonical_resolved THEN ev.id ELSE NULL END AS canonical_id,
         ev.lifecycle_state,
         ev.canonical_resolved,
         COALESCE(agg.vote_sum, 0)::text AS vote_sum,
         COALESCE(agg.vote_count, 0)::text AS vote_count
       FROM unnest($1::uuid[]) AS s(id)
       LEFT JOIN effective_venues ev ON ev.source_id = s.id
       LEFT JOIN LATERAL (
         SELECT SUM(cv.value)::bigint AS vote_sum, COUNT(*)::bigint AS vote_count
         FROM venue_community_votes cv
         WHERE cv.canonical_venue_id = ev.id
           AND ${eligible}
       ) agg ON ev.canonical_resolved
         AND ev.lifecycle_state IN ('unverified', 'verified')
         AND ev.canonical_venue_id IS NULL`,
      [venueIds],
    )
  ).rows;

  const bySource = new Map(rows.map((r) => [r.source_id, r]));
  return venueIds.map((id) => {
    const row = bySource.get(id);
    if (
      !row
      || !row.canonical_resolved
      || !row.canonical_id
      || !row.lifecycle_state
      || !["unverified", "verified"].includes(row.lifecycle_state)
    ) {
      return unavailableSummary(id, row?.canonical_id ?? null);
    }
    const count = Number(row.vote_count ?? 0);
    const sum = Number(row.vote_sum ?? 0);
    if (count <= 0) return emptySummary(id, row.canonical_id);
    return availableSummary(id, row.canonical_id, sum, count);
  });
}

export async function resolveCanonicalVenue(
  client: PoolClient,
  venueId: string,
): Promise<{
  sourceId: string;
  canonicalId: string;
  lifecycleState: string;
} | null> {
  const row = (
    await client.query<{
      source_id: string;
      id: string;
      lifecycle_state: string;
      canonical_resolved: boolean;
      canonical_venue_id: string | null;
    }>(
      `${effectiveVenueCtes("SELECT $1::uuid AS id")}
       SELECT source_id, id, lifecycle_state, canonical_resolved, canonical_venue_id
       FROM effective_venues`,
      [venueId],
    )
  ).rows[0];
  if (
    !row
    || !row.canonical_resolved
    || row.canonical_venue_id !== null
    || !["unverified", "verified"].includes(row.lifecycle_state)
  ) {
    return null;
  }
  return {
    sourceId: row.source_id,
    canonicalId: row.id,
    lifecycleState: row.lifecycle_state,
  };
}

/** All venue IDs (aliases + terminal) that resolve to the same canonical terminal. */
export async function canonicalVenueFamilyIds(
  client: PoolClient,
  canonicalId: string,
): Promise<string[]> {
  const rows = await client.query<{ id: string }>(
    `WITH RECURSIVE
      family AS (
        SELECT id FROM venues WHERE id = $1
        UNION
        SELECT v.id FROM venues v
        JOIN family f ON v.canonical_venue_id = f.id
        WHERE v.lifecycle_state = 'merged'
      )
     SELECT id FROM family`,
    [canonicalId],
  );
  return rows.rows.map((r) => r.id);
}

export async function lockCatalogShared(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('gobadminton_venue_catalog'))");
}

type VoteRow = {
  id: string;
  user_id: string;
  value: number | null;
  version: number;
  moderation_state: "clear" | "withheld";
  withdrawn_at: Date | null;
  user_action_at: Date;
};

/**
 * Merge reconciliation under Admin exclusive catalog fence.
 * Latest explicit accepted user action (incl. withdrawal) wins; withhold from either side.
 */
export async function reconcileCommunityVotesOnMerge(
  client: PoolClient,
  sourceVenueId: string,
  targetVenueId: string,
  actorUserId: string | null,
  actorPrincipalId: string | null,
): Promise<void> {
  const sourceVotes = (
    await client.query<VoteRow>(
      `SELECT id, user_id, value, version, moderation_state, withdrawn_at, user_action_at
       FROM venue_community_votes
       WHERE canonical_venue_id = $1 AND merged_into_vote_id IS NULL
       ORDER BY user_id, user_action_at DESC, id DESC
       FOR UPDATE`,
      [sourceVenueId],
    )
  ).rows;
  if (sourceVotes.length === 0) return;

  const targetVotes = (
    await client.query<VoteRow>(
      `SELECT id, user_id, value, version, moderation_state, withdrawn_at, user_action_at
       FROM venue_community_votes
       WHERE canonical_venue_id = $1 AND merged_into_vote_id IS NULL
       ORDER BY user_id, user_action_at DESC, id DESC
       FOR UPDATE`,
      [targetVenueId],
    )
  ).rows;
  const targetByUser = new Map(targetVotes.map((v) => [v.user_id, v]));

  for (const source of sourceVotes) {
    const target = targetByUser.get(source.user_id);
    if (!target) {
      // Source-only: rehome onto target and advance version so merge_survive
      // cannot collide with the existing upsert/update revision at source.version.
      const nextVersion = source.version + 1;
      await client.query(
        `UPDATE venue_community_votes
         SET canonical_venue_id = $2,
             version = $3,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [source.id, targetVenueId, nextVersion],
      );
      await client.query(
        `INSERT INTO venue_community_vote_revisions
           (vote_id, resource_version, actor_user_id, actor_principal_id, action,
            before_value, after_value, before_moderation_state, after_moderation_state,
            before_withdrawn, after_withdrawn)
         VALUES ($1, $2, $3, $4, 'merge_survive', $5, $5, $6, $6, $7, $7)`,
        [
          source.id,
          nextVersion,
          actorUserId,
          actorPrincipalId,
          source.value,
          source.moderation_state,
          source.withdrawn_at !== null,
        ],
      );
      targetByUser.set(source.user_id, { ...source, version: nextVersion });
      continue;
    }

    const sourceWins =
      source.user_action_at.getTime() > target.user_action_at.getTime()
      || (
        source.user_action_at.getTime() === target.user_action_at.getTime()
        && source.id > target.id
      );
    const winner = sourceWins ? source : target;
    const loser = sourceWins ? target : source;
    const withheld: "clear" | "withheld" =
      source.moderation_state === "withheld" || target.moderation_state === "withheld"
        ? "withheld"
        : "clear";
    const nextVersion = Math.max(source.version, target.version) + 1;
    const loserVersion = loser.version + 1;

    // Partial unique (current venue,user incl. withdrawn) requires superseding the
    // losing current row before rehoming a source winner onto the target venue.
    await client.query(
      `UPDATE venue_community_votes
       SET merged_into_vote_id = $2,
           version = $3,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [loser.id, winner.id, loserVersion],
    );
    await client.query(
      `UPDATE venue_community_votes
       SET canonical_venue_id = $2,
           value = $3,
           withdrawn_at = $4,
           moderation_state = $5,
           version = $6,
           user_action_at = $7,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [
        winner.id,
        targetVenueId,
        winner.value,
        winner.withdrawn_at,
        withheld,
        nextVersion,
        winner.user_action_at,
      ],
    );
    await client.query(
      `INSERT INTO venue_community_vote_revisions
         (vote_id, resource_version, actor_user_id, actor_principal_id, action,
          before_value, after_value, before_moderation_state, after_moderation_state,
          before_withdrawn, after_withdrawn)
       VALUES
         ($1, $2, $3, $4, 'merge_survive', $5, $6, $7, $8, $9, $10),
         ($11, $12, $3, $4, 'merge_supersede', $13, $13, $14, $14, $15, $15)`,
      [
        winner.id,
        nextVersion,
        actorUserId,
        actorPrincipalId,
        winner.value,
        winner.value,
        winner.moderation_state,
        withheld,
        winner.withdrawn_at !== null,
        winner.withdrawn_at !== null,
        loser.id,
        loserVersion,
        loser.value,
        loser.moderation_state,
        loser.withdrawn_at !== null,
      ],
    );
    targetByUser.set(source.user_id, {
      ...winner,
      version: nextVersion,
      moderation_state: withheld,
    });
  }
}
