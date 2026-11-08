import { describe, expect, it } from "vitest";
import {
  PRIVATE_IDENTICAL_REPEAT_LIMIT,
  PRIVATE_IDENTICAL_REPEAT_WINDOW_SECONDS,
  PRIVATE_SEND_RATE_LIMIT,
  PRIVATE_SEND_RATE_WINDOW_SECONDS,
  PRIVATE_TEXT_POLICY_VERSION,
  assertExactLivePayloadMatch,
  evaluatePrivateTextContent,
  normalizePrivateTextForMatch,
} from "../../src/moderation/private-text-policy";
import { ProblemHttpException } from "../../src/auth/problem";

describe("private-text-policy private-local-safety-v1", () => {
  it("exposes finite versioned local limits (not universal AI)", () => {
    expect(PRIVATE_TEXT_POLICY_VERSION).toBe("private-local-safety-v1");
    expect(PRIVATE_SEND_RATE_LIMIT).toBe(20);
    expect(PRIVATE_SEND_RATE_WINDOW_SECONDS).toBe(60);
    expect(PRIVATE_IDENTICAL_REPEAT_LIMIT).toBe(3);
    expect(PRIVATE_IDENTICAL_REPEAT_WINDOW_SECONDS).toBe(120);
  });

  it("allows ordinary sports talk, criticism, quotes and plain profanity alone", () => {
    for (const sample of [
      "Сыграем в бадминтон завтра на корте 3?",
      "Слабая организация, опаздывали и сорвали сетку",
      'Он написал «ты идиот» — это недопустимо',
      "Блядь, какой сет… но давай ещё гейм",
      "Negative opinion: host was late, still want rematch",
    ]) {
      expect(evaluatePrivateTextContent(sample).kind).toBe("allow");
    }
  });

  it("rejects unsafe URL schemes", () => {
    expect(evaluatePrivateTextContent("open javascript:alert(1)").kind).toBe(
      "reject",
    );
    expect(evaluatePrivateTextContent("see data:text/html;base64,xx").kind).toBe(
      "reject",
    );
    expect(evaluatePrivateTextContent("file:///etc/passwd").kind).toBe("reject");
    const decision = evaluatePrivateTextContent("javascript:void(0)");
    expect(decision).toEqual({ kind: "reject", reason: "unsafe_url" });
  });

  it("rejects basic contiguous character spam", () => {
    expect(evaluatePrivateTextContent(`spam ${"a".repeat(40)}`).kind).toBe(
      "reject",
    );
  });

  it("rejects only narrowly listed obvious direct threats", () => {
    expect(evaluatePrivateTextContent("Я тебя убью").kind).toBe("reject");
    expect(evaluatePrivateTextContent("I will kill you tonight").kind).toBe(
      "reject",
    );
    expect(evaluatePrivateTextContent("Убить тебя хочу прямо сейчас").kind).toBe(
      "reject",
    );
    // Harmless figurative / sports language must stay allowed.
    expect(evaluatePrivateTextContent("Этот smash убил соперника").kind).toBe(
      "allow",
    );
    expect(evaluatePrivateTextContent("Убьюсь на тренировке от усталости").kind).toBe(
      "allow",
    );
  });

  it("normalizes whitespace for phrase match without inventing storage transforms", () => {
    expect(normalizePrivateTextForMatch("  Я   ТЕБЯ\nУБЬЮ  ")).toBe(
      "я тебя убью",
    );
  });

  it("exact live payload match accepts identical body and fails closed on purged", () => {
    const live = {
      id: "m1",
      conversation_id: "c1",
      seq: 1,
      created_at: new Date(),
      kind: "text",
      body_text: "Привет",
      content_state: "live" as const,
    };
    expect(() =>
      assertExactLivePayloadMatch(live, { text: "Привет", kind: "text" }),
    ).not.toThrow();
    expect(() =>
      assertExactLivePayloadMatch(live, { text: "Другой", kind: "text" }),
    ).toThrow(ProblemHttpException);
    expect(() =>
      assertExactLivePayloadMatch(
        { ...live, content_state: "purged", body_text: null },
        { text: "Привет" },
      ),
    ).toThrow(ProblemHttpException);
  });
});
