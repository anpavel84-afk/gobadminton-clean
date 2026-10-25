import type { SocialLevel, PlayerAvatar } from "./consumer-types";
/** Mirrors the accepted R1/R2 wire projections; no target location or activity data. */
export type RadarPlayer = { canRequestContact?: boolean; avatar?: PlayerAvatar; publicPlayerId: string; displayName: string; level: SocialLevel | null; trainer: boolean };
export type ProximityBand = "near" | "middle" | "outer";
export type RadarExposureMode = "live" | "synthetic_demo";
export type RadarItem = { resultId: string; resultRef: string; player: RadarPlayer; proximityBand: ProximityBand; displaySlot: number };
export type RadarPreview = Pick<RadarItem, "player" | "proximityBand">;
export type RadarActivation = {
  coarseCenter?: { latitude: number; longitude: number };
  state: "active"; activationId: string; version: number; ownerHere: true; policyVersion: string;
  regionId: string; radiusBucketKm: 3 | 5 | 10; startedAt: string; expiresAt: string; hardExpiresAt: string;
  foregroundUntil: string; locationValidUntil: string; nextLocationUpdateAt: string; nextRadiusChangeAt: string;
  exposureMode: RadarExposureMode;
  contractVersion?: "players-unified-radar-v1"; gridSizeMeters?: 100 | 1000; degradedReason?: "source_accuracy" | null;
};
export type RadarStatus = RadarActivation | { state: "off" | "expired"; ownerHere: boolean; policyVersion: string; exposureMode: RadarExposureMode } | {
  state: "owned_elsewhere"; ownerHere: false; policyVersion: string; activationId: string; version: number; expiresAt: string; exposureMode: RadarExposureMode;
};
export type RadarNearby = {
  state: "empty" | "results"; policyVersion: string; radiusBucketKm: 3 | 5 | 10; refreshAfterSeconds: number; displayTtlSeconds: number; items: RadarItem[];
  exposureMode: RadarExposureMode;
};
export type RadarFix = { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
