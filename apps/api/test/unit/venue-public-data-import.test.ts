import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  planPublicDataReplay,
  planPublicDataRow,
  planPublicDataVersion,
  publicDataDigest,
  publicDataKeyHash,
  publicDataPatchFingerprint,
  validatePublicDataManifest,
} from "../../src/venues/venue-public-data-import";
import { guardImportEnv, main, readBatchFile } from "../../src/database/import-venue-covers";

function contacts() {
  return {
    phone: "+7 999 000-00-00",
    website: "https://example.com/club",
    messengers: [{ kind: "telegram" as const, url: "https://t.me/club" }],
  };
}

function fixture(overrides: Record<string, unknown> = {}) {
  const venueId = randomUUID();
  const item = {
    venueId,
    expectedVersion: 1,
    expectedName: "Synthetic Hall",
    expectedAddress: "Synthetic Address 1",
    publicContacts: contacts(),
    sources: [{
      url: "https://example.com/source",
      checkedAt: "2026-10-27T12:00:00.000Z",
      note: "official site contacts",
    }],
    ...overrides,
  };
  return {
    schema: "VENUE_PUBLIC_DATA_BATCH_V1" as const,
    batch: "reviewed-public-1",
    count: 1,
    items: [item],
  };
}

describe("venue public data batch validation", () => {
  it("accepts contacts/profile patches and stable digests", () => {
    const raw = fixture({
      profile: { courtCount: 4, amenities: { parking: true, showers: null } },
    });
    const parsed = validatePublicDataManifest(raw);
    expect(parsed.count).toBe(1);
    expect(publicDataKeyHash(parsed.batch, parsed.items[0]!.venueId)).toMatch(/^[a-f0-9]{64}$/);
    expect(publicDataPatchFingerprint(parsed.items[0]!)).toMatch(/^[a-f0-9]{64}$/);
    expect(publicDataDigest(parsed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { extra: true },
    { schema: "wrong" },
    { batch: "INVALID" },
    { count: 0 },
  ])("rejects invalid root %j", (patch) => {
    expect(() => validatePublicDataManifest({ ...fixture(), ...patch })).toThrow();
  });

  it("rejects unknown private/lifecycle/cover fields and missing patch", () => {
    const base = fixture();
    for (const patch of [
      { contact_phone: "+7000" },
      { contact_website: "https://private.invalid" },
      { booking_note: "secret" },
      { lifecycle_state: "verified" },
      { cover_key: "x" },
    ]) {
      expect(() => validatePublicDataManifest({
        ...base,
        items: [{ ...base.items[0]!, ...patch }],
      })).toThrow();
    }
    const { publicContacts: _drop, ...withoutPatch } = base.items[0]!;
    expect(() => validatePublicDataManifest({
      ...base,
      items: [withoutPatch],
    })).toThrow();
  });

  it("rejects duplicates, empty sources and bad source URLs", () => {
    const raw = fixture();
    const first = raw.items[0]!;
    expect(() => validatePublicDataManifest({
      ...raw,
      count: 2,
      items: [first, { ...first, expectedVersion: 2 }],
    })).toThrow();
    expect(() => validatePublicDataManifest({
      ...raw,
      items: [{ ...first, sources: [] }],
    })).toThrow();
    expect(() => validatePublicDataManifest({
      ...raw,
      items: [{
        ...first,
        sources: [{ url: "not-a-url", checkedAt: "2026-10-27T12:00:00.000Z", note: "x" }],
      }],
    })).toThrow();
  });

  it("allows explicit null clears and rejects file/symlink escapes for the CLI adapter", async () => {
    const cleared = fixture({ publicContacts: null, profile: null });
    expect(validatePublicDataManifest(cleared).items[0]!.publicContacts).toBeNull();
    const dir = await mkdtemp(path.join(tmpdir(), "public-data-unit-"));
    try {
      await writeFile(path.join(dir, "batch.json"), JSON.stringify(fixture()));
      expect(JSON.parse((await readBatchFile(dir, "batch.json", 256 * 1024)).toString("utf8")).schema)
        .toBe("VENUE_PUBLIC_DATA_BATCH_V1");
      await symlink(path.join(dir, "batch.json"), path.join(dir, "link.json"));
      await expect(readBatchFile(dir, "link.json", 256 * 1024)).rejects.toThrow();
      await expect(readBatchFile(dir, "../batch.json", 100)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("plans identity, version and replay outcomes", () => {
    const item = validatePublicDataManifest(fixture()).items[0]!;
    const row = {
      name: item.expectedName,
      address: item.expectedAddress,
      lifecycle_state: "verified",
      version: 1,
      canonical_venue_id: null as string | null,
      public_contacts: item.publicContacts,
      court_count: null,
      amenity_parking: null,
      amenity_showers: null,
    };
    expect(planPublicDataRow(undefined, item).action).toBe("FAILED");
    expect(planPublicDataRow({ ...row, lifecycle_state: "retired" }, item).action).toBe("SKIPPED");
    expect(planPublicDataRow({ ...row, name: "Other" }, item).reason).toBe("VENUE_IDENTITY_MISMATCH");
    expect(planPublicDataVersion({ ...row, version: 2 }, item).reason).toBe("VENUE_VERSION_CONFLICT");
    const fingerprint = publicDataPatchFingerprint(item);
    expect(planPublicDataReplay(row, fingerprint, {
      fingerprint,
      publicContacts: item.publicContacts ?? null,
    }).action).toBe("SKIPPED");
    expect(planPublicDataReplay(row, fingerprint, {
      fingerprint: "0".repeat(64),
      publicContacts: item.publicContacts ?? null,
    }).reason).toBe("PUBLIC_DATA_CONFLICT");
    expect(planPublicDataReplay({ ...row, public_contacts: null }, fingerprint, {
      fingerprint,
      publicContacts: item.publicContacts ?? null,
    }).reason).toBe("PUBLIC_DATA_DRIFT");
  });

  it("CLI refuses unsafe environment before loading files or connecting", async () => {
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
      await expect(main(["--public-data"], { ...safe, ...patch })).rejects.toThrow("IMPORT_ENV_REFUSED");
    }
  });
});
