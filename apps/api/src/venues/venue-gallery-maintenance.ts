import { createHash } from "node:crypto";
import { z } from "zod";
import { planGalleryStructure as planImportGalleryStructure } from "./venue-gallery-import";
import { VENUE_GALLERY_MAX } from "./venue-gallery";

const NAMESPACE = "venue_gallery_maintenance_v1";

const itemSchema = z.object({
  venueId: z.string().uuid(),
  expectedName: z.string().trim().min(1).max(160),
  expectedAddress: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive().max(2147483647),
  /** Exact final active order (positions 0..n-1). */
  orderedActiveIds: z.array(z.string().uuid()).max(VENUE_GALLERY_MAX),
  /** Exact MAIN among orderedActiveIds; null only when gallery becomes empty. */
  mainId: z.string().uuid().nullable(),
  /** Explicit approved soft-removals; must be disjoint from orderedActiveIds. */
  removeIds: z.array(z.string().uuid()).max(VENUE_GALLERY_MAX),
}).strict().superRefine((item, ctx) => {
  if (new Set(item.orderedActiveIds).size !== item.orderedActiveIds.length) {
    ctx.addIssue({ code: "custom", path: ["orderedActiveIds"], message: "DUPLICATE_GALLERY_ID" });
  }
  if (new Set(item.removeIds).size !== item.removeIds.length) {
    ctx.addIssue({ code: "custom", path: ["removeIds"], message: "DUPLICATE_GALLERY_ID" });
  }
  const ordered = new Set(item.orderedActiveIds);
  for (const id of item.removeIds) {
    if (ordered.has(id)) {
      ctx.addIssue({ code: "custom", message: "REMOVE_ORDER_OVERLAP" });
      break;
    }
  }
  if (item.orderedActiveIds.length === 0) {
    if (item.mainId !== null) {
      ctx.addIssue({ code: "custom", path: ["mainId"], message: "MAIN_REQUIRES_ACTIVE" });
    }
  } else if (item.mainId === null || !ordered.has(item.mainId)) {
    ctx.addIssue({ code: "custom", path: ["mainId"], message: "MAIN_NOT_IN_ORDER" });
  } else if (item.mainId !== item.orderedActiveIds[0]) {
    // Keep MAIN at position 0 — same public/main projection contract as setMain.
    ctx.addIssue({ code: "custom", path: ["mainId"], message: "MAIN_NOT_POSITION_ZERO" });
  }
  if (item.orderedActiveIds.length + item.removeIds.length > VENUE_GALLERY_MAX) {
    ctx.addIssue({ code: "custom", message: "VENUE_GALLERY_FULL" });
  }
});

const manifestSchema = z.object({
  schema: z.literal("VENUE_GALLERY_MAINTENANCE_V1"),
  operation: z.string().regex(/^[a-z0-9-]{1,40}$/),
  count: z.number().int().min(0).max(50),
  items: z.array(itemSchema).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.count !== manifest.items.length) {
    ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
    return;
  }
  if (new Set(manifest.items.map((item) => item.venueId)).size !== manifest.count) {
    ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
  }
});

export type GalleryMaintenanceManifest = z.infer<typeof manifestSchema>;
export type GalleryMaintenanceItem = GalleryMaintenanceManifest["items"][number];
export type GalleryMaintenancePlan = { action: "READY" | "SKIPPED" | "FAILED" | "HOLD"; reason: string };
export type GalleryMaintenanceReport = { action: GalleryMaintenancePlan["action"] | "APPLIED"; reason: string };

export type GalleryMaintenanceVenueRow = {
  name: string;
  address: string;
  lifecycle_state: string;
  version: number;
  canonical_venue_id: string | null;
};

export type GalleryMaintenanceActiveRow = {
  id: string;
  position: number;
  is_main: boolean;
};

export type AcceptedGalleryMaintenanceReceipt = {
  fingerprint: string;
  operation: string;
  venueId: string;
  itemIndex: number;
  orderedActiveIds: string[];
  mainId: string | null;
  removeIds: string[];
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

export function validateGalleryMaintenanceManifest(raw: unknown): GalleryMaintenanceManifest {
  return manifestSchema.parse(raw);
}

/** Stable per-item admission identity: operation + itemIndex only (payload bound in fingerprint). */
export function galleryMaintenanceAdmissionKeyHash(operation: string, itemIndex: number): string {
  return createHash("sha256").update(`${NAMESPACE}\n${operation}\n${itemIndex}`).digest("hex");
}

/** Full canonical item fingerprint (identity, version, ordered/main/remove). */
export function galleryMaintenanceItemFingerprint(item: GalleryMaintenanceItem): string {
  return createHash("sha256").update(stableStringify({
    venueId: item.venueId,
    expectedName: item.expectedName,
    expectedAddress: item.expectedAddress,
    expectedVersion: item.expectedVersion,
    orderedActiveIds: item.orderedActiveIds,
    mainId: item.mainId,
    removeIds: item.removeIds,
  })).digest("hex");
}

export function galleryMaintenanceManifestDigest(manifest: GalleryMaintenanceManifest): string {
  return createHash("sha256").update(
    manifest.items.map((item, index) => `${index}:${galleryMaintenanceItemFingerprint(item)}`).join("\n"),
  ).digest("hex");
}

export function planGalleryMaintenanceManifestBind(
  currentDigest: string,
  retainedDigests: readonly string[],
): GalleryMaintenancePlan | undefined {
  if (retainedDigests.length === 0) return undefined;
  if (retainedDigests.every((digest) => digest === currentDigest)) return undefined;
  return { action: "FAILED", reason: "GALLERY_MAINTENANCE_CONFLICT" };
}

export function planGalleryMaintenanceReplay(
  fingerprint: string,
  receipt: AcceptedGalleryMaintenanceReceipt,
): GalleryMaintenancePlan {
  if (receipt.fingerprint !== fingerprint) {
    return { action: "FAILED", reason: "GALLERY_MAINTENANCE_CONFLICT" };
  }
  return { action: "SKIPPED", reason: "GALLERY_MAINTENANCE_REPLAY" };
}

/** Identity / lifecycle / exact active-set / CAS gate. No provider I/O. */
export function planGalleryMaintenanceRow(
  row: GalleryMaintenanceVenueRow | undefined,
  item: GalleryMaintenanceItem,
  active: GalleryMaintenanceActiveRow[],
): GalleryMaintenancePlan {
  if (!row) return { action: "FAILED", reason: "VENUE_NOT_FOUND" };
  if (!["unverified", "verified"].includes(row.lifecycle_state) || row.canonical_venue_id !== null) {
    return { action: "SKIPPED", reason: "VENUE_INELIGIBLE" };
  }
  if (row.name !== item.expectedName || row.address !== item.expectedAddress) {
    return { action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" };
  }
  const structure = planImportGalleryStructure(
    active.map((entry) => ({ position: entry.position, is_main: entry.is_main, source_fingerprint: null })),
  );
  if (structure.action !== "READY") {
    return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
  }
  if (active.length > VENUE_GALLERY_MAX) {
    return { action: "FAILED", reason: "VENUE_GALLERY_CORRUPT" };
  }

  const activeIds = active.map((entry) => entry.id);
  const activeSet = new Set(activeIds);
  const orderedSet = new Set(item.orderedActiveIds);
  const removeSet = new Set(item.removeIds);

  if (activeIds.length !== item.orderedActiveIds.length + item.removeIds.length) {
    return { action: "FAILED", reason: "VENUE_GALLERY_SET_MISMATCH" };
  }
  for (const id of item.orderedActiveIds) {
    if (!activeSet.has(id)) return { action: "FAILED", reason: "VENUE_GALLERY_SET_MISMATCH" };
  }
  for (const id of item.removeIds) {
    if (!activeSet.has(id)) return { action: "FAILED", reason: "VENUE_GALLERY_SET_MISMATCH" };
  }
  for (const id of activeIds) {
    if (!orderedSet.has(id) && !removeSet.has(id)) {
      return { action: "FAILED", reason: "VENUE_GALLERY_SET_MISMATCH" };
    }
  }

  if (row.version !== item.expectedVersion) {
    return { action: "FAILED", reason: "VENUE_VERSION_CONFLICT" };
  }

  // No-op already-matching state is still READY under CAS (apply bumps version once).
  return { action: "READY", reason: "GALLERY_MAINTENANCE_READY" };
}

export function buildAcceptedGalleryMaintenanceReceipt(
  manifest: GalleryMaintenanceManifest,
  item: GalleryMaintenanceItem,
  itemIndex: number,
): AcceptedGalleryMaintenanceReceipt {
  return {
    fingerprint: galleryMaintenanceItemFingerprint(item),
    operation: manifest.operation,
    venueId: item.venueId,
    itemIndex,
    orderedActiveIds: item.orderedActiveIds,
    mainId: item.mainId,
    removeIds: item.removeIds,
  };
}

// Re-export max for CLI/tests without pulling the wrong import path.
export { VENUE_GALLERY_MAX };
