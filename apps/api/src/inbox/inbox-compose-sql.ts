export type ComposeInboxFilter = "all" | "unread" | "attention";

export type ComposeInboxKind =
  | "dm"
  | "dm_request"
  | "game_invitation"
  | "game_chat";

export type InboxComposeFeatures = {
  dmEnabled: boolean;
  invitationsEnabled: boolean;
  gameChatEnabled: boolean;
};

export type InboxCursor = {
  at: string;
  kind: ComposeInboxKind;
  id: string;
};

/**
 * Shared compose SQL for the production Inbox page path and plan/bounds evidence.
 * Effective DM/Invitation expiry is projected read-only (no source UPDATEs).
 * Final bind order: $1=actorId, optional cursor ($2 at, $3 kind, $4 id), then LIMIT.
 */
export function buildInboxPageSql(
  features: InboxComposeFeatures,
  filter: ComposeInboxFilter,
  cursor: InboxCursor | null,
  limit: number,
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  if (features.dmEnabled) {
    parts.push(dmSourceSql(filter));
  }
  if (features.invitationsEnabled) {
    parts.push(invitationSourceSql(filter));
  }
  if (features.gameChatEnabled) {
    parts.push(gameChatSourceSql(filter));
  }
  if (parts.length === 0) {
    return { sql: "", params: [] };
  }
  const finalParams: unknown[] = [];
  let cursorSql = "";
  if (cursor) {
    finalParams.push(cursor.at, cursor.kind, cursor.id);
    cursorSql = `WHERE (
        last_activity_at < $2::timestamptz
        OR (
          last_activity_at = $2::timestamptz
          AND kind < $3::text
        )
        OR (
          last_activity_at = $2::timestamptz
          AND kind = $3::text
          AND id < $4::uuid
        )
      )`;
  }
  finalParams.push(limit + 1);
  const limitIdx = 1 + finalParams.length;
  const sql = `
      SELECT * FROM (
        ${parts.join("\nUNION ALL\n")}
      ) AS inbox
      ${cursorSql}
      ORDER BY last_activity_at DESC, kind DESC, id DESC
      LIMIT $${limitIdx}`;
  return { sql, params: finalParams };
}

export function buildInboxCountSql(
  kind: "pending_request" | "dm_unread" | "pending_invitation" | "game_chat_unread",
): string {
  switch (kind) {
    case "pending_request":
      return `SELECT COUNT(*)::text AS count
         FROM conversation_members m
         INNER JOIN conversations c ON c.id = m.conversation_id
         WHERE m.user_id = $1
           AND m.archived = false
           AND c.kind = 'direct'
           AND ${dmIsPendingEffective("c")}
           AND c.recipient_user_id = $1`;
    case "dm_unread":
      return `SELECT COUNT(*)::text AS count
         FROM conversation_members m
         INNER JOIN conversations c ON c.id = m.conversation_id
         WHERE m.user_id = $1
           AND m.archived = false
           AND m.muted = false
           AND c.kind = 'direct'
           AND c.request_state = 'accepted'
           AND EXISTS (
             SELECT 1 FROM messages msg
             WHERE msg.conversation_id = c.id
               AND msg.seq > m.read_through_seq
               AND msg.author_user_id <> m.user_id
               AND NOT EXISTS (
                 SELECT 1 FROM message_hidden_for h
                 WHERE h.message_id = msg.id AND h.user_id = m.user_id
               )
           )`;
    case "pending_invitation":
      return `SELECT COUNT(*)::text AS count
         FROM game_invitations i
         WHERE i.invitee_user_id = $1 AND ${invitationIsPendingEffective("i")}`;
    case "game_chat_unread":
      return `SELECT COUNT(*)::text AS count
         FROM conversation_members m
         INNER JOIN conversations c ON c.id = m.conversation_id
         INNER JOIN games g ON g.id = c.game_id
         WHERE m.user_id = $1
           AND m.membership_state = 'active'
           AND m.muted = false
           AND c.kind = 'game'
           AND c.lifecycle_state = 'active'
           AND g.status = 'published'
           AND g.ends_at > now()
           AND (
             EXISTS (
               SELECT 1 FROM game_managers gm
               WHERE gm.game_id = g.id
                 AND gm.user_id = $1
                 AND gm.status = 'active'
             )
             OR EXISTS (
               SELECT 1 FROM participations p
               WHERE p.game_id = g.id
                 AND p.user_id = $1
                 AND p.status = 'confirmed'
             )
           )
           AND EXISTS (
             SELECT 1 FROM messages msg
             WHERE msg.conversation_id = c.id
               AND msg.seq > m.read_through_seq
               AND msg.author_user_id <> m.user_id
               AND NOT EXISTS (
                 SELECT 1 FROM message_hidden_for h
                 WHERE h.message_id = msg.id AND h.user_id = m.user_id
               )
           )`;
  }
}

function unreadExpr(aliasC = "c", aliasM = "m"): string {
  return `COALESCE((
    SELECT COUNT(*)::int
    FROM messages msg
    WHERE msg.conversation_id = ${aliasC}.id
      AND msg.seq > ${aliasM}.read_through_seq
      AND msg.author_user_id <> ${aliasM}.user_id
      AND NOT EXISTS (
        SELECT 1 FROM message_hidden_for h
        WHERE h.message_id = msg.id AND h.user_id = ${aliasM}.user_id
      )
  ), 0)`;
}

function dmIsPendingEffective(alias = "c"): string {
  return `(${alias}.request_state = 'pending'
    AND (${alias}.request_expires_at IS NULL OR ${alias}.request_expires_at > now()))`;
}

function dmEffectiveRequestState(alias = "c"): string {
  return `CASE
      WHEN ${alias}.request_state = 'pending'
       AND ${alias}.request_expires_at IS NOT NULL
       AND ${alias}.request_expires_at <= now()
      THEN 'expired'
      ELSE ${alias}.request_state::text
    END`;
}

function invitationIsPendingEffective(alias = "i"): string {
  return `(${alias}.status = 'pending'
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now()))`;
}

function invitationEffectiveStatus(alias = "i"): string {
  return `CASE
      WHEN ${alias}.status = 'pending'
       AND ${alias}.expires_at IS NOT NULL
       AND ${alias}.expires_at <= now()
      THEN 'expired'
      ELSE ${alias}.status::text
    END`;
}

export function dmSourceSql(filter: ComposeInboxFilter): string {
  const filterSql =
    filter === "unread"
      ? `AND ${unreadExpr()} > 0`
      : filter === "attention"
        ? `AND ${dmIsPendingEffective("c")}`
        : "";
  return `
    SELECT
      CASE
        WHEN ${dmIsPendingEffective("c")} THEN 'dm_request'
        ELSE 'dm'
      END::text AS kind,
      c.id AS id,
      COALESCE(c.last_message_at, c.created_at) AS last_activity_at,
      p.display_name AS title,
      ${dmEffectiveRequestState("c")} AS subtitle_key,
      ${unreadExpr()} AS unread_count,
      ${dmIsPendingEffective("c")} AS attention,
      c.id AS conversation_id,
      NULL::uuid AS invitation_id,
      NULL::uuid AS game_id,
      p.public_player_id AS peer_public_player_id,
      p.display_name AS peer_display_name,
      ${dmEffectiveRequestState("c")} AS request_state,
      NULL::text AS invitation_status,
      m.muted AS muted
    FROM conversation_members m
    INNER JOIN conversations c ON c.id = m.conversation_id
    INNER JOIN player_social_profiles p ON p.user_id = CASE
      WHEN c.initiator_user_id = m.user_id THEN c.recipient_user_id
      ELSE c.initiator_user_id
    END
    WHERE m.user_id = $1
      AND m.archived = false
      AND c.kind = 'direct'
      ${filterSql}
  `;
}

export function invitationSourceSql(filter: ComposeInboxFilter): string {
  if (filter === "unread") {
    return `
      SELECT
        'game_invitation'::text AS kind,
        i.id AS id,
        i.created_at AS last_activity_at,
        COALESCE(g.title, 'Приглашение в игру') AS title,
        ${invitationEffectiveStatus("i")} AS subtitle_key,
        0 AS unread_count,
        ${invitationIsPendingEffective("i")} AS attention,
        NULL::uuid AS conversation_id,
        i.id AS invitation_id,
        i.game_id AS game_id,
        NULL::uuid AS peer_public_player_id,
        NULL::text AS peer_display_name,
        NULL::text AS request_state,
        ${invitationEffectiveStatus("i")} AS invitation_status,
        false AS muted
      FROM game_invitations i
      INNER JOIN games g ON g.id = i.game_id
      WHERE false
    `;
  }
  const filterSql = filter === "attention" ? `AND ${invitationIsPendingEffective("i")}` : "";
  return `
    SELECT
      'game_invitation'::text AS kind,
      i.id AS id,
      i.created_at AS last_activity_at,
      COALESCE(g.title, 'Приглашение в игру') AS title,
      ${invitationEffectiveStatus("i")} AS subtitle_key,
      0 AS unread_count,
      ${invitationIsPendingEffective("i")} AS attention,
      NULL::uuid AS conversation_id,
      i.id AS invitation_id,
      i.game_id AS game_id,
      NULL::uuid AS peer_public_player_id,
      NULL::text AS peer_display_name,
      NULL::text AS request_state,
      ${invitationEffectiveStatus("i")} AS invitation_status,
      false AS muted
    FROM game_invitations i
    INNER JOIN games g ON g.id = i.game_id
    WHERE i.invitee_user_id = $1
      ${filterSql}
  `;
}

export function gameChatSourceSql(filter: ComposeInboxFilter): string {
  if (filter === "attention") {
    return `
      SELECT
        'game_chat'::text AS kind,
        g.id AS id,
        COALESCE(c.last_message_at, c.created_at) AS last_activity_at,
        g.title AS title,
        'game_chat'::text AS subtitle_key,
        ${unreadExpr()} AS unread_count,
        false AS attention,
        c.id AS conversation_id,
        NULL::uuid AS invitation_id,
        g.id AS game_id,
        NULL::uuid AS peer_public_player_id,
        NULL::text AS peer_display_name,
        NULL::text AS request_state,
        NULL::text AS invitation_status,
        m.muted AS muted
      FROM conversation_members m
      INNER JOIN conversations c ON c.id = m.conversation_id
      INNER JOIN games g ON g.id = c.game_id
      WHERE false
    `;
  }
  const filterSql =
    filter === "unread" ? `AND ${unreadExpr()} > 0` : "";
  return `
    SELECT
      'game_chat'::text AS kind,
      g.id AS id,
      COALESCE(c.last_message_at, c.created_at) AS last_activity_at,
      g.title AS title,
      'game_chat'::text AS subtitle_key,
      ${unreadExpr()} AS unread_count,
      false AS attention,
      c.id AS conversation_id,
      NULL::uuid AS invitation_id,
      g.id AS game_id,
      NULL::uuid AS peer_public_player_id,
      NULL::text AS peer_display_name,
      NULL::text AS request_state,
      NULL::text AS invitation_status,
      m.muted AS muted
    FROM conversation_members m
    INNER JOIN conversations c ON c.id = m.conversation_id
    INNER JOIN games g ON g.id = c.game_id
    WHERE m.user_id = $1
      AND m.membership_state = 'active'
      AND c.kind = 'game'
      AND c.lifecycle_state = 'active'
      AND g.status = 'published'
      AND g.ends_at > now()
      AND (
        EXISTS (
          SELECT 1 FROM game_managers gm
          WHERE gm.game_id = g.id
            AND gm.user_id = $1
            AND gm.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM participations p
          WHERE p.game_id = g.id
            AND p.user_id = $1
            AND p.status = 'confirmed'
        )
      )
      ${filterSql}
  `;
}
