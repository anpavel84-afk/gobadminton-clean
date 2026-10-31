import { createHash } from "node:crypto";
import { z } from "zod";
import { validateImage } from "./venue-cover-import";
import {
  VENUE_GALLERY_MAX,
  galleryEvidenceSchema,
  type GalleryEvidence,
} from "./venue-gallery";

const NAMESPACE = "venue_gallery_batch_v1";

const itemSchema = z.object({
  venueId: z.string().uuid(),
  expectedName: z.string().trim().min(1).max(160),
  expectedAddress: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive().max(2147483647),
  file: z.string().min(1).max(200),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  evidence: galleryEvidenceSchema,
}).strict().superRefine((item, ctx) => {
  const sha = item.sha256.toLowerCase();
  const expectedFile = `${item.venueId}-${sha.slice(0, 16)}.jpg`;
  if (item.file !== expectedFile) {
    ctx.addIssue({ code: "custom", message: "INVALID_FILE" });
  }
  if (item.evidence.sourceFingerprint !== sha) {
    ctx.addIssue({ code: "custom", path: ["evidence", "sourceFingerprint"], message: "SOURCE_FINGERPRINT_MISMATCH" });
  }
  // Photographic batch input must carry photo evidence — no invented illustration credit.
  if (item.evidence.creditKind !== "photo") {
    ctx.addIssue({ code: "custom", path: ["evidence", "creditKind"], message: "PHOTO_EVIDENCE_REQUIRED" });
  }
});

const manifestSchema = z.object({
  schema: z.literal("VENUE_GALLERY_BATCH_V1"),
  batch: z.string().regex(/^[a-z0-9-]{1,40}$/),
  count: z.number().int().min(0).max(50),
  items: z.array(itemSchema).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.count !== manifest.items.length) {
    ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
    return;
  }
  if (new Set(manifest.items.map((item) => item.file)).size !== manifest.count) {
    ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
  }
  const venueSha = new Set<string>();
  const perVenue = new Map<string, number[]>();
  for (let index = 0; index < manifest.items.length; index++) {
    const item = manifest.items[index]!;
    const sha = item.sha256.toLowerCase();
    const key = `${item.venueId}:${sha}`;
    if (venueSha.has(key)) {
      ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
    }
    venueSha.add(key);
    const versions = perVenue.get(item.venueId) ?? [];
    versions.push(item.expectedVersion);
    perVenue.set(item.venueId, versions);
  }
  for (const versions of perVenue.values()) {
    if (versions.length > VENUE_GALLERY_MAX) {
      ctx.addIssue({ code: "custom", message: "VENUE_GALLERY_BATCH_TOO_MANY" });
    }
    for (let i = 1; i < versions.length; i++) {
      if (versions[i] !== versions[i - 1]! + 1) {
        ctx.addIssue({ code: "custom", message: "EXPECTED_VERSIONS_NOT_CONTIGUOUS" });
        break;
      }
    }
  }
});

export type GalleryManifest = z.infer<typeof manifestSchema>;
export type GalleryImportItem = GalleryManifest["items"][number];
export type GalleryImportPlan = { action: "READY" | "SKIPPED" | "FAILED" | "HOLD"; reason: string };

export type GalleryVenueRow = {
  name: string;
  address: string;
  lifecycle_state: string;
  version: number;
  canonical_venue_id: string | null;
};

export type GalleryActiveRow = {
  position: number;
  is_main: boolean;
  source_fingerprint: string | null;
};

export type AcceptedGalleryReceipt = {
  fingerprint: string;
  batch: string;
  file: string;
  sha256: string;
  itemIndex: number;
  evidence: GalleryEvidence;
};

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) out[key] = sortValue(nested);
    return out;
  }
  return value;
}

export function validateGalleryManifest(raw: unknown): GalleryManifest {
  return manifestSchema.parse(raw);
}

export { validateImage };

/** Stable per-item admission key: batch + venue + file/index. */
export function galleryAdmissionKeyHash(batch: string, venueId: string, file: string, itemIndex: number): string {
  return createHash("sha256").update(`${NAMESPACE}\n${batch}\n${venueId}\n${itemIndex}\n${file}`).digest("hex");
}

/** Full canonical item fingerprint (identity, version, file, raw sha, evidence). */
export function galleryItemFingerprint(item: GalleryImportItem): string {
  return createHash("sha256").update(stableStringify({
    venueId: item.venueId,
    expectedName: item.expectedName,
    expectedAddress: item.expectedAddress,
    expectedVersion: item.expectedVersion,
    file: item.file,
    sha256: item.sha256.toLowerCase(),
    evidence: {
      ...item.evidence,
      sourceFingerprint: item.evidence.sourceFingerprint?.toLowerCase() ?? null,
    },
  })).digest("hex");
}

export function galleryManifestDigest(manifest: GalleryManifest): string {
  return createHash("sha256").update(
    manifest.items.map((item, index) => `${index}:${galleryItemFingerprint(item)}`).join("\n"),
  ).digest("hex");
}

export function planGalleryReplay(
  fingerprint: string,
  receipt: AcceptedGalleryReceipt,
): GalleryImportPlan {
  if (receipt.fingerprint !== fingerprint) {
    return { action: "FAILED", reason: "GALLERY_IMPORT_CONFLICT" };
  }
  return { action: "SKIPPED", reason: "GALLERY_IMPORT_REPLAY" };
}

/** Identity / lifecycle / gallery shape / capacity / active-fingerprint gate. */
export function planGalleryRow(
  row: GalleryVenueRow | undefined,
  item: GalleryImportItem,
  active: GalleryActiveRow[],
  options: { simulatedAppends?: number } = {},
): GalleryImportPlan {
  if (!row) return { action: "FAILED", reason: "VENUE_NOT_FOUND" };
  if (!["unverified", "verified"].includes(row.lifecycle_state) || row.canonical_venue_id !== null) {
    return { action: "SKIPPED", reason: "VENUE_INELIGIBLE" };
  }
  if (row.name !== item.expectedName || row.address !== item.expectedAddress) {
    return { action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" };
  }
  const structure = planGalleryStructure(active);
  if (structure.action !== "READY") return structure;

  const sha = item.sha256.toLowerCase();
  if (active.some((entry) => entry.source_fingerprint === sha)) {
    return { action: "SKIPPED", reason: "EXISTING_SOURCE_FINGERPRINT" };
  }

  const projectedCount = active.length + (options.simulatedAppends ?? 0);
  if (projectedCount >= VENUE_GALLERY_MAX) {
    return { action: "FAILED", reason: "VENUE_GALLERY_FULL" };
  }

  if (row.version !== item.expectedVersion) {
    return { action: "FAILED", reason: "VENUE_VERSION_CONFLICT" };
  }
  return { action: "READY", reason: "GALLERY_APPEND_READY" };
}

export function planGalleryStructure(active: GalleryActiveRow[]): GalleryImportPlan {
  const n = active.length;
  if (n > VENUE_GALLERY_MAX) return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
  const mains = active.filter((entry) => entry.is_main);
  if (n === 0) {
    if (mains.length !== 0) return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
    return { action: "READY", reason: "GALLERY_APPEND_READY" };
  }
  if (mains.length !== 1) return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
  const positions = active.map((entry) => entry.position).sort((a, b) => a - b);
  for (let i = 0; i < n; i++) {
    if (positions[i] !== i) return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
  }
  return { action: "READY", reason: "GALLERY_APPEND_READY" };
}

export function buildAcceptedGalleryReceipt(
  manifest: GalleryManifest,
  item: GalleryImportItem,
  itemIndex: number,
): AcceptedGalleryReceipt {
  return {
    fingerprint: galleryItemFingerprint(item),
    batch: manifest.batch,
    file: item.file,
    sha256: item.sha256.toLowerCase(),
    itemIndex,
    evidence: item.evidence,
  };
}
