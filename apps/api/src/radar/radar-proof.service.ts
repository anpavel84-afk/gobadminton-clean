import { openUnified, proofSchema } from "./unified-contract";
import { redeemUnifiedProof } from "./unified-proof";
import { PairFenceService } from "../safety/pair-fence.service";
import {
  geographicProofSchema,
  geographicPepper,
  parseGeographicToken,
  displayLocation,
} from "./geographic-contract";
import { redeemGeographicProof } from "./geographic-proof";
import { unrestrictedSql } from "../restrictions/policy";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { isDemoUuid } from "../database/demo-ids";
import { notFound } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import {
  RADAR_POLICY_VERSION,
  isAdmittedRadarRegionId,
  type RadarRadiusBucketKm,
} from "./constants";
import { RadarFeatureService } from "./radar-feature";
import {
  bandForDistance,
  rankCurrentCohort,
  selectEligibleNearbyCandidates,
} from "./radar-matching";
import { emitRadarMetric } from "./radar-telemetry";
import { parseResultRef, type ResultRefPayload } from "./result-ref";

export type RedeemedRadarProof = {
  targetUserId: string;
  publicPlayerId: string;
  displayName: string;
  levelScaleId: string | null;
  levelScaleVersion: number | null;
  levelId: string | null;
  trainer: boolean;
  displayLocation?: ReturnType<typeof displayLocation>;
  radar?: {
    consentPolicyVersion: string;
    geo: ReturnType<typeof import("./unified-contract").publicGeo>;
    validUntil: string;
    distance: ReturnType<
      typeof import("./unified-contract").distanceEstimate
    > | null;
  };
  proximityBand: "near" | "middle" | "outer" | null;
  radiusBucketKm: RadarRadiusBucketKm | null;
};

function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Результат Radar недоступен");
}

@Injectable()
export class RadarProofService {
  private readonly logger = new Logger(RadarProofService.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly feature: RadarFeatureService,
    private readonly pairs: PairFenceService,
  ) {}

  /**
   * Optional first-contact hook. Empty proof is a no-op (directory contact).
   * A supplied proof is never a bearer grant: current activations, owner
   * session, expiry, radius/cohort, block and eligibility are rechecked.
   */
  usesGeographicFence(proof: unknown): boolean {
    return (
      (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ||
        (this.env.SOCIAL_RADAR_UNIFIED_ENABLED &&
          typeof proof === "string" &&
          proof.startsWith("u1."))) &&
      proof !== undefined &&
      proof !== null
    );
  }

  async assertOptionalDiscoveryProof(
    client: PoolClient,
    input: {
      actorId: string;
      sessionId: string;
      targetUserId: string;
      discoveryProof?: string | null;
    },
  ): Promise<void> {
    const proof = input.discoveryProof;
    if (
      proof === undefined ||
      proof === null ||
      (proof === "" &&
        !this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED &&
        !this.env.SOCIAL_RADAR_UNIFIED_ENABLED)
    ) {
      return;
    }
    if (this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) {
      const allowed = await client.query("SELECT 1 WHERE " + unrestrictedSql(true, "$1", ["account.access", "profile.public", "social.radar"]), [input.actorId]);
      if (!allowed.rowCount) unavailable();
    }
    const started = Date.now();
    try {
      await this.redeem(client, {
        actorId: input.actorId,
        sessionId: input.sessionId,
        proof,
        expectedTargetUserId: input.targetUserId,
      });
      emitRadarMetric(this.logger, {
        op: "contact_proof",
        outcome: "ok",
        durationMs: Date.now() - started,
      });
    } catch (error) {
      emitRadarMetric(this.logger, {
        op: "contact_proof",
        outcome: "unavailable",
        code: "RESOURCE_UNAVAILABLE",
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }

  /** Final wall-clock check after persistence waits, under the already-held pair/presence fences. */
  async assertFinalGeographicProof(
    client: PoolClient,
    input: {
      actorId: string;
      sessionId: string;
      targetUserId: string;
      discoveryProof?: string | null;
    },
  ): Promise<void> {
    if (!this.usesGeographicFence(input.discoveryProof)) return;
    if (
      typeof input.discoveryProof === "string" &&
      input.discoveryProof.startsWith("u1.")
    ) {
      const p = openUnified(
        this.env,
        "result",
        input.discoveryProof,
        proofSchema,
      );
      if (
        !this.env.SOCIAL_RADAR_UNIFIED_ENABLED ||
        !p ||
        p.context.viewerId !== input.actorId ||
        p.context.sessionId !== input.sessionId ||
        p.targetId !== input.targetUserId
      )
        unavailable();
      await redeemUnifiedProof(client, p, true, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED);
      return;
    }
    const payload = parseGeographicToken(
      geographicPepper(this.env),
      "result",
      input.discoveryProof,
      geographicProofSchema,
    );
    if (
      !payload ||
      payload.viewerUserId !== input.actorId ||
      payload.viewerSessionId !== input.sessionId ||
      payload.targetUserId !== input.targetUserId
    )
      unavailable();
    await redeemGeographicProof(client, payload, true, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED);
  }

  async redeem(
    client: PoolClient,
    input: {
      actorId: string;
      sessionId: string;
      proof: string;
      expectedTargetUserId?: string;
    },
  ): Promise<RedeemedRadarProof> {
    // Check the caller's mode, not whether ANY Radar mode happens to be enabled.
    try {
      this.feature.assertAccess(input.actorId);
    } catch {
      unavailable();
    }
    if (typeof input.proof !== "string" || input.proof.length > 4096) {
      unavailable();
    }
    if (input.proof.startsWith("u1.")) {
      const p = openUnified(this.env, "result", input.proof, proofSchema);
      if (
        !this.env.SOCIAL_RADAR_UNIFIED_ENABLED ||
        !p ||
        p.context.viewerId !== input.actorId ||
        p.context.sessionId !== input.sessionId ||
        p.context.mode !== this.feature.assertAccess(input.actorId) ||
        (input.expectedTargetUserId &&
          p.targetId !== input.expectedTargetUserId)
      )
        unavailable();
      const target = await client.query(
        "SELECT 1 FROM radar_presences WHERE user_id=$1 AND activation_id=$2",
        [p.targetId, p.activationId],
      );
      if (!target.rows[0]) unavailable();
      await this.pairs.lockOrCreate(client, p.context.viewerId, p.targetId);
      return redeemUnifiedProof(client, p, false, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED);
    }
    if (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
      const geo = parseGeographicToken(
        geographicPepper(this.env),
        "result",
        input.proof,
        geographicProofSchema,
      );
      if (
        !geo ||
        geo.viewerUserId !== input.actorId ||
        geo.viewerSessionId !== input.sessionId ||
        geo.exposureMode !== this.feature.assertAccess(input.actorId) ||
        (input.expectedTargetUserId &&
          geo.targetUserId !== input.expectedTargetUserId) ||
        geo.expiresAt <= Date.now()
      )
        unavailable();
      // Reject a syntactically valid but nonexistent/foreign target before Pair FK insertion.
      const target = await client.query(
        `SELECT 1 FROM radar_presences r JOIN player_social_profiles p ON p.user_id=r.user_id
        WHERE r.user_id=$1 AND r.activation_id=$2 AND r.version=$3 AND p.public_player_id=$4`,
        [
          geo.targetUserId,
          geo.targetActivationId,
          geo.targetVersion,
          geo.targetPublicPlayerId,
        ],
      );
      if (!target.rows[0]) unavailable();
      // Contact already owns this pair; preview acquires the same fence here.
      await this.pairs.lockOrCreate(client, geo.viewerUserId, geo.targetUserId);
      return redeemGeographicProof(client, geo, false, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED);
    }
    const payload = parseResultRef(this.env.AUTH_PEPPER, input.proof);
    if (
      !payload ||
      payload.viewerUserId !== input.actorId ||
      payload.viewerSessionId !== input.sessionId ||
      isDemoUuid(payload.viewerUserId) !== isDemoUuid(payload.targetUserId)
    ) {
      unavailable();
    }
    if (
      input.expectedTargetUserId &&
      payload.targetUserId !== input.expectedTargetUserId
    ) {
      unavailable();
    }
    return this.revalidateCurrent(client, payload, input.sessionId);
  }

  private async revalidateCurrent(
    client: PoolClient,
    payload: ResultRefPayload,
    sessionId: string,
  ): Promise<RedeemedRadarProof> {
    const ids = [payload.viewerUserId, payload.targetUserId].sort();
    const locked = await client.query<{
      user_id: string;
      activation_id: string;
      version: string | number;
      owner_session_id: string;
      radius_bucket_km: RadarRadiusBucketKm;
      policy_version: string;
      region_id: string;
      expires_at: Date;
      foreground_until: Date;
      location_valid_until: Date;
    }>(
      `SELECT user_id, activation_id, version, owner_session_id, radius_bucket_km,
              policy_version, region_id, expires_at, foreground_until, location_valid_until
       FROM radar_presences
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR SHARE`,
      [ids],
    );
    const now = new Date();
    const viewer = locked.rows.find(
      (row) => row.user_id === payload.viewerUserId,
    );
    const target = locked.rows.find(
      (row) => row.user_id === payload.targetUserId,
    );
    if (!viewer || !target) {
      unavailable();
    }
    if (payload.exp * 1000 <= now.getTime()) {
      unavailable();
    }
    if (
      viewer.activation_id !== payload.viewerActivationId ||
      Number(viewer.version) !== payload.viewerVersion ||
      viewer.owner_session_id !== sessionId ||
      viewer.policy_version !== RADAR_POLICY_VERSION ||
      !isAdmittedRadarRegionId(viewer.region_id) ||
      viewer.expires_at.getTime() <= now.getTime() ||
      viewer.foreground_until.getTime() <= now.getTime() ||
      viewer.location_valid_until.getTime() <= now.getTime()
    ) {
      unavailable();
    }
    if (
      target.activation_id !== payload.targetActivationId ||
      Number(target.version) !== payload.targetVersion ||
      target.policy_version !== RADAR_POLICY_VERSION ||
      !isAdmittedRadarRegionId(target.region_id) ||
      target.region_id !== viewer.region_id ||
      target.expires_at.getTime() <= now.getTime() ||
      target.foreground_until.getTime() <= now.getTime() ||
      target.location_valid_until.getTime() <= now.getTime()
    ) {
      unavailable();
    }

    const profiles = await client.query<{
      user_id: string;
      radar_consented: boolean;
      radar_consent_policy_version: string | null;
      social_eligible: boolean;
      display_name: string;
      public_player_id: string;
      level_scale_id: string | null;
      level_scale_version: number | null;
      level_id: string | null;
    }>(
      `SELECT user_id, radar_consented, radar_consent_policy_version, social_eligible,
              display_name, public_player_id, level_scale_id, level_scale_version, level_id
       FROM player_social_profiles
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id
       FOR SHARE`,
      [ids],
    );
    const viewerProfile = profiles.rows.find(
      (row) => row.user_id === payload.viewerUserId,
    );
    const targetProfile = profiles.rows.find(
      (row) => row.user_id === payload.targetUserId,
    );
    if (
      !viewerProfile ||
      !targetProfile ||
      !viewerProfile.social_eligible ||
      !viewerProfile.radar_consented ||
      viewerProfile.radar_consent_policy_version !== RADAR_POLICY_VERSION ||
      viewerProfile.display_name.trim().length < 1 ||
      !targetProfile.social_eligible ||
      !targetProfile.radar_consented ||
      targetProfile.radar_consent_policy_version !== RADAR_POLICY_VERSION
    ) {
      unavailable();
    }

    const users = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE id = ANY($1::uuid[]) FOR SHARE`,
      [ids],
    );
    if (
      users.rows.length !== 2 ||
      users.rows.some((row) => row.status !== "active")
    ) {
      unavailable();
    }

    const targetSession = await client.query<{ id: string }>(
      `SELECT id FROM app_sessions
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > $3
       FOR SHARE`,
      [target.owner_session_id, payload.targetUserId, now],
    );
    if (!targetSession.rows[0]) {
      unavailable();
    }

    const blocked = await client.query<{ n: number }>(
      `SELECT 1 AS n FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [payload.viewerUserId, payload.targetUserId],
    );
    if (blocked.rows[0]) {
      unavailable();
    }

    const distance = await client.query<{ dist_m: number }>(
      `SELECT ST_Distance(t.coarse_center, v.coarse_center) AS dist_m
       FROM radar_presences t
       INNER JOIN radar_presences v ON v.user_id = $1
       WHERE t.user_id = $2
         AND ST_DWithin(t.coarse_center, v.coarse_center, v.radius_bucket_km * 1000)`,
      [payload.viewerUserId, payload.targetUserId],
    );
    const distM = distance.rows[0]?.dist_m;
    const band =
      distM === undefined
        ? null
        : bandForDistance(distM, viewer.radius_bucket_km);
    if (!band) {
      unavailable();
    }

    const candidates = await selectEligibleNearbyCandidates(
      client,
      payload.viewerUserId,
      now,
      this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
    );
    const cohort = rankCurrentCohort(
      this.env.AUTH_PEPPER,
      payload.viewerUserId,
      viewer.radius_bucket_km,
      now,
      candidates,
    );
    if (!cohort.some((row) => row.user_id === payload.targetUserId)) {
      unavailable();
    }

    const trainer = await client.query<{ trainer: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM trainer_profiles tp
         WHERE tp.user_id = $1 AND tp.status = 'active'
       ) AS trainer`,
      [payload.targetUserId],
    );

    return {
      targetUserId: payload.targetUserId,
      publicPlayerId: targetProfile.public_player_id,
      displayName: targetProfile.display_name,
      levelScaleId: targetProfile.level_scale_id,
      levelScaleVersion: targetProfile.level_scale_version,
      levelId: targetProfile.level_id,
      trainer: Boolean(trainer.rows[0]?.trainer),
      proximityBand: band,
      radiusBucketKm: viewer.radius_bucket_km,
    };
  }
}
