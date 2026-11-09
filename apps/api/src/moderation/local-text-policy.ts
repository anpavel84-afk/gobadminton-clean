/**
 * Versioned deterministic Russian token/profanity policy for public text (ru-profanity-v1).
 * Matches curated whole tokens and enumerated inflections after bounded normalization.
 * Never flattens all document whitespace or matches arbitrary substrings.
 */

export const LOCAL_TEXT_POLICY_VERSION = "ru-profanity-v1";

export type LocalTextKind = "identity" | "title" | "prose" | "contact" | "factual";

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

/** UTF-16 offsets into the original submission, never normalized storage bytes. */
export type LocalTextSpan = { start: number; end: number };

const graphemes = new Intl.Segmenter("ru", { granularity: "grapheme" });

/** The same normalization pipeline optionally carries original-byte provenance. */
function normalizePolicy(raw: string, trackSpans = false): {
  text: string;
  spans: LocalTextSpan[];
} {
  let text = raw.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
  let spans: LocalTextSpan[] = [];
  if (trackSpans) {
    // NFKC can expand ligatures or compose combining marks. Keep the whole source
    // grapheme behind each resulting UTF-16 unit; untouched text is sliced from raw.
    for (const { segment, index } of graphemes.segment(raw)) {
      const normalized = segment.normalize("NFKC").toLowerCase();
      for (let i = 0; i < normalized.length; i += 1) {
        spans.push({ start: index, end: index + segment.length });
      }
    }
  }
  for (const [re, replacement] of TRANSLIT_PAIRS) {
    const previousSpans = spans;
    const nextSpans: LocalTextSpan[] = [];
    let cursor = 0;
    text = text.replace(re, (match: string, offset: number) => {
      if (trackSpans) {
        nextSpans.push(...previousSpans.slice(cursor, offset));
        const span = {
          start: previousSpans[offset]!.start,
          // Optional transliteration apostrophe is a separator, not a letter to hide.
          end: previousSpans[offset + match.length - (match.endsWith("'") ? 2 : 1)]!.end,
        };
        for (let i = 0; i < replacement.length; i += 1) nextSpans.push(span);
        cursor = offset + match.length;
      }
      return replacement;
    });
    if (trackSpans) spans = nextSpans.concat(previousSpans.slice(cursor));
  }
  let out = "";
  for (const ch of text) out += HOMOGLYPH[ch] ?? ch;
  return { text: out, spans };
}

/** Bounded Unicode NFKC + case + ё→е + digit/leet + latin↔cyrillic confusables. */
export function normalizeForLocalPolicy(raw: string): string {
  return normalizePolicy(raw).text;
}

type PolicyToken = { text: string; parts: LocalTextSpan[] };

/** Reconstruct only bounded single-letter runs; retain the constituent ranges. */
function policyTokens(normalized: string): PolicyToken[] {
  const parts = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    text: match[0],
    parts: [{ start: match.index, end: match.index + match[0].length }],
  }));
  const tokens: PolicyToken[] = [];
  let i = 0;
  while (i < parts.length) {
    const first = parts[i]!;
    if (first.text.length === 1) {
      let merged = first.text;
      let j = i + 1;
      // Preserve ru-profanity-v1's exact 12-fragment reconstruction semantics.
      while (j < parts.length && parts[j]!.text.length === 1 && merged.length < 12) {
        merged += parts[j]!.text;
        j += 1;
      }
      if (merged.length >= 3) {
        tokens.push({ text: merged, parts: parts.slice(i, j).flatMap((part) => part.parts) });
        i = j;
        continue;
      }
    }
    tokens.push(first);
    i += 1;
  }
  return tokens;
}

export function tokenizeNormalized(normalized: string): string[] {
  return policyTokens(normalized).map((token) => token.text);
}

/** Original source ranges detected by the existing dictionary, allowlist and matcher. */
export function localProfanitySpans(raw: string): LocalTextSpan[] {
  const normalized = normalizePolicy(raw, true);
  const spans: LocalTextSpan[] = [];
  for (const token of policyTokens(normalized.text)) {
    if (!tokenMatchesProfanity(token.text)) continue;
    for (const part of token.parts) {
      for (let i = part.start; i < part.end; i += 1) {
        const span = normalized.spans[i]!;
        const previous = spans[spans.length - 1];
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else spans.push({ ...span });
      }
    }
  }
  return spans;
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
 * Prose/contact/factual: local signal is contextual (provider decides); hard reject only for
 * unambiguous short identity-like obscenity without surrounding prose.
 * Factual addresses keep sports names, street numbers and common international place tokens
 * via the narrow FALSE_POSITIVE_ALLOW set — no broad allow-bypass.
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
  if (
    (kind === "contact" || kind === "factual") &&
    trimmed.length <= 40 &&
    tokens.length <= 3
  ) {
    return { kind: "reject", reason: "profanity" };
  }
  if (looksQuotedOrReported(trimmed)) {
    return { kind: "contextual", reason: "profanity_signal" };
  }
  // Ordinary prose/factual with obscenity still goes to contextual provider; A does not invent pending.
  return { kind: "contextual", reason: "profanity_signal" };
}

export function localPolicyRejects(raw: string, kind: LocalTextKind): boolean {
  return evaluateLocalText(raw, kind).kind === "reject";
}
