import { UNIFIED_POLICY } from "./unified-contract";
import { readRadarPlayerGames } from "../games/games.service";
import type { UnifiedUpcomingGame } from "@gobadminton/contracts/src/unified.generated";
import { isDemoUuid } from "../database/demo-ids";
import { ensureGeographicConsent } from "./geographic-consent";
import { GEO_POLICY, geographicStartSchema, geographicTakeoverSchema, GEO_CONTRACT } from "./geographic-contract";
import { assertCapabilities } from "../restrictions/policy";
import { ProfilesService } from "../profiles/profiles.service";
import { avatarForUser, type PlayerAvatar } from "../profiles/avatar-presentation";
import { safePublicDisplayName } from "../profiles/social-profile-defaults";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  badRequest,
  notFound,
  conflict,
  forbidden,
  problem,
  unprocessable,
} from "../auth/problem";
import { HttpStatus } from "@nestjs/common";
import { hmacSha256Hex } from "../auth/crypto";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { RADAR_CONSENT_POLICY_VERSION } from "../profiles/constants";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  coarseCenterDistanceMeters,
  OWNER_GLOBAL_DEBUG_RADAR_REGIONS,
  quantizeFix,
  type RawFixInput,
} from "./coarse-location";
import {
  RADAR_DEFAULT_RADIUS_KM,
  RADAR_DISPLAY_TTL_SECONDS,
  RADAR_FOREGROUND_LEASE_SECONDS,
  RADAR_HARD_LIFETIME_MINUTES,
  RADAR_LOCATION_UPDATE_MINUTES,
  RADAR_LOCATION_VALID_MINUTES,
  RADAR_MAX_COARSE_SPEED_KMH,
  RADAR_POLICY_VERSION,
  RADAR_REGION_OWNER_GLOBAL_ID,
  RADAR_RADIUS_BUCKETS_KM,
  RADAR_RADIUS_CHANGE_COOLDOWN_MINUTES,
  RADAR_RADIUS_CHANGE_WINDOW_MINUTES,
  RADAR_RADIUS_CHANGES_PER_WINDOW,
  RADAR_REFRESH_AFTER_SECONDS,
  RADAR_TTL_DEFAULT_MINUTES,
  RADAR_TTL_MAX_MINUTES,
  isAdmittedRadarRegionId,
  type RadarExposureMode,
  type RadarRadiusBucketKm,
} from "./constants";
import { RadarBudgetService } from "./radar-budget.service";
import { RadarDemoService } from "./radar-demo";
import { RadarFeatureService } from "./radar-feature";
import {
  bandForDistance,
  rankCurrentCohort,
  selectEligibleNearbyCandidates,
} from "./radar-matching";
import { RadarProofService } from "./radar-proof.service";
import {
  displaySlot,
  orderingEpoch,
  resultId,
  signResultRef,
} from "./result-ref";

export type RadarLocationInput = RawFixInput;

export type RadarActivationDto = {
  state: "active";
  activationId: string;
  version: number;
  ownerHere: true;
  policyVersion: string;
  regionId: string;
  radiusBucketKm: RadarRadiusBucketKm;
  startedAt: string;
  expiresAt: string;
  hardExpiresAt: string;
  foregroundUntil: string;
  locationValidUntil: string;
  nextLocationUpdateAt: string;
  nextRadiusChangeAt: string;
  exposureMode: RadarExposureMode;
};

export type RadarStatusDto =
  | {
      state: "off";
      ownerHere: boolean;
      policyVersion: string;
      exposureMode: RadarExposureMode;
    }
  | {
      state: "owned_elsewhere";
      ownerHere: false;
      activationId: string;
      version: number;
      policyVersion: string;
      expiresAt: string;
      exposureMode: RadarExposureMode;
    }
  | {
      state: "expired";
      ownerHere: boolean;
      policyVersion: string;
      exposureMode: RadarExposureMode;
    }
  | RadarActivationDto;

export type NearbyItemDto = {
  resultId: string;
  resultRef: string;
  player: {
    avatar?: PlayerAvatar;
    canRequestContact: boolean;
    publicPlayerId: string;
    displayName: string;
    level: {
      scaleId: string;
      scaleVersion: number;
      levelId: string;
      provenance: "self_declared";
    } | null;
    trainer: boolean;
  };
  proximityBand: "near" | "middle" | "outer";
  displaySlot: number;
};

export type NearbyDto = {
  state: "empty" | "results";
  policyVersion: string;
  radiusBucketKm: RadarRadiusBucketKm;
  refreshAfterSeconds: number;
  displayTtlSeconds: number;
  items: NearbyItemDto[];
  exposureMode: RadarExposureMode;
};

export type PreviewDto = {
  player: NearbyItemDto["player"];
  proximityBand: "near" | "middle" | "outer" | null;
  displayLocation?: ReturnType<typeof import("./geographic-contract").displayLocation>;
  radar?: import("./radar-proof.service").RedeemedRadarProof["radar"];
  upcomingGames?: UnifiedUpcomingGame[];
};

type PresenceRow = {
  user_id: string;
  activation_id: string;
  owner_session_id: string;
  version: string | number;
  policy_version: string;
  region_id: string;
  started_at: Date;
  expires_at: Date;
  hard_expires_at: Date;
  foreground_until: Date;
  location_valid_until: Date;
  next_location_update_at: Date;
  next_radius_change_at: Date;
  radius_changes_window_started_at: Date;
  radius_changes_in_window: number;
  cell_i: number;
  cell_j: number;
  radius_bucket_km: RadarRadiusBucketKm;
};

const PRESENCE_SELECT = `user_id, activation_id, owner_session_id, version, policy_version,
  region_id, started_at, expires_at, hard_expires_at, foreground_until,
  location_valid_until, next_location_update_at, next_radius_change_at,
  radius_changes_window_started_at, radius_changes_in_window, cell_i, cell_j,
  radius_bucket_km`;

@Injectable()
export class RadarService {
  private get policyVersion() { return this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ? GEO_POLICY : RADAR_POLICY_VERSION; }
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly feature: RadarFeatureService,
    private readonly demo: RadarDemoService,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly actorFence: ActorFenceService,
    private readonly budgets: RadarBudgetService,
    private readonly proofs: RadarProofService,
    private readonly profiles: ProfilesService,
  ) {}

  async getStatus(userId: string, sessionId: string): Promise<RadarStatusDto> {
    // Own status/STOP is available independently of viewer/publishing switches.
    const exposureMode = this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED
      ? (isDemoUuid(userId) ? "synthetic_demo" : "live")
      : this.feature.assertAccess(userId);
    const now = new Date();
    const evidence = this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ? await this.pool.query(`SELECT 1 FROM player_social_profiles p
      JOIN radar_consent_events e ON e.id=p.radar_consent_evidence_id AND e.user_id=p.user_id AND e.event_type='accepted' AND e.policy_version=$2
      WHERE p.user_id=$1 AND p.radar_consented AND p.radar_consent_policy_version=$2
      AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)`,[userId,GEO_POLICY]) : null;
    const metadata = evidence ? {contractVersion:GEO_CONTRACT,consentRequired:!evidence.rows.length} : {};
    const result = await this.pool.query<PresenceRow>(
      `SELECT ${PRESENCE_SELECT} FROM radar_presences WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        ...metadata,
        state: "off",
        ownerHere: true,
        policyVersion: this.policyVersion,
        exposureMode,
      };
    }
    if (!this.isEffectivelyActiveRow(row, now)) {
      await this.pool.query(`DELETE FROM radar_presences WHERE user_id=$1 AND activation_id=$2 AND version=$3
        AND (expires_at<=clock_timestamp() OR foreground_until<=clock_timestamp() OR location_valid_until<=clock_timestamp() OR policy_version<>$4)`,
        [userId,row.activation_id,row.version,this.policyVersion]);
      return {
        ...metadata,
        state: "expired",
        ownerHere: row.owner_session_id === sessionId,
        policyVersion: this.policyVersion,
        exposureMode,
      };
    }
    if (row.owner_session_id !== sessionId) {
      return {
        ...metadata,
        state: "owned_elsewhere",
        ownerHere: false,
        activationId: row.activation_id,
        version: Number(row.version),
        policyVersion: row.policy_version,
        expiresAt: row.expires_at.toISOString(),
        exposureMode,
      };
    }
    return {...mapActivation(row, exposureMode),...metadata};
  }

  async start(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: {
      location: RadarLocationInput;
      radiusBucketKm?: number;
      ttlMinutes?: number;
      consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
    },
  ): Promise<{ statusCode: number; body: RadarActivationDto }> {
    const exposureMode = this.feature.assertAccess(userId);
    this.validateGeographicStart(input);
    const normalized = normalizeStart(input);
    const operation = "radar.activation.start";
    const requestHash = this.privacyRequestHash(operation, {
      radiusBucketKm: normalized.radiusBucketKm,
      ttlMinutes: normalized.ttlMinutes,
      consentPolicyVersion: normalized.consentPolicyVersion,
      consent: input.consent ?? null,
      location: privacyLocationStamp(normalized.location),
    });
    return this.mutations.runIdempotent<RadarActivationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        const row = await this.lockPresence(client, userId);
        if (
          !row ||
          row.activation_id !== body.activationId ||
          row.owner_session_id !== sessionId ||
          !this.isEffectivelyActiveRow(row, new Date())
        ) {
          throw conflict(
            "RADAR_NOT_ACTIVE",
            "Активация Radar недоступна; запросите текущий статус",
          );
        }
      },
      execute: async (client) => {
        const now = new Date();
        const refined = await client.query("SELECT 1 FROM radar_presences WHERE user_id=$1 AND policy_version=$2",[userId,UNIFIED_POLICY]);
        if(refined.rows[0]) throw conflict("RADAR_SESSION_OWNED","Используйте v2 takeover или Stop");
        await this.assertRadarEligible(client, userId, normalized.consentPolicyVersion, input.consent);
        if (exposureMode === "synthetic_demo" && !this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
          const scope = await this.demo.requireDemoCityScope(client, userId);
          this.demo.assertFixMatchesCity(scope.cityId, normalized.location);
          await this.demo.ensureCityCohort(client, userId, scope.cityId, now);
        }
        await this.budgets.consumeStartOrTakeover(client, userId, now);
        await this.budgets.consumeGeo(client, userId, now);
        const existing = await this.lockPresence(client, userId);
        if (existing && this.isEffectivelyActiveRow(existing, now)) {
          if (existing.owner_session_id === sessionId) {
            throw conflict("RADAR_ALREADY_ACTIVE", "Radar уже активен");
          }
          throw conflict(
            "RADAR_OWNED_ELSEWHERE",
            "Radar активен в другой сессии",
          );
        }
        if (existing) {
          await client.query(`DELETE FROM radar_presences WHERE user_id = $1`, [
            userId,
          ]);
        }
        const coarse = await quantizeFix(
          client,
          normalized.location,
          new Date(),
          this.allowedRegionsForUser(userId, exposureMode),
        );
        const row = await this.insertPresence(client, {
          userId,
          sessionId,
          coarse,
          radiusBucketKm: normalized.radiusBucketKm,
          ttlMinutes: normalized.ttlMinutes,
          capturedAt: normalized.location.capturedAt,
          now,
        });
        return { statusCode: 201, body: mapActivation(row, exposureMode) };
      },
    });
  }

  async renew(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: {
      activationId: string;
      expectedVersion: number;
      extendMinutes?: number;
      location?: RadarLocationInput;
    },
  ): Promise<{ statusCode: number; body: RadarActivationDto }> {
    const exposureMode = this.feature.assertAccess(userId);
    const normalized = normalizeRenew(input);
    const operation = "radar.activation.renew";
    const requestHash = this.privacyRequestHash(operation, {
      activationId: normalized.activationId,
      expectedVersion: normalized.expectedVersion,
      extendMinutes: normalized.extendMinutes,
      location: normalized.location
        ? privacyLocationStamp(normalized.location)
        : null,
    });
    return this.mutations.runIdempotent<RadarActivationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          body.activationId,
          new Date(),
        );
      },
      execute: async (client) => {
        const now = new Date();
        await this.assertRadarEligible(client, userId);
        if (exposureMode === "synthetic_demo" && !this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
          const scope = await this.demo.requireDemoCityScope(client, userId);
          if (normalized.location) {
            this.demo.assertFixMatchesCity(scope.cityId, normalized.location);
          }
        }
        const row = await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          normalized.activationId,
          now,
          normalized.expectedVersion,
        );
        const hard = row.hard_expires_at.getTime();
        const extendMs = normalized.extendMinutes * 60 * 1000;
        let nextExpires = Math.min(now.getTime() + extendMs, hard);
        if (nextExpires <= row.expires_at.getTime()) {
          // Still allow no-op renew within hard lifetime only if room remains.
          if (row.expires_at.getTime() >= hard) {
            throw conflict(
              "RADAR_MAX_LIFETIME",
              "Достигнут максимальный срок Radar",
            );
          }
          nextExpires = Math.min(row.expires_at.getTime() + extendMs, hard);
        }
        if (nextExpires <= now.getTime()) {
          throw conflict(
            "RADAR_MAX_LIFETIME",
            "Достигнут максимальный срок Radar",
          );
        }
        let cellI = row.cell_i;
        let cellJ = row.cell_j;
        let locationValidUntil = row.location_valid_until;
        let nextLocationUpdateAt = row.next_location_update_at;
        let coarseLon: number | null = null;
        let coarseLat: number | null = null;
        if (
          locationValidUntil.getTime() <= now.getTime() ||
          normalized.location
        ) {
          if (!normalized.location) {
            throw unprocessable(
              "LOCATION_REQUIRED",
              "Требуется свежая геолокация",
            );
          }
          if (nextLocationUpdateAt.getTime() > now.getTime()) {
            throw problemCooldown(nextLocationUpdateAt, now);
          }
          await this.budgets.consumeGeo(client, userId, now);
          const coarse = await quantizeFix(
            client,
            normalized.location,
            new Date(),
            this.allowedRegionsForUser(userId, exposureMode),
          );
          this.assertPlausibleMove(row, coarse, now);
          cellI = coarse.cellI;
          cellJ = coarse.cellJ;
          coarseLon = coarse.longitude;
          coarseLat = coarse.latitude;
          locationValidUntil = new Date(
            (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ? Date.parse(normalized.location!.capturedAt) : now.getTime()) + RADAR_LOCATION_VALID_MINUTES * 60 * 1000,
          );
          nextLocationUpdateAt = new Date(
            now.getTime() + RADAR_LOCATION_UPDATE_MINUTES * 60 * 1000,
          );
        }
        const updated = await client.query<PresenceRow>(
          coarseLon === null
            ? `UPDATE radar_presences
               SET expires_at = $2,
                   foreground_until = $3,
                   updated_at = $4
               WHERE user_id = $1
               RETURNING ${PRESENCE_SELECT}`
            : `UPDATE radar_presences
               SET expires_at = $2,
                   foreground_until = $3,
                   updated_at = $4,
                   cell_i = $5,
                   cell_j = $6,
                   coarse_center = ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography,
                   location_valid_until = $9,
                   next_location_update_at = $10,
                   version = version + 1
               WHERE user_id = $1
               RETURNING ${PRESENCE_SELECT}`,
          coarseLon === null
            ? [
                userId,
                new Date(nextExpires),
                new Date(now.getTime() + RADAR_FOREGROUND_LEASE_SECONDS * 1000),
                now,
              ]
            : [
                userId,
                new Date(nextExpires),
                new Date(now.getTime() + RADAR_FOREGROUND_LEASE_SECONDS * 1000),
                now,
                cellI,
                cellJ,
                coarseLon,
                coarseLat,
                locationValidUntil,
                nextLocationUpdateAt,
              ],
        );
        return { statusCode: 200, body: mapActivation(updated.rows[0]!, exposureMode) };
      },
    });
  }

  async update(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: {
      activationId: string;
      expectedVersion: number;
      location?: RadarLocationInput;
      radiusBucketKm?: number;
    },
  ): Promise<{ statusCode: number; body: RadarActivationDto }> {
    const exposureMode = this.feature.assertAccess(userId);
    const normalized = normalizeUpdate(input);
    const operation = "radar.activation.update";
    const requestHash = this.privacyRequestHash(operation, {
      activationId: normalized.activationId,
      expectedVersion: normalized.expectedVersion,
      radiusBucketKm: normalized.radiusBucketKm ?? null,
      location: normalized.location
        ? privacyLocationStamp(normalized.location)
        : null,
    });
    return this.mutations.runIdempotent<RadarActivationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          body.activationId,
          new Date(),
        );
      },
      execute: async (client) => {
        const now = new Date();
        await this.assertRadarEligible(client, userId);
        if (exposureMode === "synthetic_demo" && !this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
          const scope = await this.demo.requireDemoCityScope(client, userId);
          if (normalized.location) {
            this.demo.assertFixMatchesCity(scope.cityId, normalized.location);
          }
        }
        const row = await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          normalized.activationId,
          now,
          normalized.expectedVersion,
        );
        let cellI = row.cell_i;
        let cellJ = row.cell_j;
        let coarseLon: number | null = null;
        let coarseLat: number | null = null;
        let locationValidUntil = row.location_valid_until;
        let nextLocationUpdateAt = row.next_location_update_at;
        let radius = row.radius_bucket_km;
        let nextRadiusChangeAt = row.next_radius_change_at;
        let radiusWindowStarted = row.radius_changes_window_started_at;
        let radiusChanges = row.radius_changes_in_window;

        if (normalized.location) {
          if (nextLocationUpdateAt.getTime() > now.getTime()) {
            throw problemCooldown(nextLocationUpdateAt, now);
          }
          await this.budgets.consumeGeo(client, userId, now);
          const coarse = await quantizeFix(
            client,
            normalized.location,
            new Date(),
            this.allowedRegionsForUser(userId, exposureMode),
          );
          this.assertPlausibleMove(row, coarse, now);
          cellI = coarse.cellI;
          cellJ = coarse.cellJ;
          coarseLon = coarse.longitude;
          coarseLat = coarse.latitude;
          locationValidUntil = new Date(
            (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ? Date.parse(normalized.location!.capturedAt) : now.getTime()) + RADAR_LOCATION_VALID_MINUTES * 60 * 1000,
          );
          nextLocationUpdateAt = new Date(
            now.getTime() + RADAR_LOCATION_UPDATE_MINUTES * 60 * 1000,
          );
        }
        if (
          normalized.radiusBucketKm !== undefined &&
          normalized.radiusBucketKm !== row.radius_bucket_km
        ) {
          if (nextRadiusChangeAt.getTime() > now.getTime()) {
            throw problemCooldown(nextRadiusChangeAt, now, "RADIUS_COOLDOWN");
          }
          if (
            now.getTime() - radiusWindowStarted.getTime() >=
            RADAR_RADIUS_CHANGE_WINDOW_MINUTES * 60 * 1000
          ) {
            radiusWindowStarted = now;
            radiusChanges = 0;
          }
          if (radiusChanges >= RADAR_RADIUS_CHANGES_PER_WINDOW) {
            throw problemCooldown(
              new Date(
                radiusWindowStarted.getTime() +
                  RADAR_RADIUS_CHANGE_WINDOW_MINUTES * 60 * 1000,
              ),
              now,
              "RADIUS_COOLDOWN",
            );
          }
          radius = normalized.radiusBucketKm;
          radiusChanges += 1;
          nextRadiusChangeAt = new Date(
            now.getTime() + RADAR_RADIUS_CHANGE_COOLDOWN_MINUTES * 60 * 1000,
          );
        }
        if (
          normalized.location === undefined &&
          normalized.radiusBucketKm === undefined
        ) {
          throw badRequest("RADAR_UPDATE_EMPTY", "Нет изменений для Radar");
        }
        const updated = await client.query<PresenceRow>(
          `UPDATE radar_presences
           SET cell_i = $2,
               cell_j = $3,
               coarse_center = CASE
                 WHEN $4::float8 IS NULL THEN coarse_center
                 ELSE ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326)::geography
               END,
               location_valid_until = $6,
               next_location_update_at = $7,
               radius_bucket_km = $8,
               next_radius_change_at = $9,
               radius_changes_window_started_at = $10,
               radius_changes_in_window = $11,
               version = version + 1,
               updated_at = $12
           WHERE user_id = $1
           RETURNING ${PRESENCE_SELECT}`,
          [
            userId,
            cellI,
            cellJ,
            coarseLon,
            coarseLat,
            locationValidUntil,
            nextLocationUpdateAt,
            radius,
            nextRadiusChangeAt,
            radiusWindowStarted,
            radiusChanges,
            now,
          ],
        );
        return {
          statusCode: 200,
          body: mapActivation(updated.rows[0]!, exposureMode),
        };
      },
    });
  }

  async heartbeat(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: { activationId: string },
  ): Promise<{ statusCode: number; body: RadarActivationDto }> {
    const exposureMode = this.feature.assertAccess(userId);
    const activationId = requireUuid(input.activationId, "activationId");
    const operation = "radar.activation.heartbeat";
    const requestHash = this.privacyRequestHash(operation, { activationId });
    return this.mutations.runIdempotent<RadarActivationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          body.activationId,
          new Date(),
        );
      },
      execute: async (client) => {
        const now = new Date();
        await this.assertRadarEligible(client, userId);
        const row = await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          activationId,
          now,
        );
        const updated = await client.query<PresenceRow>(
          `UPDATE radar_presences
           SET foreground_until = $2, updated_at = $3
           WHERE user_id = $1
           RETURNING ${PRESENCE_SELECT}`,
          [
            userId,
            new Date(now.getTime() + RADAR_FOREGROUND_LEASE_SECONDS * 1000),
            now,
          ],
        );
        // Heartbeat must not extend expires_at / location_valid_until / version.
        void row;
        return { statusCode: 200, body: mapActivation(updated.rows[0]!, exposureMode) };
      },
    });
  }

  async stop(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    activationIdHeader: string | undefined,
  ): Promise<{ statusCode: number; body: { ok: true } }> {
    // Disabling availability must never prevent an authenticated exact-generation stop.
    const activationId = requireUuid(activationIdHeader, "X-Radar-Activation-Id");
    const operation = "radar.activation.stop";
    const requestHash = this.privacyRequestHash(operation, { activationId });
    return this.mutations.runIdempotent<{ ok: true }>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => {
        // Stop replay is idempotent even if generation already gone.
      },
      execute: async (client) => {
        const row = await this.lockPresence(client, userId);
        if (!row || row.activation_id !== activationId) {
          return { statusCode: 204, body: { ok: true } };
        }
        // Exact generation only; stale stop must not kill a newer takeover.
        await client.query(
          `DELETE FROM radar_presences
           WHERE user_id = $1 AND activation_id = $2`,
          [userId, activationId],
        );
        return { statusCode: 204, body: { ok: true } };
      },
    });
  }

  async takeover(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: {
      activationId: string;
      expectedVersion: number;
      confirm: boolean;
      location: RadarLocationInput;
      radiusBucketKm?: number;
      ttlMinutes?: number;
      consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
    },
  ): Promise<{ statusCode: number; body: RadarActivationDto }> {
    const exposureMode = this.feature.assertAccess(userId);
    this.validateGeographicStart(input);
    const normalized = normalizeTakeover(input);
    const operation = "radar.activation.takeover";
    const requestHash = this.privacyRequestHash(operation, {
      activationId: normalized.activationId,
      expectedVersion: normalized.expectedVersion,
      confirm: true,
      radiusBucketKm: normalized.radiusBucketKm,
      ttlMinutes: normalized.ttlMinutes,
      consentPolicyVersion: normalized.consentPolicyVersion,
      consent: input.consent ?? null,
      location: privacyLocationStamp(normalized.location),
    });
    return this.mutations.runIdempotent<RadarActivationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.assertOwnedActive(
          client,
          userId,
          sessionId,
          body.activationId,
          new Date(),
        );
      },
      execute: async (client) => {
        const now = new Date();
        const refined = await client.query("SELECT 1 FROM radar_presences WHERE user_id=$1 AND policy_version=$2",[userId,UNIFIED_POLICY]);
        if(refined.rows[0]) throw unprocessable("RADAR_CONSENT_VERSION_REQUIRED","Требуется v2 takeover Radar");
        await this.assertRadarEligible(
          client,
          userId,
          normalized.consentPolicyVersion,
          input.consent,
        );
        if (exposureMode === "synthetic_demo" && !this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
          const scope = await this.demo.requireDemoCityScope(client, userId);
          this.demo.assertFixMatchesCity(scope.cityId, normalized.location);
          await this.demo.ensureCityCohort(client, userId, scope.cityId, now);
        }
        await this.budgets.consumeStartOrTakeover(client, userId, now);
        await this.budgets.consumeGeo(client, userId, now);
        const existing = await this.lockPresence(client, userId);
        if (!existing || !this.isEffectivelyActiveRow(existing, now)) {
          throw conflict("RADAR_NOT_ACTIVE", "Нет активной сессии Radar");
        }
        if (
          existing.activation_id !== normalized.activationId ||
          Number(existing.version) !== normalized.expectedVersion
        ) {
          throw conflict(
            "RADAR_VERSION_CONFLICT",
            "Конфликт версии Radar",
          );
        }
        const coarse = await quantizeFix(
            client,
            normalized.location,
            new Date(),
            this.allowedRegionsForUser(userId, exposureMode),
          );
        await client.query(`DELETE FROM radar_presences WHERE user_id = $1`, [
          userId,
        ]);
        const row = await this.insertPresence(client, {
          userId,
          sessionId,
          coarse,
          radiusBucketKm: normalized.radiusBucketKm,
          ttlMinutes: normalized.ttlMinutes,
          capturedAt: normalized.location.capturedAt,
          now,
        });
        return { statusCode: 200, body: mapActivation(row, exposureMode) };
      },
    });
  }

  async nearby(
    userId: string,
    sessionId: string,
    activationIdHeader: string | undefined,
    query: Record<string, unknown>,
  ): Promise<NearbyDto> {
    if (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) throw problem(426,"RADAR_CLIENT_UPDATE_REQUIRED","Обновите клиент Radar");
    const exposureMode = this.feature.assertAccess(userId);
    if (Object.keys(query).length > 0) {
      throw badRequest(
        "RADAR_NEARBY_FILTER_FORBIDDEN",
        "Nearby не принимает произвольные фильтры",
      );
    }
    const activationId = requireUuid(
      activationIdHeader,
      "X-Radar-Activation-Id",
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.actorFence.assertActiveConsumerInTransaction(client, {
        actorId: userId,
        sessionId,
      });
      const now = new Date();
      await this.budgets.consumeNearby(client, userId, now);
      await this.assertRadarEligible(client, userId);
      if (exposureMode === "synthetic_demo") {
        const scope = await this.demo.requireDemoCityScope(client, userId);
        await this.demo.ensureCityCohort(client, userId, scope.cityId, now);
      }
      const viewer = await this.assertOwnedActive(
        client,
        userId,
        sessionId,
        activationId,
        now,
      );
      const candidates = await selectEligibleNearbyCandidates(
        client,
        userId,
        now,
        this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
      );
      await client.query("COMMIT");

      const ranked = rankCurrentCohort(
        this.env.AUTH_PEPPER,
        userId,
        viewer.radius_bucket_km,
        now,
        candidates,
      );
      if (ranked.length === 0) {
        return emptyNearby(viewer.radius_bucket_km, exposureMode);
      }
      const epoch = orderingEpoch(now);

      const contactable = await this.profiles.contactableTargets(client, userId, ranked.map(row => row.user_id));
      const items: NearbyItemDto[] = [];
      for (const row of ranked) {
        const band = bandForDistance(row.dist_m, viewer.radius_bucket_km)!;
        items.push({
          resultId: resultId(this.env.AUTH_PEPPER, userId, row.user_id, epoch),
          resultRef: signResultRef(this.env.AUTH_PEPPER, {
            viewerUserId: userId,
            viewerSessionId: sessionId,
            viewerActivationId: viewer.activation_id,
            viewerVersion: Number(viewer.version),
            targetUserId: row.user_id,
            targetActivationId: row.activation_id,
            targetVersion: Number(row.version),
            epoch,
            now,
          }),
          player: {
            canRequestContact: contactable.has(row.user_id),
            publicPlayerId: row.public_player_id,
            displayName: safePublicDisplayName(row.display_name),
            avatar: await avatarForUser(client, row.user_id),
            level:
              row.level_scale_id &&
              row.level_scale_version !== null &&
              row.level_id
                ? {
                    scaleId: row.level_scale_id,
                    scaleVersion: row.level_scale_version,
                    levelId: row.level_id,
                    provenance: "self_declared",
                  }
                : null,
            trainer: row.trainer,
          },
          proximityBand: band,
          displaySlot: displaySlot(
            this.env.AUTH_PEPPER,
            userId,
            row.user_id,
            now,
          ),
        });
      }
      return {
        state: "results",
        policyVersion: this.policyVersion,
        radiusBucketKm: viewer.radius_bucket_km,
        refreshAfterSeconds: RADAR_REFRESH_AFTER_SECONDS,
        displayTtlSeconds: RADAR_DISPLAY_TTL_SECONDS,
        items,
        exposureMode,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async preview(
    userId: string,
    sessionId: string,
    input: { resultRef?: string },
  ): Promise<PreviewDto> {
    const exposureMode = this.feature.assertAccess(userId);
    void exposureMode;
    if (!input.resultRef || typeof input.resultRef !== "string") {
      if (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) throw notFound("RESOURCE_UNAVAILABLE","Результат Radar недоступен");
      throw badRequest("RESULT_REF_INVALID", "Некорректный resultRef");
    }
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.actorFence.assertActiveConsumerInTransaction(client, {
        actorId: userId,
        sessionId,
      });
      await this.budgets.consumePreview(client, userId, now);
      if (!this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED && !input.resultRef.startsWith("u1.")) await this.assertRadarEligible(client, userId);
      const unified = input.resultRef.startsWith("u1.");
      const revision = unified ? (await client.query<{ revision: string }>(
        "SELECT revision FROM players_query_revision WHERE singleton",
      )).rows[0]?.revision : null;
      const redeemed = await this.proofs.redeem(client, {
        actorId: userId,
        sessionId,
        proof: input.resultRef,
      });
      const contactable = await this.profiles.contactableTargets(client, userId, [redeemed.targetUserId]);
      const avatar = await avatarForUser(client, redeemed.targetUserId);
      const response: PreviewDto = {
        player: {
          canRequestContact: contactable.has(redeemed.targetUserId),
          publicPlayerId: redeemed.publicPlayerId,
          displayName: safePublicDisplayName(redeemed.displayName),
          avatar,
          level:
            redeemed.levelScaleId &&
            redeemed.levelScaleVersion !== null &&
            redeemed.levelId
              ? {
                  scaleId: redeemed.levelScaleId,
                  scaleVersion: redeemed.levelScaleVersion,
                  levelId: redeemed.levelId,
                  provenance: "self_declared",
                }
              : null,
          trainer: redeemed.trainer,
        },
        proximityBand: redeemed.proximityBand,
        ...(redeemed.displayLocation ? { displayLocation: redeemed.displayLocation } : {}),
        ...(redeemed.radar ? { radar: redeemed.radar } : {}),
        ...(unified ? { upcomingGames: await readRadarPlayerGames(client, userId, redeemed.targetUserId, this.env) } : {}),
      };
      if (unified) {
        // Final non-geographic visibility fence, after every Game-lock wait.
        const final = await client.query<{ revision: string }>(
          "SELECT revision FROM players_query_revision WHERE singleton FOR SHARE",
        );
        if (!revision || final.rows[0]?.revision !== revision)
          throw conflict("PLAYERS_QUERY_STALE", "Каталог изменился, обновите запрос");
        await this.actorFence.assertActiveConsumerInTransaction(client, { actorId: userId, sessionId });
      }
      if(redeemed.radar) await this.proofs.assertFinalGeographicProof(client,{actorId:userId,sessionId,targetUserId:redeemed.targetUserId,discoveryProof:input.resultRef});
      if (response.upcomingGames) response.upcomingGames = response.upcomingGames.filter(game => Date.parse(game.startsAt) > Date.now());
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Best-effort purge for logout/revoke (same account session). */
  async purgeOwnedSession(userId: string, sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM radar_presences
       WHERE user_id = $1 AND owner_session_id = $2`,
      [userId, sessionId],
    );
  }

  /** Called when Radar consent or social eligibility is revoked. */
  async purgeUser(userId: string, client?: PoolClient): Promise<void> {
    const q = client ?? this.pool;
    await q.query(`DELETE FROM radar_presences WHERE user_id = $1`, [userId]);
  }

  private validateGeographicStart(input: { location: RadarLocationInput; consentPolicyVersion?: string; consent?: unknown }) {
    if (!this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) return;
    if (input.consentPolicyVersion!==GEO_POLICY) throw unprocessable("CONSENT_POLICY_VERSION_INVALID","Требуется текущая версия согласия Radar");
    const schema = "confirm" in input ? geographicTakeoverSchema : geographicStartSchema;
    if (!schema.safeParse(input).success) throw unprocessable("RADAR_ACTIVATION_INVALID","Некорректное включение географического Radar");
  }

  private privacyRequestHash(operation: string, payload: unknown): string {
    return hmacSha256Hex(
      this.env.AUTH_PEPPER,
      `radar-idem:${operation}:${stableStringify(payload)}`,
    );
  }

  private async lockPresence(
    client: PoolClient,
    userId: string,
  ): Promise<PresenceRow | null> {
    const result = await client.query<PresenceRow>(
      `SELECT ${PRESENCE_SELECT}
       FROM radar_presences
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private isOwnerGlobalDebugUser(userId: string): boolean {
    return this.env.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS.includes(userId);
  }

  private allowedRegionsForUser(
    userId: string,
    exposureMode: RadarExposureMode,
  ) {
    if (exposureMode === "live" && this.isOwnerGlobalDebugUser(userId)) {
      return OWNER_GLOBAL_DEBUG_RADAR_REGIONS;
    }
    return this.demo.allowedRegionsForMode(exposureMode);
  }

  private isEffectivelyActiveRow(row: PresenceRow, now: Date): boolean {
    return (
      row.expires_at.getTime() > now.getTime() &&
      row.foreground_until.getTime() > now.getTime() &&
      row.location_valid_until.getTime() > now.getTime() &&
      (row.policy_version === this.policyVersion || row.policy_version === UNIFIED_POLICY) &&
      isAdmittedRadarRegionId(row.region_id) &&
      (row.region_id !== RADAR_REGION_OWNER_GLOBAL_ID ||
        this.isOwnerGlobalDebugUser(row.user_id))
    );
  }

  private async assertOwnedActive(
    client: PoolClient,
    userId: string,
    sessionId: string,
    activationId: string,
    now: Date,
    expectedVersion?: number,
  ): Promise<PresenceRow> {
    const row = await this.lockPresence(client, userId);
    if(row?.policy_version === UNIFIED_POLICY) throw unprocessable("RADAR_CONSENT_VERSION_REQUIRED","Требуется v2 команда Radar");
    if (!row || !this.isEffectivelyActiveRow(row, new Date())) {
      if (row) {
        await client.query(`DELETE FROM radar_presences WHERE user_id = $1`, [
          userId,
        ]);
      }
      throw conflict("RADAR_NOT_ACTIVE", "Radar не активен");
    }
    if (row.activation_id !== activationId) {
      throw conflict("RADAR_VERSION_CONFLICT", "Конфликт поколения Radar");
    }
    if (row.owner_session_id !== sessionId) {
      throw forbidden("RADAR_NOT_OWNER", "Radar принадлежит другой сессии");
    }
    if (
      expectedVersion !== undefined &&
      Number(row.version) !== expectedVersion
    ) {
      throw conflict("RADAR_VERSION_CONFLICT", "Конфликт версии Radar");
    }
    return row;
  }

  private async assertRadarEligible(
    client: PoolClient,
    userId: string,
    consentPolicyVersion?: string,
    consent?: unknown,
  ): Promise<void> {
    await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, userId, ["social.radar", "profile.public"]);
    const result = await client.query<{
      radar_consented: boolean;
      radar_consent_policy_version: string | null;
      social_eligible: boolean;
      display_name: string;
      directory_visible: boolean;
    }>(
      `SELECT radar_consented, radar_consent_policy_version, social_eligible, display_name,
              directory_visible
       FROM player_social_profiles
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    let row = result.rows[0];
    if (!row) {
      row = await this.bootstrapMinimalRadarProfile(client, userId);
    } else if (row.display_name.trim().length < 1) {
      const seeded = await this.seedRadarProfileDisplayName(client, userId);
      if (seeded) row = { ...row, display_name: seeded };
    }
    if (!row || !row.social_eligible) {
      throw forbidden("SOCIAL_INELIGIBLE", "Социальный профиль недоступен");
    }
    if (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED) {
      await ensureGeographicConsent(client,userId,consentPolicyVersion ?? this.policyVersion,consent);
      if (!row.display_name.trim()) throw unprocessable("RADAR_PROFILE_INCOMPLETE","Для Radar нужен displayName");
      return;
    }
    if (!row.radar_consented) {
      throw forbidden("RADAR_CONSENT_REQUIRED", "Требуется согласие Radar");
    }
    const policy =
      consentPolicyVersion ??
      row.radar_consent_policy_version ??
      RADAR_CONSENT_POLICY_VERSION;
    if (
      policy !== this.policyVersion ||
      row.radar_consent_policy_version !== this.policyVersion
    ) {
      throw unprocessable(
        "CONSENT_POLICY_VERSION_INVALID",
        "Некорректная версия согласия Radar",
      );
    }
    if (row.display_name.trim().length < 1) {
      throw unprocessable(
        "RADAR_PROFILE_INCOMPLETE",
        "Для Radar нужен displayName",
      );
    }
  }

  private async bootstrapMinimalRadarProfile(
    client: PoolClient,
    userId: string,
  ): Promise<{
    radar_consented: boolean;
    radar_consent_policy_version: string | null;
    social_eligible: boolean;
    display_name: string;
    directory_visible: boolean;
  } | undefined> {
    const name = await this.accountDisplayName(client, userId);
    if (!name) return undefined;
    const inserted = await client.query<{
      radar_consented: boolean;
      radar_consent_policy_version: string | null;
      social_eligible: boolean;
      display_name: string;
      directory_visible: boolean;
    }>(
      `INSERT INTO player_social_profiles (
         user_id, display_name, contact_policy, directory_visible,
         radar_consented, social_eligible, version
       ) VALUES ($1, $2, 'closed', false, false, true, 1)
       RETURNING radar_consented, radar_consent_policy_version, social_eligible,
                 display_name, directory_visible`,
      [userId, name],
    );
    return inserted.rows[0];
  }

  private async seedRadarProfileDisplayName(
    client: PoolClient,
    userId: string,
  ): Promise<string | undefined> {
    const name = await this.accountDisplayName(client, userId);
    if (!name) return undefined;
    const updated = await client.query<{ display_name: string }>(
      `UPDATE player_social_profiles
       SET display_name = $2, version = version + 1, updated_at = now()
       WHERE user_id = $1
         AND btrim(display_name) = ''
         AND directory_visible = false
       RETURNING display_name`,
      [userId, name],
    );
    return updated.rows[0]?.display_name;
  }

  private async accountDisplayName(
    client: PoolClient,
    userId: string,
  ): Promise<string> {
    const result = await client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.display_name?.trim() ?? "";
  }

  private assertPlausibleMove(
    row: PresenceRow,
    coarse: { cellI: number; cellJ: number },
    now: Date,
  ): void {
    const distM = coarseCenterDistanceMeters(
      { cellI: row.cell_i, cellJ: row.cell_j },
      coarse,
    );
    const approxLastFixAt = new Date(
      row.location_valid_until.getTime() -
        RADAR_LOCATION_VALID_MINUTES * 60 * 1000,
    );
    const sinceLocH = Math.max(
      (now.getTime() - approxLastFixAt.getTime()) / 3_600_000,
      1 / 3600,
    );
    const speed = distM / 1000 / sinceLocH;
    if (speed > RADAR_MAX_COARSE_SPEED_KMH) {
      throw unprocessable(
        "LOCATION_IMPLAUSIBLE",
        "Неправдоподобное перемещение",
      );
    }
  }

  private async insertPresence(
    client: PoolClient,
    input: {
      userId: string;
      sessionId: string;
      coarse: {
        cellI: number;
        cellJ: number;
        longitude: number;
        latitude: number;
        regionId: string;
      };
      radiusBucketKm: RadarRadiusBucketKm;
      ttlMinutes: number;
      capturedAt?: string;
      now: Date;
    },
  ): Promise<PresenceRow> {
    const startedAt = input.now;
    const hardExpiresAt = new Date(
      startedAt.getTime() + RADAR_HARD_LIFETIME_MINUTES * 60 * 1000,
    );
    const expiresAt = new Date(
      Math.min(
        startedAt.getTime() + input.ttlMinutes * 60 * 1000,
        hardExpiresAt.getTime(),
      ),
    );
    const foregroundUntil = new Date(
      startedAt.getTime() + RADAR_FOREGROUND_LEASE_SECONDS * 1000,
    );
    const locationValidUntil = new Date(
      (this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED && input.capturedAt ? Date.parse(input.capturedAt) : startedAt.getTime()) + RADAR_LOCATION_VALID_MINUTES * 60 * 1000,
    );
    const nextLocationUpdateAt = new Date(
      startedAt.getTime() + RADAR_LOCATION_UPDATE_MINUTES * 60 * 1000,
    );
    const nextRadiusChangeAt = startedAt;
    const inserted = await client.query<PresenceRow>(
      `INSERT INTO radar_presences (
         user_id, activation_id, owner_session_id, version, policy_version, region_id,
         started_at, expires_at, hard_expires_at, foreground_until, location_valid_until,
         next_location_update_at, next_radius_change_at, radius_changes_window_started_at,
         radius_changes_in_window, cell_i, cell_j, coarse_center, radius_bucket_km, consent_evidence_id
       ) VALUES (
         $1, $2, $3, 1, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $6,
         0, $13, $14,
         ST_SetSRID(ST_MakePoint($15::float8, $16::float8), 4326)::geography,
         $17, (SELECT radar_consent_evidence_id FROM player_social_profiles WHERE user_id=$1)
       )
       RETURNING ${PRESENCE_SELECT}`,
      [
        input.userId,
        randomUUID(),
        input.sessionId,
        this.policyVersion,
        input.coarse.regionId,
        startedAt,
        expiresAt,
        hardExpiresAt,
        foregroundUntil,
        locationValidUntil,
        nextLocationUpdateAt,
        nextRadiusChangeAt,
        input.coarse.cellI,
        input.coarse.cellJ,
        input.coarse.longitude,
        input.coarse.latitude,
        input.radiusBucketKm,
      ],
    );
    return inserted.rows[0]!;
  }
}

function mapActivation(
  row: PresenceRow,
  exposureMode: RadarExposureMode,
): RadarActivationDto {
  return {
    state: "active",
    activationId: row.activation_id,
    version: Number(row.version),
    ownerHere: true,
    policyVersion: row.policy_version,
    regionId: row.region_id,
    radiusBucketKm: row.radius_bucket_km,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    hardExpiresAt: row.hard_expires_at.toISOString(),
    foregroundUntil: row.foreground_until.toISOString(),
    locationValidUntil: row.location_valid_until.toISOString(),
    nextLocationUpdateAt: row.next_location_update_at.toISOString(),
    nextRadiusChangeAt: row.next_radius_change_at.toISOString(),
    exposureMode,
  };
}

function emptyNearby(
  radiusBucketKm: RadarRadiusBucketKm,
  exposureMode: RadarExposureMode,
): NearbyDto {
  return {
    state: "empty",
    policyVersion: RADAR_POLICY_VERSION,
    radiusBucketKm,
    refreshAfterSeconds: RADAR_REFRESH_AFTER_SECONDS,
    displayTtlSeconds: RADAR_DISPLAY_TTL_SECONDS,
    items: [],
    exposureMode,
  };
}

function problemCooldown(
  until: Date,
  now: Date,
  code: "LOCATION_COOLDOWN" | "RADIUS_COOLDOWN" = "LOCATION_COOLDOWN",
) {
  const retry = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
  return problem(
    HttpStatus.TOO_MANY_REQUESTS,
    code,
    "Подождите перед следующим изменением Radar",
    undefined,
    retry,
  );
}

function requireUuid(value: string | undefined, field: string): string {
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw badRequest("RADAR_ACTIVATION_ID_INVALID", `Некорректный ${field}`);
  }
  return value;
}

function normalizeRadius(value: unknown): RadarRadiusBucketKm {
  const n = value === undefined ? RADAR_DEFAULT_RADIUS_KM : Number(value);
  if (
    !RADAR_RADIUS_BUCKETS_KM.includes(n as RadarRadiusBucketKm)
  ) {
    throw unprocessable("RADIUS_BUCKET_INVALID", "Некорректный радиус Radar");
  }
  return n as RadarRadiusBucketKm;
}

function normalizeTtl(value: unknown): number {
  const n = value === undefined ? RADAR_TTL_DEFAULT_MINUTES : Number(value);
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    n > RADAR_TTL_MAX_MINUTES
  ) {
    throw unprocessable("TTL_INVALID", "Некорректный TTL Radar");
  }
  return n;
}

function normalizeLocation(raw: unknown): RadarLocationInput {
  if (!raw || typeof raw !== "object") {
    throw badRequest("LOCATION_REQUIRED", "Требуется геолокация");
  }
  const o = raw as Record<string, unknown>;
  return {
    latitude: Number(o.latitude),
    longitude: Number(o.longitude),
    accuracyMeters: Number(o.accuracyMeters),
    capturedAt: String(o.capturedAt ?? ""),
  };
}

function normalizeStart(input: {
  location: RadarLocationInput;
  radiusBucketKm?: number;
  ttlMinutes?: number;
  consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
}) {
  return {
    location: normalizeLocation(input.location),
    radiusBucketKm: normalizeRadius(input.radiusBucketKm),
    ttlMinutes: normalizeTtl(input.ttlMinutes),
    consentPolicyVersion:
      input.consentPolicyVersion ?? RADAR_POLICY_VERSION,
  };
}

function normalizeRenew(input: {
  activationId: string;
  expectedVersion: number;
  extendMinutes?: number;
  location?: RadarLocationInput;
}) {
  return {
    activationId: requireUuid(input.activationId, "activationId"),
    expectedVersion: requireVersion(input.expectedVersion),
    extendMinutes: normalizeTtl(input.extendMinutes ?? RADAR_TTL_DEFAULT_MINUTES),
    location: input.location ? normalizeLocation(input.location) : undefined,
  };
}

function normalizeUpdate(input: {
  activationId: string;
  expectedVersion: number;
  location?: RadarLocationInput;
  radiusBucketKm?: number;
}) {
  return {
    activationId: requireUuid(input.activationId, "activationId"),
    expectedVersion: requireVersion(input.expectedVersion),
    location: input.location ? normalizeLocation(input.location) : undefined,
    radiusBucketKm:
      input.radiusBucketKm === undefined
        ? undefined
        : normalizeRadius(input.radiusBucketKm),
  };
}

function normalizeTakeover(input: {
  activationId: string;
  expectedVersion: number;
  confirm: boolean;
  location: RadarLocationInput;
  radiusBucketKm?: number;
  ttlMinutes?: number;
  consentPolicyVersion?: string;
      consent?: { disclosureId: string; accepted: true };
}) {
  if (input.confirm !== true) {
    throw badRequest("TAKEOVER_CONFIRM_REQUIRED", "Требуется подтверждение takeover");
  }
  return {
    activationId: requireUuid(input.activationId, "activationId"),
    expectedVersion: requireVersion(input.expectedVersion),
    location: normalizeLocation(input.location),
    radiusBucketKm: normalizeRadius(input.radiusBucketKm),
    ttlMinutes: normalizeTtl(input.ttlMinutes),
    consentPolicyVersion:
      input.consentPolicyVersion ?? RADAR_POLICY_VERSION,
  };
}

function requireVersion(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw badRequest("VERSION_INVALID", "Некорректная версия");
  }
  return n;
}

function privacyLocationStamp(location: RadarLocationInput): string {
  // Hash-only stamp for idempotency collision; never persist raw coords.
  return hmacSha256Hex(
    "radar-loc-stamp",
    `${location.capturedAt}:${location.accuracyMeters}:${location.latitude}:${location.longitude}`,
  ).slice(0, 32);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
