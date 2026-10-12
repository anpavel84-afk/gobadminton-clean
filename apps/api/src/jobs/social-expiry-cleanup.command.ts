import { Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DM_CLEANUP_BATCH_LIMIT } from "../messaging/constants";
import { INVITATION_CLEANUP_BATCH_LIMIT } from "../invitations/constants";
import { SOCIAL_EXPIRY_CLEANUP_BATCH_LIMIT } from "./constants";
import type { SocialExpiryCleanupPayload } from "./payloads";

export type SqlExecutor = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type SocialExpiryCleanupResult = {
  lookingDeactivated: number;
  radarDeleted: number;
  dmRequestsExpired: number;
  dmMessagesPurged: number;
  invitationsExpired: number;
  gameChatsClosed: number;
};

export function sqlExecutorFromPg(db: Pool | PoolClient): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      const result = await db.query(text, values);
      return { rows: result.rows as T[] };
    },
  };
}

/**
 * Owning-module cleanup command for expired looking intents + RadarPresence.
 * Idempotent under retry. Visibility remains enforced on read/commands even if
 * the worker is down (ADR-SOCIAL-004).
 *
 * Test-only crash injection: set `LS02_CLEANUP_FAIL_ONCE_PATH` to a filesystem
 * path; first invocation deletes the file and throws once (no production use).
 */
@Injectable()
export class SocialExpiryCleanupCommand {
  async execute(
    db: SqlExecutor,
    payload: SocialExpiryCleanupPayload,
  ): Promise<SocialExpiryCleanupResult> {
    await maybeFailOnceForTests();

    let lookingDeactivated = 0;
    let dmRequestsExpired = 0;
    let invitationsExpired = 0;
    if (payload.kind === "looking_intent") {
      lookingDeactivated += await deactivateExpiredLooking(
        db,
        payload.userId,
        payload.version,
      );
    }
    if (payload.kind === "dm_request") {
      dmRequestsExpired += await expireDmRequest(
        db,
        payload.conversationId,
        payload.version,
      );
    }
    if (payload.kind === "invitation") {
      invitationsExpired += await expireInvitation(
        db,
        payload.invitationId,
        payload.version,
      );
    }
    lookingDeactivated += await sweepExpiredLooking(db);
    const radarDeleted = await sweepExpiredRadar(db);
    dmRequestsExpired += await sweepExpiredDmRequests(db);
    const dmMessagesPurged = await sweepPurgeDmMessages(db);
    invitationsExpired += await sweepExpiredInvitations(db);
    const gameChatsClosed = await sweepCloseEndedGameChats(db);
    return {
      lookingDeactivated,
      radarDeleted,
      dmRequestsExpired,
      dmMessagesPurged,
      invitationsExpired,
      gameChatsClosed,
    };
  }
}

async function deactivateExpiredLooking(
  db: SqlExecutor,
  userId: string,
  version: number,
): Promise<number> {
  const result = await db.query<{ user_id: string }>(
    `UPDATE player_looking_intents
     SET active = false, updated_at = now()
     WHERE user_id = $1
       AND active = true
       AND expires_at IS NOT NULL
       AND expires_at <= now()
       AND version = $2
     RETURNING user_id`,
    [userId, version],
  );
  return result.rows.length;
}

async function sweepExpiredLooking(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ user_id: string }>(
    `WITH doomed AS (
       SELECT user_id
       FROM player_looking_intents
       WHERE active = true
         AND expires_at IS NOT NULL
         AND expires_at <= now()
       ORDER BY expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE player_looking_intents AS li
     SET active = false, updated_at = now()
     FROM doomed
     WHERE li.user_id = doomed.user_id
     RETURNING li.user_id`,
    [SOCIAL_EXPIRY_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

async function sweepExpiredRadar(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ user_id: string }>(
    `WITH doomed AS (
       SELECT user_id
       FROM radar_presences
       WHERE expires_at <= now()
          OR foreground_until <= now()
          OR location_valid_until <= now()
       ORDER BY expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM radar_presences AS r
     USING doomed
     WHERE r.user_id = doomed.user_id
     RETURNING r.user_id`,
    [SOCIAL_EXPIRY_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

async function expireDmRequest(
  db: SqlExecutor,
  conversationId: string,
  version: number,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE conversations
     SET request_state = 'expired',
         version = version + 1,
         updated_at = now()
     WHERE id = $1
       AND request_state = 'pending'
       AND version = $2
       AND request_expires_at IS NOT NULL
       AND request_expires_at <= now()
     RETURNING id`,
    [conversationId, version],
  );
  return result.rows.length;
}

async function sweepExpiredDmRequests(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ id: string }>(
    `WITH doomed AS (
       SELECT id
       FROM conversations
       WHERE request_state = 'pending'
         AND request_expires_at IS NOT NULL
         AND request_expires_at <= now()
       ORDER BY request_expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE conversations AS c
     SET request_state = 'expired',
         version = c.version + 1,
         updated_at = now()
     FROM doomed
     WHERE c.id = doomed.id
     RETURNING c.id`,
    [DM_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

async function sweepPurgeDmMessages(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ id: string }>(
    `WITH doomed AS (
       SELECT id
       FROM messages
       WHERE content_state = 'live'
         AND purge_eligible_at IS NOT NULL
         AND purge_eligible_at <= now()
       ORDER BY purge_eligible_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE messages AS m
     SET body_text = NULL,
         content_state = 'purged'
     FROM doomed
     WHERE m.id = doomed.id
     RETURNING m.id`,
    [DM_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

async function expireInvitation(
  db: SqlExecutor,
  invitationId: string,
  version: number,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE game_invitations
     SET status = 'expired',
         version = version + 1,
         decided_at = now(),
         updated_at = now()
     WHERE id = $1
       AND status = 'pending'
       AND version = $2
       AND expires_at IS NOT NULL
       AND expires_at <= now()
     RETURNING id`,
    [invitationId, version],
  );
  return result.rows.length;
}

async function sweepExpiredInvitations(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ id: string }>(
    `WITH doomed AS (
       SELECT id
       FROM game_invitations
       WHERE status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= now()
       ORDER BY expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE game_invitations AS i
     SET status = 'expired',
         version = i.version + 1,
         decided_at = now(),
         updated_at = now()
     FROM doomed
     WHERE i.id = doomed.id
     RETURNING i.id`,
    [INVITATION_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

/**
 * Bookkeeping close for ended/cancelled/completed Games.
 * Permission remains source-fenced on every chat read/send even if worker is down.
 */
async function sweepCloseEndedGameChats(db: SqlExecutor): Promise<number> {
  const result = await db.query<{ id: string }>(
    `WITH doomed AS (
       SELECT c.id
       FROM conversations c
       INNER JOIN games g ON g.id = c.game_id
       WHERE c.kind = 'game'
         AND c.lifecycle_state = 'active'
         AND (
           g.status IN ('cancelled', 'completed')
           OR g.ends_at <= now()
         )
       ORDER BY g.ends_at ASC
       LIMIT $1
       FOR UPDATE OF c SKIP LOCKED
     )
     UPDATE conversations AS c
     SET lifecycle_state = 'closed',
         version = c.version + 1,
         updated_at = now()
     FROM doomed
     WHERE c.id = doomed.id
     RETURNING c.id`,
    [DM_CLEANUP_BATCH_LIMIT],
  );
  return result.rows.length;
}

async function maybeFailOnceForTests(): Promise<void> {
  const marker = process.env.LS02_CLEANUP_FAIL_ONCE_PATH;
  if (!marker || marker.trim().length === 0) return;
  const fs = await import("node:fs/promises");
  try {
    await fs.access(marker);
  } catch {
    return;
  }
  await fs.unlink(marker);
  throw new Error("LS02_TEST_INJECTED_CLEANUP_FAILURE");
}
