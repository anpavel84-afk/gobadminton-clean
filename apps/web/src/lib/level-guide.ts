/**
 * #458 beginner level guidance — pure helpers.
 * NTRP v1 half-steps and exact membership against game.levelRule; no ranking algorithms.
 */

import type { LevelRule, SocialLevel } from "./consumer-types";
import {
  formatNtrpLevelDisplay,
  formatNtrpLevelId,
  inclusiveNtrpLevelIds,
  NTRP_LEVEL_MAX,
  NTRP_LEVEL_MIN,
  snapClampNtrpLevel,
} from "./game-level-range";
import { PILOT_LEVEL_OPTIONS, pilotSocialLevel } from "./player-presentation";

export const NTRP_SCALE_ID = "ntrp" as const;
export const NTRP_SCALE_VERSION = 1 as const;

export const LEVEL_GUIDE_DONT_KNOW = "" as const;

export type LevelGuideSkill = {
  levelId: string;
  label: string;
  summary: string;
};

/** All inclusive NTRP v1 half-steps 1.0 … 7.0 (13 values). */
export function ntrpHalfstepIds(): string[] {
  return inclusiveNtrpLevelIds(NTRP_LEVEL_MIN, NTRP_LEVEL_MAX);
}

/** Approximate self-declared skill blurbs — not certification. */
const SKILL_BLURBS: Record<string, string> = {
  "1.0": "Только начинаю: держу ракетку, учусь попадать по волану.",
  "1.5": "Знаком с подачей и базовыми ударами, играю очень спокойно.",
  "2.0": "Могу коротко отбить обмен, ещё много ошибок и пауз.",
  "2.5": "Играю короткие партии в спокойном темпе, учусь держать площадку.",
  "3.0": "Регулярно играю: базовые удары стабильнее, темп любительский.",
  "3.5": "Уверенный любитель: меняю направление и темп, чувствую партнёра.",
  "4.0": "Сильная любительская игра, тактика и вариативность ударов.",
  "4.5": "Очень сильный любитель / уверенный клубный уровень.",
  "5.0": "Соревновательный любительский ориентир, высокая интенсивность.",
  "5.5": "Высокий соревновательный любительский ориентир.",
  "6.0": "Ориентир полупрофессиональной игры — без гарантии квалификации.",
  "6.5": "Ориентир близко к профессиональному — самооценка, не аттестат.",
  "7.0": "Профессиональный ориентир по самооценке, не сертификат федерации.",
};

export function levelGuideSkills(): LevelGuideSkill[] {
  return ntrpHalfstepIds().map((levelId) => ({
    levelId,
    label: formatNtrpLevelDisplay(Number(levelId)),
    summary: SKILL_BLURBS[levelId] ?? `Ориентировочный уровень ${formatNtrpLevelDisplay(Number(levelId))}.`,
  }));
}

export function levelGuideSkillFor(levelId: string): LevelGuideSkill | null {
  const normalized = normalizeNtrpLevelId(levelId);
  if (!normalized) return null;
  const hit = levelGuideSkills().find((row) => row.levelId === normalized);
  return hit ?? null;
}

/** Accept "3", "3.0", "3,0" → canonical "3.0"; reject non-half-step garbage. */
export function normalizeNtrpLevelId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const snapped = snapClampNtrpLevel(n);
  // Reject values that were not already on the half-step grid before clamp (e.g. 3.2 → 3.0 silently).
  const asId = formatNtrpLevelId(snapped);
  const reparsed = Number(trimmed);
  if (Math.abs(reparsed - snapped) > 1e-9) {
    // Allow exact half-steps that clamp only for out-of-range (0.5→1.0, 8→7.0) as non-members for matching.
    if (reparsed < NTRP_LEVEL_MIN || reparsed > NTRP_LEVEL_MAX) return null;
    return null;
  }
  return asId;
}

export function isNtrpHalfstepId(levelId: string | null | undefined): boolean {
  const normalized = normalizeNtrpLevelId(levelId);
  if (!normalized) return false;
  return ntrpHalfstepIds().includes(normalized);
}

export function isPilotLevelId(levelId: string | null | undefined): boolean {
  if (!levelId) return false;
  return PILOT_LEVEL_OPTIONS.some((o) => o.levelId === levelId);
}

export function isKnownProfileLevelChoice(levelId: string | null | undefined): boolean {
  return isPilotLevelId(levelId) || isNtrpHalfstepId(levelId);
}

export function ntrpSelfDeclaredLevel(levelId: string): SocialLevel | null {
  const normalized = normalizeNtrpLevelId(levelId);
  if (!normalized) return null;
  return {
    scaleId: NTRP_SCALE_ID,
    scaleVersion: NTRP_SCALE_VERSION,
    levelId: normalized,
    provenance: "self_declared",
  };
}

/**
 * Profile Save payload for level.
 * Same levelId as existing → preserve full SocialLevel (scale/version/value).
 * NTRP half-step → ntrp/v1/self_declared (never wrap as gb-social-pilot).
 * Pilot symbols → existing pilot helper.
 * Empty / «Не знаю» → null.
 */
export function resolveProfileLevelForSave(
  selectedLevelId: string,
  existing: SocialLevel | null | undefined,
): SocialLevel | null {
  const id = String(selectedLevelId ?? "").trim();
  if (!id) return null;
  if (existing && existing.levelId === id) return existing;
  if (isNtrpHalfstepId(id)) return ntrpSelfDeclaredLevel(id);
  if (isPilotLevelId(id)) return pilotSocialLevel(id);
  // Unknown custom id without matching existing object: do not invent a scale.
  return existing && existing.levelId === id ? existing : null;
}

export function isExactNtrpV1Rule(rule: LevelRule | null | undefined): boolean {
  return Boolean(
    rule
      && rule.scaleId === NTRP_SCALE_ID
      && Number(rule.scaleVersion) === NTRP_SCALE_VERSION
      && Array.isArray(rule.allowedLevelIds),
  );
}

/**
 * Inclusive membership: selected half-step is in allowedLevelIds after normalization.
 * Non-ntrp / other version / unknown scale → not compatible (never approximate).
 */
export function gameAllowsSelectedNtrpLevel(
  rule: LevelRule | null | undefined,
  selectedLevelId: string | null | undefined,
): boolean {
  if (!selectedLevelId) return true;
  if (!isExactNtrpV1Rule(rule)) return false;
  const want = normalizeNtrpLevelId(selectedLevelId);
  if (!want) return false;
  return rule!.allowedLevelIds.some((id) => normalizeNtrpLevelId(id) === want);
}

/** Derive visible list; does not mutate the raw loaded/cache array. */
export function filterGamesBySelectedNtrpLevel<T extends { levelRule: LevelRule }>(
  games: readonly T[],
  selectedLevelId: string | null | undefined,
): T[] {
  if (!selectedLevelId) return [...games];
  return games.filter((game) => gameAllowsSelectedNtrpLevel(game.levelRule, selectedLevelId));
}

export const LEVEL_GUIDE_DISCLAIMER =
  "Уровень указываете вы сами — это ориентир для выбора игры, а не официальная квалификация и не гарантия совместимости.";

export const LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE =
  "Фильтр применяется только к уже загруженным играм списка (шкала ntrp v1). Другие шкалы не считаются совместимыми.";

export const LEVEL_GUIDE_MAP_HONESTY =
  "Карта показывает все игры выбранного города. Фильтр уровня действует в списке; при возврате к списку он сохранится.";
