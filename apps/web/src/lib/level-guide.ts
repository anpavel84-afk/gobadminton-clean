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

export const PILOT_SCALE_ID = "gb-social-pilot" as const;
export const PILOT_SCALE_VERSION = 1 as const;

export const LEVEL_GUIDE_DONT_KNOW = "" as const;

/**
 * Internal <select> value for a preserved non-catalog SocialLevel.
 * Never persist this token as SocialLevel.levelId.
 */
export const LEVEL_GUIDE_KEEP_CONTROL = "__gb_level_guide_keep__" as const;

export type LevelGuideSkill = {
  levelId: string;
  label: string;
  summary: string;
};

/**
 * Explicit draft/choice identity for the LevelGuide control.
 * Distinguishes preserved full-scale objects from catalog ntrp/pilot picks
 * even when numeric or symbol levelId strings collide.
 */
export type LevelGuideChoice =
  | { kind: "none" }
  | { kind: "keep"; level: SocialLevel }
  | { kind: "ntrp"; levelId: string }
  | { kind: "pilot"; levelId: string };

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

/** Exact catalog ntrp/v1 membership — scale+version+half-step, not bare numeric id. */
export function isExactNtrpV1Level(level: SocialLevel | null | undefined): boolean {
  if (!level) return false;
  return (
    level.scaleId === NTRP_SCALE_ID
    && Number(level.scaleVersion) === NTRP_SCALE_VERSION
    && isNtrpHalfstepId(level.levelId)
  );
}

/** Exact gb-social-pilot/v1 symbol — not a foreign scale that happens to reuse beginner. */
export function isExactPilotV1Level(level: SocialLevel | null | undefined): boolean {
  if (!level) return false;
  return (
    level.scaleId === PILOT_SCALE_ID
    && Number(level.scaleVersion) === PILOT_SCALE_VERSION
    && isPilotLevelId(level.levelId)
  );
}

/** True when the stored level is already an exact catalog choice (no keep option). */
export function isKnownProfileLevelChoice(level: SocialLevel | null | undefined): boolean {
  return isExactNtrpV1Level(level) || isExactPilotV1Level(level);
}

/** Offer a distinct keep option for non-catalog scales/versions (incl. same numeric id). */
export function shouldOfferPreservedLevel(level: SocialLevel | null | undefined): boolean {
  if (!level) return false;
  return !isKnownProfileLevelChoice(level);
}

/**
 * Label for the keep option: normalize numeric display when supported,
 * without claiming the value is NTRP or a pilot symbol.
 */
export function formatPreservedLevelChoiceLabel(level: SocialLevel): string {
  const normalizedNumeric = normalizeNtrpLevelId(level.levelId);
  const shown = normalizedNumeric ?? level.levelId;
  return `Сохранённый: ${shown} · ${level.scaleId} v${level.scaleVersion}`;
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

/** Hydrate control draft from stored profile level; resets intent on actor/editor reopen. */
export function levelGuideChoiceFromProfile(level: SocialLevel | null | undefined): LevelGuideChoice {
  if (!level) return { kind: "none" };
  if (isExactNtrpV1Level(level)) {
    const normalized = normalizeNtrpLevelId(level.levelId);
    return { kind: "ntrp", levelId: normalized ?? level.levelId };
  }
  if (isExactPilotV1Level(level)) {
    return { kind: "pilot", levelId: level.levelId };
  }
  return { kind: "keep", level };
}

/** Map draft choice → <select> value. Keep uses a control token, never a levelId. */
export function levelGuideControlValue(choice: LevelGuideChoice): string {
  switch (choice.kind) {
    case "none":
      return LEVEL_GUIDE_DONT_KNOW;
    case "keep":
      return LEVEL_GUIDE_KEEP_CONTROL;
    case "ntrp":
      return choice.levelId;
    case "pilot":
      return choice.levelId;
  }
}

/**
 * Map <select> value → draft choice.
 * KEEP token resolves to the preserved SocialLevel object; catalog ids become explicit picks.
 */
export function levelGuideChoiceFromControlValue(
  value: string,
  preserved: SocialLevel | null | undefined,
): LevelGuideChoice {
  const id = String(value ?? "");
  if (!id || id === LEVEL_GUIDE_DONT_KNOW) return { kind: "none" };
  if (id === LEVEL_GUIDE_KEEP_CONTROL) {
    return preserved ? { kind: "keep", level: preserved } : { kind: "none" };
  }
  if (isNtrpHalfstepId(id)) {
    const normalized = normalizeNtrpLevelId(id);
    return { kind: "ntrp", levelId: normalized ?? id };
  }
  if (isPilotLevelId(id)) return { kind: "pilot", levelId: id };
  // Unknown control token — do not invent a scale or persist the raw string.
  return { kind: "none" };
}

function sameNtrpIdentity(existing: SocialLevel, levelId: string): boolean {
  const want = normalizeNtrpLevelId(levelId);
  const have = normalizeNtrpLevelId(existing.levelId);
  return (
    existing.scaleId === NTRP_SCALE_ID
    && Number(existing.scaleVersion) === NTRP_SCALE_VERSION
    && want != null
    && have === want
  );
}

function samePilotIdentity(existing: SocialLevel, levelId: string): boolean {
  return (
    existing.scaleId === PILOT_SCALE_ID
    && Number(existing.scaleVersion) === PILOT_SCALE_VERSION
    && existing.levelId === levelId
  );
}

function sameFullLevelIdentity(a: SocialLevel, b: SocialLevel): boolean {
  return (
    a.scaleId === b.scaleId
    && Number(a.scaleVersion) === Number(b.scaleVersion)
    && a.levelId === b.levelId
  );
}

/**
 * Profile Save payload for level from typed draft choice.
 * keep → full original SocialLevel (scale/version/value).
 * Explicit ntrp → ntrp/v1/self_declared even if existing had the same numeric id on another scale.
 * Explicit pilot → gb-social-pilot/v1.
 * none / «Не знаю» → null.
 * Control tokens are never written as levelId.
 */
export function resolveProfileLevelForSave(
  choice: LevelGuideChoice,
  existing: SocialLevel | null | undefined,
): SocialLevel | null {
  switch (choice.kind) {
    case "none":
      return null;
    case "keep": {
      if (existing && sameFullLevelIdentity(existing, choice.level)) return existing;
      return choice.level;
    }
    case "ntrp": {
      if (existing && sameNtrpIdentity(existing, choice.levelId)) return existing;
      return ntrpSelfDeclaredLevel(choice.levelId);
    }
    case "pilot": {
      if (existing && samePilotIdentity(existing, choice.levelId)) return existing;
      if (!isPilotLevelId(choice.levelId)) return null;
      return pilotSocialLevel(choice.levelId);
    }
  }
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
