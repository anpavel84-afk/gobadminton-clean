import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { DATABASE_POOL } from "../tokens";
import {
  GAME_CHAT_CLIENT_MESSAGE_ID_MAX,
  GAME_CHAT_PAGE_DEFAULT,
  GAME_CHAT_PAGE_MAX,
  GAME_CHAT_TEXT_MAX_CHARS,
} from "./constants";
import { GameChatFeatureService } from "./game-chat-feature";

export type GameChatDto = {
  id: string;
  kind: "game";
  gameId: string;
  lifecycleState: "active" | "closed";
  version: number;
  lastMessageAt: string | null;
  lastMessageSeq: string;
  readThroughSeq: string;
  unreadCount: number;
  memberRole: "manager" | "member";
  createdAt: string;
};

export type GameChatMessageDto = {
  id: string;
  conversationId: string;
  seq: string;
  kind: "text";
  authorPublicPlayerId: string | null;
  createdAt: string;
  contentState: "live" | "tombstoned" | "purged";
  text: string | null;
};

export type GameChatSendReceiptDto = {
  messageId: string;
  conversationId: string;
  gameId: string;
  seq: string;
  createdAt: string;
  outcome: "created" | "duplicate";
};

export type GameChatMemberDto = {
  publicPlayerId: string;
  displayName: string;
  role: "manager" | "member";
};

type GameRow = {
  id: string;
  status: string;
  ends_at: Date;
  version: number;
};

type ConversationRow = {
  id: string;
  kind: "game";
  game_id: string;
  lifecycle_state: "active" | "closed";
  next_message_seq: string | number;
  last_message_at: Date | null;
  last_message_seq: string | number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type MemberRow = {
  conversation_id: string;
  user_id: string;
  role: "manager" | "member" | null;
  membership_state: "active" | "removed";
  send_allowed: boolean;
  read_through_seq: string | number;
  hidden_through_seq: string | number;
};

@Injectable()
export class GameChatService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly feature: GameChatFeatureService,
  ) {
    void this.pool;
  }

  /**
   * Same-TX membership materialization for Participation confirm / manager grant.
   * Caller must already hold Game FOR UPDATE. Source-state fence still re-checks.
   */
  async upsertMemberInTransaction(
    client: PoolClient,
    gameId: string,
    userId: string,
    role: "manager" | "member",
  ): Promise<void> {
    if (!this.feature.enabled) return;
    const conversation = await this.ensureConversationRow(client, gameId);
    await client.query(
      `INSERT INTO conversation_members (
         conversation_id, user_id, role, membership_state, send_allowed,
         read_through_seq, hidden_through_seq, archived, muted,
         preferences_version, state_version, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', true, 0, 0, false, false, 1, 1, now(), now())
       ON CONFLICT (conversation_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           membership_state = 'active',
           send_allowed = true,
           state_version = conversation_members.state_version + 1,
           updated_at = now()`,
      [conversation.id, userId, role],
    );
  }

  /**
   * Same-TX revoke for withdraw/remove/manager revoke. Source fence remains authoritative.
   */
  async revokeMemberInTransaction(
    client: PoolClient,
    gameId: string,
    userId: string,
  ): Promise<void> {
    if (!this.feature.enabled) return;
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM conversations WHERE kind = 'game' AND game_id = $1`,
      [gameId],
    );
    if (!existing.rows[0]) return;
    await client.query(
      `UPDATE conversation_members
       SET membership_state = 'removed',
           send_allowed = false,
           role = NULL,
           state_version = state_version + 1,
           updated_at = now()
       WHERE conversation_id = $1 AND user_id = $2`,
      [existing.rows[0].id, userId],
    );
  }

  /** Same-TX close on Game cancel. endsAt/completed are also enforced on read. */
  async closeChatInTransaction(
    client: PoolClient,
    gameId: string,
  ): Promise<void> {
    if (!this.feature.enabled) return;
    await client.query(
      `UPDATE conversations
       SET lifecycle_state = 'closed',
           version = version + 1,
           updated_at = now()
       WHERE kind = 'game' AND game_id = $1 AND lifecycle_state = 'active'`,
      [gameId],
    );
    await client.query(
      `UPDATE conversation_members AS m
       SET send_allowed = false,
           state_version = m.state_version + 1,
           updated_at = now()
       FROM conversations c
       WHERE c.id = m.conversation_id
         AND c.kind = 'game'
         AND c.game_id = $1
         AND m.send_allowed = true`,
      [gameId],
    );
  }

  async getOrEnsureChat(actorId: string, gameId: string): Promise<GameChatDto> {
    this.feature.assertEnabled();
    if (!isUuid(gameId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const access = await this.assertChatAccess(client, actorId, gameId, {
        forUpdateGame: false,
        requireOpenLifecycle: true,
      });
      const conversation = await this.ensureConversationRow(client, gameId);
      await this.materializeActorMember(
        client,
        conversation.id,
        actorId,
        access.role,
      );
      const member = await this.requireMemberRow(
        client,
        conversation.id,
        actorId,
      );
      await client.query("COMMIT");
      return toChatDto(conversation, member, access.role);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(
    actorId: string,
    gameId: string,
    query: { beforeSeq?: string; afterSeq?: string; limit?: number },
  ): Promise<{ items: GameChatMessageDto[]; nextCursor: string | null }> {
    this.feature.assertEnabled();
    if (!isUuid(gameId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (query.beforeSeq && query.afterSeq) {
      throw badRequest("CURSOR_INVALID", "Укажите beforeSeq или afterSeq");
    }
    const limit = clampLimit(query.limit);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const access = await this.assertChatAccess(client, actorId, gameId, {
        forUpdateGame: false,
        requireOpenLifecycle: true,
      });
      const conversation = await this.ensureConversationRow(client, gameId);
      await this.materializeActorMember(
        client,
        conversation.id,
        actorId,
        access.role,
      );
      const member = await this.requireMemberRow(
        client,
        conversation.id,
        actorId,
      );
      const hiddenThrough = Number(member.hidden_through_seq);
      const params: unknown[] = [conversation.id, actorId, hiddenThrough];
      let seqSql = "";
      if (query.beforeSeq) {
        params.push(parseSeq(query.beforeSeq));
        seqSql = `AND m.seq < $4`;
      } else if (query.afterSeq) {
        params.push(parseSeq(query.afterSeq));
        seqSql = `AND m.seq > $4`;
      }
      params.push(limit + 1);
      const limitIdx = params.length;
      const ascending = Boolean(query.afterSeq);
      const result = await client.query<{
        id: string;
        conversation_id: string;
        seq: string | number;
        kind: "text";
        body_text: string | null;
        content_state: "live" | "tombstoned" | "purged";
        created_at: Date;
        author_public_player_id: string | null;
      }>(
        `SELECT m.id, m.conversation_id, m.seq, m.kind,
                m.body_text, m.content_state, m.created_at,
                p.public_player_id AS author_public_player_id
         FROM messages m
         LEFT JOIN player_social_profiles p ON p.user_id = m.author_user_id
         LEFT JOIN message_hidden_for h
           ON h.message_id = m.id AND h.user_id = $2
         WHERE m.conversation_id = $1
           AND m.seq > $3
           AND h.message_id IS NULL
           ${seqSql}
         ORDER BY m.seq ${ascending ? "ASC" : "DESC"}
         LIMIT $${limitIdx}`,
        params,
      );
      await client.query("COMMIT");
      const slice = result.rows.slice(0, limit);
      const ordered = ascending ? slice : [...slice].reverse();
      const items = ordered.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        seq: String(row.seq),
        kind: "text" as const,
        authorPublicPlayerId: row.author_public_player_id,
        createdAt: row.created_at.toISOString(),
        contentState: row.content_state,
        text: row.content_state === "live" ? row.body_text : null,
      }));
      const edge = ascending ? slice[slice.length - 1] : slice[0];
      const nextCursor =
        result.rows.length > limit && edge ? String(edge.seq) : null;
      return { items, nextCursor };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async sendMessage(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    gameId: string,
    input: { text?: string; clientMessageId?: string; kind?: string },
  ): Promise<{ statusCode: number; body: GameChatSendReceiptDto }> {
    this.feature.assertEnabled();
    if (!isUuid(gameId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const normalized = normalizeSend(input);
    const operation = "game_chat.message.send";
    const requestHash = this.idempotency.requestHash({
      gameId,
      text: normalized.text,
      clientMessageId: normalized.clientMessageId,
    });
    return this.mutations.runIdempotent<GameChatSendReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertChatAccess(client, actorId, body.gameId, {
          forUpdateGame: false,
          requireOpenLifecycle: true,
        });
      },
      execute: async (client) => {
        const now = new Date();
        const prior = await client.query<{
          id: string;
          conversation_id: string;
          seq: string | number;
          created_at: Date;
        }>(
          `SELECT id, conversation_id, seq, created_at
           FROM messages
           WHERE author_user_id = $1 AND client_message_id = $2`,
          [actorId, normalized.clientMessageId],
        );
        if (prior.rows[0]) {
          const row = prior.rows[0];
          const access = await this.assertChatAccess(client, actorId, gameId, {
            forUpdateGame: true,
            requireOpenLifecycle: true,
          });
          const conversation = await this.ensureConversationRow(client, gameId);
          if (row.conversation_id !== conversation.id) {
            throw conflict(
              "CLIENT_MESSAGE_ID_REUSED",
              "clientMessageId уже использован",
            );
          }
          await this.materializeActorMember(
            client,
            conversation.id,
            actorId,
            access.role,
          );
          return {
            statusCode: 200,
            body: {
              messageId: row.id,
              conversationId: row.conversation_id,
              gameId,
              seq: String(row.seq),
              createdAt: row.created_at.toISOString(),
              outcome: "duplicate",
            },
          };
        }

        const access = await this.assertChatAccess(client, actorId, gameId, {
          forUpdateGame: true,
          requireOpenLifecycle: true,
        });
        await this.lockAccount(client, actorId);
        const conversation = await this.lockConversationForGame(client, gameId);
        if (conversation.lifecycle_state !== "active") {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await this.materializeActorMember(
          client,
          conversation.id,
          actorId,
          access.role,
        );

        const seq = Number(conversation.next_message_seq);
        const purgeAt = this.feature.purgeEligibleAt(now);
        const inserted = await client.query<{
          id: string;
          seq: string | number;
          created_at: Date;
        }>(
          `INSERT INTO messages (
             conversation_id, seq, author_user_id, client_message_id,
             kind, body_text, content_state, purge_eligible_at, created_at
           ) VALUES ($1, $2, $3, $4, 'text', $5, 'live', $6, $7)
           RETURNING id, seq, created_at`,
          [
            conversation.id,
            seq,
            actorId,
            normalized.clientMessageId,
            normalized.text,
            purgeAt,
            now,
          ],
        );
        await client.query(
          `UPDATE conversations
           SET next_message_seq = $2,
               last_message_seq = $3,
               last_message_at = $4,
               version = version + 1,
               updated_at = $4
           WHERE id = $1`,
          [conversation.id, seq + 1, seq, now],
        );
        const row = inserted.rows[0]!;
        return {
          statusCode: 201,
          body: {
            messageId: row.id,
            conversationId: conversation.id,
            gameId,
            seq: String(row.seq),
            createdAt: row.created_at.toISOString(),
            outcome: "created",
          },
        };
      },
    });
  }

  async markRead(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    gameId: string,
    throughSeqRaw: string | number,
  ): Promise<{
    statusCode: number;
    body: { conversationId: string; gameId: string; readThroughSeq: string };
  }> {
    this.feature.assertEnabled();
    if (!isUuid(gameId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const throughSeq = parseSeq(throughSeqRaw);
    const operation = "game_chat.read";
    const requestHash = this.idempotency.requestHash({ gameId, throughSeq });
    return this.mutations.runIdempotent({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertChatAccess(client, actorId, body.gameId, {
          forUpdateGame: false,
          requireOpenLifecycle: true,
        });
      },
      execute: async (client) => {
        const access = await this.assertChatAccess(client, actorId, gameId, {
          forUpdateGame: false,
          requireOpenLifecycle: true,
        });
        const conversation = await this.ensureConversationRow(client, gameId);
        await this.materializeActorMember(
          client,
          conversation.id,
          actorId,
          access.role,
        );
        if (throughSeq > Number(conversation.last_message_seq)) {
          throw unprocessable(
            "READ_SEQ_INVALID",
            "throughSeq превышает последнюю последовательность",
          );
        }
        await client.query(
          `UPDATE conversation_members
           SET read_through_seq = GREATEST(read_through_seq, $3),
               preferences_version = preferences_version + 1,
               updated_at = now()
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversation.id, actorId, throughSeq],
        );
        const member = await this.requireMemberRow(
          client,
          conversation.id,
          actorId,
        );
        return {
          statusCode: 200,
          body: {
            conversationId: conversation.id,
            gameId,
            readThroughSeq: String(member.read_through_seq),
          },
        };
      },
    });
  }

  async listMembers(
    actorId: string,
    gameId: string,
  ): Promise<{ items: GameChatMemberDto[] }> {
    this.feature.assertEnabled();
    if (!isUuid(gameId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const client = await this.pool.connect();
    try {
      // Authorization + member projection must share one Game-locked TX so a
      // concurrent withdraw/remove/revoke/cancel that commits after access
      // check cannot still return peer identities (LS05-QA-01 / P-GC-01/02).
      await client.query("BEGIN");
      await this.assertChatAccess(client, actorId, gameId, {
        forUpdateGame: false,
        requireOpenLifecycle: true,
      });
      const managers = await client.query<{
        public_player_id: string;
        display_name: string;
      }>(
        `SELECT p.public_player_id, p.display_name
         FROM game_managers gm
         INNER JOIN player_social_profiles p ON p.user_id = gm.user_id
         WHERE gm.game_id = $1 AND gm.status = 'active'
         ORDER BY p.display_name ASC, p.public_player_id ASC`,
        [gameId],
      );
      const participants = await client.query<{
        public_player_id: string;
        display_name: string;
        user_id: string;
      }>(
        `SELECT p.public_player_id, p.display_name, part.user_id
         FROM participations part
         INNER JOIN player_social_profiles p ON p.user_id = part.user_id
         WHERE part.game_id = $1 AND part.status = 'confirmed'
         ORDER BY p.display_name ASC, p.public_player_id ASC`,
        [gameId],
      );
      const managerIds = new Set(
        (
          await client.query<{ user_id: string }>(
            `SELECT user_id FROM game_managers
             WHERE game_id = $1 AND status = 'active'`,
            [gameId],
          )
        ).rows.map((r) => r.user_id),
      );
      const items: GameChatMemberDto[] = [
        ...managers.rows.map((row) => ({
          publicPlayerId: row.public_player_id,
          displayName: row.display_name,
          role: "manager" as const,
        })),
        ...participants.rows
          .filter((row) => !managerIds.has(row.user_id))
          .map((row) => ({
            publicPlayerId: row.public_player_id,
            displayName: row.display_name,
            role: "member" as const,
          })),
      ];
      await client.query("COMMIT");
      return { items };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertChatAccess(
    client: PoolClient,
    actorId: string,
    gameId: string,
    opts: { forUpdateGame: boolean; requireOpenLifecycle: boolean },
  ): Promise<{ role: "manager" | "member"; game: GameRow }> {
    const gameResult = await client.query<GameRow>(
      opts.forUpdateGame
        ? `SELECT id, status, ends_at, version FROM games WHERE id = $1 FOR UPDATE`
        : `SELECT id, status, ends_at, version FROM games WHERE id = $1 FOR SHARE`,
      [gameId],
    );
    const game = gameResult.rows[0];
    if (!game) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }

    const now = new Date();
    // published ∧ before endsAt is the only open consumer window (P-GC-02).
    const lifecycleClosed =
      game.status !== "published" || now >= game.ends_at;

    if (opts.requireOpenLifecycle && lifecycleClosed) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }

    const manager = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM game_managers
       WHERE game_id = $1 AND user_id = $2`,
      [gameId, actorId],
    );
    if (manager.rows[0]?.status === "active") {
      return { role: "manager", game };
    }

    const participation = await client.query<{ status: string }>(
      `SELECT status FROM participations
       WHERE game_id = $1 AND user_id = $2`,
      [gameId, actorId],
    );
    if (participation.rows[0]?.status === "confirmed") {
      return { role: "member", game };
    }

    // Enumeration-safe: knowing a Game ID never distinguishes missing vs denied.
    throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
  }

  private async ensureConversationRow(
    client: PoolClient,
    gameId: string,
  ): Promise<ConversationRow> {
    const existing = await client.query<ConversationRow>(
      `SELECT id, kind, game_id, lifecycle_state, next_message_seq,
              last_message_at, last_message_seq, version, created_at, updated_at
       FROM conversations
       WHERE kind = 'game' AND game_id = $1
       FOR UPDATE`,
      [gameId],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
    const game = await client.query<{ status: string; ends_at: Date }>(
      `SELECT status, ends_at FROM games WHERE id = $1`,
      [gameId],
    );
    const row = game.rows[0];
    const closed =
      !row || row.status !== "published" || new Date() >= row.ends_at;
    const inserted = await client.query<ConversationRow>(
      `INSERT INTO conversations (
         pair_id, kind, request_state, initiator_user_id, recipient_user_id,
         request_expires_at, next_message_seq, last_message_at, last_message_seq,
         version, created_at, updated_at, game_id, lifecycle_state, context_game_id
       ) VALUES (
         NULL, 'game', 'accepted', NULL, NULL,
         NULL, 1, NULL, 0,
         1, now(), now(), $1, $2, NULL
       )
       ON CONFLICT (game_id) WHERE (kind = 'game') DO NOTHING
       RETURNING id, kind, game_id, lifecycle_state, next_message_seq,
                 last_message_at, last_message_seq, version, created_at, updated_at`,
      [gameId, closed ? "closed" : "active"],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0];
    }
    const again = await client.query<ConversationRow>(
      `SELECT id, kind, game_id, lifecycle_state, next_message_seq,
              last_message_at, last_message_seq, version, created_at, updated_at
       FROM conversations
       WHERE kind = 'game' AND game_id = $1
       FOR UPDATE`,
      [gameId],
    );
    if (!again.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    return again.rows[0];
  }

  private async lockConversationForGame(
    client: PoolClient,
    gameId: string,
  ): Promise<ConversationRow> {
    return this.ensureConversationRow(client, gameId);
  }

  private async materializeActorMember(
    client: PoolClient,
    conversationId: string,
    userId: string,
    role: "manager" | "member",
  ): Promise<void> {
    await client.query(
      `INSERT INTO conversation_members (
         conversation_id, user_id, role, membership_state, send_allowed,
         read_through_seq, hidden_through_seq, archived, muted,
         preferences_version, state_version, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', true, 0, 0, false, false, 1, 1, now(), now())
       ON CONFLICT (conversation_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           membership_state = 'active',
           send_allowed = true,
           state_version = conversation_members.state_version + 1,
           updated_at = now()`,
      [conversationId, userId, role],
    );
  }

  private async requireMemberRow(
    client: PoolClient,
    conversationId: string,
    userId: string,
  ): Promise<MemberRow> {
    const result = await client.query<MemberRow>(
      `SELECT conversation_id, user_id, role, membership_state, send_allowed,
              read_through_seq, hidden_through_seq
       FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (!result.rows[0] || result.rows[0].membership_state !== "active") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    return result.rows[0];
  }

  private async lockAccount(client: PoolClient, userId: string): Promise<void> {
    const result = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
      [userId],
    );
    if (!result.rows[0] || result.rows[0].status !== "active") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }
}

function toChatDto(
  conversation: ConversationRow,
  member: MemberRow,
  role: "manager" | "member",
): GameChatDto {
  const lastSeq = Number(conversation.last_message_seq);
  const readThrough = Number(member.read_through_seq);
  return {
    id: conversation.id,
    kind: "game",
    gameId: conversation.game_id,
    lifecycleState: conversation.lifecycle_state,
    version: conversation.version,
    lastMessageAt: conversation.last_message_at
      ? conversation.last_message_at.toISOString()
      : null,
    lastMessageSeq: String(conversation.last_message_seq),
    readThroughSeq: String(member.read_through_seq),
    unreadCount: Math.max(0, lastSeq - readThrough),
    memberRole: role,
    createdAt: conversation.created_at.toISOString(),
  };
}

function normalizeSend(input: {
  text?: string;
  clientMessageId?: string;
  kind?: string;
}): { text: string; clientMessageId: string } {
  if (input.kind !== undefined && input.kind !== "text") {
    throw unprocessable("MESSAGE_KIND_UNSUPPORTED", "Поддерживается только text");
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < 1 || text.length > GAME_CHAT_TEXT_MAX_CHARS) {
    throw unprocessable("MESSAGE_TEXT_INVALID", "Некорректный текст сообщения");
  }
  const clientMessageId =
    typeof input.clientMessageId === "string"
      ? input.clientMessageId.trim()
      : "";
  if (
    clientMessageId.length < 1 ||
    clientMessageId.length > GAME_CHAT_CLIENT_MESSAGE_ID_MAX
  ) {
    throw unprocessable(
      "CLIENT_MESSAGE_ID_INVALID",
      "Некорректный clientMessageId",
    );
  }
  return { text, clientMessageId };
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return GAME_CHAT_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  return Math.min(limit, GAME_CHAT_PAGE_MAX);
}

function parseSeq(raw: string | number): number {
  const value =
    typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw unprocessable("READ_SEQ_INVALID", "Некорректный seq");
  }
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
