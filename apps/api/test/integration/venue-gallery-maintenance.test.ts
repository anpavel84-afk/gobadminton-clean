import { randomUUID, createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import {
  importVenueCovers,
  importVenueGallery,
  importVenueGalleryMaintenance,
} from "../../src/database/import-venue-covers";
import { validateManifest } from "../../src/venues/venue-cover-import";
import { validateGalleryManifest, type GalleryManifest } from "../../src/venues/venue-gallery-import";
import {
  validateGalleryMaintenanceManifest,
  type GalleryMaintenanceManifest,
} from "../../src/venues/venue-gallery-maintenance";
import { AvatarService } from "../../src/profiles/avatar.service";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

run("venue gallery maintenance: disposable PostGIS", () => {
  const dbName = "venue_gallery_maint_" + randomUUID().replaceAll("-", "");
  let admin: Pool | undefined, pool: Pool | undefined, root: string | undefined;
  let media: AvatarService, moderation: ContentModerationService, fake: FakeModerationProvider;
  let actor: string, userId: string;
  const city = "a0000000-0000-4000-8000-000000000001";

  function db() {
    if (!pool) throw new Error("Missing disposable DB");
    return pool;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for disposable PostGIS");
    const url = new URL(process.env.DATABASE_URL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Disposable loopback DB required");
    }
    admin = new Pool({ connectionString: url.href });
    await admin.query('CREATE DATABASE "' + dbName + '"');
    url.pathname = "/" + dbName;
    pool = new Pool({ connectionString: url.href });
    await db().query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    const migrations = path.resolve(__dirname, "../../migrations");
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await db().query(await readFile(path.join(migrations, file), "utf8"));
      await db().query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
    }
    root = await mkdtemp(path.join(tmpdir(), "venue-gallery-maint-"));
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: url.href,
      NODE_ENV: "test",
      APP_ENV: "local",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:19471",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19472",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19472",
      AUTH_PEPPER: "synthetic-gallery-maint-pepper-32chars!",
      AVATAR_MEDIA_ROOT: root,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-gallery-maint-fingerprint-32c",
    });
    fake = new FakeModerationProvider(env);
    moderation = new ContentModerationService(db(), env, fake);
    const idempotency = new IdempotencyService(db(), env);
    const mutations = new MutationRunner(db(), idempotency, new ActorFenceService(env), env);
    media = new AvatarService(db(), env, mutations, moderation, idempotency);
  }, 120000);

  beforeEach(async () => {
    const user = (await db().query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic gallery maint') RETURNING id")).rows[0];
    if (!user) throw new Error("fixture user");
    userId = user.id;
    const principal = (await db().query<{ id: string }>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [userId])).rows[0];
    if (!principal) throw new Error("fixture actor");
    actor = principal.id;
    await db().query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','synthetic')", [actor]);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS "' + dbName + '"');
      await admin.end();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function jpeg(seed: string) {
    const digest = createHash("sha256").update(seed).digest();
    const r = 40 + (digest[0]! % 200);
    const g = digest[1]!;
    const b = digest[2]!;
    return sharp({ create: { width: 900, height: 600, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  }

  async function seedVenue(name = "Synthetic Hall", address = "Synthetic Address 1") {
    const id = randomUUID();
    await db().query(
      `INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
       VALUES($1,$2,$3,$4,'Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$5,'unverified',$6,$7)`,
      [id, city, name, address, userId, id, id],
    );
    return id;
  }

  async function seedMainCover(venueId: string, bytes: Buffer) {
    const sha = createHash("sha256").update(bytes).digest("hex");
    const coverBatch = {
      manifest: validateManifest({
        schema: "VENUE_COVER_BATCH_V1",
        batch: "seed-cover",
        count: 1,
        items: [{
          venueId,
          file: `${venueId}.jpg`,
          sha256: sha,
          kind: "photo",
          credit_text: "Фото: Клуб",
          source_page_url: "https://example.com/main",
          basis_note: "PRIVATE BASIS SEED",
        }],
      }),
      images: new Map([[venueId, bytes]]),
    };
    const lines: object[] = [];
    const code = await importVenueCovers(db(), coverBatch, actor, true, { media, moderation }, (l) => lines.push(l));
    expect(code, `seedMainCover import failed code=${code} lines=${JSON.stringify(lines)}`).toBe(0);
  }

  function galleryBatch(
    venueId: string,
    entries: { bytes: Buffer; expectedVersion: number; name?: string; address?: string }[],
    batch = "synthetic-gallery",
  ): { manifest: GalleryManifest; images: Map<string, Buffer> } {
    const images = new Map<string, Buffer>();
    const items = entries.map((entry) => {
      const sha256 = createHash("sha256").update(entry.bytes).digest("hex");
      const file = `${venueId}-${sha256.slice(0, 16)}.jpg`;
      images.set(file, entry.bytes);
      return {
        venueId,
        expectedName: entry.name ?? "Synthetic Hall",
        expectedAddress: entry.address ?? "Synthetic Address 1",
        expectedVersion: entry.expectedVersion,
        file,
        sha256,
        evidence: {
          creditKind: "photo" as const,
          creditText: "Фото: Клуб",
          creditUrl: "https://example.com/photo",
          sourceUrl: "https://example.com/photo",
          sourceAuthor: null,
          permissionBasis: "Owner-confirmed portal/club photograph rights recorded for DEV catalog import",
          sourceFingerprint: sha256,
        },
      };
    });
    return { manifest: validateGalleryManifest({ schema: "VENUE_GALLERY_BATCH_V1", batch, count: items.length, items }), images };
  }

  function maintenanceManifest(
    venueId: string,
    opts: {
      version: number;
      orderedActiveIds: string[];
      mainId: string | null;
      removeIds: string[];
      name?: string;
      address?: string;
      operation?: string;
    },
  ): GalleryMaintenanceManifest {
    return validateGalleryMaintenanceManifest({
      schema: "VENUE_GALLERY_MAINTENANCE_V1",
      operation: opts.operation ?? "owner488-maint-1",
      count: 1,
      items: [{
        venueId,
        expectedName: opts.name ?? "Synthetic Hall",
        expectedAddress: opts.address ?? "Synthetic Address 1",
        expectedVersion: opts.version,
        orderedActiveIds: opts.orderedActiveIds,
        mainId: opts.mainId,
        removeIds: opts.removeIds,
      }],
    });
  }

  async function counts() {
    return (await db().query(
      `SELECT (SELECT count(*)::int FROM privileged_audit_events) audits,
              (SELECT count(*)::int FROM content_moderation_approvals) approvals,
              (SELECT count(*)::int FROM venue_gallery_items WHERE active) gallery`,
    )).rows[0];
  }

  it("dry-run has no effects; apply reorders/main/removes without provider calls; replay is idempotent", async () => {
    const venueId = await seedVenue();
    await seedMainCover(venueId, await jpeg("maint-main"));
    const version0 = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    const appendA = await jpeg("maint-a");
    const appendB = await jpeg("maint-b");
    expect(await importVenueGallery(db(), galleryBatch(venueId, [
      { bytes: appendA, expectedVersion: version0 },
    ], "maint-seed-a"), actor, true, { media, moderation }, () => undefined)).toBe(0);
    const version1 = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    expect(await importVenueGallery(db(), galleryBatch(venueId, [
      { bytes: appendB, expectedVersion: version1 },
    ], "maint-seed-b"), actor, true, { media, moderation }, () => undefined)).toBe(0);

    const rows = (await db().query<{ id: string; position: number; is_main: boolean; storage_key: string }>(
      `SELECT id, position, is_main, storage_key FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position`,
      [venueId],
    )).rows;
    expect(rows).toHaveLength(3);
    const main0 = rows[0]!;
    const mid = rows[1]!;
    const last = rows[2]!;
    const version = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    const coverBefore = (await db().query<{ cover_key: string }>("SELECT cover_key FROM venues WHERE id=$1", [venueId])).rows[0]!.cover_key;

    // Promote mid to MAIN/cover and soft-remove last (changing-room style).
    const manifest = maintenanceManifest(venueId, {
      version,
      orderedActiveIds: [mid.id, main0.id],
      mainId: mid.id,
      removeIds: [last.id],
    });
    const before = await counts();
    const providerBefore = fake.calls;
    const dryLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), manifest, actor, false, (l) => dryLines.push(l))).toBe(0);
    expect(await counts()).toEqual(before);
    expect(fake.calls).toBe(providerBefore);
    expect(dryLines).toContainEqual(expect.objectContaining({ action: "READY", reason: "GALLERY_MAINTENANCE_READY" }));

    const applyLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), manifest, actor, true, (l) => applyLines.push(l))).toBe(0);
    expect(fake.calls).toBe(providerBefore);
    expect(applyLines).toContainEqual(expect.objectContaining({ action: "APPLIED", reason: "MAINTAINED" }));

    const after = (await db().query<{ id: string; position: number; is_main: boolean }>(
      `SELECT id, position, is_main FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position`,
      [venueId],
    )).rows;
    expect(after).toEqual([
      { id: mid.id, position: 0, is_main: true },
      { id: main0.id, position: 1, is_main: false },
    ]);
    expect((await db().query(`SELECT 1 FROM venue_gallery_items WHERE id=$1 AND active`, [last.id])).rowCount).toBe(0);
    expect((await db().query(`SELECT 1 FROM venue_gallery_items WHERE id=$1`, [last.id])).rowCount).toBe(1);
    const venueAfter = (await db().query<{ version: number; cover_key: string }>(
      "SELECT version, cover_key FROM venues WHERE id=$1",
      [venueId],
    )).rows[0]!;
    expect(venueAfter.version).toBe(version + 1);
    expect(venueAfter.cover_key).toBe(mid.storage_key);
    expect(venueAfter.cover_key).not.toBe(coverBefore);

    const snap = await counts();
    const replayLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), manifest, actor, true, (l) => replayLines.push(l))).toBe(0);
    expect(fake.calls).toBe(providerBefore);
    expect(await counts()).toEqual(snap);
    expect(replayLines).toContainEqual(expect.objectContaining({ action: "SKIPPED", reason: "GALLERY_MAINTENANCE_REPLAY" }));
  });

  it("rejects wrong identity/CAS/body mismatch with zero gallery writes and no provider calls", async () => {
    const venueId = await seedVenue();
    await seedMainCover(venueId, await jpeg("cas-main"));
    const version0 = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    expect(await importVenueGallery(db(), galleryBatch(venueId, [
      { bytes: await jpeg("cas-extra"), expectedVersion: version0 },
    ], "cas-seed"), actor, true, { media, moderation }, () => undefined)).toBe(0);
    const rows = (await db().query<{ id: string }>(
      `SELECT id FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position`,
      [venueId],
    )).rows;
    const version = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    const providerBefore = fake.calls;
    const before = await counts();

    const identityLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), maintenanceManifest(venueId, {
      version,
      orderedActiveIds: [rows[1]!.id, rows[0]!.id],
      mainId: rows[1]!.id,
      removeIds: [],
      name: "Wrong Name",
      operation: "cas-identity",
    }), actor, true, (l) => identityLines.push(l))).toBe(1);
    expect(identityLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" }));
    expect(fake.calls).toBe(providerBefore);
    expect(await counts()).toEqual(before);

    const casLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), maintenanceManifest(venueId, {
      version: version + 9,
      orderedActiveIds: [rows[1]!.id, rows[0]!.id],
      mainId: rows[1]!.id,
      removeIds: [],
      operation: "cas-version",
    }), actor, true, (l) => casLines.push(l))).toBe(1);
    expect(casLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "VENUE_VERSION_CONFLICT" }));
    expect(fake.calls).toBe(providerBefore);
    expect(await counts()).toEqual(before);

    // Known key + altered body → conflict; no extra writes/provider.
    const good = maintenanceManifest(venueId, {
      version,
      orderedActiveIds: [rows[1]!.id, rows[0]!.id],
      mainId: rows[1]!.id,
      removeIds: [],
      operation: "cas-body",
    });
    expect(await importVenueGalleryMaintenance(db(), good, actor, true, () => undefined)).toBe(0);
    const afterApply = await counts();
    const providerAfter = fake.calls;
    const altered = maintenanceManifest(venueId, {
      version: version + 1,
      orderedActiveIds: [rows[0]!.id, rows[1]!.id],
      mainId: rows[0]!.id,
      removeIds: [],
      operation: "cas-body",
    });
    const conflictLines: object[] = [];
    expect(await importVenueGalleryMaintenance(db(), altered, actor, true, (l) => conflictLines.push(l))).toBe(1);
    expect(conflictLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "GALLERY_MAINTENANCE_CONFLICT" }));
    expect(fake.calls).toBe(providerAfter);
    expect(await counts()).toEqual(afterApply);
  });
});
