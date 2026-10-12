import type { ApiResult } from "./api-client";
import type { LookingIntent, SocialLevel } from "./consumer-types";

export const SOCIAL_DIRECTORY_DISABLED = "SOCIAL_DIRECTORY_DISABLED";
export const DIRECTORY_CONSENT_POLICY_VERSION = "directory-mvp-v1";

/** Pilot level labels only (IR-CATALOG-01 remains open). */
const PILOT_LEVEL_LABELS: Record<string, string> = {
  beginner: "Начинающий",
  intermediate: "Средний",
  advanced: "Продвинутый",
  "2.5": "2.5",
  "3.0": "3.0",
  "3.5": "3.5",
  "4.0": "4.0",
};

export function isSocialDirectoryDisabled(
  result: ApiResult<unknown>,
): boolean {
  if (result.ok) return false;
  return (
    result.status === 404 &&
    result.problem?.code === SOCIAL_DIRECTORY_DISABLED
  );
}

export function isResourceUnavailable(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  return result.status === 404;
}

export function formatSocialLevel(level: SocialLevel | null | undefined): string {
  if (!level) return "не указан";
  return PILOT_LEVEL_LABELS[level.levelId] ?? level.levelId;
}

export function lookingIntentActive(
  intent: LookingIntent | null | undefined,
  now = new Date(),
): boolean {
  if (!intent || intent.state !== "active") return false;
  if (intent.expiresAt) {
    const expires = Date.parse(intent.expiresAt);
    if (!Number.isNaN(expires) && expires <= now.getTime()) return false;
  }
  return true;
}

export function lookingIntentExpired(
  intent: LookingIntent | null | undefined,
  now = new Date(),
): boolean {
  if (!intent || intent.state !== "active" || !intent.expiresAt) return false;
  const expires = Date.parse(intent.expiresAt);
  return !Number.isNaN(expires) && expires <= now.getTime();
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)).toUpperCase();
}

export const PILOT_LEVEL_OPTIONS = [
  { levelId: "beginner", label: "Начинающий" },
  { levelId: "intermediate", label: "Средний" },
  { levelId: "advanced", label: "Продвинутый" },
] as const;

export function pilotSocialLevel(levelId: string): SocialLevel {
  return {
    scaleId: "gb-social-pilot",
    scaleVersion: 1,
    levelId,
    provenance: "self_declared",
  };
}

export const REPORT_REASON_OPTIONS = [
  { code: "harassment" as const, label: "Оскорбления / давление" },
  { code: "spam" as const, label: "Спам" },
  { code: "fake_profile" as const, label: "Поддельный профиль" },
  { code: "inappropriate" as const, label: "Неприемлемый контент" },
  { code: "other" as const, label: "Другое" },
];
