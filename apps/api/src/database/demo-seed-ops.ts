import type { Pool, PoolClient } from "pg";
import {
  DEMO_DM_CONVERSATION_IDS,
  DEMO_GAME_IDS,
  DEMO_GAME_INVITATION_IDS,
  DEMO_USER_IDS,
  DEMO_VENUE_IDS,
  DEMO_POPULATION_VERSION,
  demoSocialPairId,
  demoUserId,
} from "./demo-ids";
import {
  DEMO_CONSENT_POLICY_VERSION,
  DEMO_ISSUER_NAMESPACE,
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
  buildDemoGames,
  buildDemoPeople,
  buildDemoVenues,
  type DemoSeedMode,
} from "./demo-population";
import {
  VENUE_NORMALIZATION_VERSION,
  extractIdentityDiscriminator,
  normalizeVenueText,
  venueDedupeKey,
} from "../venues/venue-normalize";
import {
  buildDemoSocialPopulation,
  demoClientMessageId,
  hoursAgoDate,
  hoursFromNowDate,
  resolveDemoGame,
  resolveDemoUser,
} from "./demo-social-population";

export type DemoSeedReport = {
  mode: DemoSeedMode | "cleanup";
  populationVersion: string;
  users: number;
  profiles: number;
  directoryVisible: number;
  lookingActive: number;
  venues: number;
  trainers: number;
  games: number;
  gamesPublishedPublic: number;
  participations: number;
  avatars: "omitted_no_contract_field";
  fullModeExtras:
    | "noop_reserved_for_later_social"
    | "social_dm_invites_gamechat";
  socialPairs: number;
  dmConversations: number;
  gameConversations: number;
  messages: number;
  gameInvitations: number;
};

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Namespace-strict cleanup: mutate only deterministic demo IDs / demo issuer.
 * Out-of-namespace rows that merely reference a demo identity (non-demo game
 * created_by a demo account, or non-demo participation/transition/manager on a
 * demo game) are never deleted. External identities are classified by both
 * user ownership and issuer_namespace: a foreign user's row is never deleted
 * merely because issuer_namespace equals the demo issuer. If mixed-provenance
 * dependents exist, cleanup refuses before any mutation so demo rows are not
 * removed out from under foreign data and foreign rows are not silently swept.
 */
export async function cleanupDemoData(client: PoolClient): Promise<void> {
  const userIds = DEMO_USER_IDS;
  const gameIds = DEMO_GAME_IDS;
  const venueIds = DEMO_VENUE_IDS;

  const blockers = await client.query<{ id: string; via: string }>(
    `SELECT g.id::text AS id, 'games.created_by_user_id' AS via
     FROM games g
     WHERE g.created_by_user_id = ANY($1::uuid[])
       AND NOT (g.id = ANY($2::uuid[]))
     UNION ALL
     SELECT g.id::text, 'games.venue_id'
     FROM games g
     WHERE g.venue_id = ANY($3::uuid[])
       AND NOT (g.id = ANY($2::uuid[]))
     UNION ALL
     SELECT p.id::text, 'participations.user_id'
     FROM participations p
     WHERE p.user_id = ANY($1::uuid[])
       AND NOT (p.game_id = ANY($2::uuid[]))
     UNION ALL
     SELECT p.id::text, 'participations.game_id.non_demo_user'
     FROM participations p
     WHERE p.game_id = ANY($2::uuid[])
       AND NOT (p.user_id = ANY($1::uuid[]))
     UNION ALL
     SELECT pt.id::text, 'participation_transitions.mixed_on_demo_game'
     FROM participation_transitions pt
     INNER JOIN participations p ON p.id = pt.participation_id
     WHERE p.game_id = ANY($2::uuid[])
       AND (
         NOT (p.user_id = ANY($1::uuid[]))
         OR (pt.actor_id IS NOT NULL AND NOT (pt.actor_id = ANY($1::uuid[])))
       )
     UNION ALL
     SELECT gm.id::text, 'game_managers.user_id'
     FROM game_managers gm
     WHERE gm.user_id = ANY($1::uuid[])
       AND NOT (gm.game_id = ANY($2::uuid[]))
     UNION ALL
     SELECT gm.id::text, 'game_managers.game_id.non_demo_user'
     FROM game_managers gm
     WHERE gm.game_id = ANY($2::uuid[])
       AND NOT (gm.user_id = ANY($1::uuid[]))
     UNION ALL
     SELECT v.id::text, 'venues.created_by_user_id'
     FROM venues v
     WHERE v.created_by_user_id = ANY($1::uuid[])
       AND NOT (v.id = ANY($3::uuid[]))
     UNION ALL
     SELECT o.id::text, 'organizers.created_by_user_id'
     FROM organizers o
     WHERE o.created_by_user_id = ANY($1::uuid[])
     UNION ALL
     SELECT om.id::text, 'organizer_memberships.user_id'
     FROM organizer_memberships om
     WHERE om.user_id = ANY($1::uuid[])
     UNION ALL
     SELECT ar.id::text, 'abuse_reports.mixed_party'
     FROM abuse_reports ar
     WHERE (
       (ar.reporter_user_id = ANY($1::uuid[]) AND NOT (ar.target_user_id = ANY($1::uuid[])))
       OR (ar.target_user_id = ANY($1::uuid[]) AND NOT (ar.reporter_user_id = ANY($1::uuid[])))
     )
     UNION ALL
     SELECT (ub.blocker_user_id::text || '>' || ub.blocked_user_id::text), 'user_blocks.mixed_party'
     FROM user_blocks ub
     WHERE (
       (ub.blocker_user_id = ANY($1::uuid[]) AND NOT (ub.blocked_user_id = ANY($1::uuid[])))
       OR (ub.blocked_user_id = ANY($1::uuid[]) AND NOT (ub.blocker_user_id = ANY($1::uuid[])))
     )
     UNION ALL
     SELECT sp.id::text, 'social_pairs.mixed_party'
     FROM social_pairs sp
     WHERE (
       (sp.user_low = ANY($1::uuid[]) AND NOT (sp.user_high = ANY($1::uuid[])))
       OR (sp.user_high = ANY($1::uuid[]) AND NOT (sp.user_low = ANY($1::uuid[])))
     )
     UNION ALL
     SELECT ei.id::text, 'external_identities.demo_issuer.non_demo_user'
     FROM external_identities ei
     WHERE ei.issuer_namespace = $4
       AND NOT (ei.user_id = ANY($1::uuid[]))
     UNION ALL
     SELECT ei.id::text, 'external_identities.demo_user.non_demo_issuer'
     FROM external_identities ei
     WHERE ei.user_id = ANY($1::uuid[])
       AND ei.issuer_namespace IS DISTINCT FROM $4
     UNION ALL
     SELECT c.id::text, 'conversations.direct.mixed_party'
     FROM conversations c
     WHERE c.kind = 'direct'
       AND (
         (c.initiator_user_id = ANY($1::uuid[]) AND NOT (c.recipient_user_id = ANY($1::uuid[])))
         OR (c.recipient_user_id = ANY($1::uuid[]) AND NOT (c.initiator_user_id = ANY($1::uuid[])))
       )
     UNION ALL
     SELECT c.id::text, 'conversations.game.mixed_member'
     FROM conversations c
     INNER JOIN conversation_members m ON m.conversation_id = c.id
     WHERE c.kind = 'game'
       AND c.game_id = ANY($2::uuid[])
       AND NOT (m.user_id = ANY($1::uuid[]))
     UNION ALL
     SELECT msg.id::text, 'messages.demo_conversation.non_demo_author'
     FROM messages msg
     INNER JOIN conversations c ON c.id = msg.conversation_id
     WHERE (
         (c.kind = 'direct' AND c.id = ANY($5::uuid[]))
         OR (c.kind = 'game' AND c.game_id = ANY($2::uuid[]))
       )
       AND NOT (msg.author_user_id = ANY($1::uuid[]))
     UNION ALL
     SELECT i.id::text, 'game_invitations.mixed_party'
     FROM game_invitations i
     WHERE (
       (i.inviter_user_id = ANY($1::uuid[]) AND NOT (i.invitee_user_id = ANY($1::uuid[])))
       OR (i.invitee_user_id = ANY($1::uuid[]) AND NOT (i.inviter_user_id = ANY($1::uuid[])))
       OR (i.game_id = ANY($2::uuid[]) AND (
         NOT (i.inviter_user_id = ANY($1::uuid[]))
         OR NOT (i.invitee_user_id = ANY($1::uuid[]))
       ))
     )
     LIMIT 20`,
    [
      userIds,
      gameIds,
      venueIds,
      DEMO_ISSUER_NAMESPACE,
      DEMO_DM_CONVERSATION_IDS,
    ],
  );
  if (blockers.rows.length > 0) {
    const sample = blockers.rows
      .map((row) => `${row.via}:${row.id}`)
      .join(", ");
    throw new Error(
      `Demo cleanup refused: out-of-namespace rows reference demo identities (${sample})`,
    );
  }

  // Social backfill first (FK order): hidden → messages → members → conversations → invitations.
  await client.query(
    `DELETE FROM message_hidden_for
     WHERE message_id IN (
       SELECT m.id FROM messages m
       INNER JOIN conversations c ON c.id = m.conversation_id
       WHERE c.id = ANY($1::uuid[])
          OR c.game_id = ANY($2::uuid[])
     )
        OR user_id = ANY($3::uuid[])`,
    [DEMO_DM_CONVERSATION_IDS, gameIds, userIds],
  );
  await client.query(
    `DELETE FROM messages
     WHERE conversation_id = ANY($1::uuid[])
        OR conversation_id IN (
          SELECT id FROM conversations
          WHERE kind = 'game' AND game_id = ANY($2::uuid[])
        )`,
    [DEMO_DM_CONVERSATION_IDS, gameIds],
  );
  await client.query(
    `DELETE FROM conversation_members
     WHERE conversation_id = ANY($1::uuid[])
        OR conversation_id IN (
          SELECT id FROM conversations
          WHERE kind = 'game' AND game_id = ANY($2::uuid[])
        )
        OR (
          user_id = ANY($3::uuid[])
          AND conversation_id IN (
            SELECT id FROM conversations
            WHERE kind = 'direct'
              AND initiator_user_id = ANY($3::uuid[])
              AND recipient_user_id = ANY($3::uuid[])
          )
        )`,
    [DEMO_DM_CONVERSATION_IDS, gameIds, userIds],
  );
  await client.query(
    `DELETE FROM conversations
     WHERE id = ANY($1::uuid[])
        OR (kind = 'game' AND game_id = ANY($2::uuid[]))
        OR (
          kind = 'direct'
          AND initiator_user_id = ANY($3::uuid[])
          AND recipient_user_id = ANY($3::uuid[])
        )`,
    [DEMO_DM_CONVERSATION_IDS, gameIds, userIds],
  );
  await client.query(
    `DELETE FROM game_invitations
     WHERE id = ANY($1::uuid[])
        OR (
          inviter_user_id = ANY($2::uuid[])
          AND invitee_user_id = ANY($2::uuid[])
        )
        OR game_id = ANY($3::uuid[])`,
    [DEMO_GAME_INVITATION_IDS, userIds, gameIds],
  );

  // Delete only demo-owned dependents: demo game + demo user (and demo actor).
  await client.query(
    `DELETE FROM participation_transitions
     WHERE participation_id IN (
       SELECT id FROM participations
       WHERE game_id = ANY($1::uuid[])
         AND user_id = ANY($2::uuid[])
     )
       AND (actor_id IS NULL OR actor_id = ANY($2::uuid[]))`,
    [gameIds, userIds],
  );
  await client.query(
    `DELETE FROM participations
     WHERE game_id = ANY($1::uuid[])
       AND user_id = ANY($2::uuid[])`,
    [gameIds, userIds],
  );
  await client.query(
    `DELETE FROM game_managers
     WHERE game_id = ANY($1::uuid[])
       AND user_id = ANY($2::uuid[])`,
    [gameIds, userIds],
  );
  await client.query(`DELETE FROM games WHERE id = ANY($1::uuid[])`, [gameIds]);
  await client.query(
    `DELETE FROM trainer_profiles WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM venue_proposal_confirm_tokens WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM venue_duplicate_candidates
     WHERE left_venue_id = ANY($1::uuid[]) OR right_venue_id = ANY($1::uuid[])`,
    [venueIds],
  );
  await client.query(
    `DELETE FROM venue_merge_history
     WHERE source_venue_id = ANY($1::uuid[]) OR target_venue_id = ANY($1::uuid[])`,
    [venueIds],
  );
  await client.query(
    `DELETE FROM venue_identity_keys WHERE venue_id = ANY($1::uuid[])`,
    [venueIds],
  );
  await client.query(`DELETE FROM venues WHERE id = ANY($1::uuid[])`, [
    venueIds,
  ]);
  // Multi-party / interaction rows: only when every party is a demo user.
  await client.query(
    `DELETE FROM abuse_reports
     WHERE reporter_user_id = ANY($1::uuid[])
       AND target_user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM user_blocks
     WHERE blocker_user_id = ANY($1::uuid[])
       AND blocked_user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM social_pairs
     WHERE user_low = ANY($1::uuid[])
       AND user_high = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM radar_presences WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM radar_rate_budgets WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM player_looking_intents WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM player_social_profiles WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(
    `DELETE FROM app_sessions WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  // Pure demo identities only: demo user ownership AND demo issuer namespace.
  await client.query(
    `DELETE FROM external_identities
     WHERE user_id = ANY($1::uuid[])
       AND issuer_namespace = $2`,
    [userIds, DEMO_ISSUER_NAMESPACE],
  );
  await client.query(
    `DELETE FROM idempotency_records WHERE actor_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
}

export async function seedDemoFoundation(
  client: PoolClient,
  mode: DemoSeedMode,
): Promise<DemoSeedReport> {
  const people = buildDemoPeople();
  const venues = buildDemoVenues();
  const games = buildDemoGames();

  // Ensure catalog cities exist (migrations); do not invent ad-hoc city rows.
  for (const cityId of [DEMO_MOSCOW_CITY_ID, DEMO_SPB_CITY_ID]) {
    const city = await client.query(`SELECT id FROM cities WHERE id = $1`, [
      cityId,
    ]);
    if (!city.rows[0]) {
      throw new Error(
        `Demo seed requires catalog city ${cityId} from migrations`,
      );
    }
  }

  await cleanupDemoData(client);

  for (const person of people) {
    await client.query(
      `INSERT INTO users (id, status, locale, display_name)
       VALUES ($1, 'active', 'ru', $2)`,
      [person.userId, person.displayName],
    );
    await client.query(
      `INSERT INTO external_identities (
         id, user_id, provider_key, issuer_namespace, subject,
         email, display_name, avatar_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
      [
        person.identityId,
        person.userId,
        person.providerKey,
        DEMO_ISSUER_NAMESPACE,
        person.subject,
        person.email,
        person.displayName,
      ],
    );

    // Exact Owner contract: one accepted-schema profile per fictional account.
    const optedInAt = person.directoryVisible
      ? new Date().toISOString()
      : null;
    const consent =
      person.directoryVisible ? DEMO_CONSENT_POLICY_VERSION : null;
    // Synthetic/internal Radar demo: consent for city-scoped demo identities only.
    // Presence rows remain unseeded (materialized at runtime under SOCIAL_RADAR_DEMO_ENABLED).
    const radarConsented = Boolean(
      person.socialEligible && person.cityId,
    );
    await client.query(
      `INSERT INTO player_social_profiles (
         user_id, public_player_id, display_name, city_id, area_key,
         level_scale_id, level_scale_version, level_id, bio,
         directory_visible, contact_policy, consent_policy_version,
         opted_in_at, radar_consented, radar_consent_policy_version,
         radar_consented_at, social_eligible, version
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         $10,$11,$12,
         $13,$14,$15,
         $16,$17,1
       )`,
      [
        person.userId,
        person.publicPlayerId,
        person.displayName,
        person.cityId,
        person.areaKey,
        person.levelId ? "ntrp" : null,
        person.levelId ? 1 : null,
        person.levelId,
        person.bio,
        person.directoryVisible,
        person.contactPolicy,
        consent,
        optedInAt,
        radarConsented,
        radarConsented ? "radar-mvp-v1" : null,
        radarConsented ? new Date().toISOString() : null,
        person.socialEligible,
      ],
    );

    if (person.lookingActive) {
      if (!person.cityId) {
        throw new Error(
          `looking intent for demo person ${person.ordinal} requires cityId`,
        );
      }
      const starts = hoursFromNow(2);
      const ends = hoursFromNow(50);
      const expires = hoursFromNow(26);
      await client.query(
        `INSERT INTO player_looking_intents (
           user_id, active, city_id, area_key,
           starts_at, ends_at, expires_at, format_keys, version
         ) VALUES (
           $1, true, $2, $3,
           $4, $5, $6, $7::jsonb, 1
         )`,
        [
          person.userId,
          person.cityId,
          person.areaKey,
          starts.toISOString(),
          ends.toISOString(),
          expires.toISOString(),
          JSON.stringify(person.lookingFormats),
        ],
      );
    }

    if (person.isTrainer && person.trainerId) {
      await client.query(
        `INSERT INTO trainer_profiles (
           id, user_id, display_name, bio, declaration_source, status, version
         ) VALUES ($1,$2,$3,$4,'self_declared','active',1)`,
        [
          person.trainerId,
          person.userId,
          `${person.displayName} (demo trainer)`,
          "Synthetic demo trainer profile. Not a real coach credential.",
        ],
      );
    }
  }

  for (const venue of venues) {
    const normalizedName = normalizeVenueText(venue.name);
    const normalizedAddress = normalizeVenueText(venue.address);
    const identityDiscriminator = extractIdentityDiscriminator(
      venue.name,
      venue.address,
    );
    await client.query(
      `INSERT INTO venues (
         id, city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         normalization_version, identity_discriminator
       ) VALUES (
         $1,$2,$3,$4,$5,
         ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
         'verified','operator_seeded',$8,
         'verified',$9,$10,$11,$12
       )`,
      [
        venue.id,
        venue.cityId,
        venue.name,
        venue.address,
        venue.timezone,
        venue.longitude,
        venue.latitude,
        demoUserId(venue.createdByOrdinal),
        normalizedName,
        normalizedAddress,
        VENUE_NORMALIZATION_VERSION,
        identityDiscriminator,
      ],
    );
    await client.query(
      `INSERT INTO venue_identity_keys (dedupe_key, venue_id, normalization_version)
       VALUES ($1,$2,$3)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        venueDedupeKey({
          cityId: venue.cityId,
          normalizedName,
          normalizedAddress,
          identityDiscriminator,
        }),
        venue.id,
        VENUE_NORMALIZATION_VERSION,
      ],
    );
  }

  const peopleByOrdinal = new Map(people.map((p) => [p.ordinal, p]));
  const venuesByOrdinal = new Map(
    venues.map((v, i) => [i + 1, v] as const),
  );

  for (const game of games) {
    const creator = peopleByOrdinal.get(game.creatorOrdinal)!;
    const venue = venuesByOrdinal.get(game.venueOrdinal)!;
    const starts = daysFromNow(game.dayOffset);
    starts.setUTCHours(16, 0, 0, 0);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 12 * 60 * 60 * 1000);
    const publishedAt =
      game.status === "published" || game.status === "cancelled"
        ? new Date().toISOString()
        : null;
    const cancelledAt =
      game.status === "cancelled" ? new Date().toISOString() : null;

    let trainerProfileId: string | null = null;
    let trainerDisplayName: string | null = null;
    let trainingDescription: string | null = null;
    let settlementPurpose = "no_trainer_fee";
    let priceStatus: string | null = null;
    const priceUnit: string | null = null;
    const priceMinor: string | null = null;
    const currency: string | null = null;

    if (game.activityKind === "trainer_led") {
      if (!creator.trainerId) {
        throw new Error(
          `trainer_led game ${game.id} creator ${creator.ordinal} lacks trainer profile`,
        );
      }
      trainerProfileId = creator.trainerId;
      trainerDisplayName = `${creator.displayName} (demo trainer)`;
      trainingDescription =
        "Synthetic demo training session. Fee settlement is outside the platform.";
      settlementPurpose = "trainer_fee";
      priceStatus = "by_agreement";
    }

    const confirmedCount = game.participations.filter(
      (x) => x.status === "confirmed",
    ).length;
    if (confirmedCount + game.externalReservedCount > game.capacity) {
      throw new Error(
        `capacity invariant broken for demo game ${game.id}: confirmed=${confirmedCount} external=${game.externalReservedCount} capacity=${game.capacity}`,
      );
    }

    await client.query(
      `INSERT INTO games (
         id, organizer_id, host_display_name, host_public_contact,
         venue_id, title, status, visibility,
         starts_at, ends_at, timezone, application_deadline_at,
         capacity, external_reserved_count, format_key,
         level_scale_id, level_scale_version, allowed_level_ids,
         activity_kind, trainer_profile_id, trainer_display_name_snapshot,
         training_description,
         settlement_mode, settlement_purpose, price_status, price_unit,
         price_minor, currency, settlement_terms,
         version, cancel_reason, created_by_user_id,
         published_at, cancelled_at
       ) VALUES (
         $1,NULL,$2,$3,
         $4,$5,$6,$7,
         $8,$9,$10,$11,
         $12,$13,$14,
         'ntrp',1,$15::jsonb,
         $16,$17,$18,
         $19,
         'external',$20,$21,$22,
         $23,$24,$25,
         1,$26,$27,
         $28,$29
       )`,
      [
        game.id,
        creator.displayName,
        `demo-contact:${creator.subject}`,
        venue.id,
        game.title,
        game.status,
        game.visibility,
        starts.toISOString(),
        ends.toISOString(),
        venue.timezone,
        deadline.toISOString(),
        game.capacity,
        game.externalReservedCount,
        game.formatKey,
        JSON.stringify(game.allowedLevelIds),
        game.activityKind,
        trainerProfileId,
        trainerDisplayName,
        trainingDescription,
        settlementPurpose,
        priceStatus,
        priceUnit,
        priceMinor,
        currency,
        "Synthetic demo settlement terms. Payment custody outside MVP.",
        game.status === "cancelled"
          ? game.venueOrdinal >= 5
            ? "demo_cancelled_flood"
            : "demo_cancelled_weather"
          : null,
        creator.userId,
        publishedAt,
        cancelledAt,
      ],
    );

    await client.query(
      `INSERT INTO game_managers (
         id, game_id, user_id, role, status
       ) VALUES ($1,$2,$3,'owner','active')`,
      [game.ownerManagerId, game.id, creator.userId],
    );

    if (game.coManagerId && game.coManagerOrdinal) {
      const co = peopleByOrdinal.get(game.coManagerOrdinal)!;
      await client.query(
        `INSERT INTO game_managers (
           id, game_id, user_id, role, status
         ) VALUES ($1,$2,$3,'manager','active')`,
        [game.coManagerId, game.id, co.userId],
      );
    }

    for (const part of game.participations) {
      const player = peopleByOrdinal.get(part.userOrdinal)!;
      const confirmedAt =
        part.status === "confirmed" ? new Date().toISOString() : null;
      await client.query(
        `INSERT INTO participations (
           id, game_id, user_id, status, attempt_number, version,
           requested_at, confirmed_at
         ) VALUES ($1,$2,$3,$4,1,1,now(),$5)`,
        [part.id, game.id, player.userId, part.status, confirmedAt],
      );
      await client.query(
        `INSERT INTO participation_transitions (
           id, participation_id, from_status, to_status, actor_id,
           reason_code, aggregate_version, game_version
         ) VALUES ($1,$2,NULL,$3,$4,$5,1,1)`,
        [
          part.transitionId,
          part.id,
          part.status,
          part.status === "pending" ? player.userId : creator.userId,
          part.status === "withdrawn" ? "demo_withdrawn" : "demo_seed",
        ],
      );
    }
  }

  let socialCounts = {
    socialPairs: 0,
    dmConversations: 0,
    gameConversations: 0,
    messages: 0,
    gameInvitations: 0,
  };
  if (mode === "full") {
    socialCounts = await seedDemoSocialBackfill(client);
  }

  const directoryVisible = people.filter((p) => p.directoryVisible).length;
  const lookingActive = people.filter((p) => p.lookingActive).length;
  const trainers = people.filter((p) => p.isTrainer).length;
  const gamesPublishedPublic = games.filter(
    (g) => g.status === "published" && g.visibility === "public",
  ).length;
  const participations = games.reduce(
    (n, g) => n + g.participations.length,
    0,
  );

  return {
    mode,
    populationVersion: DEMO_POPULATION_VERSION,
    users: people.length,
    profiles: people.length,
    directoryVisible,
    lookingActive,
    venues: venues.length,
    trainers,
    games: games.length,
    gamesPublishedPublic,
    participations,
    avatars: "omitted_no_contract_field",
    fullModeExtras:
      mode === "full"
        ? "social_dm_invites_gamechat"
        : "noop_reserved_for_later_social",
    ...socialCounts,
  };
}

/** Oldest first (largest createdHoursAgo → seq 1). */
function chronologicalMessages<T extends { createdHoursAgo: number }>(
  messages: T[],
): T[] {
  return [...messages].sort((a, b) => b.createdHoursAgo - a.createdHoursAgo);
}

async function seedDemoSocialBackfill(client: PoolClient): Promise<{
  socialPairs: number;
  dmConversations: number;
  gameConversations: number;
  messages: number;
  gameInvitations: number;
}> {
  const social = buildDemoSocialPopulation();

  for (const [low, high] of social.pairOrdinalKeys) {
    const userA = resolveDemoUser(low);
    const userB = resolveDemoUser(high);
    const userLow = userA < userB ? userA : userB;
    const userHigh = userA < userB ? userB : userA;
    await client.query(
      `INSERT INTO social_pairs (id, user_low, user_high, version)
       VALUES ($1, $2, $3, 1)`,
      [demoSocialPairId(low, high), userLow, userHigh],
    );
  }

  let messageCount = 0;

  for (const thread of social.dmThreads) {
    const initiator = resolveDemoUser(thread.initiatorOrdinal);
    const recipient = resolveDemoUser(thread.recipientOrdinal);
    const orderedMessages = chronologicalMessages(thread.messages);
    const createdAt = hoursAgoDate(
      Math.max(...orderedMessages.map((m) => m.createdHoursAgo), 1),
    );
    const lastMessage = orderedMessages[orderedMessages.length - 1]!;
    const lastSeq = orderedMessages.length;
    const requestExpiresAt =
      thread.requestExpiresHoursFromNow === null
        ? null
        : hoursFromNowDate(thread.requestExpiresHoursFromNow);

    await client.query(
      `INSERT INTO conversations (
         id, pair_id, kind, request_state, initiator_user_id, recipient_user_id,
         request_expires_at, next_message_seq, last_message_at, last_message_seq,
         version, created_at, updated_at, game_id, lifecycle_state, context_game_id
       ) VALUES (
         $1, $2, 'direct', $3, $4, $5,
         $6, $7, $8, $9,
         1, $10, $10, NULL, NULL, NULL
       )`,
      [
        thread.id,
        thread.pairId,
        thread.requestState,
        initiator,
        recipient,
        requestExpiresAt?.toISOString() ?? null,
        lastSeq + 1,
        hoursAgoDate(lastMessage.createdHoursAgo).toISOString(),
        lastSeq,
        createdAt.toISOString(),
      ],
    );

    await client.query(
      `INSERT INTO conversation_members (
         conversation_id, user_id, read_through_seq, hidden_through_seq,
         archived, muted, preferences_version, state_version,
         role, membership_state, send_allowed, created_at, updated_at
       ) VALUES
         ($1, $2, $3, 0, false, false, 1, 1, NULL, 'active', true, $5, $5),
         ($1, $4, $6, 0, false, false, 1, 1, NULL, 'active', true, $5, $5)`,
      [
        thread.id,
        initiator,
        thread.initiatorReadThrough,
        recipient,
        createdAt.toISOString(),
        thread.recipientReadThrough,
      ],
    );

    let seq = 0;
    for (const message of orderedMessages) {
      seq += 1;
      await client.query(
        `INSERT INTO messages (
           id, conversation_id, seq, author_user_id, client_message_id,
           kind, body_text, content_state, purge_eligible_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'text', $6, 'live', NULL, $7)`,
        [
          message.id,
          thread.id,
          seq,
          resolveDemoUser(message.authorOrdinal),
          demoClientMessageId(message.id),
          message.bodyText,
          hoursAgoDate(message.createdHoursAgo).toISOString(),
        ],
      );
      messageCount += 1;
    }
  }

  for (const invitation of social.invitations) {
    const createdAt = hoursAgoDate(invitation.createdHoursAgo);
    const expiresAt =
      invitation.expiresHoursFromNow === null
        ? null
        : hoursFromNowDate(invitation.expiresHoursFromNow);
    const decidedAt =
      invitation.status === "pending"
        ? null
        : hoursAgoDate(Math.max(1, invitation.createdHoursAgo - 1));
    await client.query(
      `INSERT INTO game_invitations (
         id, game_id, inviter_user_id, invitee_user_id, pair_id, status,
         version, expires_at, decided_at, participation_id, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         1, $7, $8, $9, $10, $10
       )`,
      [
        invitation.id,
        resolveDemoGame(invitation.gameOrdinal),
        resolveDemoUser(invitation.inviterOrdinal),
        resolveDemoUser(invitation.inviteeOrdinal),
        invitation.pairId,
        invitation.status,
        expiresAt?.toISOString() ?? null,
        decidedAt?.toISOString() ?? null,
        invitation.participationId,
        createdAt.toISOString(),
      ],
    );
  }

  for (const gameChat of social.gameChats) {
    const orderedMessages = chronologicalMessages(gameChat.messages);
    const createdAt = hoursAgoDate(
      Math.max(...orderedMessages.map((m) => m.createdHoursAgo), 1),
    );
    const lastMessage = orderedMessages[orderedMessages.length - 1]!;
    const lastSeq = orderedMessages.length;
    await client.query(
      `INSERT INTO conversations (
         id, pair_id, kind, request_state, initiator_user_id, recipient_user_id,
         request_expires_at, next_message_seq, last_message_at, last_message_seq,
         version, created_at, updated_at, game_id, lifecycle_state, context_game_id
       ) VALUES (
         $1, NULL, 'game', 'accepted', NULL, NULL,
         NULL, $2, $3, $4,
         1, $5, $5, $6, $7, NULL
       )`,
      [
        gameChat.id,
        lastSeq + 1,
        hoursAgoDate(lastMessage.createdHoursAgo).toISOString(),
        lastSeq,
        createdAt.toISOString(),
        resolveDemoGame(gameChat.gameOrdinal),
        gameChat.lifecycleState,
      ],
    );

    for (const member of gameChat.members) {
      await client.query(
        `INSERT INTO conversation_members (
           conversation_id, user_id, read_through_seq, hidden_through_seq,
           archived, muted, preferences_version, state_version,
           role, membership_state, send_allowed, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 0, false, false, 1, 1,
           $4, 'active', true, $5, $5
         )`,
        [
          gameChat.id,
          resolveDemoUser(member.userOrdinal),
          member.readThroughSeq,
          member.role,
          createdAt.toISOString(),
        ],
      );
    }

    let seq = 0;
    for (const message of orderedMessages) {
      seq += 1;
      await client.query(
        `INSERT INTO messages (
           id, conversation_id, seq, author_user_id, client_message_id,
           kind, body_text, content_state, purge_eligible_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'text', $6, 'live', NULL, $7)`,
        [
          message.id,
          gameChat.id,
          seq,
          resolveDemoUser(message.authorOrdinal),
          demoClientMessageId(message.id),
          message.bodyText,
          hoursAgoDate(message.createdHoursAgo).toISOString(),
        ],
      );
      messageCount += 1;
    }
  }

  return {
    socialPairs: social.pairOrdinalKeys.length,
    dmConversations: social.dmThreads.length,
    gameConversations: social.gameChats.length,
    messages: messageCount,
    gameInvitations: social.invitations.length,
  };
}

export async function withDemoTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function countDemoRows(pool: Pool): Promise<{
  users: number;
  profiles: number;
  lookingActive: number;
  games: number;
  venues: number;
  dmConversations: number;
  gameConversations: number;
  gameInvitations: number;
  socialMessages: number;
  radarPresences: number;
}> {
  const users = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM users WHERE id = ANY($1::uuid[])`,
    [DEMO_USER_IDS],
  );
  const profiles = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM player_social_profiles WHERE user_id = ANY($1::uuid[])`,
    [DEMO_USER_IDS],
  );
  const looking = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM player_looking_intents
     WHERE user_id = ANY($1::uuid[]) AND active = true
       AND expires_at > now()`,
    [DEMO_USER_IDS],
  );
  const games = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM games WHERE id = ANY($1::uuid[])`,
    [DEMO_GAME_IDS],
  );
  const venues = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM venues WHERE id = ANY($1::uuid[])`,
    [DEMO_VENUE_IDS],
  );
  const dmConversations = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM conversations
     WHERE kind = 'direct' AND id = ANY($1::uuid[])`,
    [DEMO_DM_CONVERSATION_IDS],
  );
  const gameConversations = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM conversations
     WHERE kind = 'game' AND game_id = ANY($1::uuid[])`,
    [DEMO_GAME_IDS],
  );
  const gameInvitations = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM game_invitations
     WHERE id = ANY($1::uuid[])`,
    [DEMO_GAME_INVITATION_IDS],
  );
  const socialMessages = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM messages m
     INNER JOIN conversations c ON c.id = m.conversation_id
     WHERE c.id = ANY($1::uuid[])
        OR (c.kind = 'game' AND c.game_id = ANY($2::uuid[]))`,
    [DEMO_DM_CONVERSATION_IDS, DEMO_GAME_IDS],
  );
  const radar = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM radar_presences
     WHERE user_id = ANY($1::uuid[])`,
    [DEMO_USER_IDS],
  );
  return {
    users: users.rows[0]!.c,
    profiles: profiles.rows[0]!.c,
    lookingActive: looking.rows[0]!.c,
    games: games.rows[0]!.c,
    venues: venues.rows[0]!.c,
    dmConversations: dmConversations.rows[0]!.c,
    gameConversations: gameConversations.rows[0]!.c,
    gameInvitations: gameInvitations.rows[0]!.c,
    socialMessages: socialMessages.rows[0]!.c,
    radarPresences: radar.rows[0]!.c,
  };
}
