/**
 * #485 disposable PostGIS catalog scope — authored only.
 * Source author MUST NOT execute RUN_DB_INTEGRATION=1 or any DB calls.
 * Parent runs this suite on an isolated loopback PostGIS network.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REGIONAL_CITIES } from "../../../../packages/contracts/src/regional-cities";
import type { IdempotencyService } from "../../src/common/idempotency.service";
import type { MutationRunner } from "../../src/common/mutation-runner.service";
import {
  MOSCOW_CITY_ID,
  REGIONAL_CITY_RADIUS_METERS,
  SPB_CITY_ID,
  VenuesService,
} from "../../src/venues/venues.service";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

function guardedUrl(): URL {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required for disposable PostGIS");
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Disposable loopback DB required");
  }
  if (process.env.NODE_ENV !== "test" || process.env.APP_ENV !== "local") {
    throw new Error("Requires NODE_ENV=test and APP_ENV=local");
  }
  return url;
}

run("venues regional scope: disposable PostGIS searchCatalog", () => {
  const dbName = "venues_regional_" + randomUUID().replaceAll("-", "");
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let service: VenuesService;
  let userId: string;
  const novosibirsk = REGIONAL_CITIES[0]!;

  function db(): Pool {
    if (!pool) throw new Error("Missing disposable DB");
    return pool;
  }

  beforeAll(async () => {
    const url = guardedUrl();
    admin = new Pool({ connectionString: url.href });
    await admin.query('CREATE DATABASE "' + dbName + '"');
    url.pathname = "/" + dbName;
    pool = new Pool({ connectionString: url.href });
    await db().query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const migrations = path.resolve(__dirname, "../../migrations");
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await db().query(await readFile(path.join(migrations, file), "utf8"));
      await db().query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
    }
    // Profile/gallery projection helpers used by searchCatalog require migrated schema (0045+).
    expect(
      (await db().query("SELECT to_regclass('public.venue_gallery_items') AS name")).rows[0]?.name,
    ).toBe("venue_gallery_items");

    const user = (
      await db().query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES('Synthetic regional scope') RETURNING id",
      )
    ).rows[0];
    if (!user) throw new Error("fixture user");
    userId = user.id;

    for (const city of REGIONAL_CITIES) {
      await db().query(
        `INSERT INTO cities(id, country_code, name_ru, name_en, default_timezone)
         VALUES ($1, 'RU', $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [city.id, city.nameRu, city.nameEn, city.timezone],
      );
    }
    expect(REGIONAL_CITIES).toHaveLength(11);
    expect(REGIONAL_CITY_RADIUS_METERS).toBe(40000);

    // Idempotency/MutationRunner unused by searchCatalog — stub only; do not mock pool.query.
    service = new VenuesService(db(), {} as IdempotencyService, {} as MutationRunner);
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS "' + dbName + '"');
      await admin.end();
    }
  });

  /** Place a synthetic venue via ST_Project from a known regional OSM center. */
  async function placeProjected(opts: {
    cityId: string;
    centerLon: number;
    centerLat: number;
    distanceM: number;
    azimuthDeg: number;
    label: string;
  }): Promise<string> {
    const id = randomUUID();
    const name = `Synthetic regional ${opts.label}`;
    const address = `Synthetic address ${opts.label}`;
    await db().query(
      `INSERT INTO venues(
         id, city_id, name, address, timezone, location,
         created_by_user_id, lifecycle_state, normalized_name, normalized_address
       ) VALUES (
         $1, $2, $3, $4, 'Europe/Moscow',
         ST_Project(
           ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
           $7,
           radians($8)
         ),
         $9, 'unverified', $10, $11
       )`,
      [
        id,
        opts.cityId,
        name,
        address,
        opts.centerLon,
        opts.centerLat,
        opts.distanceM,
        opts.azimuthDeg,
        userId,
        id,
        id,
      ],
    );
    return id;
  }

  async function placeFixed(opts: {
    cityId: string;
    lon: number;
    lat: number;
    label: string;
  }): Promise<string> {
    const id = randomUUID();
    const name = `Synthetic legacy ${opts.label}`;
    const address = `Synthetic address ${opts.label}`;
    await db().query(
      `INSERT INTO venues(
         id, city_id, name, address, timezone, location,
         created_by_user_id, lifecycle_state, normalized_name, normalized_address
       ) VALUES (
         $1, $2, $3, $4, 'Europe/Moscow',
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         $7, 'unverified', $8, $9
       )`,
      [id, opts.cityId, name, address, opts.lon, opts.lat, userId, id, id],
    );
    return id;
  }

  it("applies 40 km ST_DWithin for regional cities including near-boundary and map-bbox negatives", async () => {
    const centerLon = novosibirsk.centerLongitude;
    const centerLat = novosibirsk.centerLatitude;
    // ~5 km north — inside radius.
    const insideId = await placeProjected({
      cityId: novosibirsk.id,
      centerLon,
      centerLat,
      distanceM: 5000,
      azimuthDeg: 0,
      label: "inside-5km",
    });
    // ~41 km north — outside 40 km, still inside the packaged Novosibirsk map maxBounds (~0.42°≈46 km).
    const outsideBboxId = await placeProjected({
      cityId: novosibirsk.id,
      centerLon,
      centerLat,
      distanceM: 41000,
      azimuthDeg: 0,
      label: "outside-41km-in-bbox",
    });
    const justInsideId = await placeProjected({
      cityId: novosibirsk.id,
      centerLon,
      centerLat,
      distanceM: 39999.99,
      azimuthDeg: 90,
      label: "boundary-39999.99",
    });
    const justOutsideId = await placeProjected({
      cityId: novosibirsk.id,
      centerLon,
      centerLat,
      distanceM: 40000.1,
      azimuthDeg: 90,
      label: "boundary-40000.1",
    });

    const page = await service.searchCatalog({ cityId: novosibirsk.id, limit: 50 });
    const ids = new Set(page.items.map((item) => item.id));
    expect(ids.has(insideId)).toBe(true);
    expect(ids.has(justInsideId)).toBe(true);
    expect(ids.has(outsideBboxId)).toBe(false);
    expect(ids.has(justOutsideId)).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("keeps Moscow/SPb historically unscoped and accepts limit 50 without query", async () => {
    // Far from Moscow center (~Vladivostok) — still returned (no retro 40 km filter).
    const moscowFar = await placeFixed({
      cityId: MOSCOW_CITY_ID,
      lon: 131.885,
      lat: 43.115,
      label: "moscow-far",
    });
    const spbFar = await placeFixed({
      cityId: SPB_CITY_ID,
      lon: 131.885,
      lat: 43.115,
      label: "spb-far",
    });

    const moscow = await service.searchCatalog({ cityId: MOSCOW_CITY_ID, limit: 50 });
    expect(moscow.items.some((item) => item.id === moscowFar)).toBe(true);

    const spb = await service.searchCatalog({ cityId: SPB_CITY_ID, limit: 50 });
    expect(spb.items.some((item) => item.id === spbFar)).toBe(true);

    // No q: limit 50 is accepted; values above the catalog max are clamped (not rejected).
    const regional = await service.searchCatalog({ cityId: novosibirsk.id, limit: 50 });
    expect(regional.items.length).toBeLessThanOrEqual(50);
    const clamped = await service.searchCatalog({ cityId: novosibirsk.id, limit: 51 });
    expect(clamped.items.length).toBeLessThanOrEqual(50);
  });
});
