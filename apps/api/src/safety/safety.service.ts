import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { notFound, unprocessable, problem } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import {
  messageReportContentFingerprint,
} from "../moderation/message-report-source";
import { SocialFeatureService } from "../profiles/social-feature";
import { ProfilesService } from "../profiles/profiles.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { PairFenceService } from "./pair-fence.service";

export type BlockReceiptDto = {
  publicPlayerId: string;
  blocked: boolean;
};

export type ReportReceiptDto = {
  reportId: string;
  status: "submitted";
  createdAt: string;
};

export type CreatePlayerReportInput = {
  targetKind: "player";
  targetPublicPlayerId: string;
  reasonCode:
    | "harassment"
    | "spam"
    | "fake_profile"
    | "inappropriate"
    | "other";
  detail?: string | null;
  evidenceRefs?: string[];
};

export type CreateMessageReportInput = {
  targetKind: "message";
  messageId: string;
  conversationId?: string;
  gameId?: string;
  reasonCode:
    | "harassment"
    | "spam"
    | "fake_profile"
    | "inappropriate"
    | "other";
  detail?: string | null;
  shareMessageWithSupport: true;
};

export type CreateReportInput = CreatePlayerReportInput | CreateMessageReportInput;

const REASON_CODES = new Set([
  "harassment",
  "spam",
  "fake_profile",
  "inappropriate",
  "other",
]);

/**
 * Public organizer/trainer role-review reports (#394) use a separate domain table
 * (`role_reputation_reports`) and never widen this player-only abuse_reports intake.
 * Private peer `game_review` received-report guards stay in game-feedback (kind===peer).
 * C2 adds discriminated `message` with exact selected-message consent binding.
 */
export const ROLE_REPUTATION_REPORT_REASON_CODES = [
  "harassment",
  "spam",
  "inappropriate",
  "pii",
  "threat",
  "fabrication",
  "other",
] as const;

export type RoleReputationReportReasonCode =
  (typeof ROLE_REPUTATION_REPORT_REASON_CODES)[number];

export function isRoleReputationReportReason(
  value: string,
): value is RoleReputationReportReasonCode {
  return (ROLE_REPUTATION_REPORT_REASON_CODES as readonly string[]).includes(value);
}

type ResolvedMessageSource = {
  messageId: string;
  conversationId: string;
  conversationKind: "direct" | "game";
  gameId: string | null;
  seq: string;
  authorUserId: string;
  bodyText: string;
  contentFingerprint: string;
};

@Injectable()
export class SafetyService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly feature: SocialFeatureService,
    private readonly profiles: ProfilesService,
    private readonly pairs: PairFenceService,
  ) {
    void this.pool;
  }

  async block(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    publicPlayerId: string,
  ): Promise<{ statusCode: number; body: BlockReceiptDto }> {
    this.feature.assertEnabled();
    if (!isUuid(publicPlayerId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const operation = "social_block.put";
    const requestHash = this.idempotency.requestHash({ publicPlayerId });
    return this.mutations.runIdempotent<BlockReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => {
        // Block receipt is actor-owned; session fence already applied.
      },
      execute: async (client) => {
        const targetUserId = await this.profiles.resolveUserIdByPublicPlayerId(
          client,
          publicPlayerId,
        );
        if (!targetUserId || targetUserId === actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        const pair = await this.pairs.lockOrCreate(client, actorId, targetUserId);
        await client.query(
          `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, pair_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
          [actorId, targetUserId, pair.id],
        );
        // S1 source compatibility: schema0031 has no friendship table. Pair is
        // already locked; block permanently ends the current generation.
        const friendshipSchema = await client.query("SELECT to_regclass('friendships') AS name");
        if (friendshipSchema.rows[0]?.name) {
          await client.query(`UPDATE friendships SET state='blocked',version=version+1,
            accepted_at=NULL,updated_at=clock_timestamp()
            WHERE pair_id=$1 AND state IN ('pending','accepted')`, [pair.id]);
        }
        // LS-03 fence: pending DM first-contact cannot complete after block.
        // Accepted history remains readable; send path fails closed on block.
        await client.query(
          `UPDATE conversations
           SET request_state = 'closed',
               version = version + 1,
               updated_at = now()
           WHERE pair_id = $1
             AND request_state = 'pending'`,
          [pair.id],
        );
        return {
          statusCode: 200,
          body: { publicPlayerId, blocked: true },
        };
      },
    });
  }

  async unblock(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    publicPlayerId: string,
  ): Promise<{ statusCode: number; body: BlockReceiptDto }> {
    this.feature.assertEnabled();
    if (!isUuid(publicPlayerId)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const operation = "social_block.delete";
    const requestHash = this.idempotency.requestHash({ publicPlayerId });
    return this.mutations.runIdempotent<BlockReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => {},
      execute: async (client) => {
        const targetUserId = await this.profiles.resolveUserIdByPublicPlayerId(
          client,
          publicPlayerId,
        );
        if (!targetUserId || targetUserId === actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        await this.pairs.lockOrCreate(client, actorId, targetUserId);
        await client.query(
          `DELETE FROM user_blocks
           WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
          [actorId, targetUserId],
        );
        return {
          statusCode: 200,
          body: { publicPlayerId, blocked: false },
        };
      },
    });
  }

  async createReport(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateReportInput,
  ): Promise<{ statusCode: number; body: ReportReceiptDto }> {
    this.feature.assertEnabled();
    if (input?.targetKind === "message") {
      return this.createMessageReport(actorId, sessionId, idempotencyKey, input);
    }
    const normalized = normalizePlayerReport(input);
    const operation = "abuse_report.create";
    const requestHash = this.idempotency.requestHash(normalized);
    return this.mutations.runIdempotent<ReportReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => {},
      execute: async (client) => {
        const targetUserId = await this.profiles.resolveUserIdByPublicPlayerId(
          client,
          normalized.targetPublicPlayerId,
        );
        if (!targetUserId || targetUserId === actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        // Pair fence serializes report-vs-block races; no Game locks.
        await this.pairs.lockOrCreate(client, actorId, targetUserId);
        const inserted = await client.query<{
          id: string;
          created_at: Date;
        }>(
          `INSERT INTO abuse_reports (
             reporter_user_id, target_kind, target_user_id,
             target_public_player_id, reason_code, detail, evidence_refs, state
           ) VALUES ($1, 'player', $2, $3, $4, $5, $6::jsonb, 'submitted')
           RETURNING id, created_at`,
          [
            actorId,
            targetUserId,
            normalized.targetPublicPlayerId,
            normalized.reasonCode,
            normalized.detail,
            JSON.stringify(normalized.evidenceRefs),
          ],
        );
        const row = inserted.rows[0]!;
        return {
          statusCode: 201,
          body: {
            reportId: row.id,
            status: "submitted",
            createdAt: row.created_at.toISOString(),
          },
        };
      },
    });
  }

  private async createMessageReport(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateMessageReportInput,
  ): Promise<{ statusCode: number; body: ReportReceiptDto }> {
    const normalized = normalizeMessageReport(input);
    const operation = "abuse_report.message.create";
    const requestHash = this.idempotency.requestHash(normalized);
    return this.mutations.runIdempotent<ReportReceiptDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, existing) => {
        await this.assertBindingsInstalled(client);
        const source = await this.resolveReadableIncomingMessage(client, actorId, normalized);
        const bound = (
          await client.query<{ report_id: string }>(
            `SELECT report_id FROM message_report_bindings
             WHERE reporter_user_id = $1 AND message_id = $2 AND content_fingerprint = $3`,
            [actorId, source.messageId, source.contentFingerprint],
          )
        ).rows[0];
        if (!bound || bound.report_id !== existing.reportId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
      },
      execute: async (client) => {
        await this.assertBindingsInstalled(client);
        if (normalized.shareMessageWithSupport !== true) {
          throw unprocessable(
            "MESSAGE_REPORT_CONSENT_REQUIRED",
            "Нужно согласие на передачу выбранного сообщения",
          );
        }
        const source = await this.resolveReadableIncomingMessage(client, actorId, normalized);

        const existingBinding = (
          await client.query<{ report_id: string; created_at: Date }>(
            `SELECT b.report_id, r.created_at
             FROM message_report_bindings b
             JOIN abuse_reports r ON r.id = b.report_id
             WHERE b.reporter_user_id = $1
               AND b.message_id = $2
               AND b.content_fingerprint = $3`,
            [actorId, source.messageId, source.contentFingerprint],
          )
        ).rows[0];
        if (existingBinding) {
          return {
            statusCode: 200,
            body: {
              reportId: existingBinding.report_id,
              status: "submitted",
              createdAt: existingBinding.created_at.toISOString(),
            },
          };
        }

        await this.pairs.lockOrCreate(client, actorId, source.authorUserId);

        const inserted = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO abuse_reports (
             reporter_user_id, target_kind, target_user_id,
             target_public_player_id, reason_code, detail, evidence_refs, state
           ) VALUES ($1, 'message', $2, NULL, $3, $4, '[]'::jsonb, 'submitted')
           RETURNING id, created_at`,
          [actorId, source.authorUserId, normalized.reasonCode, normalized.detail],
        );
        const reportId = inserted.rows[0]!.id;
        await client.query(
          `INSERT INTO message_report_bindings (
             report_id, message_id, conversation_id, conversation_kind, game_id,
             message_seq, author_user_id, content_fingerprint, share_consent, reporter_user_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)`,
          [
            reportId,
            source.messageId,
            source.conversationId,
            source.conversationKind,
            source.gameId,
            source.seq,
            source.authorUserId,
            source.contentFingerprint,
            actorId,
          ],
        );
        return {
          statusCode: 201,
          body: {
            reportId,
            status: "submitted",
            createdAt: inserted.rows[0]!.created_at.toISOString(),
          },
        };
      },
    });
  }

  private fingerprintSecret(): string {
    const secret = this.env.CONTENT_MODERATION_FINGERPRINT_SECRET;
    if (!secret) {
      throw problem(
        503,
        "MODERATION_TEMPORARILY_UNAVAILABLE",
        "Проверка сообщений временно недоступна",
      );
    }
    return secret;
  }

  private async assertBindingsInstalled(client: PoolClient): Promise<void> {
    const installed = (
      await client.query<{ name: string | null }>(
        `SELECT to_regclass('message_report_bindings') AS name`,
      )
    ).rows[0]?.name;
    if (!installed) {
      throw problem(503, "FEATURE_UNAVAILABLE", "Жалоба на сообщение временно недоступна");
    }
  }

  /**
   * Server-authoritative selected-message access: genuine exact incoming live readable
   * message only. Rejects own/foreign/hidden/purged. DM history remains readable after
   * block without requiring send/unblock. Game uses current membership/lifecycle gates.
   */
  private async resolveReadableIncomingMessage(
    client: PoolClient,
    reporterUserId: string,
    input: {
      messageId: string;
      conversationId: string | null;
      gameId: string | null;
    },
  ): Promise<ResolvedMessageSource> {
    const secret = this.fingerprintSecret();
    const row = (
      await client.query<{
        id: string;
        conversation_id: string;
        seq: string | number;
        author_user_id: string;
        kind: string;
        body_text: string | null;
        content_state: string;
        conversation_kind: "direct" | "game";
        game_id: string | null;
        hidden_through_seq: string | number | null;
        hidden_for: string | null;
      }>(
        `SELECT m.id, m.conversation_id, m.seq, m.author_user_id, m.kind,
                m.body_text, m.content_state,
                c.kind AS conversation_kind, c.game_id,
                mem.hidden_through_seq,
                h.message_id::text AS hidden_for
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN conversation_members mem
           ON mem.conversation_id = m.conversation_id AND mem.user_id = $2
         LEFT JOIN message_hidden_for h
           ON h.message_id = m.id AND h.user_id = $2
         WHERE m.id = $1
         FOR UPDATE OF m`,
        [input.messageId, reporterUserId],
      )
    ).rows[0];
    if (!row) throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    if (row.kind !== "text") throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    if (row.author_user_id === reporterUserId) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (!row.hidden_through_seq && row.hidden_through_seq !== 0) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (row.hidden_for) throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    if (Number(row.seq) <= Number(row.hidden_through_seq)) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (row.content_state !== "live" || row.body_text == null || row.body_text.length < 1) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }

    if (row.conversation_kind === "direct") {
      if (!input.conversationId || input.conversationId !== row.conversation_id) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
      if (input.gameId) throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      // Membership alone grants historical DM readability after block; no send/unblock.
    } else if (row.conversation_kind === "game") {
      if (!input.gameId || input.gameId !== row.game_id) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
      if (input.conversationId && input.conversationId !== row.conversation_id) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
      await this.assertGameChatReadAccess(client, reporterUserId, row.game_id!);
    } else {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }

    const contentFingerprint = messageReportContentFingerprint(secret, {
      messageId: row.id,
      conversationId: row.conversation_id,
      seq: row.seq,
      bodyText: row.body_text,
    });
    return {
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationKind: row.conversation_kind,
      gameId: row.conversation_kind === "game" ? row.game_id : null,
      seq: String(row.seq),
      authorUserId: row.author_user_id,
      bodyText: row.body_text,
      contentFingerprint,
    };
  }

  /** Current game-chat read gates (published, now < ends_at, manager or confirmed). */
  private async assertGameChatReadAccess(
    client: PoolClient,
    actorId: string,
    gameId: string,
  ): Promise<void> {
    const game = (
      await client.query<{
        id: string;
        status: string;
        ends_at: Date;
      }>(
        `SELECT id, status, ends_at FROM games WHERE id = $1 FOR SHARE`,
        [gameId],
      )
    ).rows[0];
    if (!game || game.status !== "published") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (game.ends_at.getTime() <= Date.now()) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    const manager = (
      await client.query(
        `SELECT 1 FROM game_managers
         WHERE game_id = $1 AND user_id = $2 AND role IN ('owner','manager')
         LIMIT 1`,
        [gameId, actorId],
      )
    ).rows[0];
    if (manager) return;
    const participant = (
      await client.query(
        `SELECT 1 FROM participations
         WHERE game_id = $1 AND user_id = $2 AND status = 'confirmed'
         LIMIT 1`,
        [gameId, actorId],
      )
    ).rows[0];
    if (!participant) throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
  }
}

function normalizePlayerReport(input: CreateReportInput): {
  targetKind: "player";
  targetPublicPlayerId: string;
  reasonCode: string;
  detail: string | null;
  evidenceRefs: string[];
} {
  if (!input || input.targetKind !== "player") {
    throw unprocessable("TARGET_KIND_INVALID", "Некорректный targetKind");
  }
  if (!input.targetPublicPlayerId || !isUuid(input.targetPublicPlayerId)) {
    throw unprocessable(
      "TARGET_PUBLIC_PLAYER_ID_INVALID",
      "Некорректный targetPublicPlayerId",
    );
  }
  if (!REASON_CODES.has(input.reasonCode)) {
    throw unprocessable("REASON_CODE_INVALID", "Некорректный reasonCode");
  }
  let detail: string | null = null;
  if (input.detail !== undefined && input.detail !== null) {
    const trimmed = String(input.detail).trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      throw unprocessable("REPORT_DETAIL_INVALID", "Некорректный detail");
    }
    detail = trimmed;
  }
  let evidenceRefs: string[] = [];
  if (input.evidenceRefs !== undefined) {
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 10) {
      throw unprocessable(
        "EVIDENCE_REFS_INVALID",
        "Некорректные evidenceRefs",
      );
    }
    evidenceRefs = input.evidenceRefs.map((ref) => {
      const value = String(ref).trim();
      if (value.length < 1 || value.length > 200) {
        throw unprocessable(
          "EVIDENCE_REFS_INVALID",
          "Некорректные evidenceRefs",
        );
      }
      return value;
    });
  }
  return {
    targetKind: "player",
    targetPublicPlayerId: input.targetPublicPlayerId,
    reasonCode: input.reasonCode,
    detail,
    evidenceRefs,
  };
}

function normalizeMessageReport(input: CreateMessageReportInput): {
  targetKind: "message";
  messageId: string;
  conversationId: string | null;
  gameId: string | null;
  reasonCode: string;
  detail: string | null;
  shareMessageWithSupport: true;
} {
  if (input.targetKind !== "message") {
    throw unprocessable("TARGET_KIND_INVALID", "Некорректный targetKind");
  }
  if (!input.messageId || !isUuid(input.messageId)) {
    throw unprocessable("MESSAGE_ID_INVALID", "Некорректный messageId");
  }
  if (input.shareMessageWithSupport !== true) {
    throw unprocessable(
      "MESSAGE_REPORT_CONSENT_REQUIRED",
      "Нужно согласие на передачу выбранного сообщения",
    );
  }
  if (!REASON_CODES.has(input.reasonCode)) {
    throw unprocessable("REASON_CODE_INVALID", "Некорректный reasonCode");
  }
  const conversationId =
    input.conversationId === undefined || input.conversationId === null
      ? null
      : String(input.conversationId);
  const gameId =
    input.gameId === undefined || input.gameId === null
      ? null
      : String(input.gameId);
  if (conversationId && !isUuid(conversationId)) {
    throw unprocessable("CONVERSATION_ID_INVALID", "Некорректный conversationId");
  }
  if (gameId && !isUuid(gameId)) {
    throw unprocessable("GAME_ID_INVALID", "Некорректный gameId");
  }
  // Exactly one context: DM conversationId XOR game chat gameId.
  if ((conversationId && gameId) || (!conversationId && !gameId)) {
    throw unprocessable("MESSAGE_REPORT_CONTEXT_INVALID", "Укажите контекст сообщения");
  }
  // Client excerpts / author ids / evidenceRefs are never accepted as authority.
  if ("evidenceRefs" in input && (input as { evidenceRefs?: unknown }).evidenceRefs !== undefined) {
    throw unprocessable("EVIDENCE_REFS_INVALID", "evidenceRefs недопустимы для жалобы на сообщение");
  }
  let detail: string | null = null;
  if (input.detail !== undefined && input.detail !== null) {
    const trimmed = String(input.detail).trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      throw unprocessable("REPORT_DETAIL_INVALID", "Некорректный detail");
    }
    detail = trimmed;
  }
  return {
    targetKind: "message",
    messageId: input.messageId,
    conversationId,
    gameId,
    reasonCode: input.reasonCode,
    detail,
    shareMessageWithSupport: true,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
