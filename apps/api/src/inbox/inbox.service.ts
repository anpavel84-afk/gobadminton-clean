import { avatarForPlayer, type PlayerAvatar } from "../profiles/avatar-presentation";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { badRequest, notFound, unprocessable } from "../auth/problem";
import { GameChatService } from "../game-chat/game-chat.service";
import { MessagingService } from "../messaging/messaging.service";
import { DATABASE_POOL } from "../tokens";
import {
  DM_REQUEST_SUBTITLE,
  GAME_CHAT_SUBTITLE,
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  INVITATION_SUBTITLE,
} from "./constants";
import {
  buildInboxCountSql,
  buildInboxPageSql,
  type ComposeInboxFilter,
  type ComposeInboxKind,
} from "./inbox-compose-sql";
import { InboxFeatureService } from "./inbox-feature";

export type InboxKind = ComposeInboxKind;
export type InboxFilter = ComposeInboxFilter;

export type InboxPeerDto = {
  avatar?: PlayerAvatar;
  publicPlayerId: string;
  displayName: string;
};

export type InboxItemDto = {
  kind: InboxKind;
  id: string;
  lastActivityAt: string;
  title: string;
  subtitle: string;
  unreadCount: number;
  attention: boolean;
  conversationId: string | null;
  invitationId: string | null;
  gameId: string | null;
  peer: InboxPeerDto | null;
  requestState:
    | "pending"
    | "accepted"
    | "declined"
    | "expired"
    | "closed"
    | null;
  invitationStatus:
    | "pending"
    | "accepted"
    | "declined"
    | "expired"
    | "revoked"
    | "cancelled_by_game"
    | null;
  muted: boolean;
};

export type InboxCountsDto = {
  pendingRequestCount: number;
  pendingInvitationCount: number;
  dmUnread: number;
  gameChatUnread: number;
};

export type InboxPageDto = {
  items: InboxItemDto[];
  nextCursor: string | null;
  counts: InboxCountsDto;
};

type RawRow = {
  kind: InboxKind;
  id: string;
  last_activity_at: Date;
  title: string;
  subtitle_key: string;
  unread_count: string | number;
  attention: boolean;
  conversation_id: string | null;
  invitation_id: string | null;
  game_id: string | null;
  peer_public_player_id: string | null;
  peer_display_name: string | null;
  request_state: InboxItemDto["requestState"];
  invitation_status: InboxItemDto["invitationStatus"];
  muted: boolean;
};

@Injectable()
export class InboxService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly feature: InboxFeatureService,
    private readonly messaging: MessagingService,
    private readonly gameChat: GameChatService,
  ) {}

  async list(
    actorId: string,
    query: { cursor?: string; limit?: number; filter?: string },
  ): Promise<InboxPageDto> {
    this.feature.assertEnabled();
    const limit = clampLimit(query.limit);
    const filter = parseFilter(query.filter);
    const cursor = decodeCursor(query.cursor);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        // Read-only compose: source expiry remains Messaging / Invitation / jobs.
        const items = await this.queryPage(client, actorId, {
          limit,
          filter,
          cursor,
        });
        const counts = await this.queryCounts(client, actorId);
        await client.query("COMMIT");
        const page = items.slice(0, limit);
        const last = page[page.length - 1];
        return {
          items: await Promise.all(page.map(async row => { const item = projectItem(row); if (item.peer) item.peer.avatar = await avatarForPlayer(this.pool, item.peer.publicPlayerId); return item; })),
          nextCursor:
            items.length > limit && last
              ? encodeCursor({
                  at: last.last_activity_at.toISOString(),
                  kind: last.kind,
                  id: last.id,
                })
              : null,
          counts,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async counts(actorId: string): Promise<InboxCountsDto> {
    this.feature.assertEnabled();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const counts = await this.queryCounts(client, actorId);
        await client.query("COMMIT");
        return counts;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async markRead(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    kindRaw: string,
    id: string,
    throughSeqRaw: string | number | undefined,
  ): Promise<{
    statusCode: number;
    body: {
      kind: InboxKind;
      id: string;
      readThroughSeq: string;
    };
  }> {
    this.feature.assertEnabled();
    const kind = parseMarkKind(kindRaw);
    if (throughSeqRaw === undefined || throughSeqRaw === null || throughSeqRaw === "") {
      throw unprocessable("THROUGH_SEQ_REQUIRED", "Укажите throughSeq");
    }
    if (kind === "dm" || kind === "dm_request") {
      if (!this.feature.dmEnabled) {
        throw notFound("SOCIAL_DM_DISABLED", "Обмен сообщениями недоступен");
      }
      const result = await this.messaging.markRead(
        actorId,
        sessionId,
        idempotencyKey,
        id,
        throughSeqRaw,
      );
      return {
        statusCode: result.statusCode,
        body: {
          kind,
          id,
          readThroughSeq: result.body.readThroughSeq,
        },
      };
    }
    if (!this.feature.gameChatEnabled) {
      throw notFound("SOCIAL_GAME_CHAT_DISABLED", "Чат игры недоступен");
    }
    const result = await this.gameChat.markRead(
      actorId,
      sessionId,
      idempotencyKey,
      id,
      throughSeqRaw,
    );
    return {
      statusCode: result.statusCode,
      body: {
        kind: "game_chat",
        id,
        readThroughSeq: result.body.readThroughSeq,
      },
    };
  }

  private async queryPage(
    client: PoolClient,
    actorId: string,
    input: {
      limit: number;
      filter: InboxFilter;
      cursor: { at: string; kind: InboxKind; id: string } | null;
    },
  ): Promise<RawRow[]> {
    const built = buildInboxPageSql(
      {
        dmEnabled: this.feature.dmEnabled,
        invitationsEnabled: this.feature.invitationsEnabled,
        gameChatEnabled: this.feature.gameChatEnabled,
      },
      input.filter,
      input.cursor,
      input.limit,
    );
    if (!built.sql) {
      return [];
    }
    const result = await client.query<RawRow>(built.sql, [
      actorId,
      ...built.params,
    ]);
    return result.rows;
  }

  private async queryCounts(
    client: PoolClient,
    actorId: string,
  ): Promise<InboxCountsDto> {
    let pendingRequestCount = 0;
    let pendingInvitationCount = 0;
    let dmUnread = 0;
    let gameChatUnread = 0;

    if (this.feature.dmEnabled) {
      const pending = await client.query<{ count: string }>(
        buildInboxCountSql("pending_request"),
        [actorId],
      );
      pendingRequestCount = Number(pending.rows[0]?.count ?? 0);

      const unread = await client.query<{ count: string }>(
        buildInboxCountSql("dm_unread"),
        [actorId],
      );
      dmUnread = Number(unread.rows[0]?.count ?? 0);
    }

    if (this.feature.invitationsEnabled) {
      const pending = await client.query<{ count: string }>(
        buildInboxCountSql("pending_invitation"),
        [actorId],
      );
      pendingInvitationCount = Number(pending.rows[0]?.count ?? 0);
    }

    if (this.feature.gameChatEnabled) {
      const unread = await client.query<{ count: string }>(
        buildInboxCountSql("game_chat_unread"),
        [actorId],
      );
      gameChatUnread = Number(unread.rows[0]?.count ?? 0);
    }

    return {
      pendingRequestCount,
      pendingInvitationCount,
      dmUnread,
      gameChatUnread,
    };
  }
}

function projectItem(row: RawRow): InboxItemDto {
  const unreadCount = Number(row.unread_count);
  let subtitle = row.subtitle_key;
  if (row.kind === "dm" || row.kind === "dm_request") {
    subtitle =
      DM_REQUEST_SUBTITLE[
        (row.request_state ?? "closed") as keyof typeof DM_REQUEST_SUBTITLE
      ] ?? row.subtitle_key;
  } else if (row.kind === "game_invitation") {
    subtitle =
      INVITATION_SUBTITLE[
        (row.invitation_status ??
          "expired") as keyof typeof INVITATION_SUBTITLE
      ] ?? row.subtitle_key;
  } else {
    subtitle = GAME_CHAT_SUBTITLE;
  }
  return {
    kind: row.kind,
    id: row.id,
    lastActivityAt: row.last_activity_at.toISOString(),
    title: row.title,
    subtitle,
    unreadCount,
    attention: row.attention,
    conversationId: row.conversation_id,
    invitationId: row.invitation_id,
    gameId: row.game_id,
    peer:
      row.peer_public_player_id && row.peer_display_name
        ? {
            publicPlayerId: row.peer_public_player_id,
            displayName: row.peer_display_name,
          }
        : null,
    requestState: row.request_state,
    invitationStatus: row.invitation_status,
    muted: row.muted,
  };
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return INBOX_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  return Math.min(limit, INBOX_PAGE_MAX);
}

function parseFilter(raw?: string): InboxFilter {
  if (raw === undefined || raw === "" || raw === "all") return "all";
  if (raw === "unread" || raw === "attention") return raw;
  throw badRequest("FILTER_INVALID", "Некорректный filter");
}

function parseMarkKind(raw: string): InboxKind {
  if (raw === "dm" || raw === "dm_request" || raw === "game_chat") {
    return raw;
  }
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

function encodeCursor(input: {
  at: string;
  kind: InboxKind;
  id: string;
}): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(
  cursor?: string,
): { at: string; kind: InboxKind; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { at?: string; kind?: string; id?: string };
    if (
      typeof parsed.at !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.id !== "string" ||
      !isUuid(parsed.id) ||
      !isInboxKind(parsed.kind) ||
      !isSafeTimestamptz(parsed.at)
    ) {
      throw new Error("bad cursor");
    }
    return { at: parsed.at, kind: parsed.kind, id: parsed.id };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
}

function isInboxKind(value: string): value is InboxKind {
  return (
    value === "dm" ||
    value === "dm_request" ||
    value === "game_invitation" ||
    value === "game_chat"
  );
}

/** Opaque cursor `at` must be an ISO-8601 timestamptz the driver can bind safely. */
function isSafeTimestamptz(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
