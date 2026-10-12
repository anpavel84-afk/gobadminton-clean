import type { AppEnv } from "../config/env";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import {
  RADAR_REGION_MOSCOW,
  RADAR_REGION_SPB,
  type RadarExposureMode,
} from "./constants";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
import { DEMO_SPB_CITY_ID } from "../database/demo-ids";
import { unprocessable } from "../auth/problem";

export const GEO_CONTRACT = "radar-geographic-v1";
export const GEO_POLICY = "radar-geographic-sharing-v1";
export const GEO_DISCLOSURE_ID = "radar-geographic-sharing-v1.ru.v1";
export const GEO_DISCLOSURE_TEXT =
  "Включая Radar, вы делаете своё примерное местоположение видимым другим авторизованным пользователям GoBadminton, даже если они не включили свой Radar. Местоположение видно, пока Radar активен. Вы можете выключить его в любой момент. Приложение должно оставаться открытым на экране; местоположение автоматически устаревает. Другие экраны обновляются с небольшой задержкой, до 45 секунд.";
export const GEO_DISCLOSURE_HASH = createHash("sha256")
  .update(GEO_DISCLOSURE_TEXT)
  .digest("hex");
export const fixSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(1000),
  capturedAt: z.iso.datetime({ offset: true }),
});
export const consentSchema = z.strictObject({
  disclosureId: z.literal(GEO_DISCLOSURE_ID),
  accepted: z.literal(true),
});

export const geographicStartSchema = z.strictObject({
  location: fixSchema,
  radiusBucketKm: z
    .union([z.literal(3), z.literal(5), z.literal(10)])
    .optional(),
  ttlMinutes: z.number().int().min(1).max(15).optional(),
  consentPolicyVersion: z.literal(GEO_POLICY),
  consent: consentSchema.optional(),
});
export const geographicTakeoverSchema = geographicStartSchema.extend({
  activationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  confirm: z.literal(true),
});

const originInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("current_activation"),
    activationId: z.uuid(),
  }),
  z.strictObject({ kind: z.literal("foreground_fix"), location: fixSchema }),
  z.strictObject({
    kind: z.literal("reference"),
    originRef: z.string().min(1).max(4096),
  }),
]);
export const querySchema = z
  .strictObject({
    cityId: z.uuid(),
    scope: z.enum(["city", "nearby"]),
    origin: originInputSchema,
    radiusBucketKm: z
      .union([z.literal(3), z.literal(5), z.literal(10)])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.scope === "nearby" &&
        (v.origin.kind === "none" || v.radiusBucketKm === undefined)) ||
      (v.scope === "city" && v.radiusBucketKm !== undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "scope/origin/radius mismatch" });
    }
  });
const namespace = z.enum(["live", "synthetic_demo"]);
export const privateOriginSchema = z
  .strictObject({
    v: z.literal(1),
    audience: z.literal("radar-query-origin-v1"),
    viewerUserId: z.uuid(),
    viewerSessionId: z.uuid(),
    cityId: z.uuid(),
    regionId: z.string().min(1).max(64),
    exposureMode: namespace,
    model: z.literal("regional_grid_center_v1"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    expiresAt: z.number().int().positive(),
    activationId: z.uuid().optional(),
    activationVersion: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      (v.activationId === undefined) === (v.activationVersion === undefined),
  );
export type PrivateOrigin = z.infer<typeof privateOriginSchema>;
export const geographicProofSchema = z
  .strictObject({
    v: z.literal(2),
    audience: z.literal(GEO_CONTRACT),
    policyVersion: z.literal(GEO_POLICY),
    viewerUserId: z.uuid(),
    viewerSessionId: z.uuid(),
    queryId: z.uuid(),
    cityId: z.uuid(),
    regionId: z.string().min(1).max(64),
    exposureMode: namespace,
    scope: z.enum(["city", "nearby"]),
    origin: privateOriginSchema.nullable(),
    radiusBucketKm: z
      .union([z.literal(3), z.literal(5), z.literal(10)])
      .nullable(),
    targetUserId: z.uuid(),
    targetPublicPlayerId: z.uuid(),
    targetActivationId: z.uuid(),
    targetVersion: z.number().int().positive(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .superRefine((v, ctx) => {
    if (
      v.viewerUserId === v.targetUserId ||
      v.expiresAt <= v.issuedAt ||
      v.expiresAt > v.issuedAt + 60000 ||
      (v.scope === "nearby" && (!v.origin || v.radiusBucketKm === null)) ||
      (v.scope === "city" && v.radiusBucketKm !== null) ||
      (v.origin &&
        (v.origin.viewerUserId !== v.viewerUserId ||
          v.origin.viewerSessionId !== v.viewerSessionId ||
          v.origin.cityId !== v.cityId ||
          v.origin.regionId !== v.regionId ||
          v.origin.exposureMode !== v.exposureMode ||
          v.expiresAt > v.origin.expiresAt))
    ) {
      ctx.addIssue({ code: "custom", message: "invalid proof scope" });
    }
  });
export type GeographicProof = z.infer<typeof geographicProofSchema>;
export function signGeographicToken(
  pepper: string,
  purpose: "origin" | "result",
  payload: unknown,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", pepper).update(`radar-geographic-${purpose}:${body}`).digest("base64url")}`;
}
export function parseGeographicToken<T>(
  pepper: string,
  purpose: "origin" | "result",
  token: unknown,
  schema: z.ZodType<T>,
): T | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)))
    return null;
  const expected = createHmac("sha256", pepper)
    .update(`radar-geographic-${purpose}:${parts[0]}`)
    .digest("base64url");
  const supplied = Buffer.from(parts[1]!);
  const actual = Buffer.from(expected);
  if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual))
    return null;
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function geographicCity(cityId: string, mode: RadarExposureMode) {
  if (cityId === MOSCOW_CITY_ID) return RADAR_REGION_MOSCOW;
  if (cityId === DEMO_SPB_CITY_ID && mode === "synthetic_demo")
    return RADAR_REGION_SPB;
  throw unprocessable(
    "RADAR_CITY_UNSUPPORTED",
    "Город Radar не поддерживается",
  );
}
export function displayLocation(latitude: number, longitude: number) {
  return {
    model: "regional_grid_center_v1" as const,
    latitude: Number(latitude.toFixed(5)),
    longitude: Number(longitude.toFixed(5)),
    gridSizeMeters: 1000 as const,
  };
}

/** Rotate on coordinated restore/reset; prevents restored sessions replaying transient geo tokens. */
export function geographicPepper(env: AppEnv): string {
  return createHmac("sha256", env.AUTH_PEPPER)
    .update(`radar-geo-epoch:${env.RADAR_GEOGRAPHIC_TOKEN_EPOCH}`)
    .digest("hex");
}
