import type { PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import type { GamePushKind } from "./game-push.policy";

export type GamePushSql = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export type GamePushIntentInput = {
  kind: GamePushKind;
  eventKey: string;
  recipientUserId: string;
  gameId: string;
  gameVersion: number;
  actorUserId?: string | null;
  invitationId?: string | null;
  participationId?: string | null;
  reminderId?: string | null;
  reminderOrdinal?: number | null;
};

/**
 * Persist a durable game-event push intent in the caller's business TX.
 * Never carries title/body/PII. Idempotent on (event_key, recipient).
 * Does not enqueue PgBoss — caller uses JobEnqueueService SAVEPOINT path.
 * For new_pending_application, manager_updated_at is captured server-side from
 * game_managers.updated_at (exact timestamptz) — never via JS Date/ISO.
 */
export async function persistGameEventPushIntent(
  client: GamePushSql,
  input: GamePushIntentInput,
): Promise<void> {
  await client.query(
    `INSERT INTO web_push_delivery_intents (
       message_id, conversation_id, recipient_user_id, author_user_id,
       kind, game_id, event_key, invitation_id, participation_id,
       reminder_id, reminder_ordinal, game_version, actor_user_id,
       manager_updated_at, status
     ) VALUES (
       NULL, NULL, $1, NULL,
       $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       CASE
         WHEN $2::text = 'new_pending_application' THEN (
           SELECT gm.updated_at
           FROM game_managers gm
           WHERE gm.game_id = $3
             AND gm.user_id = $1
             AND gm.status = 'active'
             AND gm.role IN ('owner', 'manager')
           LIMIT 1
         )
         ELSE NULL
       END,
       'pending'
     )
     ON CONFLICT (event_key, recipient_user_id) WHERE event_key IS NOT NULL
     DO NOTHING`,
    [
      input.recipientUserId,
      input.kind,
      input.gameId,
      input.eventKey,
      input.invitationId ?? null,
      input.participationId ?? null,
      input.reminderId ?? null,
      input.reminderOrdinal ?? null,
      input.gameVersion,
      input.actorUserId ?? null,
    ],
  );
}

/**
 * Optional durable intent: SAVEPOINT so a failed INSERT cannot abort the
 * caller's business TX. Returns false when the intent did not land.
 */
export async function persistGameEventPushIntentOptional(
  client: GamePushSql,
  input: GamePushIntentInput,
): Promise<boolean> {
  try {
    await client.query("SAVEPOINT web_push_game_intent");
  } catch {
    return false;
  }
  try {
    await persistGameEventPushIntent(client, input);
    await client.query("RELEASE SAVEPOINT web_push_game_intent");
    return true;
  } catch {
    try {
      await client.query("ROLLBACK TO SAVEPOINT web_push_game_intent");
    } catch {
      /* TX may already be unusable; caller still must not see a throw */
    }
    return false;
  }
}

/** Snapshot pending/confirmed participants at cancel TX for later delivery fence. */
export async function snapshotGameCancelRecipients(
  client: PoolClient | GamePushSql,
  input: { gameId: string; gameVersion: number },
): Promise<string[]> {
  const rows = await client.query(
    `SELECT user_id, status
     FROM participations
     WHERE game_id = $1
       AND status IN ('pending', 'confirmed')
     FOR SHARE`,
    [input.gameId],
  );
  const userIds: string[] = [];
  for (const row of rows.rows as Array<{ user_id: string; status: string }>) {
    await client.query(
      `INSERT INTO web_push_game_cancel_recipients (
         game_id, game_version, user_id, membership_status
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_id, game_version, user_id) DO NOTHING`,
      [input.gameId, input.gameVersion, row.user_id, row.status],
    );
    userIds.push(row.user_id);
  }
  return userIds;
}

export function gamePushEnabled(env: Pick<AppEnv, "WEB_PUSH_ENABLED">): boolean {
  return env.WEB_PUSH_ENABLED === true;
}

export function invitationEventKey(
  invitationId: string,
  version: number,
): string {
  return `inv:${invitationId}:v${version}`;
}

export function participationEventKey(
  kind:
    | "participation_confirmed"
    | "participation_rejected"
    | "new_pending_application",
  participationId: string,
  version: number,
): string {
  const prefix =
    kind === "new_pending_application"
      ? "app"
      : kind === "participation_confirmed"
        ? "pc"
        : "pr";
  return `${prefix}:${participationId}:v${version}`;
}

export function gameChangeEventKey(
  kind: "game_cancelled" | "game_time_changed" | "game_venue_changed",
  gameId: string,
  gameVersion: number,
): string {
  const prefix =
    kind === "game_cancelled"
      ? "gc"
      : kind === "game_time_changed"
        ? "gt"
        : "gv";
  return `${prefix}:${gameId}:v${gameVersion}`;
}

export function reminderEventKey(
  reminderId: string,
  ordinal: number,
): string {
  return `or:${reminderId}:o${ordinal}`;
}

/** Trusted comparison — eventKey must equal the builder for the current row version. */
export function eventKeyMatchesInvitation(
  eventKey: string,
  invitationId: string,
  version: number,
): boolean {
  return eventKey === invitationEventKey(invitationId, version);
}

export function eventKeyMatchesParticipation(
  eventKey: string,
  kind:
    | "participation_confirmed"
    | "participation_rejected"
    | "new_pending_application",
  participationId: string,
  version: number,
): boolean {
  return eventKey === participationEventKey(kind, participationId, version);
}

export function eventKeyMatchesGameChange(
  eventKey: string,
  kind: "game_cancelled" | "game_time_changed" | "game_venue_changed",
  gameId: string,
  gameVersion: number,
): boolean {
  return eventKey === gameChangeEventKey(kind, gameId, gameVersion);
}

export function eventKeyMatchesReminder(
  eventKey: string,
  reminderId: string,
  ordinal: number,
): boolean {
  return eventKey === reminderEventKey(reminderId, ordinal);
}
