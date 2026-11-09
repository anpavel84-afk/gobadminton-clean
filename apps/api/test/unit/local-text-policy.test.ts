import { describe, expect, it } from "vitest";
import {
  evaluateLocalText,
  LOCAL_TEXT_POLICY_VERSION,
  localProfanitySpans,
  normalizeForLocalPolicy,
  tokenizeNormalized,
} from "../../src/moderation/local-text-policy";

import { maskPublicCommentBody, PUBLIC_COMMENT_PRESENTATION_VERSION } from "../../src/moderation/public-comment-presentation";

describe("local-text-policy ru-profanity-v1", () => {
  it("accepts normal Russian/international names, sports and places", () => {
    for (const sample of [
      "Анна Смирнова",
      "Кирилл Панов",
      "José García",
      "бадминтон",
      "волан",
      "корты Москвы",
      "Псков",
      "страхование",
      "хутор",
    ]) {
      expect(evaluateLocalText(sample, "identity").kind).toBe("clean");
      expect(evaluateLocalText(sample, "title").kind).toBe("clean");
      expect(evaluateLocalText(`Играем в ${sample}`, "prose").kind).toBe("clean");
    }
  });

  it("rejects high-confidence obscenity in identity/title after normalization", () => {
    expect(evaluateLocalText("хуй", "identity").kind).toBe("reject");
    expect(evaluateLocalText("БЛЯДЬ", "title").kind).toBe("reject");
    expect(evaluateLocalText("х у й", "identity").kind).toBe("reject"); // separated letters
    expect(evaluateLocalText("pizda", "identity").kind).toBe("reject"); // translit
  });

  it("keeps prose contextual for quotes/criticism rather than hard-reject", () => {
    const quoted = 'Он написал «ты блядь» — это недопустимо';
    expect(evaluateLocalText(quoted, "prose").kind).toBe("contextual");
    const criticism = "Слабая организация, опаздывали и сорвали сетку";
    expect(evaluateLocalText(criticism, "prose").kind).toBe("clean");
  });

  it("factual addresses keep sports/street numbers/international names; short obscenity rejects", () => {
    for (const sample of [
      "ул. Ленина, 10",
      "корты Москвы, дом 5",
      "Псков, хутор 3",
      "José García 12",
      "бадминтон клуб, 2",
    ]) {
      expect(evaluateLocalText(sample, "factual").kind).toBe("clean");
    }
    expect(evaluateLocalText("хуй", "factual").kind).toBe("reject");
    expect(evaluateLocalText("пизда", "factual").kind).toBe("reject");
  });

  it("normalizes ё/case/homoglyphs without flattening all whitespace", () => {
    expect(normalizeForLocalPolicy("Ёлка")).toContain("елка");
    const tokens = tokenizeNormalized(normalizeForLocalPolicy("привет   мир"));
    expect(tokens).toEqual(["привет", "мир"]);
  });
});


describe("public-comment-mask-v1 original-span presentation", () => {
  it("leaves clean prose, names, sports, punctuation and Unicode byte-for-byte", () => {
    for (const text of [
      "José García, Анна Смирнова — Псков: бадминтон, волан, ракетка, корты!",
      "Слабая организация, опаздывали и сорвали сетку. Верните деньги!",
      "страхование, пасхальный, хвойный, хутор, сукно, smash, shuttle",
      "  É / E\u0301 / ① / 🙂 / 👩‍👩‍👧‍👦 / Ёлка\n\t",
      "художник, Хуан, Сухуми, поддержка",
    ]) {
      expect(localProfanitySpans(text)).toEqual([]);
      expect(maskPublicCommentBody(text)).toBe(text);
    }
    expect(maskPublicCommentBody(null)).toBeNull();
    expect(maskPublicCommentBody("")).toBe("");
    // Mask once: removing a multi-letter token must not join unrelated single letters.
    expect(maskPublicCommentBody("х у блядь й")).toBe("х у ***** й");
  });

  it.each([
    ["БЛЯДЬ", "*****"],
    ["ёбаный", "******"],
    ["xуй", "***"],
    ["6лядь", "*****"],
    ["pizda", "*****"],
    ["blyad'", "*****'"],
    ["yeban", "*****"],
    ["blyad's", "*****'*"],
    ["ⓟⓘⓩⓓⓐ", "*****"],
    ["ｐｉｚｄａ", "*****"],
    ["х у й", "* * *"],
    ["х-у.й", "*-*.*"],
    ["х\nу\tй", "*\n*\t*"],
  ])("maps variant %s back to its original span", (token, masked) => {
    const raw = `🙂 Он написал «${token}», это недопустимо. E\u0301!`;
    expect(maskPublicCommentBody(raw)).toBe(`🙂 Он написал «${masked}», это недопустимо. E\u0301!`);
    expect(evaluateLocalText(raw, "prose").kind).toBe("contextual");
    expect(evaluateLocalText(token, "identity").kind).toBe("reject");
    expect(evaluateLocalText(token, "title").kind).toBe("reject");
  });

  it("keeps approval policy version and bounded matching decisions", () => {
    expect(LOCAL_TEXT_POLICY_VERSION).toBe("ru-profanity-v1");
    expect(PUBLIC_COMMENT_PRESENTATION_VERSION).toBe("public-comment-mask-v1");
    // Do not invent a second, more permissive substring or separated-letter matcher.
    const raw = "а б в г д е ж з и к л м х у й";
    expect(tokenizeNormalized(normalizeForLocalPolicy(raw))).toEqual(["абвгдежзиклм", "хуй"]);
    expect(maskPublicCommentBody(raw)).toBe("а б в г д е ж з и к л м * * *");
  });
});
