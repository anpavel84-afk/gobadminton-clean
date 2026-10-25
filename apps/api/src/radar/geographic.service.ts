import { devMapPreview } from "./dev-map-preview";
import { devMoscowTestAllowed, devMoscowTestLocation } from "./dev-moscow-test";
import { UNIFIED_WIRE,UNIFIED_POLICY,UNIFIED_DISCLOSURE_ID,UNIFIED_DISCLOSURE_HASH,UNIFIED_DISCLOSURE_TEXT } from "./unified-contract";
import { Inject, Injectable } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import type { AppEnv } from "../config/env";
import {
  forbidden,
  notFound,
  unauthorized,
  serviceUnavailable,
  unprocessable,
} from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { safeProviderAvatar } from "../profiles/avatar-presentation";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
import { DEMO_SPB_CITY_ID } from "../database/demo-ids";
import { quantizeFix } from "./coarse-location";
import { RadarFeatureService } from "./radar-feature";
import { RadarBudgetService } from "./radar-budget.service";
import { orderingEpoch } from "./result-ref";
import {
  GEO_CONTRACT,
  GEO_POLICY,
  GEO_DISCLOSURE_ID,
  GEO_DISCLOSURE_TEXT,
  GEO_DISCLOSURE_HASH,
  geographicCity,
  querySchema,
  privateOriginSchema,
  geographicPepper,
  parseGeographicToken,
  signGeographicToken,
  displayLocation,
  type PrivateOrigin,
  type GeographicProof,
} from "./geographic-contract";
import { geographicCandidates } from "./geographic-selection";

@Injectable()
export class GeographicRadarService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly feature: RadarFeatureService,
    private readonly fence: ActorFenceService,
    private readonly budgets: RadarBudgetService,
  ) {}

  assertEnabled(userId: string) {
    const mode = this.feature.assertAccess(userId);
    if (!this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED)
      throw notFound(
        "RADAR_GEOGRAPHIC_DISABLED",
        "Географический Radar недоступен",
      );
    return mode;
  }

  async config(userId: string, sessionId: string) {
    const mode = this.feature.assertAccess(userId);
    return this.read(userId, sessionId, async (client) => {
      await this.budgets.consumeConfig(client, userId, new Date());
      const cityIds =
        mode === "live" ? [MOSCOW_CITY_ID] : [MOSCOW_CITY_ID, DEMO_SPB_CITY_ID];
      return {
        ...(devMoscowTestAllowed(this.env, userId) && mode === "live" ? { devMoscowTest: devMoscowTestLocation } : {}),
        contractVersion: GEO_CONTRACT,
        policyVersion: GEO_POLICY,
        enabled: this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED,
        exposureMode: mode,
        unifiedDirectory: {enabled:this.env.SOCIAL_RADAR_UNIFIED_ENABLED,contractVersion:UNIFIED_WIRE,pageLimit:50,mapPageLimit:100,models:["regional_grid_100m_v1","regional_grid_1000m_v1"],policyVersion:UNIFIED_POLICY,disclosure:{id:UNIFIED_DISCLOSURE_ID,sha256:UNIFIED_DISCLOSURE_HASH,text:UNIFIED_DISCLOSURE_TEXT,locale:"ru"}},
        publishingV2: {enabled:this.env.SOCIAL_RADAR_PUBLISHING_V2_ENABLED},
        geographicV1: {enabled:this.env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED},
        capabilities: {
          offViewer: true,
          sparseK: 1,
          resultCap: 20,
          origins: [
            "none",
            "current_activation",
            "foreground_fix",
            "reference",
          ],
        },
        disclosure: {
          id: GEO_DISCLOSURE_ID,
          locale: "ru",
          sha256: GEO_DISCLOSURE_HASH,
          text: GEO_DISCLOSURE_TEXT,
        },
        cities: cityIds.map((cityId) => ({
          cityId,
          regionId: geographicCity(cityId, mode).regionId,
          map: devMapPreview(this.env, cityId),
        })),
      };
    });
  }

  async query(userId: string, sessionId: string, raw: unknown) {
    const mode = this.assertEnabled(userId);
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success)
      throw unprocessable("RADAR_QUERY_INVALID", "Некорректный запрос Radar");
    const input = parsed.data;
    const region = geographicCity(input.cityId, mode);
    return this.read(userId, sessionId, async (client, sessionExpires) => {
      await this.budgets.consumeNearby(client, userId, new Date());
      await this.budgets.consumeQueryContext(
        client,
        userId,
        this.hash(`city:${input.cityId}`),
        input.radiusBucketKm ?? null,
        new Date(),
      );
      let origin: PrivateOrigin | null = null;
      const binding = {
        v: 1 as const,
        audience: "radar-query-origin-v1" as const,
        viewerUserId: userId,
        viewerSessionId: sessionId,
        cityId: input.cityId,
        regionId: region.regionId,
        exposureMode: mode,
        model: "regional_grid_center_v1" as const,
      };
      if (input.origin.kind === "foreground_fix") {
        await this.budgets.consumeGeo(client, userId, new Date());
        const coarse = await quantizeFix(
          client,
          input.origin.location,
          new Date(),
          [region],
        );
        origin = {
          ...binding,
          latitude: coarse.latitude,
          longitude: coarse.longitude,
          expiresAt: Math.min(
            Date.parse(input.origin.location.capturedAt) + 360_000,
            sessionExpires.getTime(),
          ),
        };
      } else if (input.origin.kind === "current_activation") {
        const r = await client.query<{
          latitude: number;
          longitude: number;
          version: string;
          expires: Date;
        }>(
          `SELECT ST_Y(coarse_center::geometry) AS latitude, ST_X(coarse_center::geometry) AS longitude,version,
             LEAST(expires_at,hard_expires_at,foreground_until,location_valid_until) AS expires
           FROM radar_presences WHERE user_id=$1 AND owner_session_id=$2 AND activation_id=$3 AND region_id=$4 AND policy_version=$5`,
          [
            userId,
            sessionId,
            input.origin.activationId,
            region.regionId,
            GEO_POLICY,
          ],
        );
        const row = r.rows[0];
        if (!row || row.expires.getTime() <= Date.now())
          throw unprocessable(
            "RADAR_QUERY_ORIGIN_EXPIRED",
            "Источник местоположения устарел",
          );
        origin = {
          ...binding,
          latitude: row.latitude,
          longitude: row.longitude,
          expiresAt: Math.min(row.expires.getTime(), sessionExpires.getTime()),
          activationId: input.origin.activationId,
          activationVersion: Number(row.version),
        };
      } else if (input.origin.kind === "reference") {
        origin = parseGeographicToken(
          geographicPepper(this.env),
          "origin",
          input.origin.originRef,
          privateOriginSchema,
        );
        if (
          !origin ||
          origin.viewerUserId !== userId ||
          origin.viewerSessionId !== sessionId ||
          origin.cityId !== input.cityId ||
          origin.regionId !== region.regionId ||
          origin.exposureMode !== mode
        )
          throw unprocessable(
            "RADAR_QUERY_ORIGIN_INVALID",
            "Некорректный источник местоположения",
          );
      }
      if (origin) await assertCurrentOrigin(client, origin);
      const generatedAt = new Date();
      const rows = await geographicCandidates(client, {
        restrictionsEnabled: this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
        viewerId: userId,
        regionId: region.regionId,
        mode,
        scope: input.scope,
        origin,
        radius: input.radiusBucketKm ?? null,
        rankSeed: this.hash(`rank:${userId}:${orderingEpoch(generatedAt)}`),
      });
      const queryId = randomUUID();
      const validUntil = Math.min(
        generatedAt.getTime() + 45_000,
        sessionExpires.getTime(),
        origin?.expiresAt ?? Infinity,
        ...rows.map((r) => r.valid_until.getTime()),
      );
      const items = rows.map((row) => {
        const proof: GeographicProof = {
          v: 2,
          audience: GEO_CONTRACT,
          policyVersion: GEO_POLICY,
          viewerUserId: userId,
          viewerSessionId: sessionId,
          queryId,
          cityId: input.cityId,
          regionId: region.regionId,
          exposureMode: mode,
          scope: input.scope,
          origin,
          radiusBucketKm: input.radiusBucketKm ?? null,
          targetUserId: row.user_id,
          targetPublicPlayerId: row.public_player_id,
          targetActivationId: row.activation_id,
          targetVersion: Number(row.version),
          issuedAt: generatedAt.getTime(),
          expiresAt: Math.min(
            generatedAt.getTime() + 60_000,
            sessionExpires.getTime(),
            origin?.expiresAt ?? Infinity,
          ),
        };
        return {
          resultId: this.hash(
            `result:${userId}:${row.public_player_id}:${orderingEpoch(generatedAt)}`,
          ).slice(0, 32),
          resultRef: signGeographicToken(
            geographicPepper(this.env),
            "result",
            proof,
          ),
          player: {
            publicPlayerId: row.public_player_id,
            displayName: row.display_name,
            trainer: row.trainer,
            avatar: {
              uploadedUrl: row.avatar_key
                ? `/v1/media/avatars/${row.avatar_key}`
                : null,
              providerUrl: safeProviderAvatar(row.provider_url),
            },
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
            canRequestContact:
              this.env.SOCIAL_DIRECTORY_ENABLED &&
              this.env.SOCIAL_DM_ENABLED &&
              row.contactable,
          },
          displayLocation: displayLocation(row.latitude, row.longitude),
          proximityBand:
            row.dist_m === null
              ? null
              : row.dist_m <= 3000
                ? "near"
                : row.dist_m <= 5000
                  ? "middle"
                  : "outer",
        };
      });
      return {
        contractVersion: GEO_CONTRACT,
        policyVersion: GEO_POLICY,
        state: items.length ? "results" : "empty",
        exposureMode: mode,
        cityId: input.cityId,
        regionId: region.regionId,
        map: { availability: "missing" },
        query: {
          id: queryId,
          scope: input.scope,
          ordering: origin ? "coarse_distance" : "stable_city_sample",
          radiusBucketKm: input.radiusBucketKm ?? null,
          originRef: origin
            ? signGeographicToken(geographicPepper(this.env), "origin", origin)
            : null,
        },
        generatedAt: generatedAt.toISOString(),
        validUntil: new Date(validUntil).toISOString(),
        refreshAfterSeconds: 30,
        displayTtlSeconds: 45,
        items,
      };
    });
  }

  private hash(value: string) {
    return createHmac("sha256", this.env.AUTH_PEPPER)
      .update(value)
      .digest("hex");
  }
  private async read<T>(
    userId: string,
    sessionId: string,
    operation: (client: PoolClient, sessionExpires: Date) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='2s'");
      await client.query("SET LOCAL lock_timeout='2s'");
      await this.fence.assertActiveConsumerInTransaction(client, {
        actorId: userId,
        sessionId,
      });
      const v = await client.query<{ social_eligible: boolean }>(
        "SELECT social_eligible FROM player_social_profiles WHERE user_id=$1",
        [userId],
      );
      if (v.rows[0]?.social_eligible === false)
        throw forbidden("SOCIAL_INELIGIBLE", "Социальный профиль недоступен");
      const s = await client.query<{ expires_at: Date }>(
        "SELECT expires_at FROM app_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
        [sessionId],
      );
      if (!s.rows[0])
        throw notFound("RESOURCE_UNAVAILABLE", "Сессия недоступна");
      const result = await operation(client, s.rows[0].expires_at);
      const current = await client.query(
        `SELECT 1 FROM app_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
        [sessionId, userId],
      );
      if (!current.rows[0]) throw unauthorized();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (["57014", "55P03"].includes((error as { code?: string }).code ?? ""))
        throw serviceUnavailable(
          "RADAR_QUERY_UNAVAILABLE",
          "Запрос Radar временно недоступен",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Plain current reads only; callers acquire the required visibility fences first. */
export async function assertCurrentOrigin(
  client: PoolClient,
  origin: PrivateOrigin,
) {
  if (origin.expiresAt <= Date.now())
    throw unprocessable(
      "RADAR_QUERY_ORIGIN_EXPIRED",
      "Источник местоположения устарел",
    );
  if (origin.activationId) {
    const r = await client.query(
      `SELECT 1 FROM radar_presences WHERE user_id=$1 AND owner_session_id=$2 AND activation_id=$3 AND version=$4
      AND policy_version=$5 AND region_id=$6 AND expires_at>clock_timestamp() AND hard_expires_at>clock_timestamp()
      AND foreground_until>clock_timestamp() AND location_valid_until>clock_timestamp()`,
      [
        origin.viewerUserId,
        origin.viewerSessionId,
        origin.activationId,
        origin.activationVersion,
        GEO_POLICY,
        origin.regionId,
      ],
    );
    if (!r.rows[0])
      throw unprocessable(
        "RADAR_QUERY_ORIGIN_EXPIRED",
        "Источник местоположения устарел",
      );
  }
}
