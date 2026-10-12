import { Inject, Injectable } from "@nestjs/common";
import { APP_ENV } from "../tokens";
import type { AppEnv } from "../config/env";
import type { PoolClient } from "pg";
import { unprocessable } from "../auth/problem";
export const CASE_EVIDENCE_POLICY = Symbol("CASE_EVIDENCE_POLICY");
/** No live retention/hold policy is inferred. A separately admitted provider can replace this port. */
export interface CaseEvidencePolicy {
  capture(client: PoolClient, caseId: string): Promise<{ policyId: "internal_synthetic_v1"; expiresAt: Date; legalHold: boolean }>;
  canRead(client: PoolClient, item: { expires_at: Date; policy_id: string }): Promise<boolean>;
  canPurge(item: { legal_hold: boolean }): boolean;
}
@Injectable()
export class SyntheticCaseEvidencePolicy implements CaseEvidencePolicy {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}
  async capture(client: PoolClient, _caseId: string) {
    const ttl = this.env.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS;
    if (!ttl) throw unprocessable("CASE_EVIDENCE_POLICY_DISABLED", "Сохранение материалов недоступно");
    const expiresAt = (await client.query<{expires_at: Date}>("SELECT clock_timestamp()+$1::integer*interval '1 second' AS expires_at", [ttl])).rows[0]!.expires_at;
    return { policyId: "internal_synthetic_v1" as const, expiresAt, legalHold: false };
  }
  async canRead(client: PoolClient, item: { expires_at: Date; policy_id: string }) {
    if (!this.env.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS || item.policy_id !== "internal_synthetic_v1") return false;
    return Boolean((await client.query("SELECT 1 WHERE $1::timestamptz>clock_timestamp()", [item.expires_at])).rowCount);
  }
  canPurge(_item: { legal_hold: boolean }) { return false; } // No purge authority, including expired unheld data.
}
