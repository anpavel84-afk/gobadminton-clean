import type { Pool, PoolClient } from "pg";
import webpush from "web-push";
import { openSecret } from "../auth/crypto";
import type { AppEnv } from "../config/env";
import {
  WEB_PUSH_INTENT_RECOVER_BATCH_LIMIT,
} from "../jobs/constants";
import type { WebPushMessageDeliverPayload } from "../jobs/payloads";
import { unrestrictedSql } from "../restrictions/policy";
import {
  PUSH_COPY,
  accountFence,
  assertSafeSameOriginPath,
} from "./push.policy";

export type WebPushSendResult = {
  statusCode: number;
  permanent: boolean;
  /** Provider outcome unknown — do not blind-retry (may already have delivered). */
  unknown?: boolean;
};

export type WebPushTransport = {
  send(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    payload: string;
    ttl: number;
  }): Promise<WebPushSendResult>;
};

/** Library transport — encrypts offline; never logs endpoint/keys. */
export function createLibraryWebPushTransport(env: {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}): WebPushTransport {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  return {
    async send(input) {
      try {
        const result = await webpush.sendNotification(
          {
            endpoint: input.endpoint,
            keys: { p256dh: input.p256dh, auth: input.auth },
          },
          input.payload,
          { TTL: input.ttl, urgency: "normal" },
        );
        return { statusCode: result.statusCode, permanent: false };
      } catch (error: unknown) {
        const statusCode =
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          typeof (error as { statusCode: unknown }).statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : 0;
        if (!statusCode) {
          // Ambiguous transport effect — preserve rather than blind-retry.
          return { statusCode: 0, permanent: false, unknown: true };
        }
        const permanent = statusCode === 404 || statusCode === 410 || statusCode === 400;
        // Never rethrow provider body/URL/token text.
        return { statusCode, permanent };
      }
    },
  };
}

export type SqlExec = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

function asExec(client: Pool | PoolClient): SqlExec {
  return {
    query: async <T = Record<string, unknown>>(text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows as T[] };
    },
  };
}

export type DeliveryOutcome = {
  delivered: number;
  skipped: number;
  cleaned: number;
  failedTransient: number;
};

async function preferenceEnabled(exec: SqlExec, userId: string): Promise<boolean> {
  const row = await exec.query<{ enabled: boolean }>(
    `SELECT enabled FROM web_push_preferences WHERE user_id = $1`,
    [userId],
  );
  return row.rows[0]?.enabled === true;
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

/**
 * Current account fence before external delivery: active user + account.access
 * when restrictions are enabled (same expressions as session/auth policy).
 */
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

async function markIntentConsumed(
  exec: SqlExec,
  messageId: string,
  recipientUserId: string,
): Promise<void> {
  await exec.query(
    `UPDATE web_push_delivery_intents
     SET status = 'consumed', updated_at = now()
     WHERE message_id = $1
       AND recipient_user_id = $2
       AND status IN ('pending', 'queued')`,
    [messageId, recipientUserId],
  );
}

async function dmEligible(
  exec: SqlExec,
  input: {
    conversationId: string;
    recipientUserId: string;
    authorUserId: string;
    messageId: string;
    messageSeq: number;
  },
): Promise<boolean> {
  if (input.recipientUserId === input.authorUserId) return false;
  const conv = await exec.query<{
    kind: string;
    request_state: string;
    initiator_user_id: string | null;
    recipient_user_id: string | null;
  }>(
    `SELECT kind, request_state, initiator_user_id, recipient_user_id
     FROM conversations WHERE id = $1`,
    [input.conversationId],
  );
  const c = conv.rows[0];
  if (!c || c.kind !== "direct" || c.request_state !== "accepted") return false;
  if (
    input.recipientUserId !== c.initiator_user_id &&
    input.recipientUserId !== c.recipient_user_id
  ) {
    return false;
  }
  const peer =
    input.recipientUserId === c.initiator_user_id
      ? c.recipient_user_id
      : c.initiator_user_id;
  if (!peer) return false;
  const blocked = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM user_blocks
     WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
        OR (blocker_user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [input.recipientUserId, peer],
  );
  if (blocked.rows[0]) return false;
  const member = await exec.query<{
    muted: boolean;
    read_through_seq: string | number;
  }>(
    `SELECT muted, read_through_seq FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.recipientUserId],
  );
  const m = member.rows[0];
  if (!m || m.muted) return false;
  if (Number(m.read_through_seq) >= input.messageSeq) return false;
  const msg = await exec.query<{ content_state: string; author_user_id: string }>(
    `SELECT content_state, author_user_id FROM messages WHERE id = $1`,
    [input.messageId],
  );
  const message = msg.rows[0];
  if (!message || message.content_state !== "live") return false;
  if (message.author_user_id !== input.authorUserId) return false;
  return true;
}

async function gameChatEligible(
  exec: SqlExec,
  input: {
    conversationId: string;
    gameId: string;
    recipientUserId: string;
    authorUserId: string;
    messageId: string;
    messageSeq: number;
  },
): Promise<boolean> {
  if (input.recipientUserId === input.authorUserId) return false;
  const game = await exec.query<{ status: string; ends_at: Date }>(
    `SELECT status, ends_at FROM games WHERE id = $1`,
    [input.gameId],
  );
  const g = game.rows[0];
  if (!g || g.status !== "published" || g.ends_at.getTime() <= Date.now()) return false;
  const manager = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM game_managers
     WHERE game_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
    [input.gameId, input.recipientUserId],
  );
  const part = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM participations
     WHERE game_id = $1 AND user_id = $2 AND status = 'confirmed' LIMIT 1`,
    [input.gameId, input.recipientUserId],
  );
  if (!manager.rows[0] && !part.rows[0]) return false;
  const blocked = await exec.query<{ n: number }>(
    `SELECT 1 AS n FROM user_blocks
     WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
        OR (blocker_user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [input.recipientUserId, input.authorUserId],
  );
  if (blocked.rows[0]) return false;
  const member = await exec.query<{
    muted: boolean;
    membership_state: string;
    read_through_seq: string | number;
  }>(
    `SELECT muted, membership_state, read_through_seq FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.recipientUserId],
  );
  const m = member.rows[0];
  if (!m || m.membership_state === "removed" || m.muted) return false;
  if (Number(m.read_through_seq) >= input.messageSeq) return false;
  const conv = await exec.query<{ lifecycle_state: string }>(
    `SELECT lifecycle_state FROM conversations WHERE id = $1`,
    [input.conversationId],
  );
  if (conv.rows[0]?.lifecycle_state !== "active") return false;
  const msg = await exec.query<{ content_state: string }>(
    `SELECT content_state FROM messages WHERE id = $1`,
    [input.messageId],
  );
  if (msg.rows[0]?.content_state !== "live") return false;
  return true;
}

async function loadMessageMeta(
  exec: SqlExec,
  messageId: string,
): Promise<{ seq: number; conversationId: string } | null> {
  const row = await exec.query<{
    seq: string | number;
    conversation_id: string;
  }>(`SELECT seq, conversation_id FROM messages WHERE id = $1`, [messageId]);
  const m = row.rows[0];
  if (!m) return null;
  return { seq: Number(m.seq), conversationId: m.conversation_id };
}

/**
 * Deliver one push job. Transport failures never throw to the caller in a way
 * that would imply message rollback — jobs may retry transient failures only.
 */
export async function deliverWebPushJob(input: {
  pool: Pool;
  env: AppEnv;
  payload: WebPushMessageDeliverPayload;
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
    const meta = await loadMessageMeta(exec, input.payload.messageId);
    if (!meta) {
      await markIntentConsumed(
        exec,
        input.payload.messageId,
        input.payload.recipientUserId,
      );
      outcome.skipped += 1;
      return outcome;
    }
    if (meta.conversationId !== input.payload.conversationId) {
      await markIntentConsumed(
        exec,
        input.payload.messageId,
        input.payload.recipientUserId,
      );
      outcome.skipped += 1;
      return outcome;
    }

    const accountOk = await recipientAccountAllowsPush(
      exec,
      input.payload.recipientUserId,
      input.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
    );
    if (!accountOk) {
      await markIntentConsumed(
        exec,
        input.payload.messageId,
        input.payload.recipientUserId,
      );
      outcome.skipped += 1;
      return outcome;
    }

    const prefOn = await preferenceEnabled(exec, input.payload.recipientUserId);
    if (!prefOn) {
      await markIntentConsumed(
        exec,
        input.payload.messageId,
        input.payload.recipientUserId,
      );
      outcome.skipped += 1;
      return outcome;
    }

    let eligible = false;
    if (input.payload.kind === "dm_message") {
      eligible = await dmEligible(exec, {
        conversationId: input.payload.conversationId,
        recipientUserId: input.payload.recipientUserId,
        authorUserId: input.payload.authorUserId,
        messageId: input.payload.messageId,
        messageSeq: meta.seq,
      });
    } else {
      if (!input.payload.gameId) {
        await markIntentConsumed(
          exec,
          input.payload.messageId,
          input.payload.recipientUserId,
        );
        outcome.skipped += 1;
        return outcome;
      }
      eligible = await gameChatEligible(exec, {
        conversationId: input.payload.conversationId,
        gameId: input.payload.gameId,
        recipientUserId: input.payload.recipientUserId,
        authorUserId: input.payload.authorUserId,
        messageId: input.payload.messageId,
        messageSeq: meta.seq,
      });
    }
    if (!eligible) {
      await markIntentConsumed(
        exec,
        input.payload.messageId,
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
    const path =
      input.payload.kind === "dm_message"
        ? assertSafeSameOriginPath(
            `/messages?conversation=${input.payload.conversationId}`,
            "dm_message",
          )
        : assertSafeSameOriginPath(
            `/messages?game=${input.payload.gameId}`,
            "game_chat_message",
          );
    const body = JSON.stringify({
      title: PUSH_COPY[input.payload.kind],
      tag: `gb-msg-${input.payload.messageId}`,
      path,
      fence,
      kind: input.payload.kind === "dm_message" ? "dm" : "game",
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

      // Claim only failed rows, or stale claimed (crash). Recent claimed =
      // concurrent in-flight — skip to avoid double send. Sent/gone/skipped stay skipped.
      const claimed = await exec.query<{ id: string; status: string; attempt_count: number }>(
        `INSERT INTO web_push_delivery_claims (
           message_id, subscription_id, recipient_user_id, kind, status, attempt_count
         ) VALUES ($1, $2, $3, $4, 'claimed', 1)
         ON CONFLICT (message_id, subscription_id) DO UPDATE
           SET status = 'claimed',
               attempt_count = web_push_delivery_claims.attempt_count + 1,
               updated_at = now()
           WHERE web_push_delivery_claims.status = 'failed'
              OR (
                   web_push_delivery_claims.status = 'claimed'
                   AND web_push_delivery_claims.updated_at < now() - interval '120 seconds'
                 )
         RETURNING id, status, attempt_count`,
        [
          input.payload.messageId,
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
        // Preserve ambiguous provider effect — do not blind-retry (may already delivered).
        await exec.query(
          `UPDATE web_push_delivery_claims
           SET status = 'skipped', updated_at = now() WHERE id = $1`,
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
      await markIntentConsumed(
        exec,
        input.payload.messageId,
        input.payload.recipientUserId,
      );
    }
    return outcome;
  } finally {
    client.release();
  }
}

/**
 * Bounded recover of pending durable intents after PgBoss enqueue outage.
 * Reuses the existing deliver queue via caller-provided dispatch (no new scheduler).
 */
export async function recoverPendingWebPushIntents(input: {
  pool: Pool;
  dispatch: (payload: WebPushMessageDeliverPayload) => Promise<boolean>;
  limit?: number;
}): Promise<{ recovered: number; failed: number }> {
  const limit = input.limit ?? WEB_PUSH_INTENT_RECOVER_BATCH_LIMIT;
  const pending = await input.pool.query<{
    id: string;
    message_id: string;
    conversation_id: string;
    recipient_user_id: string;
    author_user_id: string;
    kind: "dm_message" | "game_chat_message";
    game_id: string | null;
  }>(
    `SELECT id, message_id, conversation_id, recipient_user_id, author_user_id, kind, game_id
     FROM web_push_delivery_intents
     WHERE status = 'pending'
       AND created_at > now() - interval '7 days'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );

  let recovered = 0;
  let failed = 0;
  for (const row of pending.rows) {
    const claimed = await input.pool.query<{ id: string }>(
      `UPDATE web_push_delivery_intents
       SET status = 'queued', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;

    const payload: WebPushMessageDeliverPayload =
      row.kind === "dm_message"
        ? {
            kind: "dm_message",
            messageId: row.message_id,
            conversationId: row.conversation_id,
            recipientUserId: row.recipient_user_id,
            authorUserId: row.author_user_id,
          }
        : {
            kind: "game_chat_message",
            messageId: row.message_id,
            conversationId: row.conversation_id,
            gameId: row.game_id!,
            recipientUserId: row.recipient_user_id,
            authorUserId: row.author_user_id,
          };

    try {
      const ok = await input.dispatch(payload);
      if (ok) recovered += 1;
      else {
        await input.pool.query(
          `UPDATE web_push_delivery_intents
           SET status = 'pending', updated_at = now()
           WHERE id = $1 AND status = 'queued'`,
          [row.id],
        );
        failed += 1;
      }
    } catch {
      await input.pool.query(
        `UPDATE web_push_delivery_intents
         SET status = 'pending', updated_at = now()
         WHERE id = $1 AND status = 'queued'`,
        [row.id],
      );
      failed += 1;
    }
  }
  return { recovered, failed };
}

/** Decode library request for offline unit tests (no network). */
export function buildEncryptedPushRequest(input: {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: string;
}): { method: string; headers: Record<string, string | number | string[] | undefined>; body: Buffer | null } {
  webpush.setVapidDetails(
    input.vapidSubject,
    input.vapidPublicKey,
    input.vapidPrivateKey,
  );
  return webpush.generateRequestDetails(
    {
      endpoint: input.endpoint,
      keys: { p256dh: input.p256dh, auth: input.auth },
    },
    input.payload,
    { TTL: 60 },
  );
}
