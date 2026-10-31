import { unrestrictedSql } from "../restrictions/policy";
import { avatarForPlayer, avatarForUser, type PlayerAvatar } from "../profiles/avatar-presentation";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
  ProblemHttpException,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { JobEnqueueService } from "../jobs/job-enqueue.service";
import { ProfilesService } from "../profiles/profiles.service";
import { PairFenceService } from "../safety/pair-fence.service";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  DM_CLIENT_MESSAGE_ID_MAX,
  DM_PAGE_DEFAULT,
  DM_PAGE_MAX,
  DM_TEXT_MAX_CHARS,
} from "./constants";
import { DiscoveryProofHook } from "./discovery-proof.hook";
import { DmFeatureService } from "./dm-feature";

export type ConversationPeerDto = {
  avatar?: PlayerAvatar;
  publicPlayerId: string;
  displayName: string;
};

export type ConversationDto = {
  id: string;
  kind: "direct";
  requestState: "pending" | "accepted" | "declined" | "expired" | "closed";
  version: number;
  peer: ConversationPeerDto;
  role: "initiator" | "recipient";
  lastMessageAt: string | null;
  lastMessageSeq: string;
  readThroughSeq: string;
  unreadCount: number;
  archived: boolean;
  muted: boolean;
  requestExpiresAt: string | null;
  createdAt: string;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  seq: string;
  kind: "text";
  authorPublicPlayerId: string | null;
  createdAt: string;
  contentState: "live" | "tombstoned" | "purged";
  text: string | null;
};

export type SendReceiptDto = {
  messageId: string;
  conversationId: string;
  seq: string;
  createdAt: string;
  outcome: "created" | "duplicate";
};

export type CreateRequestResultDto = {
  conversation: ConversationDto;
  receipt: SendReceiptDto;
};

export type ContactStateDto = { targetPublicPlayerId: string } & (
  | { state: "none"; canRequestContact: true }
  | { state: "accepted" | "pending_incoming" | "pending_outgoing"; conversationId: string; version: number }
  | { state: "terminal" | "unavailable" }
);

type ConversationRow = {
  id: string;
  pair_id: string | null;
  kind: "direct" | "game";
  request_state: "pending" | "accepted" | "declined" | "expired" | "closed";
  initiator_user_id: string | null;
  recipient_user_id: string | null;
  request_expires_at: Date | null;
  next_message_seq: string | number;
  last_message_at: Date | null;
  last_message_seq: string | number;
  version: number;
  created_at: Date;
  updated_at: Date;
  context_game_id?: string | null;
};

type MemberRow = {
  conversation_id: string;
  user_id: string;
  read_through_seq: string | number;
  hidden_through_seq: string | number;
  archived: boolean;
  muted: boolean;
  preferences_version: number;
  state_version: number;
};

@Injectable()
export class MessagingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly feature: DmFeatureService,
    private readonly profiles: ProfilesService,
    private readonly pairs: PairFenceService,
    private readonly proofHook: DiscoveryProofHook,
    private readonly jobs: JobEnqueueService,
  ) {
    void this.pool;
    // New chats are accepted immediately; legacy pending expiry jobs remain for pre-0044 rows.
    void this.jobs;
  }

  /** A snapshot lookup only: never creates a pair, accepts, expires or unarchives. */
  async getContactState(actorId: string, target?: string): Promise<ContactStateDto> {
    if (typeof target !== "string" || !isUuid(target)) {
      throw badRequest("TARGET_PUBLIC_PLAYER_ID_INVALID", "Некорректный targetPublicPlayerId");
    }
    const unavailable: ContactStateDto = { state: "unavailable", targetPublicPlayerId: target };
    if (!this.feature.enabled) return unavailable;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const peer = await client.query<{ user_id: string }>(
        "SELECT user_id FROM player_social_profiles WHERE public_player_id = $1", [target],
      );
      const peerId = peer.rows[0]?.user_id;
      if (!peerId || peerId === actorId) return unavailable;
      await this.lockAccounts(client, [actorId, peerId]);
      await this.assertNoBilateralBlock(client, actorId, peerId);
      await this.assertCurrentSocialEligible(client, actorId, peerId);
      const { userLow, userHigh } = this.pairs.sortedPair(actorId, peerId);
      const existing = await client.query<ConversationRow & { member: boolean }>(
        `SELECT c.*, EXISTS (SELECT 1 FROM conversation_members m
           WHERE m.conversation_id = c.id AND m.user_id = $3) AS member
         FROM social_pairs p JOIN conversations c ON c.pair_id = p.id AND c.kind = 'direct'
         WHERE p.user_low = $1 AND p.user_high = $2`, [userLow, userHigh, actorId],
      );
      const row = existing.rows[0];
      if (row) {
        if (!row.member) return unavailable;
        const state = effectiveRequestState(row, new Date());
        if (state !== "accepted" && state !== "pending") return { state: "terminal", targetPublicPlayerId: target };
        if (state === "accepted") {
          // No new wire field: unavailable hides write-capable contact-state when peer closed.
          // Accepted history remains readable via conversation message APIs (no directory_visibility).
          if (!(await this.receiverAllowsIncoming(client, peerId))) return unavailable;
          return {
            state: "accepted",
            targetPublicPlayerId: target, conversationId: row.id, version: row.version,
          };
        }
        return {
          state: row.initiator_user_id === actorId ? "pending_outgoing" : "pending_incoming",
          targetPublicPlayerId: target, conversationId: row.id, version: row.version,
        };
      }
      await this.assertContactEligible(client, actorId, peerId);
      return { state: "none", targetPublicPlayerId: target, canRequestContact: true };
    } catch (error) {
      // Only policy-denial is normalized. DB/network/serialization faults remain retryable errors.
      if (error instanceof ProblemHttpException && error.getStatus() === 404) return unavailable;
      throw error;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  async createRequest(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    input: {
      targetPublicPlayerId?: string;
      text?: string;
      clientMessageId?: string;
      discoveryProof?: string | null;
      gameContextId?: string | null;
    },
  ): Promise<{ statusCode: number; body: CreateRequestResultDto }> {
    this.feature.assertEnabled();
    const normalized = normalizeCreateRequest(input);
    const operation = "dm.request.create";
    const requestHash = this.idempotency.requestHash({
      targetPublicPlayerId: normalized.targetPublicPlayerId,
      text: normalized.text,
      clientMessageId: normalized.clientMessageId,
      discoveryProof: normalized.discoveryProof ?? null,
      gameContextId: normalized.gameContextId ?? null,
    });
    return this.mutations.runIdempotent<CreateRequestResultDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertMember(client, actorId, body.conversation.id);
      },
      execute: async (client) => {
        const now = new Date();
        const targetUserId = await this.profiles.resolveUserIdByPublicPlayerId(
          client,
          normalized.targetPublicPlayerId,
        );
        if (!targetUserId || targetUserId === actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        if (!this.proofHook.usesGeographicFence(normalized.discoveryProof)) await this.lockAccounts(client, [actorId, targetUserId]);
        await this.assertContactEligible(client, actorId, targetUserId);
        // Game context precedes Pair, matching invitation Game→Pair order.
        if (normalized.gameContextId) {
          await this.assertDmGameContext(
            client,
            actorId,
            targetUserId,
            normalized.gameContextId,
          );
        }
        const pair = await this.pairs.lockOrCreate(client, actorId, targetUserId);
        await this.assertNoBilateralBlock(client, actorId, targetUserId);

        const existing = await client.query<ConversationRow>(
          `SELECT * FROM conversations WHERE pair_id = $1 AND kind = 'direct' FOR UPDATE`,
          [pair.id],
        );
        if (existing.rows[0]) {
          const row = existing.rows[0];
          const effective = effectiveRequestState(row, now);
          if (effective === "pending") {
            if (row.recipient_user_id === actorId) {
              throw conflict(
                "REQUEST_DECISION_REQUIRED",
                "Сначала ответьте на входящий запрос",
              );
            }
            throw conflict(
              "REQUEST_PENDING",
              "Запрос уже ожидает ответа получателя",
            );
          }
          if (effective === "accepted") {
            throw conflict(
              "CONVERSATION_ALREADY_OPEN",
              "Переписка уже открыта",
            );
          }
          // declined / expired / closed = terminal contact gate
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }

        await this.proofHook.assertOptionalProof(client, {
          actorId,
          sessionId,
          targetUserId,
          discoveryProof: normalized.discoveryProof,
        });
        // Immediate DM: first message opens accepted direct chat; no pending gate/expiry job.
        const inserted = await client.query<ConversationRow>(
          `INSERT INTO conversations (
             pair_id, kind, request_state, initiator_user_id, recipient_user_id,
             request_expires_at, next_message_seq, last_message_at, last_message_seq,
             version, created_at, updated_at, context_game_id
           ) VALUES (
             $1, 'direct', 'accepted', $2, $3, NULL, 2, $4, 1, 1, $4, $4, $5
           )
           RETURNING *`,
          [
            pair.id,
            actorId,
            targetUserId,
            now,
            normalized.gameContextId,
          ],
        );
        const conversation = inserted.rows[0]!;
        await client.query(
          `INSERT INTO conversation_members (
             conversation_id, user_id, read_through_seq, hidden_through_seq
           ) VALUES
             ($1, $2, 1, 0),
             ($1, $3, 0, 0)`,
          [conversation.id, actorId, targetUserId],
        );
        const purgeAt = this.feature.purgeEligibleAt(now);
        const message = await client.query<{
          id: string;
          seq: string | number;
          created_at: Date;
        }>(
          `INSERT INTO messages (
             conversation_id, seq, author_user_id, client_message_id,
             kind, body_text, content_state, purge_eligible_at, created_at
           ) VALUES ($1, 1, $2, $3, 'text', $4, 'live', $5, $6)
           RETURNING id, seq, created_at`,
          [
            conversation.id,
            actorId,
            normalized.clientMessageId,
            normalized.text,
            purgeAt,
            now,
          ],
        );
        const msg = message.rows[0]!;

        const dto = await this.toConversationDto(client, actorId, conversation);
        await this.proofHook.assertFinalProof(client,{actorId,sessionId,targetUserId,discoveryProof:normalized.discoveryProof});
        return {
          statusCode: 201,
          body: {
            conversation: dto,
            receipt: {
              messageId: msg.id,
              conversationId: conversation.id,
              seq: String(msg.seq),
              createdAt: msg.created_at.toISOString(),
              outcome: "created",
            },
          },
        };
      },
    });
  }

  async accept(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    conversationId: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: ConversationDto }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable("EXPECTED_VERSION_INVALID", "Некорректный expectedVersion");
    }
    const operation = "dm.request.accept";
    const requestHash = this.idempotency.requestHash({
      conversationId,
      expectedVersion,
    });
    return this.mutations.runIdempotent<ConversationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertMember(client, actorId, body.id);
      },
      execute: async (client) => {
        const now = new Date();
        const row = await this.lockConversation(client, conversationId);
        const peers = requireDirectPeers(row);
        await this.lockAccounts(client, [peers.initiator, peers.recipient]);
        await this.pairs.lockOrCreate(
          client,
          peers.initiator,
          peers.recipient,
        );
        if (peers.recipient !== actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await this.assertNoBilateralBlock(
          client,
          peers.initiator,
          peers.recipient,
        );
        const effective = effectiveRequestState(row, now);
        if (effective !== "pending") {
          if (effective === "accepted" && row.version === expectedVersion) {
            return {
              statusCode: 200,
              body: await this.toConversationDto(client, actorId, row),
            };
          }
          throw conflict("REQUEST_NOT_PENDING", "Запрос недоступен для принятия");
        }
        if (row.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия разговора устарела");
        }
        const updated = await client.query<ConversationRow>(
          `UPDATE conversations
           SET request_state = 'accepted',
               request_expires_at = NULL,
               version = version + 1,
               updated_at = $2
           WHERE id = $1
           RETURNING *`,
          [conversationId, now],
        );
        return {
          statusCode: 200,
          body: await this.toConversationDto(client, actorId, updated.rows[0]!),
        };
      },
    });
  }

  async decline(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    conversationId: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: ConversationDto }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable("EXPECTED_VERSION_INVALID", "Некорректный expectedVersion");
    }
    const operation = "dm.request.decline";
    const requestHash = this.idempotency.requestHash({
      conversationId,
      expectedVersion,
    });
    return this.mutations.runIdempotent<ConversationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertMember(client, actorId, body.id);
      },
      execute: async (client) => {
        const now = new Date();
        const row = await this.lockConversation(client, conversationId);
        const peers = requireDirectPeers(row);
        await this.lockAccounts(client, [peers.initiator, peers.recipient]);
        await this.pairs.lockOrCreate(
          client,
          peers.initiator,
          peers.recipient,
        );
        if (peers.recipient !== actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        const effective = effectiveRequestState(row, now);
        if (effective === "declined" && row.version === expectedVersion) {
          return {
            statusCode: 200,
            body: await this.toConversationDto(client, actorId, row),
          };
        }
        if (effective !== "pending") {
          throw conflict("REQUEST_NOT_PENDING", "Запрос недоступен для отклонения");
        }
        if (row.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия разговора устарела");
        }
        const updated = await client.query<ConversationRow>(
          `UPDATE conversations
           SET request_state = 'declined',
               version = version + 1,
               updated_at = $2
           WHERE id = $1
           RETURNING *`,
          [conversationId, now],
        );
        return {
          statusCode: 200,
          body: await this.toConversationDto(client, actorId, updated.rows[0]!),
        };
      },
    });
  }

  async listConversations(
    actorId: string,
    query: {
      cursor?: string;
      limit?: number;
      archived?: boolean;
    },
  ): Promise<{ items: ConversationDto[]; nextCursor: string | null }> {
    this.feature.assertEnabled();
    const limit = clampLimit(query.limit);
    const archived = query.archived === true;
    const cursor = decodeActivityCursor(query.cursor);
    const params: unknown[] = [actorId, archived];
    let cursorSql = "";
    if (cursor) {
      params.push(cursor.lastMessageAt, cursor.id);
      cursorSql = `AND (
        COALESCE(c.last_message_at, c.created_at) < $3::timestamptz
        OR (
          COALESCE(c.last_message_at, c.created_at) = $3::timestamptz
          AND c.id < $4::uuid
        )
      )`;
    }
    params.push(limit + 1);
    const limitIdx = params.length;
    const result = await this.pool.query<ConversationRow & MemberRow & {
      peer_public_player_id: string;
      peer_display_name: string;
    }>(
      `SELECT c.*,
              m.read_through_seq, m.hidden_through_seq, m.archived, m.muted,
              m.preferences_version, m.state_version, m.user_id,
              p.public_player_id AS peer_public_player_id,
              p.display_name AS peer_display_name
       FROM conversation_members m
       INNER JOIN conversations c ON c.id = m.conversation_id
       INNER JOIN player_social_profiles p ON p.user_id = CASE
         WHEN c.initiator_user_id = m.user_id THEN c.recipient_user_id
         ELSE c.initiator_user_id
       END
       WHERE m.user_id = $1
         AND m.archived = $2
         AND c.kind = 'direct'
         ${cursorSql}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
       LIMIT $${limitIdx}`,
      params,
    );
    const now = new Date();
    const rows = result.rows.slice(0, limit);
    const items: ConversationDto[] = [];
    for (const row of rows) {
      // Lazy expire pending on read (worker-down safe).
      const effective = await this.ensureEffectiveState(row, now);
      items.push(
        projectConversationDto(actorId, effective, {
          read_through_seq: row.read_through_seq,
          hidden_through_seq: row.hidden_through_seq,
          archived: row.archived,
          muted: row.muted,
          preferences_version: row.preferences_version,
          state_version: row.state_version,
          conversation_id: row.id,
          user_id: actorId,
        }, {
          publicPlayerId: row.peer_public_player_id,
          displayName: row.peer_display_name,
          avatar: await avatarForPlayer(this.pool, row.peer_public_player_id),
        }),
      );
    }
    const next =
      result.rows.length > limit && rows.length > 0
        ? encodeActivityCursor({
            lastMessageAt: (
              rows[rows.length - 1]!.last_message_at ??
              rows[rows.length - 1]!.created_at
            ).toISOString(),
            id: rows[rows.length - 1]!.id,
          })
        : null;
    return { items, nextCursor: next };
  }

  async getConversation(
    actorId: string,
    conversationId: string,
  ): Promise<ConversationDto> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const result = await this.pool.query<ConversationRow & MemberRow & {
      peer_public_player_id: string;
      peer_display_name: string;
    }>(
      `SELECT c.*,
              m.read_through_seq, m.hidden_through_seq, m.archived, m.muted,
              m.preferences_version, m.state_version, m.user_id,
              p.public_player_id AS peer_public_player_id,
              p.display_name AS peer_display_name
       FROM conversation_members m
       INNER JOIN conversations c ON c.id = m.conversation_id
       INNER JOIN player_social_profiles p ON p.user_id = CASE
         WHEN c.initiator_user_id = m.user_id THEN c.recipient_user_id
         ELSE c.initiator_user_id
       END
       WHERE m.user_id = $1 AND c.id = $2 AND c.kind = 'direct'`,
      [actorId, conversationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const effective = await this.ensureEffectiveState(row, new Date());
    return projectConversationDto(
      actorId,
      effective,
      {
        read_through_seq: row.read_through_seq,
        hidden_through_seq: row.hidden_through_seq,
        archived: row.archived,
        muted: row.muted,
        preferences_version: row.preferences_version,
        state_version: row.state_version,
        conversation_id: row.id,
        user_id: actorId,
      },
      {
        publicPlayerId: row.peer_public_player_id,
        displayName: row.peer_display_name,
          avatar: await avatarForPlayer(this.pool, row.peer_public_player_id),
      },
    );
  }

  async listMessages(
    actorId: string,
    conversationId: string,
    query: {
      beforeSeq?: string;
      afterSeq?: string;
      limit?: number;
    },
  ): Promise<{ items: MessageDto[]; nextCursor: string | null }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (query.beforeSeq && query.afterSeq) {
      throw badRequest("CURSOR_INVALID", "Укажите beforeSeq или afterSeq");
    }
    const limit = clampLimit(query.limit);
    const client = await this.pool.connect();
    try {
      const member = await client.query<MemberRow>(
        `SELECT * FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, actorId],
      );
      if (!member.rows[0]) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
      const conv = await client.query<ConversationRow>(
        `SELECT * FROM conversations WHERE id = $1`,
        [conversationId],
      );
      if (!conv.rows[0]) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
      await this.ensureEffectiveState(conv.rows[0], new Date());
      const hiddenThrough = Number(member.rows[0].hidden_through_seq);
      const params: unknown[] = [conversationId, actorId, hiddenThrough];
      let seqSql = "";
      if (query.beforeSeq) {
        const before = parseSeq(query.beforeSeq);
        params.push(before);
        seqSql = `AND m.seq < $4`;
      } else if (query.afterSeq) {
        const after = parseSeq(query.afterSeq);
        params.push(after);
        seqSql = `AND m.seq > $4`;
      }
      params.push(limit + 1);
      const limitIdx = params.length;
      const ascending = Boolean(query.afterSeq);
      const result = await client.query<{
        id: string;
        conversation_id: string;
        seq: string | number;
        author_user_id: string;
        kind: "text";
        body_text: string | null;
        content_state: "live" | "tombstoned" | "purged";
        created_at: Date;
        author_public_player_id: string | null;
      }>(
        `SELECT m.id, m.conversation_id, m.seq, m.author_user_id, m.kind,
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
      const edge = slice[slice.length - 1];
      const nextCursor =
        result.rows.length > limit && edge
          ? String(edge.seq)
          : null;
      return { items, nextCursor };
    } finally {
      client.release();
    }
  }

  async sendMessage(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    conversationId: string,
    input: { text?: string; clientMessageId?: string; kind?: string },
  ): Promise<{ statusCode: number; body: SendReceiptDto }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const normalized = normalizeSend(input);
    const operation = "dm.message.send";
    const requestHash = this.idempotency.requestHash({
      conversationId,
      text: normalized.text,
      clientMessageId: normalized.clientMessageId,
    });
    return this.mutations.runIdempotent<SendReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertMember(client, actorId, body.conversationId);
      },
      execute: async (client) => {
        const now = new Date();
        // Durable clientMessageId fence before conversation lock.
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
          if (row.conversation_id !== conversationId) {
            throw conflict(
              "CLIENT_MESSAGE_ID_REUSED",
              "clientMessageId уже использован",
            );
          }
          await this.assertMember(client, actorId, conversationId);
          return {
            statusCode: 200,
            body: {
              messageId: row.id,
              conversationId: row.conversation_id,
              seq: String(row.seq),
              createdAt: row.created_at.toISOString(),
              outcome: "duplicate",
            },
          };
        }

        const conv = await this.lockConversation(client, conversationId);
        if (conv.kind !== "direct") {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        if (!conv.initiator_user_id || !conv.recipient_user_id) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await this.lockAccounts(client, [
          conv.initiator_user_id,
          conv.recipient_user_id,
        ]);
        await this.pairs.lockOrCreate(
          client,
          conv.initiator_user_id,
          conv.recipient_user_id,
        );
        await this.assertMember(client, actorId, conversationId);
        const effective = effectiveRequestState(conv, now);
        if (effective === "pending" && conv.request_expires_at && conv.request_expires_at <= now) {
          await client.query(
            `UPDATE conversations
             SET request_state = 'expired', version = version + 1, updated_at = $2
             WHERE id = $1 AND request_state = 'pending'`,
            [conversationId, now],
          );
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        if (effective !== "accepted") {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await this.assertNoBilateralBlock(
          client,
          conv.initiator_user_id,
          conv.recipient_user_id,
        );
        await this.assertCurrentSocialEligible(
          client,
          conv.initiator_user_id,
          conv.recipient_user_id,
        );
        // Peer closed blocks delivery; sender contact_policy opt-out does not forbid outbound.
        // Accepted history stays readable without requiring directory visibility.
        const receiverUserId =
          actorId === conv.initiator_user_id
            ? conv.recipient_user_id
            : conv.initiator_user_id;
        await this.assertReceiverAllowsIncoming(client, receiverUserId);

        const seq = Number(conv.next_message_seq);
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
            conversationId,
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
               updated_at = $4
           WHERE id = $1`,
          [conversationId, seq + 1, seq, now],
        );
        await client.query(
          `UPDATE conversation_members
           SET read_through_seq = GREATEST(read_through_seq, $3),
               state_version = state_version + 1,
               updated_at = $4
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, actorId, seq, now],
        );
        const msg = inserted.rows[0]!;
        return {
          statusCode: 201,
          body: {
            messageId: msg.id,
            conversationId,
            seq: String(msg.seq),
            createdAt: msg.created_at.toISOString(),
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
    conversationId: string,
    throughSeqRaw: string | number,
  ): Promise<{ statusCode: number; body: { readThroughSeq: string } }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const throughSeq = parseSeq(String(throughSeqRaw));
    const operation = "dm.conversation.read";
    const requestHash = this.idempotency.requestHash({
      conversationId,
      throughSeq,
    });
    return this.mutations.runIdempotent<{ readThroughSeq: string }>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        await this.assertMember(client, actorId, conversationId);
      },
      execute: async (client) => {
        const conv = await this.lockConversation(client, conversationId);
        await this.assertMember(client, actorId, conversationId);
        const maxSeq = Number(conv.last_message_seq);
        if (throughSeq > maxSeq) {
          throw unprocessable(
            "READ_SEQ_INVALID",
            "throughSeq превышает доступную историю",
          );
        }
        const updated = await client.query<{ read_through_seq: string | number }>(
          `UPDATE conversation_members
           SET read_through_seq = GREATEST(read_through_seq, $3),
               state_version = state_version + 1,
               updated_at = now()
           WHERE conversation_id = $1 AND user_id = $2
           RETURNING read_through_seq`,
          [conversationId, actorId, throughSeq],
        );
        return {
          statusCode: 200,
          body: { readThroughSeq: String(updated.rows[0]!.read_through_seq) },
        };
      },
    });
  }

  async hideMessage(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ statusCode: number; body: { hidden: true } }> {
    this.feature.assertEnabled();
    if (!isUuid(conversationId) || !isUuid(messageId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const operation = "dm.message.hide";
    const requestHash = this.idempotency.requestHash({
      conversationId,
      messageId,
    });
    return this.mutations.runIdempotent<{ hidden: true }>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        await this.assertMember(client, actorId, conversationId);
      },
      execute: async (client) => {
        await this.lockConversation(client, conversationId);
        await this.assertMember(client, actorId, conversationId);
        const msg = await client.query<{ id: string }>(
          `SELECT id FROM messages
           WHERE id = $1 AND conversation_id = $2`,
          [messageId, conversationId],
        );
        if (!msg.rows[0]) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await client.query(
          `INSERT INTO message_hidden_for (message_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [messageId, actorId],
        );
        return { statusCode: 200, body: { hidden: true } };
      },
    });
  }

  private async ensureEffectiveState(
    row: ConversationRow,
    now: Date,
  ): Promise<ConversationRow> {
    if (
      row.request_state === "pending" &&
      row.request_expires_at &&
      row.request_expires_at <= now
    ) {
      const updated = await this.pool.query<ConversationRow>(
        `UPDATE conversations
         SET request_state = 'expired',
             version = version + 1,
             updated_at = $2
         WHERE id = $1 AND request_state = 'pending'
           AND request_expires_at IS NOT NULL
           AND request_expires_at <= $2
         RETURNING *`,
        [row.id, now],
      );
      return updated.rows[0] ?? { ...row, request_state: "expired" };
    }
    return row;
  }

  private async toConversationDto(
    client: PoolClient,
    actorId: string,
    row: ConversationRow,
  ): Promise<ConversationDto> {
    if (
      row.kind !== "direct" ||
      !row.initiator_user_id ||
      !row.recipient_user_id
    ) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const peerUserId =
      row.initiator_user_id === actorId
        ? row.recipient_user_id
        : row.initiator_user_id;
    const peer = await client.query<{
      public_player_id: string;
      display_name: string;
    }>(
      `SELECT public_player_id, display_name
       FROM player_social_profiles WHERE user_id = $1`,
      [peerUserId],
    );
    const member = await client.query<MemberRow>(
      `SELECT * FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [row.id, actorId],
    );
    if (!peer.rows[0] || !member.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    return projectConversationDto(
      actorId,
      row,
      member.rows[0],
      {
        publicPlayerId: peer.rows[0].public_player_id,
        displayName: peer.rows[0].display_name,
        avatar: await avatarForUser(client, peerUserId),
      },
    );
  }

  private async lockConversation(
    client: PoolClient,
    conversationId: string,
  ): Promise<ConversationRow> {
    const result = await client.query<ConversationRow>(
      `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`,
      [conversationId],
    );
    if (!result.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    return result.rows[0];
  }

  private async assertMember(
    client: PoolClient,
    actorId: string,
    conversationId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, actorId],
    );
    if (!result.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  private async lockAccounts(
    client: PoolClient,
    userIds: string[],
  ): Promise<void> {
    const sorted = [...new Set(userIds)].sort();
    for (const id of sorted) {
      const result = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [id],
      );
      if (!result.rows[0] || result.rows[0].status !== "active") {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
    }
  }

  private async assertContactEligible(
    client: PoolClient,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    // Target privacy is rechecked under the existing account fence, including issued public IDs.
    if (this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) {
      const targetAllowed = await client.query("SELECT 1 WHERE " + unrestrictedSql(true, "$1", ["account.access", "profile.public", "social.directory"]), [targetUserId]);
      if (!targetAllowed.rowCount) throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const actor = await client.query<{
      social_eligible: boolean;
    }>(
      `SELECT social_eligible FROM player_social_profiles WHERE user_id = $1`,
      [actorId],
    );
    if (!actor.rows[0]?.social_eligible) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const target = await client.query<{
      directory_visible: boolean;
      contact_policy: "requests" | "closed";
      social_eligible: boolean;
    }>(
      `SELECT directory_visible, contact_policy, social_eligible
       FROM player_social_profiles WHERE user_id = $1 FOR SHARE`,
      [targetUserId],
    );
    const row = target.rows[0];
    if (
      !row ||
      !row.social_eligible ||
      !row.directory_visible ||
      row.contact_policy !== "requests"
    ) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  /** Incoming delivery to an accepted chat: contact_policy requests; no directory_visibility required. */
  private async receiverAllowsIncoming(
    client: PoolClient,
    receiverUserId: string,
  ): Promise<boolean> {
    const target = await client.query<{
      contact_policy: "requests" | "closed";
      social_eligible: boolean;
    }>(
      `SELECT contact_policy, social_eligible
       FROM player_social_profiles WHERE user_id = $1 FOR SHARE`,
      [receiverUserId],
    );
    const row = target.rows[0];
    return Boolean(row?.social_eligible && row.contact_policy === "requests");
  }

  private async assertReceiverAllowsIncoming(
    client: PoolClient,
    receiverUserId: string,
  ): Promise<void> {
    if (!(await this.receiverAllowsIncoming(client, receiverUserId))) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  private async assertCurrentSocialEligible(
    client: PoolClient,
    a: string,
    b: string,
  ): Promise<void> {
    const sorted = [...new Set([a, b])].sort();
    for (const userId of sorted) {
      const result = await client.query<{ social_eligible: boolean }>(
        `SELECT social_eligible FROM player_social_profiles WHERE user_id = $1 FOR SHARE`,
        [userId],
      );
      if (!result.rows[0]?.social_eligible) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
    }
  }

  private async assertNoBilateralBlock(
    client: PoolClient,
    a: string,
    b: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [a, b],
    );
    if (result.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  /**
   * Optional typed Game context for applicant↔manager clarification DM (P-GC-04).
   * Does not grant Game Chat membership or bypass DM consent/block/rate rules.
   */
  private async assertDmGameContext(
    client: PoolClient,
    actorId: string,
    targetUserId: string,
    gameId: string,
  ): Promise<void> {
    if (!isUuid(gameId)) {
      throw unprocessable("GAME_CONTEXT_INVALID", "Некорректный gameContextId");
    }
    const game = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM games WHERE id = $1 FOR SHARE`,
      [gameId],
    );
    if (!game.rows[0] || game.rows[0].status !== "published") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const actorPending = await client.query(
      `SELECT 1 FROM participations
       WHERE game_id = $1 AND user_id = $2 AND status = 'pending'`,
      [gameId, actorId],
    );
    const targetManager = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active'`,
      [gameId, targetUserId],
    );
    const actorManager = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active'`,
      [gameId, actorId],
    );
    const targetPending = await client.query(
      `SELECT 1 FROM participations
       WHERE game_id = $1 AND user_id = $2 AND status = 'pending'`,
      [gameId, targetUserId],
    );
    const ok =
      (actorPending.rows[0] && targetManager.rows[0]) ||
      (actorManager.rows[0] && targetPending.rows[0]);
    if (!ok) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }
}

function effectiveRequestState(
  row: ConversationRow,
  now: Date,
): ConversationRow["request_state"] {
  if (
    row.request_state === "pending" &&
    row.request_expires_at &&
    row.request_expires_at <= now
  ) {
    return "expired";
  }
  return row.request_state;
}

function projectConversationDto(
  actorId: string,
  row: ConversationRow,
  member: MemberRow,
  peer: ConversationPeerDto,
): ConversationDto {
  const lastSeq = Number(row.last_message_seq);
  const readThrough = Number(member.read_through_seq);
  const unread = Math.max(0, lastSeq - readThrough);
  return {
    id: row.id,
    kind: "direct",
    requestState: effectiveRequestState(row, new Date()),
    version: row.version,
    peer,
    role: row.initiator_user_id === actorId ? "initiator" : "recipient",
    lastMessageAt: row.last_message_at
      ? row.last_message_at.toISOString()
      : null,
    lastMessageSeq: String(row.last_message_seq),
    readThroughSeq: String(member.read_through_seq),
    unreadCount: unread,
    archived: member.archived,
    muted: member.muted,
    requestExpiresAt: row.request_expires_at
      ? row.request_expires_at.toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

function requireDirectPeers(row: ConversationRow): {
  initiator: string;
  recipient: string;
} {
  if (
    row.kind !== "direct" ||
    !row.initiator_user_id ||
    !row.recipient_user_id
  ) {
    throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
  }
  return {
    initiator: row.initiator_user_id,
    recipient: row.recipient_user_id,
  };
}

function normalizeCreateRequest(input: {
  targetPublicPlayerId?: string;
  text?: string;
  clientMessageId?: string;
  discoveryProof?: string | null;
  gameContextId?: string | null;
}): {
  targetPublicPlayerId: string;
  text: string;
  clientMessageId: string;
  discoveryProof?: string | null;
  gameContextId: string | null;
} {
  if (
    !input.targetPublicPlayerId ||
    typeof input.targetPublicPlayerId !== "string" ||
    !isUuid(input.targetPublicPlayerId)
  ) {
    throw unprocessable(
      "TARGET_PUBLIC_PLAYER_ID_INVALID",
      "Некорректный targetPublicPlayerId",
    );
  }
  const text = normalizeText(input.text);
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  let gameContextId: string | null = null;
  if (
    input.gameContextId !== undefined &&
    input.gameContextId !== null &&
    input.gameContextId !== ""
  ) {
    if (
      typeof input.gameContextId !== "string" ||
      !isUuid(input.gameContextId)
    ) {
      throw unprocessable(
        "GAME_CONTEXT_INVALID",
        "Некорректный gameContextId",
      );
    }
    gameContextId = input.gameContextId;
  }
  return {
    targetPublicPlayerId: input.targetPublicPlayerId,
    text,
    clientMessageId,
    discoveryProof: input.discoveryProof,
    gameContextId,
  };
}

function normalizeSend(input: {
  text?: string;
  clientMessageId?: string;
  kind?: string;
}): { text: string; clientMessageId: string } {
  if (input.kind !== undefined && input.kind !== "text") {
    throw unprocessable("MESSAGE_KIND_INVALID", "Поддерживается только text");
  }
  return {
    text: normalizeText(input.text),
    clientMessageId: normalizeClientMessageId(input.clientMessageId),
  };
}

function normalizeText(text: unknown): string {
  if (typeof text !== "string") {
    throw unprocessable("TEXT_INVALID", "Текст сообщения обязателен");
  }
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > DM_TEXT_MAX_CHARS) {
    throw unprocessable(
      "TEXT_INVALID",
      `Текст должен быть от 1 до ${DM_TEXT_MAX_CHARS} символов`,
    );
  }
  return trimmed;
}

function normalizeClientMessageId(value: unknown): string {
  if (typeof value !== "string") {
    throw unprocessable("CLIENT_MESSAGE_ID_INVALID", "clientMessageId обязателен");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > DM_CLIENT_MESSAGE_ID_MAX) {
    throw unprocessable(
      "CLIENT_MESSAGE_ID_INVALID",
      "Некорректный clientMessageId",
    );
  }
  return trimmed;
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DM_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  return Math.min(limit, DM_PAGE_MAX);
}

function parseSeq(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw badRequest("SEQ_INVALID", "Некорректный seq");
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw badRequest("SEQ_INVALID", "Некорректный seq");
  }
  return n;
}

function encodeActivityCursor(input: {
  lastMessageAt: string;
  id: string;
}): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeActivityCursor(
  cursor?: string,
): { lastMessageAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { lastMessageAt?: string; id?: string };
    if (
      typeof parsed.lastMessageAt !== "string" ||
      typeof parsed.id !== "string" ||
      !isUuid(parsed.id)
    ) {
      throw new Error("bad cursor");
    }
    return { lastMessageAt: parsed.lastMessageAt, id: parsed.id };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
