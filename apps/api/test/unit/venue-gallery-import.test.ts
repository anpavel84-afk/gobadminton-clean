import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, it, expect } from "vitest";
import {
  galleryAdmissionKeyHash,
  galleryItemFingerprint,
  galleryManifestDigest,
  planGalleryAttemptReplay,
  planGalleryManifestBind,
  planGalleryReplay,
  planGalleryRow,
  planGalleryStructure,
  validateGalleryManifest,
  validateImage,
} from "../../src/venues/venue-gallery-import";
import { guardImportEnv, loadGalleryBatch, main, readBatchFile } from "../../src/database/import-venue-covers";
import {
  galleryMaintenanceAdmissionKeyHash,
  galleryMaintenanceItemFingerprint,
  galleryMaintenanceManifestDigest,
  planGalleryMaintenanceManifestBind,
  planGalleryMaintenanceReplay,
  planGalleryMaintenanceRow,
  validateGalleryMaintenanceManifest,
} from "../../src/venues/venue-gallery-maintenance";

function evidence(sha: string) {
  return {
    creditKind: "photo" as const,
    creditText: "Фото: Клуб",
    creditUrl: "https://example.com/photo",
    sourceUrl: "https://example.com/photo",
    sourceAuthor: null as string | null,
    permissionBasis: "Owner-confirmed portal/club photograph rights recorded for DEV catalog import",
    sourceFingerprint: sha.toLowerCase(),
  };
}

function item(opts: {
  venueId?: string;
  sha256?: string;
  expectedVersion?: number;
  expectedName?: string;
  expectedAddress?: string;
  file?: string;
  evidence?: ReturnType<typeof evidence>;
} = {}) {
  const venueId = opts.venueId ?? randomUUID();
  const sha256 = opts.sha256 ?? "a".repeat(64);
  const sha = sha256.toLowerCase();
  return {
    venueId,
    expectedName: opts.expectedName ?? "Synthetic Hall",
    expectedAddress: opts.expectedAddress ?? "Synthetic Address 1",
    expectedVersion: opts.expectedVersion ?? 1,
    file: opts.file ?? `${venueId}-${sha.slice(0, 16)}.jpg`,
    sha256,
    evidence: opts.evidence ?? evidence(sha),
  };
}

function fixture(items?: ReturnType<typeof item>[]) {
  const list = items ?? [item()];
  return { schema: "VENUE_GALLERY_BATCH_V1" as const, batch: "reviewed-gallery-1", count: list.length, items: list };
}

describe("venue gallery batch validation", () => {
  it("accepts photo evidence bound to raw sha and stable admission fingerprints", () => {
    const raw = fixture();
    const parsed = validateGalleryManifest(raw);
    expect(parsed.count).toBe(1);
    const admission = galleryAdmissionKeyHash(parsed.batch, 0);
    expect(admission).toMatch(/^[a-f0-9]{64}$/);
    // Stable identity is batch+index — payload/venue/file mutation must not mint a new key.
    expect(galleryAdmissionKeyHash(parsed.batch, 0)).toBe(admission);
    expect(galleryAdmissionKeyHash(parsed.batch, 1)).not.toBe(admission);
    expect(galleryItemFingerprint(parsed.items[0]!)).toMatch(/^[a-f0-9]{64}$/);
    const digest = galleryManifestDigest(parsed);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(planGalleryManifestBind(digest, [])).toBeUndefined();
    expect(planGalleryManifestBind(digest, [digest])).toBeUndefined();
    expect(planGalleryManifestBind(digest, ["0".repeat(64)])?.reason).toBe("GALLERY_IMPORT_CONFLICT");
    expect(planGalleryManifestBind(digest, [digest, "0".repeat(64)])?.reason).toBe("GALLERY_IMPORT_CONFLICT");
  });

  it.each([
    { extra: true },
    { schema: "wrong" },
    { batch: "INVALID" },
    { count: 0 },
  ])("rejects invalid root %j", (patch) => {
    expect(() => validateGalleryManifest({ ...fixture(), ...patch })).toThrow();
  });

  it("rejects bad file names, fingerprint drift, illustration credit and always-true permission", () => {
    const venueId = randomUUID();
    const sha = "b".repeat(64);
    expect(() => validateGalleryManifest(fixture([item({ venueId, sha256: sha, file: `${venueId}.jpg` })]))).toThrow();
    expect(() => validateGalleryManifest(fixture([item({
      venueId, sha256: sha,
      evidence: { ...evidence(sha), sourceFingerprint: "c".repeat(64) },
    })]))).toThrow();
    expect(() => validateGalleryManifest(fixture([item({
      venueId, sha256: sha,
      evidence: {
        creditKind: "illustration" as const,
        creditText: "Иллюстрация",
        creditUrl: null,
        permissionBasis: "note",
        sourceFingerprint: sha,
      } as unknown as ReturnType<typeof evidence>,
    })]))).toThrow();
    expect(() => validateGalleryManifest(fixture([item({
      venueId, sha256: sha,
      evidence: { ...evidence(sha), permissionBasis: "true" },
    })]))).toThrow();
  });

  it("rejects duplicate files, venue+sha pairs, non-contiguous versions and >8 per venue", () => {
    const venueId = randomUUID();
    const sha1 = "1".repeat(64);
    const sha2 = "2".repeat(64);
    const first = item({ venueId, sha256: sha1, expectedVersion: 3 });
    expect(() => validateGalleryManifest(fixture([first, { ...first, expectedVersion: 4 }]))).toThrow();
    expect(() => validateGalleryManifest(fixture([
      item({ venueId, sha256: sha1, expectedVersion: 3 }),
      item({ venueId, sha256: sha2, expectedVersion: 5 }),
    ]))).toThrow();
    const many = Array.from({ length: 9 }, (_, i) => item({
      venueId,
      sha256: createHash("sha256").update(String(i)).digest("hex"),
      expectedVersion: 1 + i,
    }));
    expect(() => validateGalleryManifest(fixture(many))).toThrow();
  });

  it("accepts contiguous multi-item same venue and checks JPEG bounds", async () => {
    const venueId = randomUUID();
    const dir = await mkdtemp(path.join(tmpdir(), "gallery-import-unit-"));
    try {
      const bytes = await sharp({ create: { width: 50, height: 50, channels: 3, background: "red" } }).jpeg().toBuffer();
      const hash = createHash("sha256").update(bytes).digest("hex");
      validateImage(bytes, hash);
      for (const [input, digest] of [[bytes, "0".repeat(64)], [Buffer.from("not jpeg"), hash], [Buffer.alloc(2 * 1024 * 1024 + 1), hash]] as const) {
        expect(() => validateImage(input, digest)).toThrow();
      }
      const bytes2 = await sharp({ create: { width: 51, height: 50, channels: 3, background: "blue" } }).jpeg().toBuffer();
      const hash2 = createHash("sha256").update(bytes2).digest("hex");
      const batch = fixture([
        item({ venueId, sha256: hash, expectedVersion: 2 }),
        item({ venueId, sha256: hash2, expectedVersion: 3 }),
      ]);
      await writeFile(path.join(dir, batch.items[0]!.file), bytes);
      await writeFile(path.join(dir, batch.items[1]!.file), bytes2);
      await writeFile(path.join(dir, "batch.json"), JSON.stringify(batch));
      expect((await loadGalleryBatch(dir, "batch.json")).manifest.count).toBe(2);
      await symlink(path.join(dir, "batch.json"), path.join(dir, "link.json"));
      await expect(loadGalleryBatch(dir, "link.json")).rejects.toThrow();
      await expect(readBatchFile(dir, "../batch.json", 100)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("plans identity/version/capacity and replay before stale version", () => {
    const venueId = randomUUID();
    const sha = "d".repeat(64);
    const rowItem = item({ venueId, sha256: sha, expectedVersion: 3, expectedName: "Hall", expectedAddress: "Addr" });
    const row = { name: "Hall", address: "Addr", lifecycle_state: "verified", version: 3, canonical_venue_id: null };
    expect(planGalleryRow(undefined, rowItem, []).action).toBe("FAILED");
    expect(planGalleryRow({ ...row, lifecycle_state: "merged" }, rowItem, []).action).toBe("SKIPPED");
    expect(planGalleryRow({ ...row, canonical_venue_id: randomUUID() }, rowItem, []).action).toBe("SKIPPED");
    expect(planGalleryRow({ ...row, name: "Other" }, rowItem, []).reason).toBe("VENUE_IDENTITY_MISMATCH");
    expect(planGalleryRow({ ...row, version: 4 }, rowItem, []).reason).toBe("VENUE_VERSION_CONFLICT");
    expect(planGalleryRow(row, rowItem, [{ position: 0, is_main: true, source_fingerprint: sha }]).reason).toBe("EXISTING_SOURCE_FINGERPRINT");
    const full = Array.from({ length: 8 }, (_, i) => ({ position: i, is_main: i === 0, source_fingerprint: null }));
    expect(planGalleryRow(row, rowItem, full).reason).toBe("VENUE_GALLERY_FULL");
    expect(planGalleryStructure([
      { position: 0, is_main: true, source_fingerprint: null },
      { position: 2, is_main: false, source_fingerprint: null },
    ]).reason).toBe("VENUE_GALLERY_CORRUPT");
    expect(planGalleryRow(row, rowItem, [{ position: 0, is_main: true, source_fingerprint: null }]).action).toBe("READY");
    const fp = galleryItemFingerprint(validateGalleryManifest(fixture([rowItem])).items[0]!);
    expect(planGalleryReplay(fp, {
      fingerprint: fp, batch: "reviewed-gallery-1", file: rowItem.file, sha256: sha, itemIndex: 0, evidence: evidence(sha),
    }).reason).toBe("GALLERY_IMPORT_REPLAY");
    expect(planGalleryReplay("0".repeat(64), {
      fingerprint: fp, batch: "reviewed-gallery-1", file: rowItem.file, sha256: sha, itemIndex: 0, evidence: evidence(sha),
    }).reason).toBe("GALLERY_IMPORT_CONFLICT");
    const digest = galleryManifestDigest(validateGalleryManifest(fixture([rowItem])));
    expect(planGalleryAttemptReplay(fp, digest, {
      fingerprint: fp, digest, batch: "reviewed-gallery-1", file: rowItem.file, sha256: sha, itemIndex: 0,
    })).toEqual({ action: "HOLD", reason: "OPERATION_OUTCOME_UNKNOWN" });
    expect(planGalleryAttemptReplay(fp, digest, {
      fingerprint: "0".repeat(64), digest, batch: "reviewed-gallery-1", file: rowItem.file, sha256: sha, itemIndex: 0,
    }).reason).toBe("GALLERY_IMPORT_CONFLICT");
    expect(planGalleryAttemptReplay(fp, "0".repeat(64), {
      fingerprint: fp, digest, batch: "reviewed-gallery-1", file: rowItem.file, sha256: sha, itemIndex: 0,
    }).reason).toBe("GALLERY_IMPORT_CONFLICT");
  });

  it("CLI refuses unsafe environment and exclusive --gallery/--public-data/--gallery-maintenance", async () => {
    const safe = {
      APP_ENV: "stage",
      PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
      AVATAR_MEDIA_ROOT: "/synthetic",
      CONTENT_MODERATION_PROVIDER: "openai",
    };
    expect(() => guardImportEnv(safe)).not.toThrow();
    for (const patch of [
      { APP_ENV: "prod" },
      { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" },
      { AVATAR_MEDIA_ROOT: "" },
      { CONTENT_MODERATION_PROVIDER: "fake" },
    ]) {
      await expect(main([], { ...safe, ...patch })).rejects.toThrow("IMPORT_ENV_REFUSED");
    }
    await expect(main([
      "--gallery", "--public-data", "--dir", "/tmp", "--manifest", "x.json", "--actor-principal-id", randomUUID(),
    ], safe)).rejects.toThrow("INVALID_ARGUMENTS");
    await expect(main([
      "--gallery", "--gallery-maintenance", "--dir", "/tmp", "--manifest", "x.json", "--actor-principal-id", randomUUID(),
    ], safe)).rejects.toThrow("INVALID_ARGUMENTS");
  });
});

describe("venue gallery maintenance validation", () => {
  function maintenanceItem(opts: {
    venueId?: string;
    expectedVersion?: number;
    expectedName?: string;
    expectedAddress?: string;
    orderedActiveIds?: string[];
    mainId?: string | null;
    removeIds?: string[];
  } = {}) {
    const venueId = opts.venueId ?? randomUUID();
    const keep = opts.orderedActiveIds ?? [randomUUID()];
    return {
      venueId,
      expectedName: opts.expectedName ?? "Synthetic Hall",
      expectedAddress: opts.expectedAddress ?? "Synthetic Address 1",
      expectedVersion: opts.expectedVersion ?? 1,
      orderedActiveIds: keep,
      mainId: opts.mainId === undefined ? (keep[0] ?? null) : opts.mainId,
      removeIds: opts.removeIds ?? [],
    };
  }

  function maintenanceFixture(items?: ReturnType<typeof maintenanceItem>[]) {
    const list = items ?? [maintenanceItem()];
    return {
      schema: "VENUE_GALLERY_MAINTENANCE_V1" as const,
      operation: "owner488-reorder-1",
      count: list.length,
      items: list,
    };
  }

  it("accepts exact order/main/remove and stable admission fingerprints", () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const raw = maintenanceFixture([maintenanceItem({
      orderedActiveIds: [b, a],
      mainId: b,
      removeIds: [c],
    })]);
    const parsed = validateGalleryMaintenanceManifest(raw);
    expect(parsed.count).toBe(1);
    const admission = galleryMaintenanceAdmissionKeyHash(parsed.operation, 0);
    expect(admission).toMatch(/^[a-f0-9]{64}$/);
    expect(galleryMaintenanceAdmissionKeyHash(parsed.operation, 0)).toBe(admission);
    expect(galleryMaintenanceAdmissionKeyHash(parsed.operation, 1)).not.toBe(admission);
    const fp = galleryMaintenanceItemFingerprint(parsed.items[0]!);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
    const digest = galleryMaintenanceManifestDigest(parsed);
    expect(planGalleryMaintenanceManifestBind(digest, [])).toBeUndefined();
    expect(planGalleryMaintenanceManifestBind(digest, [digest])).toBeUndefined();
    expect(planGalleryMaintenanceManifestBind(digest, ["0".repeat(64)])?.reason).toBe("GALLERY_MAINTENANCE_CONFLICT");
  });

  it("rejects overlap, missing main, non-zero main, duplicate venues", () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(() => validateGalleryMaintenanceManifest(maintenanceFixture([maintenanceItem({
      orderedActiveIds: [a], mainId: a, removeIds: [a],
    })]))).toThrow();
    expect(() => validateGalleryMaintenanceManifest(maintenanceFixture([maintenanceItem({
      orderedActiveIds: [a, b], mainId: b,
    })]))).toThrow();
    expect(() => validateGalleryMaintenanceManifest(maintenanceFixture([maintenanceItem({
      orderedActiveIds: [], mainId: a,
    })]))).toThrow();
    const venueId = randomUUID();
    expect(() => validateGalleryMaintenanceManifest(maintenanceFixture([
      maintenanceItem({ venueId, orderedActiveIds: [a], mainId: a }),
      maintenanceItem({ venueId, orderedActiveIds: [b], mainId: b }),
    ]))).toThrow();
  });

  it("plans identity/CAS/set mismatch and known replay without inventing provider work", () => {
    const a = randomUUID();
    const b = randomUUID();
    const venueId = randomUUID();
    const item = maintenanceItem({
      venueId,
      expectedVersion: 4,
      expectedName: "Hall",
      expectedAddress: "Addr",
      orderedActiveIds: [b, a],
      mainId: b,
      removeIds: [],
    });
    const row = { name: "Hall", address: "Addr", lifecycle_state: "verified", version: 4, canonical_venue_id: null };
    const active = [
      { id: a, position: 0, is_main: true },
      { id: b, position: 1, is_main: false },
    ];
    expect(planGalleryMaintenanceRow(undefined, item, active).reason).toBe("VENUE_NOT_FOUND");
    expect(planGalleryMaintenanceRow({ ...row, name: "Other" }, item, active).reason).toBe("VENUE_IDENTITY_MISMATCH");
    expect(planGalleryMaintenanceRow({ ...row, version: 3 }, item, active).reason).toBe("VENUE_VERSION_CONFLICT");
    expect(planGalleryMaintenanceRow(row, item, [active[0]!]).reason).toBe("VENUE_GALLERY_SET_MISMATCH");
    expect(planGalleryMaintenanceRow(row, item, active).action).toBe("READY");
    const removeItem = maintenanceItem({
      venueId,
      expectedVersion: 4,
      expectedName: "Hall",
      expectedAddress: "Addr",
      orderedActiveIds: [b],
      mainId: b,
      removeIds: [a],
    });
    expect(planGalleryMaintenanceRow(row, removeItem, active).action).toBe("READY");
    const fp = galleryMaintenanceItemFingerprint(validateGalleryMaintenanceManifest(maintenanceFixture([item])).items[0]!);
    expect(planGalleryMaintenanceReplay(fp, {
      fingerprint: fp,
      operation: "owner488-reorder-1",
      venueId,
      itemIndex: 0,
      orderedActiveIds: item.orderedActiveIds,
      mainId: item.mainId,
      removeIds: item.removeIds,
    }).reason).toBe("GALLERY_MAINTENANCE_REPLAY");
    expect(planGalleryMaintenanceReplay("0".repeat(64), {
      fingerprint: fp,
      operation: "owner488-reorder-1",
      venueId,
      itemIndex: 0,
      orderedActiveIds: item.orderedActiveIds,
      mainId: item.mainId,
      removeIds: item.removeIds,
    }).reason).toBe("GALLERY_MAINTENANCE_CONFLICT");
  });
});
