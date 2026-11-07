/**
 * Versioned deterministic Russian token/profanity policy for public text (ru-profanity-v1).
 * Matches curated whole tokens and enumerated inflections after bounded normalization.
 * Never flattens all document whitespace or matches arbitrary substrings.
 */

export const LOCAL_TEXT_POLICY_VERSION = "ru-profanity-v1";

export type LocalTextKind = "identity" | "title" | "prose" | "contact";

export type LocalTextSignal =
  | { kind: "clean" }
  | { kind: "reject"; reason: "profanity" }
  | { kind: "contextual"; reason: "profanity_signal" };

/** Curated high-confidence obscenity stems (normalized form). Artificial fixtures use these. */
const PROFANITY_STEMS = [
  "бляд",
  "блят",
  "хуй",
  "хуе",
  "хуё",
  "хуя",
  "пизд",
  "ебан",
  "ебал",
  "ебат",
  "ёбан",
  "ёбал",
  "ёбат",
  "мудак",
  "мудил",
  "пидор",
  "пидар",
  "гандон",
  "сука",
  "суки",
  "сучк",
  "залуп",
] as const;

/** Whole-token allowlist after normalization — sports/names that share letter runs with stems. */
const FALSE_POSITIVE_ALLOW = new Set([
  "страх",
  "страхование",
  "страховой",
  "страховая",
  "страховые",
  "пасха",
  "пасхальный",
  "псков",
  "псковский",
  "хвойный",
  "хвоя",
  "хутор",
  "хутора",
  "хуторе",
  "сукно",
  "сукна",
  "бадминтон",
  "бадминтона",
  "бадминтоне",
  "ракетка",
  "ракетки",
  "волан",
  "воланы",
  "корт",
  "корта",
  "корты",
  "сетка",
  "сетки",
  "подача",
  "подачи",
  "smash",
  "clear",
  "drop",
  "drive",
  "net",
  "court",
  "shuttle",
  "racket",
  "racquet",
]);

const HOMOGLYPH: Record<string, string> = {
  a: "а",
  e: "е",
  o: "о",
  p: "р",
  c: "с",
  x: "х",
  y: "у",
  h: "н",
  k: "к",
  m: "м",
  t: "т",
  b: "в",
  "@": "а",
  "0": "о",
  "3": "е",
  "4": "ч",
  "6": "б",
  $: "с",
};

const TRANSLIT_PAIRS: Array<[RegExp, string]> = [
  [/blyad(?:'|ь)?/gi, "бляд"],
  [/blyat(?:'|ь)?/gi, "блят"],
  [/huy|hui|xy[йияе]/gi, "хуй"],
  [/pizd/gi, "пизд"],
  [/eban|yeban|ieban/gi, "ебан"],
  [/mudak/gi, "мудак"],
  [/pidor|pidar/gi, "пидор"],
  [/gandon|condom/gi, "гандон"],
  [/suka|suc[hk]ka/gi, "сука"],
  [/zalup/gi, "залуп"],
];

/** Bounded Unicode NFKC + case + ё→е + digit/leet + latin↔cyrillic confusables. */
export function normalizeForLocalPolicy(raw: string): string {
  let s = raw.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
  for (const [re, repl] of TRANSLIT_PAIRS) s = s.replace(re, repl);
  let out = "";
  for (const ch of s) {
    out += HOMOGLYPH[ch] ?? ch;
  }
  return out;
}

/**
 * Reconstruct tokens: whitespace/punct split, then merge single-letter runs within a
 * bounded window (separated-letter evasion) without deleting all document whitespace.
 */
export function tokenizeNormalized(normalized: string): string[] {
  const parts = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tokens: string[] = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i]!.length === 1) {
      let merged = parts[i]!;
      let j = i + 1;
      // Bound reconstructed span to 12 single-letter fragments.
      while (j < parts.length && parts[j]!.length === 1 && merged.length < 12) {
        merged += parts[j]!;
        j += 1;
      }
      if (merged.length >= 3) tokens.push(merged);
      else tokens.push(parts[i]!);
      i = merged.length >= 3 ? j : i + 1;
      continue;
    }
    tokens.push(parts[i]!);
    i += 1;
  }
  return tokens;
}

function tokenMatchesProfanity(token: string): boolean {
  if (FALSE_POSITIVE_ALLOW.has(token)) return false;
  if (token.length < 3) return false;
  for (const stem of PROFANITY_STEMS) {
    if (token === stem || token.startsWith(stem) || (stem.length >= 4 && token.includes(stem))) {
      // Require stem boundary-ish: avoid matching mid-word Latin sports terms already allowed.
      if (FALSE_POSITIVE_ALLOW.has(token)) return false;
      return true;
    }
  }
  return false;
}

/** Detect quote/report context so prose can stay contextual instead of hard-reject. */
function looksQuotedOrReported(raw: string): boolean {
  const t = raw.trim();
  if (/[«»""„].+[«»""„]/.test(t)) return true;
  if (/\b(написал[аи]?|сказал[аи]?|писал[аи]?|цитат|quote|написано)\b/i.test(t)) return true;
  if (/^\s*[-–—]\s*\S/.test(t) && t.length > 20) return true;
  return false;
}

/**
 * Evaluate one field. Identity/title: high-confidence token → reject.
 * Prose/contact: local signal is contextual (provider decides); hard reject only for
 * unambiguous short identity-like obscenity without surrounding prose.
 */
export function evaluateLocalText(raw: string, kind: LocalTextKind): LocalTextSignal {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "clean" };
  const normalized = normalizeForLocalPolicy(trimmed);
  const tokens = tokenizeNormalized(normalized);
  const hit = tokens.some(tokenMatchesProfanity);
  if (!hit) return { kind: "clean" };
  if (kind === "identity" || kind === "title") {
    return { kind: "reject", reason: "profanity" };
  }
  if (kind === "contact" && trimmed.length <= 40 && tokens.length <= 3) {
    return { kind: "reject", reason: "profanity" };
  }
  if (looksQuotedOrReported(trimmed)) {
    return { kind: "contextual", reason: "profanity_signal" };
  }
  // Ordinary prose with obscenity still goes to contextual provider; A does not invent pending.
  return { kind: "contextual", reason: "profanity_signal" };
}

export function localPolicyRejects(raw: string, kind: LocalTextKind): boolean {
  return evaluateLocalText(raw, kind).kind === "reject";
}
