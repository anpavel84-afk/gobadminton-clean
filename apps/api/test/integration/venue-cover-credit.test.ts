import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
type Credit = { cover_credit_kind: string | null; cover_credit_text: string | null; cover_credit_url: string | null };
const empty: Credit = { cover_credit_kind: null, cover_credit_text: null, cover_credit_url: null };
const photo: Credit = { cover_credit_kind: "photo", cover_credit_text: "Фото: Клуб", cover_credit_url: "https://club.example" };
const logo: Credit = { cover_credit_kind: "logo", cover_credit_text: "Логотип: Клуб", cover_credit_url: "https://club.example/logo" };
const illustration: Credit = { cover_credit_kind: "illustration", cover_credit_text: "Иллюстрация", cover_credit_url: null };
const cityId = "a0000000-0000-4000-8000-000000000001";
const dir = path.resolve(__dirname, "../../migrations");

run("0037 venue cover credit: disposable PostGIS and public API", () => {
  const databaseName = "venue_credit_" + randomUUID().replaceAll("-", "");
  let adminPool: Pool | undefined;
  let pool: Pool;
  let app: NestFastifyApplication | undefined;
  let actorId: string;
  let approvalId: string;

  beforeAll(async () => {
    const source = process.env.DATABASE_URL;
    if (source === undefined) throw new Error("DATABASE_URL required for disposable local PostGIS");
    const url = new URL(source);
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) === false) throw new Error("Disposable loopback PostGIS required");
    adminPool = new Pool({ connectionString: url.href });
    await adminPool.query('CREATE DATABASE "' + databaseName + '"');
    url.pathname = "/" + databaseName;
    pool = new Pool({ connectionString: url.href });
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    // Through 0045: current VenuesService reads venue_gallery_items. 0037 credit CHECKs and
    // empty-schema 0037 rollback remain valid on this additive stack (credits cleared first).
    const files = (await readdir(dir)).filter(file => file.endsWith(".sql") && file < "0046").sort();
    for (const file of files) {
      await pool.query(await readFile(path.join(dir, file), "utf8"));
      await pool.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
    }
    const user = (await pool.query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic attribution') RETURNING id")).rows[0];
    if (user === undefined) throw new Error("Missing fixture user");
    actorId = user.id;
    const approval = (await pool.query<{ id: string }>(
      "INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id",
      ["a".repeat(64)],
    )).rows[0];
    if (approval === undefined) throw new Error("Missing fixture approval");
    approvalId = approval.id;
    const env = loadEnv({ ...process.env, DATABASE_URL: url.href, NODE_ENV: "test", APP_ENV: "local",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:19441", PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19442",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19442", AUTH_PEPPER: "venue-credit-synthetic-consumer-pepper-32chars" });
    const mod = await Test.createTestingModule({ imports: [buildTestCoreModule(env, pool), VenuesModule] }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (adminPool !== undefined) {
      await adminPool.query('DROP DATABASE IF EXISTS "' + databaseName + '"');
      await adminPool.end();
    }
  });

  async function fixture(withCover = true): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address,cover_key,cover_moderation_approval_id,cover_actor_id) VALUES($1,$2,'Synthetic credit','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$3,'unverified',$7,$7,$4,$5,$6)",
      [id, cityId, actorId, withCover ? randomUUID().replaceAll("-", "").repeat(2) + ".png" : null, withCover ? approvalId : null, withCover ? actorId : null, id],
    );
    return id;
  }
  async function write(id: string, credit: Credit) {
    return pool.query("UPDATE venues SET cover_credit_kind=$2,cover_credit_text=$3,cover_credit_url=$4 WHERE id=$1",
      [id, credit.cover_credit_kind, credit.cover_credit_text, credit.cover_credit_url]);
  }
  async function stored(id: string) {
    return (await pool.query<Credit>("SELECT cover_credit_kind,cover_credit_text,cover_credit_url FROM venues WHERE id=$1", [id])).rows[0];
  }

  it("rejects partial NULLs, invalid shapes, schemes, lengths and attribution without a cover", async () => {
    const id = await fixture();
    const bad: Credit[] = [
      { ...photo, cover_credit_kind: null }, { ...photo, cover_credit_text: null }, { ...photo, cover_credit_url: null },
      { ...photo, cover_credit_kind: "other" }, { ...photo, cover_credit_text: "Клуб" },
      { ...logo, cover_credit_text: "Фото: Клуб" }, { ...logo, cover_credit_url: null },
      { ...illustration, cover_credit_url: "https://club.example" },
      { ...illustration, cover_credit_text: "Картинка" },
      { ...photo, cover_credit_url: "http://club.example" },
      { ...photo, cover_credit_text: "Фото: " + "x".repeat(115) },
      { ...photo, cover_credit_url: "https://" + "x".repeat(293) },
      { ...empty, cover_credit_kind: "photo" },
      { ...empty, cover_credit_text: "Фото: Клуб" }, { ...empty, cover_credit_url: "https://club.example" },
    ];
    for (const credit of bad) await expect(write(id, credit)).rejects.toMatchObject({ code: "23514" });
    const withoutCover = await fixture(false);
    for (const credit of [photo, logo, illustration]) await expect(write(withoutCover, credit)).rejects.toMatchObject({ code: "23514" });
    for (const credit of [photo, logo, illustration, empty]) {
      await write(id, credit);
      expect(await stored(id)).toEqual(credit);
    }
    // Inclusive boundary lengths.
    await write(id, { ...photo, cover_credit_text: "Фото: " + "x".repeat(114), cover_credit_url: "https://" + "x".repeat(292) });
  });

  it("preserves same-key credit, clears stale credit, and retains explicitly changed credit with a new key", async () => {
    const id = await fixture();
    await write(id, photo);
    await pool.query("UPDATE venues SET cover_key=cover_key WHERE id=$1", [id]);
    expect(await stored(id)).toEqual(photo);
    await pool.query("UPDATE venues SET cover_key=$2,cover_credit_kind=$3,cover_credit_text=$4,cover_credit_url=$5 WHERE id=$1",
      [id, "b".repeat(64) + ".png", logo.cover_credit_kind, logo.cover_credit_text, logo.cover_credit_url]);
    expect(await stored(id)).toEqual(logo);
    // Explicitly resending identical values still counts as unchanged attribution.
    await pool.query("UPDATE venues SET cover_key=$2,cover_credit_kind=$3,cover_credit_text=$4,cover_credit_url=$5 WHERE id=$1",
      [id, "c".repeat(64) + ".png", logo.cover_credit_kind, logo.cover_credit_text, logo.cover_credit_url]);
    expect(await stored(id)).toEqual(empty);
    await write(id, illustration);
    await pool.query("UPDATE venues SET cover_key=$2 WHERE id=$1", [id, "d".repeat(64) + ".png"]);
    expect(await stored(id)).toEqual(empty);
    await write(id, photo);
    await pool.query("UPDATE venues SET cover_key=NULL,cover_actor_id=NULL,cover_moderation_approval_id=NULL WHERE id=$1", [id]);
    expect(await stored(id)).toEqual(empty);
    const fresh = await fixture(false);
    await pool.query("UPDATE venues SET cover_key=$2,cover_actor_id=$3,cover_moderation_approval_id=$4,cover_credit_kind='illustration',cover_credit_text='Иллюстрация' WHERE id=$1",
      [fresh, "e".repeat(64) + ".png", actorId, approvalId]);
    expect(await stored(fresh)).toEqual(illustration);
  });

  it("exposes credit only with a visible uploaded URL in detail and catalog", async () => {
    if (app === undefined) throw new Error("Missing API fixture");
    const id = await fixture();
    const detail = async () => {
      if (app === undefined) throw new Error("Missing API fixture");
      const response = await app.inject({ method: "GET", url: "/v1/venues/" + id });
      expect(response.statusCode).toBe(200);
      return response.json<{ cover: { uploadedUrl: string | null; credit: unknown } }>().cover;
    };
    expect((await detail()).credit).toBeNull();
    await write(id, photo);
    const credit = { kind: "photo", text: photo.cover_credit_text, url: photo.cover_credit_url };
    const visible = await detail();
    expect(visible.uploadedUrl).toMatch(/^\/v1\/media\/venue-covers\//);
    expect(visible.credit).toEqual(credit);
    const catalog = await app.inject({ method: "GET", url: "/v1/venues?cityId=" + cityId + "&limit=50" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json<{ items: { id: string; cover: unknown }[] }>().items.find(item => item.id === id)?.cover).toEqual(visible);
    await pool.query("UPDATE content_moderation_approvals SET decision='review' WHERE id=$1", [approvalId]);
    expect(await detail()).toEqual({ uploadedUrl: null, credit: null });
    await pool.query("UPDATE content_moderation_approvals SET decision='allow' WHERE id=$1", [approvalId]);
    await pool.query("UPDATE venues SET cover_key=NULL,cover_actor_id=NULL,cover_moderation_approval_id=NULL WHERE id=$1", [id]);
    expect(await detail()).toEqual({ uploadedUrl: null, credit: null });
  });

  it("refuses rollback with populated credits and removes only new objects when empty", async () => {
    const id = await fixture();
    await write(id, photo);
    const rollback = await readFile(path.join(dir, "rollback/0037_venue_cover_credit.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(client.query(rollback)).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      expect(await stored(id)).toEqual(photo);
      await client.query("UPDATE venues SET cover_credit_kind=NULL,cover_credit_text=NULL,cover_credit_url=NULL");
      await client.query("BEGIN");
      await client.query(rollback);
      await client.query("COMMIT");
      expect((await client.query("SELECT 1 FROM schema_migrations WHERE id='0037_venue_cover_credit'")).rowCount).toBe(0);
      expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='venues' AND column_name LIKE 'cover_credit_%'")).rows).toEqual([]);
      expect((await client.query("SELECT to_regprocedure('clear_stale_venue_cover_credit()') AS fn")).rows).toEqual([{ fn: null }]);
      expect((await client.query("SELECT tgname FROM pg_trigger WHERE tgname='venue_cover_credit_reset'")).rows).toEqual([]);
      expect((await client.query("SELECT contact_phone,cover_key FROM venues WHERE id=$1", [id])).rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
