import { Inject, Injectable } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  badRequest,
  conflict,
  forbidden,
  serviceUnavailable,
  unprocessable,
  problem,
} from "../auth/problem";
import { MutationRunner } from "../common/mutation-runner.service";
import { isDemoUuid, DEMO_SPB_CITY_ID } from "../database/demo-ids";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
import { RadarFeatureService } from "./radar-feature";
import { RadarBudgetService } from "./radar-budget.service";
import { resolveRadarRegion } from "./coarse-location";
import { RADAR_REGION_MOSCOW, RADAR_REGION_SPB } from "./constants";
import { quantizeUnified } from "./unified-location";
import {
  UNIFIED_WIRE,
  UNIFIED_POLICY,
  UNIFIED_DISCLOSURE_ID,
  UNIFIED_DISCLOSURE_HASH,
  UNIFIED_DISCLOSURE_TEXT,
  unifiedStartSchema,
  unifiedTakeoverSchema,
  unifiedRenewSchema,
  unifiedUpdateSchema,
  unifiedHeartbeatSchema,
} from "./unified-contract";

type Presence = {
  coarse_latitude?: number; coarse_longitude?: number;
  user_id: string;
  activation_id: string;
  owner_session_id: string;
  version: string;
  policy_version: string;
  region_id: string;
  location_model: string;
  grid_size_meters: number;
  expires_at: Date;
  hard_expires_at: Date;
  foreground_until: Date;
  location_valid_until: Date;
  started_at: Date;
  next_location_update_at: Date;
  next_radius_change_at: Date;
  radius_bucket_km: number;
  radius_changes_window_started_at: Date;
  radius_changes_in_window: number;
  consent_evidence_id: string;
};
function activationReceipt(row: Presence) {
  return { activationId: row.activation_id, version: Number(row.version) };
}
export function v2Metadata(row: Presence, sessionId: string) {
  return {
    state:
      row.owner_session_id === sessionId
        ? ("active" as const)
        : ("owned_elsewhere" as const),
    ...(row.owner_session_id === sessionId && Number.isFinite(row.coarse_latitude) && Number.isFinite(row.coarse_longitude) ? { coarseCenter: { latitude: row.coarse_latitude, longitude: row.coarse_longitude } } : {}),
    contractVersion: UNIFIED_WIRE,
    activationId: row.activation_id,
    version: Number(row.version),
    ownerHere: row.owner_session_id === sessionId,
    policyVersion: UNIFIED_POLICY,
    regionId: row.region_id,
    model: row.location_model,
    gridSizeMeters: row.grid_size_meters,
    degradedReason: row.grid_size_meters === 1000 ? "source_accuracy" : null,
    radiusBucketKm: row.radius_bucket_km,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    hardExpiresAt: row.hard_expires_at.toISOString(),
    foregroundUntil: row.foreground_until.toISOString(),
    locationValidUntil: row.location_valid_until.toISOString(),
    nextLocationUpdateAt: row.next_location_update_at.toISOString(),
    nextRadiusChangeAt: row.next_radius_change_at.toISOString(),
    exposureMode: isDemoUuid(row.user_id) ? "synthetic_demo" : "live",
  };
}
@Injectable()
export class UnifiedPublishingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly feature: RadarFeatureService,
    private readonly budgets: RadarBudgetService,
  ) {}
  async status(userId: string, sessionId: string) {
    const r = await this.pool.query<Presence>(
      "SELECT *, ST_Y(coarse_center::geometry) AS coarse_latitude, ST_X(coarse_center::geometry) AS coarse_longitude FROM radar_presences WHERE user_id=$1 AND policy_version=$2",
      [userId, UNIFIED_POLICY],
    );
    const row = r.rows[0];
    if (!row) {
      const known = await this.pool.query(
        "SELECT 1 FROM radar_consent_events WHERE user_id=$1 AND policy_version=$2 AND event_type='accepted' LIMIT 1",
        [userId, UNIFIED_POLICY],
      );
      return known.rows[0]
        ? {
            state: "off",
            ownerHere: true,
            policyVersion: UNIFIED_POLICY,
            contractVersion: UNIFIED_WIRE,
          }
        : null;
    }
    const expires = Math.min(
      row.expires_at.getTime(),
      row.hard_expires_at.getTime(),
      row.foreground_until.getTime(),
      row.location_valid_until.getTime(),
    );
    if (expires <= Date.now()) {
      await this.pool.query(
        "DELETE FROM radar_presences WHERE user_id=$1 AND activation_id=$2 AND version=$3 AND LEAST(expires_at,hard_expires_at,foreground_until,location_valid_until)<=clock_timestamp()",
        [userId, row.activation_id, row.version],
      );
      return {
        state: "expired",
        ownerHere: row.owner_session_id === sessionId,
        policyVersion: UNIFIED_POLICY,
        contractVersion: UNIFIED_WIRE,
      };
    }
    return {
      ...v2Metadata(row, sessionId),
      updateRequired: !this.env.SOCIAL_RADAR_PUBLISHING_V2_ENABLED,
    };
  }
  async command(
    userId: string,
    sessionId: string,
    key: string,
    kind: "start" | "takeover" | "renew" | "update" | "heartbeat",
    raw: unknown,
  ) {
    if (!this.env.SOCIAL_RADAR_PUBLISHING_V2_ENABLED)
      throw serviceUnavailable(
        "FEATURE_UNAVAILABLE",
        "Публикация Radar недоступна",
      );
    const mode = this.feature.assertAccess(userId);
    const schema = {
      start: unifiedStartSchema,
      takeover: unifiedTakeoverSchema,
      renew: unifiedRenewSchema,
      update: unifiedUpdateSchema,
      heartbeat: unifiedHeartbeatSchema,
    }[kind];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path.includes("location")))
        throw unprocessable("LOCATION_INVALID", "Некорректная геолокация");
      if (
        parsed.error.issues.some(
          (i) =>
            i.path.includes("consent") ||
            i.path.includes("consentPolicyVersion"),
        )
      )
        throw unprocessable(
          "RADAR_CONSENT_VERSION_REQUIRED",
          "Требуется актуальное согласие Radar",
        );
      throw badRequest("INVALID_REQUEST", "Некорректная команда Radar");
    }
    const input = parsed.data as {
      location?: Parameters<typeof quantizeUnified>[1];
      activationId?: string;
      expectedVersion?: number;
      ttlMinutes?: number;
      radiusBucketKm?: 3 | 5 | 10;
      extendMinutes?: number;
    };
    const operation = `radar.unified.${kind}`;
    const requestHash = createHmac("sha256", this.env.AUTH_PEPPER)
      .update(operation + JSON.stringify(input))
      .digest("hex");
    const result = await this.mutations.runIdempotent<
      ReturnType<typeof activationReceipt>
    >({
      actorId: userId,
      sessionId,
      operation,
      key,
      requestHash,
      authorizeReplay: async (client, body) => {
        await this.requireProfile(client, userId);
        const r = await this.owned(
          client,
          userId,
          sessionId,
          body.activationId,
          body.version,
        );
        if (r.policy_version !== UNIFIED_POLICY)
          throw conflict("VERSION_CONFLICT", "Конфликт поколения Radar");
        await this.requireConsent(client, userId);
      },
      execute: async (client) => {
        await this.requireProfile(client, userId);
        if (kind === "start" || kind === "takeover") {
          // First v2 ON/takeover always carries exact explicit evidence, never upgrades v1.
          const registry = await client.query(
            "SELECT 1 FROM radar_disclosures WHERE policy_version=$1 AND disclosure_id=$2 AND disclosure_sha256=$3 AND disclosure_text=$4",
            [
              UNIFIED_POLICY,
              UNIFIED_DISCLOSURE_ID,
              UNIFIED_DISCLOSURE_HASH,
              UNIFIED_DISCLOSURE_TEXT,
            ],
          );
          if (!registry.rows[0])
            throw forbidden(
              "RADAR_DISCLOSURE_UNAVAILABLE",
              "Раскрытие Radar недоступно",
            );
          await this.budgets.consumeStartOrTakeover(client, userId, new Date());
          const r = await client.query<Presence>(
            "SELECT * FROM radar_presences WHERE user_id=$1 FOR UPDATE",
            [userId],
          );
          const old = r.rows[0];
          if (
            kind === "start" &&
            old &&
            Math.min(
              old.expires_at.getTime(),
              old.foreground_until.getTime(),
              old.location_valid_until.getTime(),
              old.hard_expires_at.getTime(),
            ) > Date.now()
          )
            throw conflict("RADAR_SESSION_OWNED", "Radar уже активен");
          if (
            kind === "takeover" &&
            (!old ||
              !("activationId" in input) ||
              old.activation_id !== input.activationId ||
              Number(old.version) !== input.expectedVersion)
          )
            throw conflict("VERSION_CONFLICT", "Конфликт поколения Radar");
          if (!("location" in input) || !input.location)
            throw unprocessable("LOCATION_INVALID", "Требуется геолокация");
          const point = await this.fix(client, userId, input.location, mode);
          await client.query("DELETE FROM radar_presences WHERE user_id=$1", [
            userId,
          ]);
          const receipt = await client.query<{ id: string }>(
            "INSERT INTO radar_consent_events(user_id,event_type,policy_version,disclosure_id,disclosure_sha256,locale,source) VALUES($1,'accepted',$2,$3,$4,'ru','radar_enable') RETURNING id",
            [
              userId,
              UNIFIED_POLICY,
              UNIFIED_DISCLOSURE_ID,
              UNIFIED_DISCLOSURE_HASH,
            ],
          );
          const receiptId = receipt.rows[0]!.id;
          await client.query(
            "UPDATE player_social_profiles SET radar_consented=true,radar_consent_policy_version=$2,radar_consented_at=clock_timestamp(),radar_consent_evidence_id=$3,version=version+1 WHERE user_id=$1",
            [userId, UNIFIED_POLICY, receiptId],
          );
          const ttl = "ttlMinutes" in input ? (input.ttlMinutes ?? 15) : 15;
          const added = await client.query<Presence>(
            `INSERT INTO radar_presences(user_id,activation_id,owner_session_id,version,policy_version,region_id,started_at,expires_at,hard_expires_at,foreground_until,location_valid_until,next_location_update_at,next_radius_change_at,radius_changes_window_started_at,radius_changes_in_window,cell_i,cell_j,coarse_center,radius_bucket_km,consent_evidence_id,location_model,grid_size_meters,source_accuracy_meters,source_captured_at)
      VALUES($1,$2,$3,1,$4,$5,clock_timestamp(),clock_timestamp()+$6::int*interval '1 minute',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '90 seconds',to_timestamp($7::float8/1000)+interval '6 minutes',clock_timestamp()+interval '5 minutes',clock_timestamp(),clock_timestamp(),0,$8,$9,ST_SetSRID(ST_MakePoint($10::float8,$11::float8),4326)::geography,$12,$13,$14,$15,$16,to_timestamp($7::float8/1000)) RETURNING *`,
            [
              userId,
              randomUUID(),
              sessionId,
              UNIFIED_POLICY,
              point.regionId,
              ttl,
              point.capturedAt,
              point.cellI,
              point.cellJ,
              point.longitude,
              point.latitude,
              ("radiusBucketKm" in input ? input.radiusBucketKm : undefined) ??
                5,
              receiptId,
              point.model,
              point.grid,
              point.accuracy,
            ],
          );
          return {
            statusCode: kind === "start" ? 201 : 200,
            body: activationReceipt(added.rows[0]!),
          };
        }
        if (!input.activationId)
          throw badRequest("INVALID_REQUEST", "Требуется поколение Radar");
        await this.requireConsent(client, userId);
        const old = await this.owned(
          client,
          userId,
          sessionId,
          input.activationId,
          "expectedVersion" in input ? input.expectedVersion : undefined,
        );
        if (kind === "heartbeat") {
          const r = await client.query<Presence>(
            "UPDATE radar_presences SET foreground_until=clock_timestamp()+interval '90 seconds' WHERE user_id=$1 RETURNING *",
            [userId],
          );
          return { statusCode: 200, body: activationReceipt(r.rows[0]!) };
        }
        const location = "location" in input ? input.location : undefined;
        if (location && old.next_location_update_at.getTime() > Date.now())
          throw conflict(
            "LOCATION_COOLDOWN",
            "Местоположение обновляется не чаще раза в пять минут",
          );
        const radiusChanged =
          input.radiusBucketKm !== undefined &&
          input.radiusBucketKm !== old.radius_bucket_km;
        let radiusWindow = old.radius_changes_window_started_at,
          radiusCount = old.radius_changes_in_window,
          nextRadius = old.next_radius_change_at;
        if (radiusChanged) {
          if (nextRadius.getTime() > Date.now())
            throw problem(
              429,
              "RADIUS_COOLDOWN",
              "Радиус пока нельзя изменить",
              undefined,
              Math.ceil((nextRadius.getTime() - Date.now()) / 1000),
            );
          if (Date.now() - radiusWindow.getTime() >= 900_000) {
            radiusWindow = new Date();
            radiusCount = 0;
          }
          if (radiusCount >= 2)
            throw problem(
              429,
              "RADIUS_COOLDOWN",
              "Слишком частая смена радиуса",
              undefined,
              Math.max(
                1,
                Math.ceil(
                  (radiusWindow.getTime() + 900_000 - Date.now()) / 1000,
                ),
              ),
            );
          radiusCount++;
          nextRadius = new Date(Date.now() + 300_000);
        }
        const point = location
          ? await this.fix(client, userId, location, mode)
          : null;
        if (point && point.regionId !== old.region_id)
          throw unprocessable(
            "RADAR_REGION_UNSUPPORTED",
            "Смена города требует новой активации",
          );
        const extension = kind === "renew" ? (input.extendMinutes ?? 15) : null;
        if (
          extension !== null &&
          old.expires_at.getTime() >= old.hard_expires_at.getTime()
        )
          throw conflict(
            "RADAR_MAX_LIFETIME",
            "Достигнут максимальный срок Radar",
          );
        const changed = await client.query<Presence>(
          `UPDATE radar_presences SET version=version+1,
     expires_at=CASE WHEN $2::int IS NULL THEN expires_at ELSE LEAST(hard_expires_at,CASE WHEN clock_timestamp()+$2::int*interval '1 minute'<=expires_at THEN expires_at+$2::int*interval '1 minute' ELSE clock_timestamp()+$2::int*interval '1 minute' END) END,
     foreground_until=clock_timestamp()+interval '90 seconds',
     coarse_center=CASE WHEN $3::float8 IS NULL THEN coarse_center ELSE ST_SetSRID(ST_MakePoint($3::float8,$4::float8),4326)::geography END,
     cell_i=coalesce($5,cell_i),cell_j=coalesce($6,cell_j),location_model=coalesce($7,location_model),grid_size_meters=coalesce($8,grid_size_meters),source_accuracy_meters=coalesce($9,source_accuracy_meters),
     source_captured_at=CASE WHEN $10::float8 IS NULL THEN source_captured_at ELSE to_timestamp($10::float8/1000) END,
     location_valid_until=CASE WHEN $10::float8 IS NULL THEN location_valid_until ELSE to_timestamp($10::float8/1000)+interval '6 minutes' END,
     next_location_update_at=CASE WHEN $10::float8 IS NULL THEN next_location_update_at ELSE clock_timestamp()+interval '5 minutes' END, radius_bucket_km=$11, next_radius_change_at=$12, radius_changes_window_started_at=$13, radius_changes_in_window=$14 WHERE user_id=$1 RETURNING *`,
          [
            userId,
            extension,
            point?.longitude ?? null,
            point?.latitude ?? null,
            point?.cellI ?? null,
            point?.cellJ ?? null,
            point?.model ?? null,
            point?.grid ?? null,
            point?.accuracy ?? null,
            point?.capturedAt ?? null,
            input.radiusBucketKm ?? old.radius_bucket_km,
            nextRadius,
            radiusWindow,
            radiusCount,
          ],
        );
        return {
          statusCode: 200,
          body: activationReceipt(changed.rows[0]!),
        };
      },
    });
    // Durable receipt contains only the generation CAS. Re-read current ephemeral
    // metadata for transport; never persist model, point, accuracy or fix clocks.
    const current = await this.pool.query<Presence>(
      "SELECT *, ST_Y(coarse_center::geometry) AS coarse_latitude, ST_X(coarse_center::geometry) AS coarse_longitude FROM radar_presences WHERE user_id=$1 AND owner_session_id=$2 AND activation_id=$3 AND version=$4 AND policy_version=$5 AND LEAST(expires_at,hard_expires_at,foreground_until,location_valid_until)>clock_timestamp()",
      [
        userId,
        sessionId,
        result.body.activationId,
        result.body.version,
        UNIFIED_POLICY,
      ],
    );
    if (!current.rows[0])
      throw conflict(
        "VERSION_CONFLICT",
        "Активация изменилась; запросите текущий статус",
      );
    return {
      statusCode: result.statusCode,
      body: v2Metadata(current.rows[0], sessionId),
    };
  }
  private async fix(
    client: PoolClient,
    userId: string,
    location: Parameters<typeof quantizeUnified>[1],
    mode: "live" | "synthetic_demo",
  ) {
    await this.budgets.consumeGeo(client, userId, new Date());
    const region = resolveRadarRegion(
      location.latitude,
      location.longitude,
      mode === "synthetic_demo"
        ? [RADAR_REGION_MOSCOW, RADAR_REGION_SPB]
        : [RADAR_REGION_MOSCOW],
    );
    return quantizeUnified(
      client,
      location,
      region.regionId === RADAR_REGION_SPB.regionId
        ? DEMO_SPB_CITY_ID
        : MOSCOW_CITY_ID,
      mode,
    );
  }
  private async requireProfile(client: PoolClient, userId: string) {
    await client.query(
      "INSERT INTO player_social_profiles(user_id,display_name) SELECT id,left(coalesce(nullif(btrim(display_name),''),'Игрок'),80) FROM users WHERE id=$1 ON CONFLICT(user_id) DO NOTHING",
      [userId],
    );
    const p = await client.query<{
      social_eligible: boolean;
      display_name: string;
    }>(
      "SELECT social_eligible,display_name FROM player_social_profiles WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    if (!p.rows[0]?.social_eligible)
      throw forbidden("VIEWER_RESTRICTED", "Социальный профиль недоступен");
    if (!p.rows[0].display_name.trim())
      throw unprocessable("RADAR_PROFILE_INCOMPLETE", "Требуется имя игрока");
  }
  private async requireConsent(client: PoolClient, userId: string) {
    const r = await client.query(
      `SELECT 1 FROM player_social_profiles p JOIN radar_consent_events e ON e.id=p.radar_consent_evidence_id AND e.user_id=p.user_id WHERE p.user_id=$1 AND p.radar_consented AND p.radar_consent_policy_version=$2 AND e.policy_version=$2 AND e.event_type='accepted' AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)`,
      [userId, UNIFIED_POLICY],
    );
    if (!r.rows[0])
      throw unprocessable(
        "RADAR_CONSENT_VERSION_REQUIRED",
        "Требуется актуальное согласие Radar",
      );
  }
  private async owned(
    client: PoolClient,
    userId: string,
    sessionId: string,
    activationId: string,
    version?: number,
  ) {
    const r = await client.query<Presence>(
      "SELECT * FROM radar_presences WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    const row = r.rows[0];
    if (
      !row ||
      row.policy_version !== UNIFIED_POLICY ||
      row.activation_id !== activationId ||
      (version !== undefined && Number(row.version) !== version)
    )
      throw conflict("VERSION_CONFLICT", "Конфликт поколения Radar");
    if (row.owner_session_id !== sessionId)
      throw forbidden("RADAR_NOT_OWNER", "Radar принадлежит другой сессии");
    if (
      Math.min(
        row.expires_at.getTime(),
        row.hard_expires_at.getTime(),
        row.foreground_until.getTime(),
        row.location_valid_until.getTime(),
      ) <= Date.now()
    )
      throw conflict("RADAR_NOT_ACTIVE", "Radar устарел");
    return row;
  }
}
