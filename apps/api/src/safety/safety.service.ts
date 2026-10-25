import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { notFound, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { SocialFeatureService } from "../profiles/social-feature";
import { ProfilesService } from "../profiles/profiles.service";
import { DATABASE_POOL } from "../tokens";
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

export type CreateReportInput = {
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

const REASON_CODES = new Set([
  "harassment",
  "spam",
  "fake_profile",
  "inappropriate",
  "other",
]);

@Injectable()
export class SafetyService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
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
    const normalized = normalizeReport(input);
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
}

function normalizeReport(input: CreateReportInput): {
  targetKind: "player";
  targetPublicPlayerId: string;
  reasonCode: string;
  detail: string | null;
  evidenceRefs: string[];
} {
  if (input.targetKind !== "player") {
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
