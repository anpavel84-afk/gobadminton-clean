import type { Pool, PoolClient } from "pg";
import { openSecret } from "../auth/crypto";
import type { AppEnv } from "../config/env";
import { WEB_PUSH_INTENT_RECOVER_BATCH_LIMIT } from "../jobs/constants";
import type { WebPushGameEventDeliverPayload } from "../jobs/payloads";
import { unrestrictedSql } from "../restrictions/policy";
import type { DeliveryOutcome, SqlExec, WebPushTransport } from "./push-delivery";
import { accountFence } from "./push.policy";
import {
  eventKeyMatchesGameChange,
  eventKeyMatchesInvitation,
  eventKeyMatchesParticipation,
  eventKeyMatchesReminder,
} from "./game-push-intents";
import {
  GAME_PUSH_COPY,
  GAME_PUSH_PREF_COLUMN,
  eventGroupForKind,
  pathForGamePush,
  type GamePushKind,
} from "./game-push.policy";

function asExec(client: Pool | PoolClient): SqlExec {
  return {
    query: async <T = Record<string, unknown>>(text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows as T[] };
    },
  };
}

async function preferenceAllows(
  exec: SqlExec,
  userId: string,
  kind: GamePushKind,
): Promise<boolean> {
  const column = GAME_PUSH_PREF_COLUMN[eventGroupForKind(kind)];
  const row = await exec.query<{ enabled: boolean; event_on: boolean }>(
    `SELECT enabled, ${column} AS event_on
     FROM web_push_preferences WHERE user_id = $1`,
    [userId],
  );
  const pref = row.rows[0];
  return pref?.enabled === true && pref.event_on === true;
}

async function sessionStillOwns(
  exec: SqlExec,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const row = await exec.query<{ ok: boolean }>(
    `SELECT true AS ok FROM app_sessions
     WHERE id = $1 AND user_id = $2
       AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId, userId],
  );
  return Boolean(row.rows[0]?.ok);
}

async function recipientAccountAllowsPush(
  exec: SqlExec,
  userId: string,
  restrictionsEnabled: boolean,
): Promise<boolean> {
  const row = await exec.query<{ ok: boolean }>(
    `SELECT true AS ok FROM users u
     WHERE u.id = $1
       AND u.status = 'active'
       AND ${unrestrictedSql(restrictionsEnabled, "$1", ["account.access"])}`,
    [userId],
  );
  return Boolean(row.rows[0]?.ok);
}

async function markGameIntentConsumed(
  exec: SqlExec,
  eventKey: string,
  recipientUserId: string,
): Promise<void> {
  await exec.query(
    `UPDATE web_push_delivery_intents
     SET status = 'consumed', updated_at = now()
     WHERE event_key = $1
       AND recipient_user_id = $2
       AND status IN ('pending', 'queued')`,
    [eventKey, recipientUserId],
  );
}

async function blockedPair(
  exec: SqlExec,
  a: string,
  b: string,
): Promise<boolean> {
  if (!b || a === b) return false;
  const blocked = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM user_blocks
     WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
        OR (blocker_user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [a, b],
  );
  return Boolean(blocked.rows[0]);
}

async function isActiveGameManager(
  exec: SqlExec,
  gameId: string,
  userId: string,
): Promise<boolean> {
  if (!userId) return false;
  const row = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM game_managers
     WHERE game_id = $1 AND user_id = $2
       AND status = 'active' AND role IN ('owner', 'manager')
     LIMIT 1`,
    [gameId, userId],
  );
  return Boolean(row.rows[0]);
}

/**
 * Re-check current business proof before external transport.
 * Cancelled games suppress non-cancel kinds; cancel itself requires snapshot.
 * Moderated/taken_down games are suppressed when GAME_MODERATION is on.
 */
export async function gameEventEligible(
  exec: SqlExec,
  payload: WebPushGameEventDeliverPayload,
  options?: { moderationEnabled?: boolean },
): Promise<boolean> {
  if (payload.recipientUserId === payload.actorUserId) return false;

  const game = await exec.query<{
    status: string;
    version: number;
  }>(`SELECT status, version FROM games WHERE id = $1`, [payload.gameId]);
  const g = game.rows[0];
  if (!g) return false;

  if (options?.moderationEnabled) {
    const mod = await exec.query<{ state: string }>(
      `SELECT state FROM game_moderation_state WHERE game_id = $1`,
      [payload.gameId],
    );
    const state = mod.rows[0]?.state ?? "clear";
    if (state === "taken_down" || state === "hidden") {
      return false;
    }
  }

  if (payload.kind !== "game_cancelled" && g.status === "cancelled") {
    return false;
  }
  if (
    payload.kind !== "game_cancelled" &&
    payload.kind !== "outcome_reminder" &&
    g.status !== "published"
  ) {
    return false;
  }

  if (await blockedPair(exec, payload.recipientUserId, payload.actorUserId ?? "")) {
    return false;
  }

  switch (payload.kind) {
    case "game_invitation": {
      if (!payload.invitationId) return false;
      const inv = await exec.query<{
        status: string;
        version: number;
        game_id: string;
        invitee_user_id: string;
        expires_at: Date | null;
      }>(
        `SELECT status, version, game_id, invitee_user_id, expires_at
         FROM game_invitations WHERE id = $1`,
        [payload.invitationId],
      );
      const row = inv.rows[0];
      if (!row) return false;
      if (row.game_id !== payload.gameId) return false;
      if (row.invitee_user_id !== payload.recipientUserId) return false;
      if (
        !eventKeyMatchesInvitation(
          payload.eventKey,
          payload.invitationId,
          row.version,
        )
      ) {
        return false;
      }
      if (row.status !== "pending") return false;
      if (row.expires_at && row.expires_at.getTime() <= Date.now()) return false;
      if (payload.actorUserId) {
        if (!(await isActiveGameManager(exec, payload.gameId, payload.actorUserId))) {
          return false;
        }
      }
      return g.status === "published";
    }
    case "participation_confirmed":
    case "participation_rejected": {
      if (!payload.participationId) return false;
      const part = await exec.query<{
        status: string;
        version: number;
        game_id: string;
        user_id: string;
      }>(
        `SELECT status, version, game_id, user_id FROM participations WHERE id = $1`,
        [payload.participationId],
      );
      const row = part.rows[0];
      if (!row || row.user_id !== payload.recipientUserId) return false;
      if (row.game_id !== payload.gameId) return false;
      if (
        !eventKeyMatchesParticipation(
          payload.eventKey,
          payload.kind,
          payload.participationId,
          row.version,
        )
      ) {
        return false;
      }
      if (payload.kind === "participation_confirmed" && row.status !== "confirmed") {
        return false;
      }
      // Own rejected version still valid — does not require confirmed seat.
      if (payload.kind === "participation_rejected" && row.status !== "rejected") {
        return false;
      }
      if (payload.actorUserId) {
        if (!(await isActiveGameManager(exec, payload.gameId, payload.actorUserId))) {
          return false;
        }
      }
      return true;
    }
    case "new_pending_application": {
      if (!payload.participationId) return false;
      const part = await exec.query<{
        status: string;
        version: number;
        game_id: string;
        user_id: string;
      }>(
        `SELECT status, version, game_id, user_id FROM participations WHERE id = $1`,
        [payload.participationId],
      );
      const row = part.rows[0];
      if (!row || row.status !== "pending") return false;
      if (row.game_id !== payload.gameId) return false;
      // Applicant actor must be the participation user.
      if (payload.actorUserId && payload.actorUserId !== row.user_id) return false;
      if (
        !eventKeyMatchesParticipation(
          payload.eventKey,
          "new_pending_application",
          payload.participationId,
          row.version,
        )
      ) {
        return false;
      }
      // Exact timestamptz epoch fence: missing intent/snapshot always denies.
      // Compare in SQL only — JS Date.getTime truncates Postgres microseconds.
      const proof = await exec.query<{ n: number }>(
        `SELECT 1 AS n
         FROM web_push_delivery_intents i
         INNER JOIN game_managers gm
           ON gm.game_id = $3
          AND gm.user_id = $2
          AND gm.status = 'active'
          AND gm.role IN ('owner', 'manager')
          AND i.manager_updated_at IS NOT NULL
          AND i.manager_updated_at = gm.updated_at
         WHERE i.event_key = $1
           AND i.recipient_user_id = $2
         LIMIT 1`,
        [payload.eventKey, payload.recipientUserId, payload.gameId],
      );
      return Boolean(proof.rows[0]);
    }
    case "game_cancelled": {
      if (g.status !== "cancelled") return false;
      if (g.version !== payload.gameVersion) return false;
      if (
        !eventKeyMatchesGameChange(
          payload.eventKey,
          "game_cancelled",
          payload.gameId,
          payload.gameVersion,
        )
      ) {
        return false;
      }
      const snap = await exec.query<{ n: number }>(
        `SELECT 1 AS n FROM web_push_game_cancel_recipients
         WHERE game_id = $1 AND game_version = $2 AND user_id = $3
         LIMIT 1`,
        [payload.gameId, payload.gameVersion, payload.recipientUserId],
      );
      return Boolean(snap.rows[0]);
    }
    case "outcome_reminder": {
      if (!payload.reminderId || payload.reminderOrdinal == null) return false;
      if (
        !eventKeyMatchesReminder(
          payload.eventKey,
          payload.reminderId,
          payload.reminderOrdinal,
        )
      ) {
        return false;
      }
      const rem = await exec.query<{
        state: string;
        ordinal: number;
        organizer_user_id: string;
        game_id: string;
      }>(
        `SELECT state, ordinal, organizer_user_id, game_id
         FROM game_outcome_reminders WHERE id = $1`,
        [payload.reminderId],
      );
      const row = rem.rows[0];
      if (!row) return false;
      if (row.game_id !== payload.gameId) return false;
      if (row.organizer_user_id !== payload.recipientUserId) return false;
      if (row.ordinal !== payload.reminderOrdinal) return false;
      if (row.state !== "visible") return false;
      const outcome = await exec.query<{ n: number }>(
        `SELECT 1 AS n FROM game_outcomes WHERE game_id = $1 LIMIT 1`,
        [payload.gameId],
      );
      if (outcome.rows[0]) return false;
      if (g.status === "cancelled") return false;
      return isActiveGameManager(exec, payload.gameId, payload.recipientUserId);
    }
  }
}

export async function deliverGameEventWebPushJob(input: {
  pool: Pool;
  env: AppEnv;
  payload: WebPushGameEventDeliverPayload;
  transport: WebPushTransport;
}): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = {
    delivered: 0,
    skipped: 0,
    cleaned: 0,
    failedTransient: 0,
  };
  if (!input.env.WEB_PUSH_ENABLED) {
    outcome.skipped += 1;
    return outcome;
  }
  const client = await input.pool.connect();
  try {
    const exec = asExec(client);
    const moderationEnabled = input.env.GAME_MODERATION_INTERNAL_ENABLED === true;

    const fencesStillOpen = async (): Promise<boolean> => {
      const accountOk = await recipientAccountAllowsPush(
        exec,
        input.payload.recipientUserId,
        input.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
      );
      if (!accountOk) return false;
      const prefOn = await preferenceAllows(
        exec,
        input.payload.recipientUserId,
        input.payload.kind,
      );
      if (!prefOn) return false;
      return gameEventEligible(exec, input.payload, { moderationEnabled });
    };

    if (!(await fencesStillOpen())) {
      await markGameIntentConsumed(
        exec,
        input.payload.eventKey,
        input.payload.recipientUserId,
      );
      outcome.skipped += 1;
      return outcome;
    }

    const subs = await exec.query<{
      id: string;
      session_id: string;
      endpoint_sealed: string;
      p256dh_sealed: string;
      auth_sealed: string;
    }>(
      `SELECT id, session_id, endpoint_sealed, p256dh_sealed, auth_sealed
       FROM web_push_subscriptions
       WHERE user_id = $1 AND unbound_at IS NULL
       ORDER BY created_at ASC
       LIMIT 5`,
      [input.payload.recipientUserId],
    );

    const fence = accountFence(
      input.env.AUTH_PEPPER,
      input.payload.recipientUserId,
    );
    const path = pathForGamePush(input.payload.kind, input.payload.gameId);
    const body = JSON.stringify({
      title: GAME_PUSH_COPY[input.payload.kind],
      tag: `gb-game-${input.payload.eventKey}`,
      path,
      fence,
      kind: "game_event",
    });

    for (const sub of subs.rows) {
      const owns = await sessionStillOwns(
        exec,
        sub.session_id,
        input.payload.recipientUserId,
      );
      if (!owns) {
        await exec.query(
          `UPDATE web_push_subscriptions
           SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
           WHERE id = $1 AND unbound_at IS NULL`,
          [sub.id],
        );
        outcome.cleaned += 1;
        continue;
      }

      const claimed = await exec.query<{
        id: string;
        status: string;
        attempt_count: number;
      }>(
        `INSERT INTO web_push_delivery_claims (
           message_id, event_key, subscription_id, recipient_user_id, kind, status, attempt_count
         ) VALUES (NULL, $1, $2, $3, $4, 'claimed', 1)
         ON CONFLICT (event_key, subscription_id) WHERE event_key IS NOT NULL DO UPDATE
           SET status = 'claimed',
               attempt_count = web_push_delivery_claims.attempt_count + 1,
               updated_at = now()
           WHERE web_push_delivery_claims.status = 'failed'
         RETURNING id, status, attempt_count`,
        [
          input.payload.eventKey,
          sub.id,
          input.payload.recipientUserId,
          input.payload.kind,
        ],
      );
      if (!claimed.rows[0]) {
        outcome.skipped += 1;
        continue;
      }
      if (claimed.rows[0].attempt_count > 8) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'skipped', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        outcome.skipped += 1;
        continue;
      }

      let endpoint: string;
      let p256dh: string;
      let auth: string;
      try {
        endpoint = openSecret(input.env.AUTH_PEPPER, sub.endpoint_sealed);
        p256dh = openSecret(input.env.AUTH_PEPPER, sub.p256dh_sealed);
        auth = openSecret(input.env.AUTH_PEPPER, sub.auth_sealed);
      } catch {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'failed', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        await exec.query(
          `UPDATE web_push_subscriptions
           SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
           WHERE id = $1`,
          [sub.id],
        );
        outcome.cleaned += 1;
        continue;
      }

      // Recheck event/prefs/account/block/session fences before EACH provider call.
      if (!(await fencesStillOpen())) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'skipped', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        await markGameIntentConsumed(
          exec,
          input.payload.eventKey,
          input.payload.recipientUserId,
        );
        outcome.skipped += 1;
        return outcome;
      }
      const ownsAgain = await sessionStillOwns(
        exec,
        sub.session_id,
        input.payload.recipientUserId,
      );
      if (!ownsAgain) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'skipped', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        await exec.query(
          `UPDATE web_push_subscriptions
           SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
           WHERE id = $1 AND unbound_at IS NULL`,
          [sub.id],
        );
        outcome.cleaned += 1;
        continue;
      }

      const result = await input.transport.send({
        endpoint,
        p256dh,
        auth,
        payload: body,
        ttl: 86_400,
      });

      if (result.statusCode >= 200 && result.statusCode < 300) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'sent', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        outcome.delivered += 1;
        continue;
      }
      if (result.unknown || result.statusCode === 0) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'unknown', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        outcome.skipped += 1;
        continue;
      }
      if (result.permanent || result.statusCode === 404 || result.statusCode === 410) {
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'gone', updated_at = now() WHERE id = $1`,
          [claimed.rows[0].id],
        );
        await exec.query(
          `UPDATE web_push_subscriptions
           SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
           WHERE id = $1`,
          [sub.id],
        );
        outcome.cleaned += 1;
        continue;
      }
      await exec.query(
        `UPDATE web_push_delivery_claims
         SET status = 'failed', updated_at = now() WHERE id = $1`,
        [claimed.rows[0].id],
      );
      outcome.failedTransient += 1;
    }

    if (outcome.failedTransient === 0) {
      await markGameIntentConsumed(
        exec,
        input.payload.eventKey,
        input.payload.recipientUserId,
      );
    }
    return outcome;
  } finally {
    client.release();
  }
}

export async function recoverPendingGamePushIntents(input: {
  pool: Pool;
  enqueueInTx: (
    client: PoolClient,
    payload: WebPushGameEventDeliverPayload,
  ) => Promise<boolean>;
  limit?: number;
}): Promise<{ recovered: number; failed: number }> {
  const limit = input.limit ?? WEB_PUSH_INTENT_RECOVER_BATCH_LIMIT;
  const pending = await input.pool.query<{
    id: string;
    event_key: string;
    kind: GamePushKind;
    recipient_user_id: string;
    actor_user_id: string | null;
    game_id: string;
    game_version: number;
    invitation_id: string | null;
    participation_id: string | null;
    reminder_id: string | null;
    reminder_ordinal: number | null;
  }>(
    `SELECT id, event_key, kind, recipient_user_id, actor_user_id, game_id,
            game_version, invitation_id, participation_id, reminder_id, reminder_ordinal
     FROM web_push_delivery_intents
     WHERE status = 'pending'
       AND event_key IS NOT NULL
       AND created_at > now() - interval '7 days'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );

  let recovered = 0;
  let failed = 0;
  for (const row of pending.rows) {
    const payload: WebPushGameEventDeliverPayload = {
      kind: row.kind,
      eventKey: row.event_key,
      recipientUserId: row.recipient_user_id,
      actorUserId: row.actor_user_id,
      gameId: row.game_id,
      gameVersion: row.game_version,
      invitationId: row.invitation_id,
      participationId: row.participation_id,
      reminderId: row.reminder_id,
      reminderOrdinal: row.reminder_ordinal,
    };
    const client = await input.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{ id: string }>(
        `UPDATE web_push_delivery_intents
         SET status = 'queued', updated_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [row.id],
      );
      if (!claimed.rows[0]) {
        await client.query("ROLLBACK");
        continue;
      }
      let ok = false;
      try {
        ok = await input.enqueueInTx(client, payload);
      } catch {
        ok = false;
      }
      if (!ok) {
        await client.query("ROLLBACK");
        failed += 1;
        continue;
      }
      await client.query("COMMIT");
      recovered += 1;
    } catch {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      failed += 1;
    } finally {
      client.release();
    }
  }
  return { recovered, failed };
}
