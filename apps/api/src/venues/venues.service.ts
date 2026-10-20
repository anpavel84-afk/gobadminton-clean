import { readPublicVenueContacts, type PublicVenueContacts } from "./public-venue-contacts";
import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../tokens";
import { notFound, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  VENUE_NORMALIZATION_VERSION,
  extractIdentityDiscriminator,
  isAdvisoryFuzzyNeighbor,
  jaccard,
  normalizeVenueText,
  tokenHash,
  venueDedupeKey,
  venueProposalFingerprint,
} from "./venue-normalize";

export type CityDto = {
  id: string;
  countryCode: string;
  nameRu: string;
  nameEn: string;
  defaultTimezone: string;
};

export type VenueDto = {
  publicContacts?: PublicVenueContacts | null;
  cover?: { uploadedUrl: string | null; credit: { kind: "photo" | "logo" | "illustration"; text: string; url: string | null } | null };
  id: string;
  name: string;
  cityId: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  dataStatus: string;
  provenance: string;
  lifecycleState: string;
  identityDiscriminator: string;
  resolvedFromVenueId?: string;
};

export type VenueCatalogPage = {
  items: VenueDto[];
  nextCursor: string | null;
};

export type CreateVenueInput = {
  cityId: string;
  name: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  identityDiscriminator?: string;
  confirmDistinctToken?: string;
};

export type VenuePossibleDuplicateBody = {
  type: "about:blank";
  title: string;
  status: 409;
  code: "VENUE_POSSIBLE_DUPLICATE";
  requestId: string;
  detail: string;
  confirmationToken: string;
  confirmationExpiresAt: string;
  candidates: VenueDto[];
};

export const MOSCOW_CITY_ID = "a0000000-0000-4000-8000-000000000001";
export const SPB_CITY_ID = "a0000000-0000-4000-8000-000000000002";

const CONFIRM_TTL_MS = 10 * 60 * 1000;
const FUZZY_NEIGHBOR_LIMIT = 5;
const CATALOG_DEFAULT_LIMIT = 20;
const CATALOG_MAX_LIMIT = 50;
const SELECTABLE_LIFECYCLES = ["unverified", "verified"] as const;

type VenueRow = {
  public_contacts?: unknown;
  cover_url?: string | null;
  cover_credit_kind: "photo" | "logo" | "illustration" | null;
  cover_credit_text: string | null;
  cover_credit_url: string | null;
  id: string;
  name: string;
  city_id: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  data_status: string;
  provenance: string;
  lifecycle_state: string;
  identity_discriminator: string;
  normalized_name: string;
  normalized_address: string;
  canonical_venue_id: string | null;
  distance_m?: number | string | null;
};

@Injectable()
export class VenuesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
  ) {}

  async listCities(): Promise<{ items: CityDto[] }> {
    const result = await this.pool.query<{
      id: string;
      country_code: string;
      name_ru: string;
      name_en: string;
      default_timezone: string;
    }>(
      `SELECT id, country_code, name_ru, name_en, default_timezone
       FROM cities
       ORDER BY name_ru ASC, id ASC`,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        countryCode: row.country_code,
        nameRu: row.name_ru,
        nameEn: row.name_en,
        defaultTimezone: row.default_timezone,
      })),
    };
  }

  async searchCatalog(input: {
    cityId: string;
    q?: string;
    lat?: number;
    lng?: number;
    limit?: number;
    cursor?: string;
  }): Promise<VenueCatalogPage> {
    if (!isUuid(input.cityId)) {
      throw unprocessable("CITY_ID_INVALID", "Некорректный cityId");
    }
    const limit = clampLimit(input.limit);
    const q = (input.q ?? "").trim();
    if (q.length > 120) {
      throw unprocessable("VENUE_QUERY_INVALID", "Слишком длинный поисковый запрос");
    }
    if (input.cursor && !isUuid(input.cursor)) {
      throw unprocessable("CURSOR_INVALID", "Некорректный cursor");
    }
    const hasPoint =
      input.lat !== undefined || input.lng !== undefined;
    if (hasPoint) {
      assertCoordinates(input.lat, input.lng);
    }
    if (input.cursor) {
      const cursorExists = await this.pool.query<{ id: string }>(
        `SELECT id FROM venues WHERE id = $1`,
        [input.cursor],
      );
      if (!cursorExists.rows[0]) {
        throw unprocessable("CURSOR_INVALID", "Некорректный cursor");
      }
    }
    const normalizedQ = q.length > 0 ? normalizeVenueText(q) : "";
    const params: unknown[] = [input.cityId, SELECTABLE_LIFECYCLES];
    let distanceExpr = "";
    let pointSql = "";
    let sql = `
      SELECT
        to_jsonb(venues)->'public_contacts' AS public_contacts, venue_cover_url(id) AS cover_url, cover_credit_kind, cover_credit_text, cover_credit_url, id, name, city_id, address, timezone, data_status, provenance,
        lifecycle_state, identity_discriminator,
        normalized_name, normalized_address, canonical_venue_id,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
        __DISTANCE__
      FROM venues
      WHERE city_id = $1
        AND lifecycle_state = ANY($2::text[])
    `;
    if (normalizedQ.length > 0) {
      params.push(`%${normalizedQ}%`);
      sql += ` AND (normalized_name LIKE $${params.length} OR normalized_address LIKE $${params.length})`;
    }
    if (hasPoint) {
      params.push(input.lat, input.lng);
      const latIdx = params.length - 1;
      const lngIdx = params.length;
      pointSql = `ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography`;
      distanceExpr = `, ST_Distance(location, ${pointSql}) AS distance_m`;
    }
    sql = sql.replace("__DISTANCE__", distanceExpr);
    if (hasPoint) {
      if (input.cursor) {
        params.push(input.cursor);
        const cursorIdx = params.length;
        sql += ` AND (
          ST_Distance(location, ${pointSql}) >
            (SELECT ST_Distance(v.location, ${pointSql}) FROM venues v WHERE v.id = $${cursorIdx})
          OR (
            ST_Distance(location, ${pointSql}) =
              (SELECT ST_Distance(v.location, ${pointSql}) FROM venues v WHERE v.id = $${cursorIdx})
            AND id > $${cursorIdx}
          )
        )`;
      }
      sql += ` ORDER BY distance_m ASC, id ASC`;
    } else {
      if (input.cursor) {
        params.push(input.cursor);
        const cursorIdx = params.length;
        sql += ` AND (
          normalized_name > (SELECT v.normalized_name FROM venues v WHERE v.id = $${cursorIdx})
          OR (
            normalized_name = (SELECT v.normalized_name FROM venues v WHERE v.id = $${cursorIdx})
            AND id > $${cursorIdx}
          )
        )`;
      }
      sql += ` ORDER BY normalized_name ASC, id ASC`;
    }
    params.push(limit + 1);
    sql += ` LIMIT $${params.length}`;

    const result = await this.pool.query<VenueRow>(sql, params);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => mapVenue(row)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async create(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateVenueInput,
  ): Promise<{ statusCode: number; body: VenueDto | VenuePossibleDuplicateBody }> {
    return this.propose(userId, sessionId, idempotencyKey, input, "venues.create");
  }

  async propose(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateVenueInput,
    operation = "venues.propose",
  ): Promise<{ statusCode: number; body: VenueDto | VenuePossibleDuplicateBody }> {
    const parsed = parseVenueInput(input);
    const requestHash = this.idempotency.requestHash({
      cityId: parsed.cityId,
      name: parsed.name,
      address: parsed.address,
      timezone: parsed.timezone,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      identityDiscriminator: parsed.identityDiscriminator,
      confirmDistinctToken: parsed.confirmDistinctToken ?? "",
    });
    return this.mutations.runIdempotent<VenueDto | VenuePossibleDuplicateBody>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) =>
        this.findOrPropose(client, {
          userId,
          sessionId,
          parsed,
          allowFuzzyPrompt: true,
        }),
    });
  }

  async confirmDistinct(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateVenueInput & { confirmationToken: string },
  ): Promise<{ statusCode: number; body: VenueDto }> {
    const parsed = parseVenueInput({
      ...input,
      confirmDistinctToken: input.confirmationToken,
    });
    if (!parsed.confirmDistinctToken) {
      throw unprocessable("CONFIRM_TOKEN_INVALID", "Некорректный confirmationToken");
    }
    const requestHash = this.idempotency.requestHash({
      cityId: parsed.cityId,
      name: parsed.name,
      address: parsed.address,
      timezone: parsed.timezone,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      identityDiscriminator: parsed.identityDiscriminator,
      confirmationToken: parsed.confirmDistinctToken,
    });
    return this.mutations.runIdempotent<VenueDto>({
      actorId: userId,
      sessionId,
      operation: "venues.confirmDistinct",
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) => {
        const result = await this.findOrPropose(client, {
          userId,
          sessionId,
          parsed,
          allowFuzzyPrompt: false,
          consumeConfirmToken: true,
        });
        if (result.statusCode === 409) {
          throw unprocessable(
            "CONFIRM_TOKEN_INVALID",
            "Нельзя подтвердить площадку с этим токеном",
          );
        }
        return { statusCode: result.statusCode, body: result.body as VenueDto };
      },
    });
  }

  async getById(venueId: string): Promise<VenueDto> {
    if (!isUuid(venueId)) {
      throw notFound("VENUE_NOT_FOUND", "Площадка не найдена");
    }
    const origin = await this.pool.query<VenueRow>(venueSelectSql("WHERE v.id = $1"), [
      venueId,
    ]);
    const start = origin.rows[0];
    if (!start) throw notFound("VENUE_NOT_FOUND", "Площадка не найдена");
    let current = start;
    const seen = new Set<string>([current.id]);
    for (let hop = 0; hop < 8 && current.lifecycle_state === "merged"; hop += 1) {
      const nextId = current.canonical_venue_id;
      if (!nextId || seen.has(nextId)) break;
      seen.add(nextId);
      const next = await this.pool.query<VenueRow>(venueSelectSql("WHERE v.id = $1"), [
        nextId,
      ]);
      if (!next.rows[0]) break;
      current = next.rows[0];
    }
    const dto = mapVenue(current);
    if (current.id !== venueId) {
      dto.resolvedFromVenueId = venueId;
    }
    return dto;
  }

  private async findOrPropose(
    client: PoolClient,
    input: {
      userId: string;
      sessionId: string;
      parsed: ParsedVenueInput;
      allowFuzzyPrompt: boolean;
      consumeConfirmToken?: boolean;
    },
  ): Promise<{ statusCode: number; body: VenueDto | VenuePossibleDuplicateBody }> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
    const city = await client.query(`SELECT id FROM cities WHERE id = $1`, [
      input.parsed.cityId,
    ]);
    if (!city.rows[0]) {
      throw unprocessable("CITY_NOT_FOUND", "Город не найден");
    }

    const identity = buildIdentity(input.parsed);
    const emptyDiscriminatorKey =
      identity.identityDiscriminator.length > 0
        ? venueDedupeKey({
            cityId: input.parsed.cityId,
            normalizedName: identity.normalizedName,
            normalizedAddress: identity.normalizedAddress,
            identityDiscriminator: "",
          })
        : null;
    const lockKeys = emptyDiscriminatorKey
      ? [identity.dedupeKey, emptyDiscriminatorKey].sort()
      : [identity.dedupeKey];
    for (const lockKey of lockKeys) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        lockKey,
      ]);
    }

    const existingKey = await lookupIdentityVenueId(client, identity.dedupeKey);
    if (existingKey) {
      const reused = await loadVenue(client, existingKey);
      if (input.consumeConfirmToken) {
        await this.tryConsumeConfirmToken(client, input, identity, "reuse");
      }
      return { statusCode: 200, body: mapVenue(reused) };
    }

    if (emptyDiscriminatorKey) {
      const reused = await this.tryReuseLegacyEmptyDiscriminator(
        client,
        input,
        identity,
        emptyDiscriminatorKey,
      );
      if (reused) {
        return reused;
      }
    }

    if (input.consumeConfirmToken) {
      await this.tryConsumeConfirmToken(client, input, identity, "create");
    } else if (input.allowFuzzyPrompt && !input.parsed.confirmDistinctToken) {
      const neighbors = await this.findFuzzyNeighbors(client, input.parsed, identity);
      if (neighbors.length > 0) {
        const token = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS);
        await client.query(
          `INSERT INTO venue_proposal_confirm_tokens (
             token_hash, user_id, session_id, purpose, proposal_fingerprint, expires_at
           ) VALUES ($1,$2,$3,'confirm_distinct',$4,$5)`,
          [
            tokenHash(token),
            input.userId,
            input.sessionId,
            identity.fingerprint,
            expiresAt.toISOString(),
          ],
        );
        const body: VenuePossibleDuplicateBody = {
          type: "about:blank",
          title: "Похожая площадка уже есть",
          status: 409,
          code: "VENUE_POSSIBLE_DUPLICATE",
          requestId: randomUUID(),
          detail:
            "Выберите существующую площадку или подтвердите, что это другая, отдельным запросом confirm-distinct.",
          confirmationToken: token,
          confirmationExpiresAt: expiresAt.toISOString(),
          candidates: neighbors.map((row) => mapVenue(row)),
        };
        return { statusCode: 409, body };
      }
    } else if (input.parsed.confirmDistinctToken && input.allowFuzzyPrompt) {
      await this.tryConsumeConfirmToken(client, input, identity, "create");
    }

    const venueId = randomUUID();
    const inserted = await client.query<VenueRow>(
      `INSERT INTO venues (
         id, city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         normalization_version, identity_discriminator
       ) VALUES (
         $1,$2,$3,$4,$5,
         ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
         'unverified','user_submitted',$8,
         'unverified',$9,$10,$11,$12
       )
       RETURNING
         to_jsonb(venues)->'public_contacts' AS public_contacts, venue_cover_url(id) AS cover_url, cover_credit_kind, cover_credit_text, cover_credit_url, id, name, city_id, address, timezone, data_status, provenance,
         lifecycle_state, identity_discriminator,
         normalized_name, normalized_address, canonical_venue_id,
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude`,
      [
        venueId,
        input.parsed.cityId,
        input.parsed.name,
        input.parsed.address,
        input.parsed.timezone,
        input.parsed.longitude,
        input.parsed.latitude,
        input.userId,
        identity.normalizedName,
        identity.normalizedAddress,
        VENUE_NORMALIZATION_VERSION,
        identity.identityDiscriminator,
      ],
    );
    const reserved = await client.query<{ venue_id: string }>(
      `INSERT INTO venue_identity_keys (dedupe_key, venue_id, normalization_version)
       VALUES ($1,$2,$3)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING venue_id`,
      [identity.dedupeKey, venueId, VENUE_NORMALIZATION_VERSION],
    );
    if (!reserved.rows[0]) {
      await client.query(`DELETE FROM venues WHERE id = $1`, [venueId]);
      const raced = await lookupIdentityVenueId(client, identity.dedupeKey);
      if (!raced) {
        throw unprocessable(
          "VENUE_IDENTITY_RACE",
          "Не удалось зарезервировать площадку",
        );
      }
      const reused = await loadVenue(client, raced);
      return { statusCode: 200, body: mapVenue(reused) };
    }
    return { statusCode: 201, body: mapVenue(inserted.rows[0]!) };
  }

  private async tryReuseLegacyEmptyDiscriminator(
    client: PoolClient,
    input: {
      userId: string;
      sessionId: string;
      parsed: ParsedVenueInput;
      consumeConfirmToken?: boolean;
    },
    identity: BuiltIdentity,
    emptyDiscriminatorKey: string,
  ): Promise<{ statusCode: number; body: VenueDto } | null> {
    const legacyId = await lookupIdentityVenueId(client, emptyDiscriminatorKey);
    if (!legacyId) return null;
    const legacy = await loadVenue(client, legacyId);
    if (
      legacy.city_id !== input.parsed.cityId ||
      legacy.normalized_name !== identity.normalizedName ||
      legacy.normalized_address !== identity.normalizedAddress ||
      legacy.identity_discriminator !== ""
    ) {
      return null;
    }

    const promoted = await client.query<{ venue_id: string }>(
      `UPDATE venue_identity_keys
       SET dedupe_key = $1
       WHERE venue_id = $2
         AND dedupe_key = $3
         AND NOT EXISTS (
           SELECT 1 FROM venue_identity_keys other WHERE other.dedupe_key = $1
         )
       RETURNING venue_id`,
      [identity.dedupeKey, legacy.id, emptyDiscriminatorKey],
    );
    if (promoted.rows[0]) {
      await client.query(
        `UPDATE venues
         SET identity_discriminator = $1, updated_at = now()
         WHERE id = $2 AND identity_discriminator = ''`,
        [identity.identityDiscriminator, legacy.id],
      );
      if (input.consumeConfirmToken) {
        await this.tryConsumeConfirmToken(client, input, identity, "reuse");
      }
      return { statusCode: 200, body: mapVenue(await loadVenue(client, legacy.id)) };
    }

    const ownerId = await lookupIdentityVenueId(client, identity.dedupeKey);
    if (ownerId && ownerId !== legacy.id) {
      await insertLegacyExactCollision(client, legacy.id, ownerId);
      if (input.consumeConfirmToken) {
        await this.tryConsumeConfirmToken(client, input, identity, "reuse");
      }
      return { statusCode: 200, body: mapVenue(await loadVenue(client, ownerId)) };
    }

    if (input.consumeConfirmToken) {
      await this.tryConsumeConfirmToken(client, input, identity, "reuse");
    }
    return { statusCode: 200, body: mapVenue(legacy) };
  }

  private async tryConsumeConfirmToken(
    client: PoolClient,
    input: {
      userId: string;
      sessionId: string;
      parsed: ParsedVenueInput;
    },
    identity: BuiltIdentity,
    _mode: "create" | "reuse",
  ): Promise<void> {
    const token = input.parsed.confirmDistinctToken;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      throw unprocessable("CONFIRM_TOKEN_INVALID", "Некорректный confirmationToken");
    }
    const consumed = await client.query<{ id: string }>(
      `UPDATE venue_proposal_confirm_tokens
       SET used_at = now()
       WHERE token_hash = $1
         AND user_id = $2
         AND session_id = $3
         AND purpose = 'confirm_distinct'
         AND proposal_fingerprint = $4
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING id`,
      [tokenHash(token), input.userId, input.sessionId, identity.fingerprint],
    );
    if (!consumed.rows[0]) {
      throw unprocessable(
        "CONFIRM_TOKEN_INVALID",
        "Токен подтверждения недействителен, истёк или принадлежит другой сессии",
      );
    }
  }

  private async findFuzzyNeighbors(
    client: PoolClient,
    parsed: ParsedVenueInput,
    identity: BuiltIdentity,
  ): Promise<VenueRow[]> {
    const result = await client.query<VenueRow>(
      `SELECT
         to_jsonb(venues)->'public_contacts' AS public_contacts, venue_cover_url(id) AS cover_url, cover_credit_kind, cover_credit_text, cover_credit_url, id, name, city_id, address, timezone, data_status, provenance,
         lifecycle_state, identity_discriminator,
         normalized_name, normalized_address, canonical_venue_id,
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude,
         ST_Distance(
           location,
           ST_SetSRID(ST_MakePoint($3,$2),4326)::geography
         ) AS distance_m
       FROM venues
       WHERE city_id = $1
         AND lifecycle_state = ANY($4::text[])
         AND (
           ST_DWithin(
             location,
             ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,
             300
           )
           OR normalized_name = $5
           OR normalized_address = $6
         )
       ORDER BY distance_m ASC, id ASC
       LIMIT 80`,
      [
        parsed.cityId,
        parsed.latitude,
        parsed.longitude,
        SELECTABLE_LIFECYCLES,
        identity.normalizedName,
        identity.normalizedAddress,
      ],
    );
    const matches: VenueRow[] = [];
    for (const row of result.rows) {
      const distance =
        row.distance_m === null || row.distance_m === undefined
          ? null
          : Number(row.distance_m);
      if (
        isAdvisoryFuzzyNeighbor({
          nameJaccard: jaccard(identity.normalizedName, row.normalized_name),
          addressJaccard: jaccard(
            identity.normalizedAddress,
            row.normalized_address,
          ),
          distanceMeters: Number.isFinite(distance) ? distance : null,
        })
      ) {
        matches.push(row);
      }
      if (matches.length >= FUZZY_NEIGHBOR_LIMIT) break;
    }
    return matches;
  }
}

type ParsedVenueInput = {
  cityId: string;
  name: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  identityDiscriminator: string;
  confirmDistinctToken?: string;
};

type BuiltIdentity = {
  normalizedName: string;
  normalizedAddress: string;
  identityDiscriminator: string;
  dedupeKey: string;
  fingerprint: string;
};

function parseVenueInput(input: CreateVenueInput): ParsedVenueInput {
  const name = input.name?.trim() ?? "";
  const address = input.address?.trim() ?? "";
  const timezone = input.timezone?.trim() ?? "";
  if (!isUuid(input.cityId)) {
    throw unprocessable("CITY_ID_INVALID", "Некорректный cityId");
  }
  if (name.length < 1 || name.length > 160) {
    throw unprocessable("VENUE_NAME_INVALID", "Некорректное имя площадки");
  }
  if (address.length < 1 || address.length > 500) {
    throw unprocessable("VENUE_ADDRESS_INVALID", "Некорректный адрес площадки");
  }
  if (timezone.length < 1 || timezone.length > 64) {
    throw unprocessable("VENUE_TIMEZONE_INVALID", "Некорректный timezone");
  }
  assertCoordinates(input.latitude, input.longitude);
  const explicit = input.identityDiscriminator?.trim();
  if (explicit && explicit.length > 80) {
    throw unprocessable(
      "VENUE_DISCRIMINATOR_INVALID",
      "Некорректный identityDiscriminator",
    );
  }
  const token = input.confirmDistinctToken?.trim();
  if (token && !/^[a-f0-9]{64}$/.test(token)) {
    throw unprocessable("CONFIRM_TOKEN_INVALID", "Некорректный confirmationToken");
  }
  return {
    cityId: input.cityId,
    name,
    address,
    timezone,
    latitude: input.latitude,
    longitude: input.longitude,
    identityDiscriminator: extractIdentityDiscriminator(name, address, explicit),
    confirmDistinctToken: token || undefined,
  };
}

function buildIdentity(parsed: ParsedVenueInput): BuiltIdentity {
  const normalizedName = normalizeVenueText(parsed.name);
  const normalizedAddress = normalizeVenueText(parsed.address);
  const identityDiscriminator = parsed.identityDiscriminator;
  const dedupeKey = venueDedupeKey({
    cityId: parsed.cityId,
    normalizedName,
    normalizedAddress,
    identityDiscriminator,
  });
  return {
    normalizedName,
    normalizedAddress,
    identityDiscriminator,
    dedupeKey,
    fingerprint: venueProposalFingerprint({
      dedupeKey,
      timezone: parsed.timezone,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
    }),
  };
}

// Extract only the public key from the row so reads also work on schema 0037.
// PostgreSQL returns SQL NULL for an absent JSON key; private keys never leave SQL.
// Catalog, fuzzy and INSERT RETURNING use the same projection.
function venueSelectSql(where: string): string {
  return `
    SELECT
      to_jsonb(v)->'public_contacts' AS public_contacts, venue_cover_url(v.id) AS cover_url, v.cover_credit_kind, v.cover_credit_text, v.cover_credit_url, v.id, v.name, v.city_id, v.address, v.timezone, v.data_status, v.provenance,
      v.lifecycle_state, v.identity_discriminator,
      v.normalized_name, v.normalized_address, v.canonical_venue_id,
      ST_Y(v.location::geometry) AS latitude,
      ST_X(v.location::geometry) AS longitude
    FROM venues v
    ${where}
  `;
}

async function lookupIdentityVenueId(
  client: PoolClient,
  dedupeKey: string,
): Promise<string | null> {
  const result = await client.query<{ venue_id: string }>(
    `SELECT venue_id FROM venue_identity_keys WHERE dedupe_key = $1`,
    [dedupeKey],
  );
  return result.rows[0]?.venue_id ?? null;
}

async function insertLegacyExactCollision(
  client: PoolClient,
  leftId: string,
  rightId: string,
): Promise<void> {
  const [left, right] = leftId < rightId ? [leftId, rightId] : [rightId, leftId];
  await client.query(
    `INSERT INTO venue_duplicate_candidates (
       left_venue_id, right_venue_id, source, status
     ) VALUES ($1,$2,'legacy_exact_collision','open')
     ON CONFLICT (left_venue_id, right_venue_id, source) DO NOTHING`,
    [left, right],
  );
}

async function loadVenue(client: PoolClient, venueId: string): Promise<VenueRow> {
  const result = await client.query<VenueRow>(venueSelectSql("WHERE v.id = $1"), [
    venueId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw notFound("VENUE_NOT_FOUND", "Площадка не найдена");
  }
  return row;
}

function mapVenue(row: VenueRow, resolvedFromVenueId?: string): VenueDto {
  const dto: VenueDto = {
    publicContacts: readPublicVenueContacts(row.public_contacts),
    cover: { uploadedUrl: row.cover_url ?? null, credit: row.cover_url && row.cover_credit_kind && row.cover_credit_text !== null ? { kind: row.cover_credit_kind, text: row.cover_credit_text, url: row.cover_credit_url } : null },
    id: row.id,
    name: row.name,
    cityId: row.city_id,
    address: row.address,
    timezone: row.timezone,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    dataStatus: row.data_status,
    provenance: row.provenance,
    lifecycleState: row.lifecycle_state,
    identityDiscriminator: row.identity_discriminator,
  };
  if (resolvedFromVenueId) dto.resolvedFromVenueId = resolvedFromVenueId;
  return dto;
}

function assertCoordinates(lat: number | undefined, lng: number | undefined): void {
  if (
    typeof lat !== "number" ||
    Number.isNaN(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    throw unprocessable("VENUE_LATITUDE_INVALID", "Некорректная широта");
  }
  if (
    typeof lng !== "number" ||
    Number.isNaN(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    throw unprocessable("VENUE_LONGITUDE_INVALID", "Некорректная долгота");
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return CATALOG_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw unprocessable("LIMIT_INVALID", "Некорректный limit");
  }
  return Math.min(limit, CATALOG_MAX_LIMIT);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
