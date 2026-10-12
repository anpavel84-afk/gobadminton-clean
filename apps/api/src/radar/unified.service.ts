import { Inject, Injectable } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
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
import { ActorFenceService } from "../common/actor-fence.service";
import { geographicCity } from "./geographic-contract";
import { RadarFeatureService } from "./radar-feature";
import { RadarBudgetService } from "./radar-budget.service";
import { ProfilesService } from "../profiles/profiles.service";
import { safeProviderAvatar } from "../profiles/avatar-presentation";
import { quantizeUnified } from "./unified-location";
import { assertUnifiedOrigin } from "./unified-origin";
import { selectUnified, type UnifiedRow } from "./unified-selection";
import {
  UNIFIED_WIRE,
  UNIFIED_POLICY,
  initialSchema,
  continuationSchema,
  mapSchema,
  contextSchema,
  cursorSchema,
  originSchema,
  openUnified,
  sealUnified,
  publicGeo,
  distanceEstimate,
  type UnifiedContext,
  type UnifiedOrigin,
  type UnifiedCursor,
  type UnifiedPoint,
  type UnifiedProof,
} from "./unified-contract";

export function rowPoint(row: UnifiedRow): UnifiedPoint {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    grid: row.grid_size_meters,
    model: row.location_model,
    accuracy: row.source_accuracy_meters,
    capturedAt: row.source_captured_at.getTime(),
  };
}
@Injectable()
export class UnifiedPlayersService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly feature: RadarFeatureService,
    private readonly fence: ActorFenceService,
    private readonly budgets: RadarBudgetService,
    private readonly profiles: ProfilesService,
  ) {}
  async query(viewerId: string, sessionId: string, raw: unknown, map = false) {
    if (!this.env.SOCIAL_RADAR_UNIFIED_ENABLED)
      throw serviceUnavailable(
        "FEATURE_UNAVAILABLE",
        "Единый каталог Radar недоступен",
      );
    const mode = this.feature.assertAccess(viewerId);
    const initial =
      !map && !(raw && typeof raw === "object" && "queryRef" in raw);
    const parsed = (
      map ? mapSchema : initial ? initialSchema : continuationSchema
    ).safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path.includes("location")))
        throw unprocessable("LOCATION_INVALID", "Некорректная геолокация");
      if (
        initial &&
        raw &&
        typeof raw === "object" &&
        "filters" in raw &&
        !(raw as { filters?: { cityId?: unknown } }).filters?.cityId
      )
        throw unprocessable("RADAR_CITY_REQUIRED", "Выберите город Radar");
      throw badRequest("INVALID_REQUEST", "Некорректный запрос Players");
    }
    const input = parsed.data;
    return this.read(viewerId, sessionId, async (client, sessionExpires) => {
      await this.budgets.consumeUnified(client, viewerId, initial, new Date());
      let context: UnifiedContext;
      let cursor: UnifiedCursor | null = null;
      const revision = (
        await client.query<{ revision: string }>(
          "SELECT revision FROM players_query_revision WHERE singleton",
        )
      ).rows[0]!.revision;
      if (initial && "filters" in input && "origin" in input) {
        let region: ReturnType<typeof geographicCity>;
        try {
          region = geographicCity(input.filters.cityId, mode);
        } catch {
          throw unprocessable(
            "RADAR_REGION_UNSUPPORTED",
            "Город Radar не поддерживается",
          );
        }
        const filters = {
          ...input.filters,
          name: input.filters.name?.trim().toLowerCase(),
        };
        let origin: UnifiedOrigin | null = null;
        const bind = {
          viewerId,
          sessionId,
          cityId: filters.cityId,
          regionId: region.regionId,
          mode,
        };
        if (input.origin.kind === "foreground_fix") {
          await this.budgets.consumeGeo(client, viewerId, new Date());
          const p = await quantizeUnified(
            client,
            input.origin.location,
            filters.cityId,
            mode,
          );
          origin = {
            ...bind,
            latitude: p.latitude,
            longitude: p.longitude,
            grid: p.grid,
            model: p.model,
            accuracy: p.accuracy,
            capturedAt: p.capturedAt,
            expiresAt: Math.min(p.capturedAt + 60_000, sessionExpires),
          };
        } else if (input.origin.kind === "reference") {
          origin = openUnified(
            this.env,
            "origin",
            input.origin.originRef,
            originSchema,
          );
          if (
            !origin ||
            origin.viewerId !== viewerId ||
            origin.sessionId !== sessionId ||
            origin.cityId !== filters.cityId ||
            origin.regionId !== region.regionId ||
            origin.mode !== mode
          )
            throw badRequest(
              "CURSOR_INVALID",
              "Некорректный источник местоположения",
            );
        } else if (input.origin.kind === "current_activation") {
          const r = await client.query<{
            latitude: number;
            longitude: number;
            grid_size_meters: 100 | 1000;
            source_accuracy_meters: number;
            source_captured_at: Date;
            location_model: UnifiedPoint["model"];
            version: string;
            deadline: Date;
          }>(
            `SELECT ST_Y(coarse_center::geometry) latitude,ST_X(coarse_center::geometry) longitude,grid_size_meters,source_accuracy_meters,source_captured_at,location_model,version,LEAST(expires_at,hard_expires_at,foreground_until,location_valid_until) deadline FROM radar_presences WHERE user_id=$1 AND owner_session_id=$2 AND activation_id=$3 AND region_id=$4 AND policy_version=$5`,
            [
              viewerId,
              sessionId,
              input.origin.activationId,
              region.regionId,
              UNIFIED_POLICY,
            ],
          );
          const p = r.rows[0];
          if (!p)
            throw unprocessable(
              "LOCATION_INVALID",
              "Источник местоположения недоступен",
            );
          origin = {
            ...bind,
            latitude: p.latitude,
            longitude: p.longitude,
            grid: p.grid_size_meters,
            model: p.location_model,
            accuracy: p.source_accuracy_meters,
            capturedAt: p.source_captured_at.getTime(),
            expiresAt: Math.min(p.deadline.getTime(), sessionExpires),
            activationId: input.origin.activationId,
            version: Number(p.version),
          };
        }
        if (origin) await assertUnifiedOrigin(client, origin);
        context = {
          id: randomUUID(),
          wire: UNIFIED_WIRE,
          viewerId,
          sessionId,
          mode,
          regionId: region.regionId,
          filters,
          origin,
          revision,
          asOf: Date.now(),
          expiresAt: Math.min(
            Date.now() + 45_000,
            sessionExpires,
            origin?.expiresAt ?? Infinity,
          ),
        };
      } else {
        if (!("queryRef" in input))
          throw badRequest("INVALID_REQUEST", "Требуется контекст запроса");
        const c = openUnified(this.env, "query", input.queryRef, contextSchema);
        if (
          !c ||
          c.viewerId !== viewerId ||
          c.sessionId !== sessionId ||
          c.mode !== mode
        )
          throw badRequest("CURSOR_INVALID", "Некорректный контекст запроса");
        context = c;
        if (context.expiresAt <= Date.now())
          throw conflict("QUERY_EXPIRED", "Обновите каталог Players");
        if (context.revision !== revision)
          throw conflict(
            "PLAYERS_QUERY_STALE",
            "Каталог изменился, обновите запрос",
          );
        const token =
          "cursor" in input
            ? input.cursor
            : "mapCursor" in input
              ? input.mapCursor
              : undefined;
        if (token) {
          cursor = openUnified(
            this.env,
            map ? "map" : "list",
            token,
            cursorSchema,
          );
          if (!cursor || cursor.contextId !== context.id)
            throw badRequest("CURSOR_INVALID", "Некорректная страница Players");
        }
        if (context.origin) await assertUnifiedOrigin(client, context.origin);
      }
      const limit = input.limit ?? (map ? 100 : 50);
      if (initial && this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) {
        const expiry = (await client.query<{deadline:Date|null}>("SELECT min(expires_at) AS deadline FROM user_restrictions WHERE revoked_at IS NULL AND expires_at>clock_timestamp() AND capability IN ('account.access','profile.public','social.directory','social.radar')")).rows[0]?.deadline;
        if (expiry) context.expiresAt = Math.min(context.expiresAt, expiry.getTime());
      }
      const rows = await selectUnified(client, context, cursor, limit, map, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED);
      const stats = rows[0]!;
      const deadline = stats.set_deadline?.getTime() ?? Infinity;
      if (initial) context.expiresAt = Math.min(context.expiresAt, deadline);
      else if (deadline < context.expiresAt)
        throw conflict(
          "PLAYERS_QUERY_STALE",
          "Каталог изменился, обновите запрос",
        );
      const all = rows.filter((r) => r.user_id !== null),
        hasMore = all.length > limit,
        page = all.slice(0, limit);
      const ids = page.map((r) => r.user_id!);
      // Two batched projections; never per-row DB calls.
      const contactable = await this.profiles.contactableTargets(
        client,
        viewerId,
        ids,
      );
      const avatars = await client.query<{
        user_id: string;
        avatar_key: string | null;
        provider_url: string | null;
      }>(
        `SELECT p.user_id,p.avatar_key,(SELECT e.avatar_url FROM external_identities e WHERE e.user_id=p.user_id AND e.provider_key IN ('vk','yandex') AND e.avatar_url IS NOT NULL ORDER BY e.created_at,e.id LIMIT 1) provider_url FROM player_social_profiles p WHERE p.user_id=ANY($1::uuid[])`,
        [ids],
      );
      const avatarMap = new Map(
        avatars.rows.map((r) => [
          r.user_id,
          {
            uploadedUrl: r.avatar_key
              ? `/v1/media/avatars/${r.avatar_key}`
              : null,
            providerUrl: safeProviderAvatar(r.provider_url),
          },
        ]),
      );
      const generated = Date.now();
      const items = page.map((row) => {
        const player = {
          publicPlayerId: row.public_player_id,
          displayName: row.display_name,
          cityId: row.city_id,
          areaKey: row.area_key,
          ...(row.directory_visible ? { bio: row.bio } : {}),
          trainer: row.trainer,
          lookingForGame: row.looking,
          level:
            row.level_scale_id && row.level_id
              ? {
                  scaleId: row.level_scale_id,
                  scaleVersion: row.level_scale_version!,
                  levelId: row.level_id,
                  provenance: "self_declared",
                }
              : null,
          avatar: avatarMap.get(row.user_id!),
          canRequestContact: contactable.has(row.user_id!),
        };
        let radar = null;
        if (row.activation_id) {
          const point = rowPoint(row);
          const proof: UnifiedProof = {
            context,
            targetId: row.user_id!,
            publicId: row.public_player_id,
            activationId: row.activation_id,
            version: Number(row.version),
            ownerSessionId: row.owner_session_id,
            receiptId: row.consent_evidence_id,
            model: row.location_model,
            expiresAt: Math.min(context.expiresAt, row.valid_until.getTime()),
          };
          radar = {
            resultId: createHash("sha256")
              .update(`${context.id}:${row.activation_id}:${row.version}`)
              .digest("hex")
              .slice(0, 32),
            resultRef: sealUnified(this.env, "result", proof),
            consentPolicyVersion: UNIFIED_POLICY,
            geo: publicGeo(point, generated),
            validUntil: new Date(proof.expiresAt).toISOString(),
            distance:
              context.origin && row.dist_m !== null
                ? distanceEstimate(row.dist_m, point, context.origin)
                : null,
          };
        }
        return {
          publicPlayerId: row.public_player_id,
          projection: row.directory_visible
            ? ("directory" as const)
            : ("radar_public" as const),
          player,
          radar,
        };
      });
      const last = page.at(-1);
      const next =
        hasMore && last
          ? sealUnified(this.env, map ? "map" : "list", {
              contextId: context.id,
              group: last.group_key,
              distance: last.distance_key,
              name: last.name_key,
              publicId: last.public_player_id,
              rank: Number(last.rank),
            } satisfies UnifiedCursor)
          : null;
      // Final global non-geographic visibility fence. No target/profile locks after it.
      // RR refuses a concurrently advanced epoch; held SHARE through COMMIT serializes
      // all eligibility/order writers, including targets outside this returned page.
      const final = await client.query<{ revision: string }>(
        "SELECT revision FROM players_query_revision WHERE singleton FOR SHARE",
      );
      if (final.rows[0]?.revision !== context.revision)
        throw conflict(
          "PLAYERS_QUERY_STALE",
          "Каталог изменился, обновите запрос",
        );
      if (context.origin) await assertUnifiedOrigin(client, context.origin);
      if (context.expiresAt <= Date.now())
        throw conflict("QUERY_EXPIRED", "Обновите каталог Players");
      const pagination = {
        returnedCount: items.length,
        rankStart: page.length ? Number(page[0]!.rank) : null,
        rankEnd: last ? Number(last.rank) : null,
        hasMore,
      };
      return {
        contractVersion: UNIFIED_WIRE,
        policyVersion: UNIFIED_POLICY,
        exposureMode:
          mode === "live"
            ? ("authenticated_live" as const)
            : ("synthetic_demo" as const),
        cityId: context.filters.cityId,
        regionId: context.regionId,
        generatedAt: new Date(generated).toISOString(),
        validUntil: new Date(context.expiresAt).toISOString(),
        refreshAfterSeconds: 30,
        query: {
          queryRef: sealUnified(this.env, "query", context),
          asOf: new Date(context.asOf).toISOString(),
          ordering: context.origin
            ? "radar_distance_then_directory"
            : "radar_city_then_directory",
          originState: context.origin ? "authorized" : "none",
          originRef: context.origin
            ? sealUnified(this.env, "origin", context.origin)
            : null,
        },
        totals: {
          matchingTotal: Number(stats.matching_total),
          radarTotal: Number(stats.radar_total),
          ordinaryOnlyTotal: Number(stats.ordinary_total),
          completeness: "exact_at_asOf",
        },
        map: { availability: "missing", mapId: null, version: null },
        ...(map
          ? { mapPage: { ...pagination, nextMapCursor: next } }
          : { page: { ...pagination, nextCursor: next } }),
        items,
      };
    });
  }
  private async read<T>(
    viewerId: string,
    sessionId: string,
    op: (client: PoolClient, sessionExpires: number) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("SET LOCAL statement_timeout='2s'");
      await client.query("SET LOCAL lock_timeout='2s'");
      const lock = await client.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) ok",
        [`players-read:${sessionId}`],
      );
      if (!lock.rows[0]?.ok)
        throw problem(
          429,
          "RATE_LIMITED",
          "Запрос Players уже выполняется",
          undefined,
          1,
        );
      await this.fence.assertActiveConsumerInTransaction(client, {
        actorId: viewerId,
        sessionId,
      });
      const p = await client.query<{ social_eligible: boolean }>(
        "SELECT social_eligible FROM player_social_profiles WHERE user_id=$1",
        [viewerId],
      );
      if (p.rows[0]?.social_eligible === false)
        throw forbidden("VIEWER_RESTRICTED", "Социальный профиль недоступен");
      const s = await client.query<{ expires_at: Date }>(
        "SELECT expires_at FROM app_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
        [sessionId],
      );
      if (!s.rows[0]) throw forbidden("VIEWER_RESTRICTED", "Сессия недоступна");
      const result = await op(client, s.rows[0].expires_at.getTime());
      const current = await client.query(
        "SELECT 1 FROM app_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
        [sessionId, viewerId],
      );
      if (!current.rows[0])
        throw forbidden("VIEWER_RESTRICTED", "Сессия недоступна");
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (e as { code?: string }).code;
      if (code === "40001" || code === "40P01")
        throw conflict(
          "PLAYERS_QUERY_STALE",
          "Каталог изменился, обновите запрос",
        );
      if (code === "57014" || code === "55P03")
        throw serviceUnavailable(
          "DISCOVERY_TIMEOUT",
          "Каталог временно недоступен",
        );
      throw e;
    } finally {
      client.release();
    }
  }
}
