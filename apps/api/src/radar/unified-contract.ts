import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { AppEnv } from "../config/env";
import { fixSchema } from "./geographic-contract";

export const UNIFIED_WIRE = "players-unified-radar-v1";
export const UNIFIED_POLICY = "radar-geographic-sharing-v2";
export const UNIFIED_DISCLOSURE_ID = "radar-geographic-sharing-v2.ru.v1";
export const UNIFIED_DISCLOSURE_TEXT =
  "Включая Radar, вы временно показываете авторизованным пользователям GoBadminton своё примерное местоположение и расстояние до вас. При точной геолокации используется ячейка около 100 м, при неточной — около 1 км; точность зависит от устройства. Расстояние приблизительное, по прямой. Вы можете выключить Radar в любой момент. В фоне передача прекращается, сеанс ограничен по времени.";
export const UNIFIED_DISCLOSURE_HASH = createHash("sha256")
  .update(UNIFIED_DISCLOSURE_TEXT)
  .digest("hex");
export const modelSchema = z.enum([
  "regional_grid_100m_v1",
  "regional_grid_1000m_v1",
]);
export const filtersSchema = z.strictObject({
  cityId: z.uuid(),
  areaKey: z.string().max(64).optional(),
  name: z.string().max(100).optional(),
  looking: z.boolean().optional(),
  trainer: z.boolean().optional(),
});
const originInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("foreground_fix"), location: fixSchema }),
  z.strictObject({
    kind: z.literal("current_activation"),
    activationId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("reference"),
    originRef: z.string().min(1).max(4096),
  }),
]);
export const initialSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  filters: filtersSchema,
  origin: originInput,
  limit: z.number().int().min(1).max(50).optional(),
});
export const continuationSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  queryRef: z.string().min(1).max(4096),
  cursor: z.string().min(1).max(4096),
  limit: z.number().int().min(1).max(50).optional(),
});
export const mapSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  queryRef: z.string().min(1).max(4096),
  mapCursor: z.string().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export const unifiedConsentSchema = z.strictObject({
  disclosureId: z.literal(UNIFIED_DISCLOSURE_ID),
  disclosureHash: z.literal(UNIFIED_DISCLOSURE_HASH),
  accepted: z.literal(true),
});
export const unifiedStartSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  consentPolicyVersion: z.literal(UNIFIED_POLICY),
  consent: unifiedConsentSchema,
  location: fixSchema,
  ttlMinutes: z.number().int().min(1).max(15).optional(),
  radiusBucketKm: z
    .union([z.literal(3), z.literal(5), z.literal(10)])
    .optional(),
});
export const unifiedTakeoverSchema = unifiedStartSchema.extend({
  activationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  confirm: z.literal(true),
});
export const unifiedUpdateSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  consentPolicyVersion: z.literal(UNIFIED_POLICY),
  activationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  location: fixSchema.optional(),
  radiusBucketKm: z
    .union([z.literal(3), z.literal(5), z.literal(10)])
    .optional(),
});
export const unifiedRenewSchema = unifiedUpdateSchema.extend({
  extendMinutes: z.number().int().min(1).max(15).optional(),
});
export const unifiedHeartbeatSchema = z.strictObject({
  contractVersion: z.literal(UNIFIED_WIRE),
  consentPolicyVersion: z.literal(UNIFIED_POLICY),
  activationId: z.uuid(),
});
const pointSchema = z.strictObject({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  grid: z.union([z.literal(100), z.literal(1000)]),
  accuracy: z.number().min(0).max(1000),
  capturedAt: z.number().int(),
  model: modelSchema,
});
export type UnifiedPoint = z.infer<typeof pointSchema>;
export const originSchema = pointSchema.extend({
  viewerId: z.uuid(),
  sessionId: z.uuid(),
  cityId: z.uuid(),
  regionId: z.string(),
  mode: z.enum(["live", "synthetic_demo"]),
  expiresAt: z.number().int(),
  activationId: z.uuid().optional(),
  version: z.number().int().positive().optional(),
});
export type UnifiedOrigin = z.infer<typeof originSchema>;
export const contextSchema = z.strictObject({
  id: z.uuid(),
  wire: z.literal(UNIFIED_WIRE),
  viewerId: z.uuid(),
  sessionId: z.uuid(),
  mode: z.enum(["live", "synthetic_demo"]),
  regionId: z.string(),
  filters: filtersSchema,
  origin: originSchema.nullable(),
  revision: z.string(),
  asOf: z.number().int(),
  expiresAt: z.number().int(),
});
export type UnifiedContext = z.infer<typeof contextSchema>;
export const cursorSchema = z.strictObject({
  contextId: z.uuid(),
  group: z.number().int().min(0).max(1),
  distance: z.number().finite().nonnegative(),
  name: z.string(),
  publicId: z.uuid(),
  rank: z.number().int().positive(),
});
export type UnifiedCursor = z.infer<typeof cursorSchema>;
export const proofSchema = z.strictObject({
  context: contextSchema,
  targetId: z.uuid(),
  publicId: z.uuid(),
  activationId: z.uuid(),
  version: z.number().int().positive(),
  ownerSessionId: z.uuid(),
  receiptId: z.uuid(),
  model: modelSchema,
  expiresAt: z.number().int(),
});
export type UnifiedProof = z.infer<typeof proofSchema>;
export type UnifiedPurpose = "origin" | "query" | "list" | "map" | "result";
function key(env: AppEnv, purpose: UnifiedPurpose) {
  return createHmac("sha256", env.AUTH_PEPPER)
    .update(`players-unified-v1:${env.RADAR_GEOGRAPHIC_TOKEN_EPOCH}:${purpose}`)
    .digest();
}
/** Authenticated encryption keeps private centers/identities out of cleartext cursors. Distinct purpose keys, restore epoch. */
export function sealUnified(
  env: AppEnv,
  purpose: UnifiedPurpose,
  value: unknown,
): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(env, purpose), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return `u1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}
export function openUnified<T>(
  env: AppEnv,
  purpose: UnifiedPurpose,
  token: unknown,
  schema: z.ZodType<T>,
): T | null {
  if (
    typeof token !== "string" ||
    token.length > 4096 ||
    !/^u1\.[A-Za-z0-9_-]+$/.test(token)
  )
    return null;
  try {
    const b = Buffer.from(token.slice(3), "base64url");
    if (b.length < 29) return null;
    const d = createDecipheriv(
      "aes-256-gcm",
      key(env, purpose),
      b.subarray(0, 12),
    );
    d.setAuthTag(b.subarray(12, 28));
    const parsed = schema.safeParse(
      JSON.parse(
        Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"),
      ),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function pointUncertainty(p: UnifiedPoint) {
  return p.accuracy + (p.grid * Math.SQRT2) / 2 + 5;
}
export function distanceEstimate(
  d: number,
  target: UnifiedPoint,
  origin: UnifiedPoint,
) {
  const step = ([100, 500, 1000] as const).find(
    (s) =>
      s >= Math.max(target.grid, origin.grid, target.accuracy, origin.accuracy),
  )!;
  const u = pointUncertainty(target) + pointUncertainty(origin);
  const range = d <= Math.max(u, step / 2);
  return {
    kind: range ? ("range" as const) : ("estimate" as const),
    roundedMeters: range ? null : step * Math.floor(d / step + 0.5),
    roundingStepMeters: step,
    uncertaintyMeters: step * Math.ceil(u / step),
    lowerMeters: range ? 0 : null,
    upperMeters: range ? step * Math.ceil((d + u) / step) : null,
    basis: "published_centers_geodesic" as const,
    approximate: true as const,
  };
}
export function publicGeo(p: UnifiedPoint, now: number) {
  return {
    latitude: Number(p.latitude.toFixed(5)),
    longitude: Number(p.longitude.toFixed(5)),
    crs: "EPSG:4326" as const,
    model: p.model,
    gridSizeMeters: p.grid,
    uncertaintyMeters: p.grid * Math.ceil(pointUncertainty(p) / p.grid),
    quality: p.grid === 100 ? ("approximate" as const) : ("degraded" as const),
    sourceTimestampBucket: new Date(
      Math.floor(p.capturedAt / 30000) * 30000,
    ).toISOString(),
    sourceAgeSeconds: Math.ceil(Math.max(0, now - p.capturedAt) / 30000) * 30,
  };
}
