import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import {
  MODERATION_MODEL,
  ModerationProviderError,
  TEXT_CATEGORIES,
  safeTextBatchDecision,
} from "../../src/moderation/provider";
import {
  OpenAIModerationProvider,
  parseTextResponse,
} from "../../src/moderation/openai-provider";
import { evaluateLocalText } from "../../src/moderation/local-text-policy";
import {
  REVIEW_HARD_REJECT_CATEGORIES,
  REVIEW_QUEUE_CATEGORIES,
  TEXT_FIELD_HINTS,
  TEXT_SURFACE_KIND,
  isReviewTextSurface,
} from "../../src/moderation/text-policy";

const rawEnv = {
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://local@127.0.0.1/test",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  CONTENT_MODERATION_PROVIDER: "openai",
  CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-m1-test-fingerprint-secret-32",
  OPENAI_MODERATION_API_KEY: "synthetic-api-key",
};

function textFixture(count: number, flaggedIndex = -1) {
  return {
    id: "synthetic-text-response",
    model: MODERATION_MODEL,
    results: Array.from({ length: count }, (_, i) => ({
      flagged: i === flaggedIndex,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, i === flaggedIndex && key === "harassment"]),
      ),
      category_applied_input_types: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [
          key,
          i === flaggedIndex && key === "harassment" ? ["text"] : [],
        ]),
      ),
      category_scores: { harassment: 0.99 },
    })),
  };
}

describe("text moderation adapter", () => {
  it("parses strict schema and rejects model/count/category mismatches", () => {
    expect(parseTextResponse(textFixture(2), 2).results).toHaveLength(2);
    expect(() => parseTextResponse(textFixture(1), 2)).toThrow(ModerationProviderError);
    expect(() =>
      parseTextResponse({ ...textFixture(1), model: "omni-moderation-latest" }, 1),
    ).toThrow(ModerationProviderError);
    const bad = textFixture(1, 0);
    bad.results[0]!.category_applied_input_types.harassment = [] as never;
    expect(() => parseTextResponse(bad, 1)).toThrow(ModerationProviderError);
  });

  it("sends text batch without logging raw body and separates fake counters", async () => {
    const beforeAttempt = vi.fn(async () => undefined);
    const texts = ["Анна", "Играем в бадминтон"] as const;
    const transport = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe(MODERATION_MODEL);
      // Official text batch is string[]; multimodal object[] collapses to one result.
      expect(body.input).toEqual([...texts]);
      expect(Array.isArray(body.input) && body.input.every((item: unknown) => typeof item === "string")).toBe(
        true,
      );
      expect(
        body.input.some(
          (item: unknown) =>
            item !== null &&
            typeof item === "object" &&
            (item as { type?: string }).type === "text",
        ),
      ).toBe(false);
      expect(body.input).toHaveLength(2);
      return Response.json(textFixture(2));
    });
    const adapter = new OpenAIModerationProvider(loadEnv(rawEnv), transport);
    const result = await adapter.moderateTexts({
      texts,
      signal: new AbortController().signal,
      beforeAttempt,
    });
    expect(result.results).toHaveLength(2);
    expect(result).not.toHaveProperty("category_scores");
    expect(beforeAttempt).toHaveBeenCalledTimes(1);

    const fake = new FakeModerationProvider(
      { NODE_ENV: "test", APP_ENV: "local" },
      async () => ({
        model: MODERATION_MODEL,
        responseId: null,
        flagged: false,
        categories: Object.fromEntries(
          ["self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "violence", "violence/graphic"].map(
            (k) => [k, false],
          ),
        ) as never,
      }),
      async (input) => safeTextBatchDecision(input.texts.length),
    );
    await fake.moderateTexts({
      texts: ["ok"],
      signal: new AbortController().signal,
      beforeAttempt: async () => undefined,
    });
    expect(fake.textCalls).toBe(1);
    expect(fake.calls).toBe(0);
  });

  it("treats comment_body as prose: criticism/quotes contextual, not identity hard-reject", () => {
    expect(TEXT_SURFACE_KIND.comment_body).toBe("prose");
    expect(TEXT_FIELD_HINTS.comment_body).toMatch(/комментария/i);
    expect(evaluateLocalText("Слабая организация на корте", "prose").kind).toBe("clean");
    expect(
      evaluateLocalText('Он написал «хуйня», цитирую для отчёта', "prose").kind,
    ).toBe("contextual");
  });

  it("B1b role review/reply surfaces stay prose; soft vs hard category split", () => {
    expect(isReviewTextSurface("role_review_body")).toBe(true);
    expect(isReviewTextSurface("role_reply_body")).toBe(true);
    expect(isReviewTextSurface("comment_body")).toBe(false);
    expect(TEXT_SURFACE_KIND.role_review_body).toBe("prose");
    expect(TEXT_SURFACE_KIND.role_reply_body).toBe("prose");
    expect(TEXT_FIELD_HINTS.role_review_body).toMatch(/отзыва/i);
    // Ordinary profiles/comments still reject any flag; review soft queue is separate.
    expect(REVIEW_QUEUE_CATEGORIES).toEqual(
      expect.arrayContaining(["harassment", "hate", "illicit", "violence"]),
    );
    expect(REVIEW_HARD_REJECT_CATEGORIES).toEqual(
      expect.arrayContaining(["sexual/minors", "harassment/threatening", "self-harm"]),
    );
    expect(REVIEW_HARD_REJECT_CATEGORIES).not.toContain("harassment");
    expect(
      evaluateLocalText("Слабая организация, время сдвинули", "prose").kind,
    ).toBe("clean");
  });

  it("bounds text retries on transport failure", async () => {
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: "PRIVATE_PAYLOAD" } }), {
          status: 500,
          headers: { "retry-after": "9" },
        }),
    );
    const adapter = new OpenAIModerationProvider(loadEnv(rawEnv), transport);
    const reserve = vi.fn(async () => undefined);
    await expect(
      adapter.moderateTexts({
        texts: ["synthetic"],
        signal: new AbortController().signal,
        beforeAttempt: reserve,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);
  });
});
