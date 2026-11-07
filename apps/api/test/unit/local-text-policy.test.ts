import { describe, expect, it } from "vitest";
import {
  evaluateLocalText,
  normalizeForLocalPolicy,
  tokenizeNormalized,
} from "../../src/moderation/local-text-policy";

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

  it("normalizes ё/case/homoglyphs without flattening all whitespace", () => {
    expect(normalizeForLocalPolicy("Ёлка")).toContain("елка");
    const tokens = tokenizeNormalized(normalizeForLocalPolicy("привет   мир"));
    expect(tokens).toEqual(["привет", "мир"]);
  });
});
