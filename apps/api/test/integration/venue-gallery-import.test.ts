import { randomUUID, createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import { importVenueCovers, importVenueGallery } from "../../src/database/import-venue-covers";
import { validateManifest } from "../../src/venues/venue-cover-import";
import { validateGalleryManifest, type GalleryManifest } from "../../src/venues/venue-gallery-import";
import { AvatarService } from "../../src/profiles/avatar.service";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

run("venue gallery import: disposable PostGIS", () => {
  const dbName = "venue_gallery_import_" + randomUUID().replaceAll("-", "");
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
    root = await mkdtemp(path.join(tmpdir(), "venue-gallery-import-"));
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: url.href,
      NODE_ENV: "test",
      APP_ENV: "local",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:19461",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19462",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19462",
      AUTH_PEPPER: "synthetic-gallery-import-pepper-32chars",
      AVATAR_MEDIA_ROOT: root,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-gallery-import-fingerprint-32chars",
    });
    fake = new FakeModerationProvider(env);
    moderation = new ContentModerationService(db(), env, fake);
    const idempotency = new IdempotencyService(db(), env);
    const mutations = new MutationRunner(db(), idempotency, new ActorFenceService(env), env);
    media = new AvatarService(db(), env, mutations, moderation, idempotency);
    const user = (await db().query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic gallery importer') RETURNING id")).rows[0];
    if (!user) throw new Error("fixture user");
    userId = user.id;
    const principal = (await db().query<{ id: string }>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [userId])).rows[0];
    if (!principal) throw new Error("fixture actor");
    actor = principal.id;
    await db().query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','synthetic')", [actor]);
  }, 120000);

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
    expect(await importVenueCovers(db(), coverBatch, actor, true, { media, moderation }, () => undefined)).toBe(0);
    return sha;
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

  it("dry-run has no writes; append preserves main/old bytes; exact replay skips moderation", async () => {
    const venueId = await seedVenue();
    const mainBytes = await jpeg("main");
    await seedMainCover(venueId, mainBytes);
    const main = (await db().query<{ cover_key: string; version: number; storage_key: string }>(
      `SELECT v.cover_key, v.version, g.storage_key FROM venues v
       JOIN venue_gallery_items g ON g.venue_id=v.id AND g.active AND g.is_main
       WHERE v.id=$1`,
      [venueId],
    )).rows[0]!;
    const mainFile = await readFile(path.join(root!, main.cover_key));

    const appendBytes = await jpeg("append");
    const input = galleryBatch(venueId, [{ bytes: appendBytes, expectedVersion: main.version }]);
    const lines: object[] = [];
    const counts = async () => (await db().query(
      `SELECT (SELECT count(*)::int FROM privileged_audit_events) audits,
              (SELECT count(*)::int FROM content_moderation_approvals) approvals,
              (SELECT count(*)::int FROM venue_gallery_items WHERE active) gallery`,
    )).rows[0];
    const before = await counts();
    const calls = fake.calls;
    expect(await importVenueGallery(db(), input, actor, false, { media, moderation }, (l) => lines.push(l))).toBe(0);
    expect(await counts()).toEqual(before);
    expect(fake.calls).toBe(calls);
    expect(lines).toContainEqual(expect.objectContaining({ action: "READY", usage: "UNKNOWN" }));

    expect(await importVenueGallery(db(), input, actor, true, { media, moderation }, (l) => lines.push(l))).toBe(0);
    const after = (await db().query<{
      version: number; cover_key: string; position: number; is_main: boolean; source_fingerprint: string; storage_key: string;
    }>(
      `SELECT v.version, v.cover_key, g.position, g.is_main, g.source_fingerprint, g.storage_key
       FROM venues v JOIN venue_gallery_items g ON g.venue_id=v.id AND g.active
       WHERE v.id=$1 ORDER BY g.position`,
      [venueId],
    )).rows;
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ position: 0, is_main: true, cover_key: main.cover_key, storage_key: main.storage_key });
    expect(after[1]).toMatchObject({
      position: 1, is_main: false,
      source_fingerprint: createHash("sha256").update(appendBytes).digest("hex"),
    });
    expect(await readFile(path.join(root!, main.cover_key))).toEqual(mainFile);
    expect(after[0]!.version).toBe(main.version + 1);

    const callsAfter = fake.calls;
    const snap = await counts();
    expect(await importVenueGallery(db(), input, actor, true, { media, moderation }, (l) => lines.push(l))).toBe(0);
    expect(fake.calls).toBe(callsAfter);
    expect(await counts()).toEqual(snap);
    expect(lines.some((line) => "action" in line && (line as { action: string }).action === "SKIPPED")).toBe(true);
  });

  it("skips resurrection after remove; altered manifest conflicts; name drift before moderation", async () => {
    const venueId = await seedVenue();
    const mainBytes = await jpeg("res-main");
    await seedMainCover(venueId, mainBytes);
    const version = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    const appendBytes = await jpeg("res-append");
    const input = galleryBatch(venueId, [{ bytes: appendBytes, expectedVersion: version }], "resurrect-batch");
    expect(await importVenueGallery(db(), input, actor, true, { media, moderation }, () => undefined)).toBe(0);
    const item = (await db().query<{ id: string }>(
      `SELECT id FROM venue_gallery_items WHERE venue_id=$1 AND active AND position=1`,
      [venueId],
    )).rows[0]!;
    await db().query(`UPDATE venue_gallery_items SET active=false, is_main=false, updated_at=now() WHERE id=$1`, [item.id]);
    const calls = fake.calls;
    const lines: object[] = [];
    expect(await importVenueGallery(db(), input, actor, true, { media, moderation }, (l) => lines.push(l))).toBe(0);
    expect(fake.calls).toBe(calls);
    expect(lines).toContainEqual(expect.objectContaining({ action: "SKIPPED", reason: "GALLERY_IMPORT_REPLAY" }));
    expect((await db().query(`SELECT 1 FROM venue_gallery_items WHERE id=$1 AND active`, [item.id])).rowCount).toBe(0);

    // Same batch+index with altered identity/version → conflict, no moderation.
    const conflictLines: object[] = [];
    const calls2 = fake.calls;
    const crafted = {
      manifest: {
        ...input.manifest,
        items: [{
          ...input.manifest.items[0]!,
          expectedVersion: version + 99,
          expectedName: "Drifted Name",
        }],
      },
      images: input.images,
    };
    expect(await importVenueGallery(db(), crafted, actor, true, { media, moderation }, (l) => conflictLines.push(l))).toBe(1);
    expect(fake.calls).toBe(calls2);
    expect(conflictLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "GALLERY_IMPORT_CONFLICT" }));

    // Changed file+sha+fresh version at same batch index — no moderation.
    const mutatedBytes = await jpeg("mutated-file");
    const mutatedSha = createHash("sha256").update(mutatedBytes).digest("hex");
    const mutatedFile = `${venueId}-${mutatedSha.slice(0, 16)}.jpg`;
    const fileSwap = {
      manifest: validateGalleryManifest({
        schema: "VENUE_GALLERY_BATCH_V1",
        batch: input.manifest.batch,
        count: 1,
        items: [{
          ...input.manifest.items[0]!,
          expectedVersion: version + 1,
          file: mutatedFile,
          sha256: mutatedSha,
          evidence: { ...input.manifest.items[0]!.evidence, sourceFingerprint: mutatedSha },
        }],
      }),
      images: new Map([[mutatedFile, mutatedBytes]]),
    };
    const fileSwapCalls = fake.calls;
    const fileSwapLines: object[] = [];
    expect(await importVenueGallery(db(), fileSwap, actor, true, { media, moderation }, (l) => fileSwapLines.push(l))).toBe(1);
    expect(fake.calls).toBe(fileSwapCalls);
    expect(fileSwapLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "GALLERY_IMPORT_CONFLICT" }));

    // Changed venue at same batch index — no moderation.
    const otherVenue = await seedVenue("Other Hall B", "Other Address B");
    await seedMainCover(otherVenue, await jpeg("other-b-main"));
    const otherVersion = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [otherVenue])).rows[0]!.version;
    const venueSwapBytes = await jpeg("venue-swap");
    const venueSwap = galleryBatch(otherVenue, [{
      bytes: venueSwapBytes, expectedVersion: otherVersion, name: "Other Hall B", address: "Other Address B",
    }], input.manifest.batch);
    const venueSwapCalls = fake.calls;
    const venueSwapLines: object[] = [];
    expect(await importVenueGallery(db(), venueSwap, actor, true, { media, moderation }, (l) => venueSwapLines.push(l))).toBe(1);
    expect(fake.calls).toBe(venueSwapCalls);
    expect(venueSwapLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "GALLERY_IMPORT_CONFLICT" }));

    // Appended tail changes full manifest digest — refuse before any new paid call.
    const tailBytes = await jpeg("tail-append");
    const tailSha = createHash("sha256").update(tailBytes).digest("hex");
    const tailFile = `${venueId}-${tailSha.slice(0, 16)}.jpg`;
    const withTail = {
      manifest: validateGalleryManifest({
        schema: "VENUE_GALLERY_BATCH_V1",
        batch: input.manifest.batch,
        count: 2,
        items: [
          input.manifest.items[0]!,
          {
            ...input.manifest.items[0]!,
            expectedVersion: version + 1,
            file: tailFile,
            sha256: tailSha,
            evidence: { ...input.manifest.items[0]!.evidence, sourceFingerprint: tailSha },
          },
        ],
      }),
      images: new Map([...input.images, [tailFile, tailBytes]]),
    };
    const tailCalls = fake.calls;
    const tailLines: object[] = [];
    expect(await importVenueGallery(db(), withTail, actor, true, { media, moderation }, (l) => tailLines.push(l))).toBe(1);
    expect(fake.calls).toBe(tailCalls);
    expect(tailLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "GALLERY_IMPORT_CONFLICT" }));

    const driftVenue = await seedVenue("Hall A", "Addr A");
    await seedMainCover(driftVenue, await jpeg("drift-main"));
    const driftVersion = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [driftVenue])).rows[0]!.version;
    const driftBytes = await jpeg("drift-photo");
    const drift = galleryBatch(driftVenue, [{
      bytes: driftBytes, expectedVersion: driftVersion, name: "Wrong", address: "Addr A",
    }], "drift-batch");
    const driftCalls = fake.calls;
    const driftLines: object[] = [];
    expect(await importVenueGallery(db(), drift, actor, true, { media, moderation }, (l) => driftLines.push(l))).toBe(1);
    expect(fake.calls).toBe(driftCalls);
    expect(driftLines).toContainEqual(expect.objectContaining({ action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" }));
  });

  it("rolls back on injected post-approve failure; concurrent same admission pays once", async () => {
    const venueId = await seedVenue();
    await seedMainCover(venueId, await jpeg("rb-main"));
    const version = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    const bytes = await jpeg("rb-append");
    const input = galleryBatch(venueId, [{ bytes, expectedVersion: version }], "rollback-batch");

    const brokenModeration: Pick<ContentModerationService, "approveImage" | "bindImage"> = {
      approveImage: (...args) => moderation.approveImage(...args),
      bindImage: async () => {
        throw new Error("INJECTED_BIND_FAIL");
      },
    };
    const lines: object[] = [];
    const beforeGallery = (await db().query(`SELECT count(*)::int AS n FROM venue_gallery_items WHERE venue_id=$1 AND active`, [venueId])).rows[0]!.n;
    expect(await importVenueGallery(db(), input, actor, true, { media, moderation: brokenModeration }, (l) => lines.push(l))).toBe(1);
    expect((await db().query(`SELECT count(*)::int AS n FROM venue_gallery_items WHERE venue_id=$1 AND active`, [venueId])).rows[0]!.n).toBe(beforeGallery);
    expect((await db().query(`SELECT version FROM venues WHERE id=$1`, [venueId])).rows[0]!.version).toBe(version);

    const healthy = galleryBatch(venueId, [{ bytes: await jpeg("conc"), expectedVersion: version }], "concurrency-batch");
    const started = fake.calls;
    const [a, b] = await Promise.all([
      importVenueGallery(db(), healthy, actor, true, { media, moderation }, () => undefined),
      importVenueGallery(db(), healthy, actor, true, { media, moderation }, () => undefined),
    ]);
    expect([a, b].sort()).toEqual([0, 1]);
    const active = (await db().query(
      `SELECT count(*)::int AS n FROM venue_gallery_items WHERE venue_id=$1 AND active`,
      [venueId],
    )).rows[0]!.n;
    expect(active).toBe(2);
    // One winner paid; loser HOLD or replay — at most one additional provider call beyond cache misses.
    expect(fake.calls - started).toBeLessThanOrEqual(1);

    // Competing changed manifest while first provider holds batch claim → HOLD + one provider call.
    const holdVenue = await seedVenue("Hold Hall", "Hold Address 1");
    await seedMainCover(holdVenue, await jpeg("hold-main"));
    const holdVersion = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [holdVenue])).rows[0]!.version;
    const firstBytes = await jpeg("hold-first");
    const rivalBytes = await jpeg("hold-rival");
    const first = galleryBatch(holdVenue, [{
      bytes: firstBytes, expectedVersion: holdVersion, name: "Hold Hall", address: "Hold Address 1",
    }], "hold-batch");
    const rival = galleryBatch(holdVenue, [{
      bytes: rivalBytes, expectedVersion: holdVersion, name: "Hold Hall", address: "Hold Address 1",
    }], "hold-batch");
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    let resolveEntered!: () => void;
    const enteredProvider = new Promise<void>((resolve) => { resolveEntered = resolve; });
    let entered = false;
    const holdingModeration: Pick<ContentModerationService, "approveImage" | "bindImage"> = {
      approveImage: async (...args) => {
        if (!entered) {
          entered = true;
          resolveEntered();
          await providerGate;
        }
        return moderation.approveImage(...args);
      },
      bindImage: (...args) => moderation.bindImage(...args),
    };
    const holdStarted = fake.calls;
    const holdLines: object[] = [];
    const firstRun = importVenueGallery(db(), first, actor, true, { media, moderation: holdingModeration }, () => undefined);
    try {
      let entryTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          enteredProvider,
          firstRun.then((code) => {
            throw new Error(
              `firstRun finished before provider entry (code=${code}); identity/fixture mismatch likely — approveImage never reached`,
            );
          }),
          new Promise<never>((_, reject) => {
            entryTimer = setTimeout(
              () => reject(new Error("timed out waiting for provider entry (approveImage)")),
              15_000,
            );
          }),
        ]);
      } finally {
        if (entryTimer !== undefined) clearTimeout(entryTimer);
      }
      const rivalCode = await importVenueGallery(db(), rival, actor, true, { media, moderation }, (l) => holdLines.push(l));
      releaseProvider();
      const firstCode = await firstRun;
      expect([firstCode, rivalCode].sort()).toEqual([0, 1]);
      expect(holdLines).toContainEqual(expect.objectContaining({ action: "HOLD", reason: "OPERATION_IN_PROGRESS" }));
      expect(fake.calls - holdStarted).toBe(1);
    } finally {
      releaseProvider();
    }
  });

  it("stops later same-venue items after failure; independent venue continues; max 8", async () => {
    const venueId = await seedVenue();
    await seedMainCover(venueId, await jpeg("max-main"));
    let version = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [venueId])).rows[0]!.version;
    for (let i = 0; i < 6; i++) {
      const bytes = await jpeg(`fill-${i}`);
      const batch = galleryBatch(venueId, [{ bytes, expectedVersion: version }], `fill-${i}`);
      expect(await importVenueGallery(db(), batch, actor, true, { media, moderation }, () => undefined)).toBe(0);
      version += 1;
    }
    // 7 active (1 main + 6). One more READY, then FULL.
    const other = await seedVenue("Other Hall", "Other Address");
    await seedMainCover(other, await jpeg("other-main"));
    const otherVersion = (await db().query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [other])).rows[0]!.version;

    const lastOk = await jpeg("last-ok");
    const overflow = await jpeg("overflow");
    const otherBytes = await jpeg("other-append");
    const images = new Map<string, Buffer>();
    const items = [];
    for (const [vid, bytes, ver, name, address, batchSuffix] of [
      [venueId, lastOk, version, "Synthetic Hall", "Synthetic Address 1", "a"],
      [venueId, overflow, version + 1, "Synthetic Hall", "Synthetic Address 1", "b"],
      [other, otherBytes, otherVersion, "Other Hall", "Other Address", "c"],
    ] as const) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const file = `${vid}-${sha256.slice(0, 16)}.jpg`;
      images.set(file, bytes);
      items.push({
        venueId: vid,
        expectedName: name,
        expectedAddress: address,
        expectedVersion: ver,
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
      });
      void batchSuffix;
    }
    const mixed = {
      manifest: validateGalleryManifest({ schema: "VENUE_GALLERY_BATCH_V1", batch: "mixed-max", count: items.length, items }),
      images,
    };
    // After 7 items, 8th fills max; 9th for same venue would be FULL — but we only have 8 slots, so second venue item at version+1 fails FULL, third other venue applies.
    const lines: object[] = [];
    // First append brings venue to 8; second same-venue must FAIL FULL and block; other venue still APPLIED.
    await importVenueGallery(db(), mixed, actor, true, { media, moderation }, (l) => lines.push(l));
    expect(lines).toContainEqual(expect.objectContaining({ venueId, action: "APPLIED" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId, action: "FAILED", reason: "VENUE_GALLERY_FULL" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: other, action: "APPLIED" }));
    expect((await db().query(
      `SELECT count(*)::int AS n FROM venue_gallery_items WHERE venue_id=$1 AND active`,
      [venueId],
    )).rows[0]!.n).toBe(8);
  });
});
