import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import {
  MODERATION_MODEL,
  ModerationProviderError,
  TEXT_CATEGORIES,
  safeTextBatchDecision,
  safeTextItemDecision,
} from "../../src/moderation/provider";
import {
  OpenAIModerationProvider,
  parseTextResponse,
} from "../../src/moderation/openai-provider";
import { evaluateLocalText, LOCAL_TEXT_POLICY_VERSION } from "../../src/moderation/local-text-policy";
import {
  DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
  isDevModerationQuantityQuotaPauseActive,
  isExactTrustedDevModerationEnv,
} from "../../src/moderation/moderation-quota-policy";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import {
  PUBLIC_TEXT_POLICY_VERSION,
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

  it("B2a venue public surfaces: identity / factual / prose; not review", () => {
    expect(isReviewTextSurface("venue_name")).toBe(false);
    expect(isReviewTextSurface("venue_address")).toBe(false);
    expect(isReviewTextSurface("venue_description")).toBe(false);
    expect(TEXT_SURFACE_KIND.venue_name).toBe("identity");
    expect(TEXT_SURFACE_KIND.venue_address).toBe("factual");
    expect(TEXT_SURFACE_KIND.venue_description).toBe("prose");
    expect(TEXT_FIELD_HINTS.venue_name).toMatch(/назван/i);
    expect(TEXT_FIELD_HINTS.venue_address).toMatch(/адрес/i);
    expect(TEXT_FIELD_HINTS.venue_description).toMatch(/описание/i);
    expect(evaluateLocalText("Клуб Бадминтон Псков", "identity").kind).toBe("clean");
    expect(evaluateLocalText("ул. Ленина, 10 корпус 2", "factual").kind).toBe("clean");
    expect(evaluateLocalText("José García Court 3", "factual").kind).toBe("clean");
    expect(evaluateLocalText("хуй", "factual").kind).toBe("reject");
  });

  it("B1b/B1c review surfaces stay prose; soft vs hard category split", () => {
    expect(isReviewTextSurface("role_review_body")).toBe(true);
    expect(isReviewTextSurface("role_reply_body")).toBe(true);
    expect(isReviewTextSurface("venue_review_body")).toBe(true);
    expect(isReviewTextSurface("comment_body")).toBe(false);
    expect(TEXT_SURFACE_KIND.role_review_body).toBe("prose");
    expect(TEXT_SURFACE_KIND.role_reply_body).toBe("prose");
    expect(TEXT_SURFACE_KIND.venue_review_body).toBe("prose");
    expect(TEXT_FIELD_HINTS.role_review_body).toMatch(/отзыва/i);
    expect(TEXT_FIELD_HINTS.venue_review_body).toMatch(/площадк/i);
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

  it("local/test text budget path keeps quantity pause off; provider Retry-After unchanged", async () => {
    const env = loadEnv(rawEnv);
    expect(isExactTrustedDevModerationEnv(env)).toBe(false);
    expect(
      isDevModerationQuantityQuotaPauseActive(env, new Date("2026-11-08T00:00:00.000Z")),
    ).toBe(false);
    expect(DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: "PRIVATE_PAYLOAD" } }), {
          status: 429,
          headers: { "retry-after": "12" },
        }),
    );
    const adapter = new OpenAIModerationProvider(env, transport);
    const reserve = vi.fn(async () => undefined);
    await expect(
      adapter.moderateTexts({
        texts: ["synthetic-quota-boundary"],
        signal: new AbortController().signal,
        beforeAttempt: reserve,
      }),
    ).rejects.toMatchObject({ kind: "unavailable", retryAfterSeconds: 12 });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalled();
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

/** N-1 binder SQL must omit role_reputation_decision_id unless human publication FK is set. */
describe("content moderation binding SQL compatibility", () => {
  const env = loadEnv(rawEnv);
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

  function captureClient() {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        if (sql.includes("content_moderation_approvals")) {
          return { rows: [{ id: "approval-1", decision: "allow" }] };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    return { client, sqls };
  }

  it("ordinary A bindTexts omits role_reputation_decision_id column name", async () => {
    const service = new ContentModerationService({} as Pool, env, fake);
    const text = "Играем в бадминтон";
    const fingerprint = service.textFingerprint("game_title", text);
    const { client, sqls } = captureClient();
    await service.bindTexts(
      client,
      {
        fields: [
          {
            surface: "game_title",
            fieldId: "title",
            text,
            fingerprint,
            providerKey: "fake",
            providerModel: MODERATION_MODEL,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: new Date("2026-11-07T00:00:00.000Z"),
            decision: safeTextItemDecision(),
            classification: "allow",
            responseId: null,
          },
        ],
      },
      [{ surface: "game_title", text }],
      {
        entityKind: "game",
        entityId: "11111111-1111-1111-1111-111111111111",
        resourceVersion: 1,
        actorUserId: "22222222-2222-2222-2222-222222222222",
        bindingKind: "publication",
      },
    );
    const bindingSql = sqls.find((s) => s.includes("content_moderation_bindings"));
    expect(bindingSql).toBeDefined();
    expect(bindingSql).not.toContain("role_reputation_decision_id");
  });

  it("human role publication bind names role_reputation_decision_id", async () => {
    const service = new ContentModerationService({} as Pool, env, fake);
    const text = "Спокойный отзыв о роли";
    const fingerprint = service.textFingerprint("role_review_body", text);
    const { client, sqls } = captureClient();
    await service.bindReviewTexts(
      client,
      {
        fields: [
          {
            surface: "role_review_body",
            fieldId: "text",
            text,
            fingerprint,
            providerKey: "fake",
            providerModel: MODERATION_MODEL,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: new Date("2026-11-07T00:00:00.000Z"),
            decision: safeTextItemDecision(),
            classification: "allow",
            responseId: null,
          },
        ],
      },
      [{ surface: "role_review_body", text }],
      {
        entityKind: "role_review_revision",
        entityId: "33333333-3333-3333-3333-333333333333",
        resourceVersion: 1,
        actorUserId: "22222222-2222-2222-2222-222222222222",
        actorPrincipalId: "44444444-4444-4444-4444-444444444444",
        bindingKind: "publication",
        roleReputationDecisionId: "55555555-5555-5555-5555-555555555555",
      },
    );
    const bindingSql = sqls.find((s) => s.includes("content_moderation_bindings"));
    expect(bindingSql).toContain("role_reputation_decision_id");
  });

  it("publication without human role decision id is rejected", async () => {
    const service = new ContentModerationService({} as Pool, env, fake);
    const text = "Спокойный отзыв о роли";
    const fingerprint = service.textFingerprint("role_review_body", text);
    const { client } = captureClient();
    await expect(
      service.bindReviewTexts(
        client,
        {
          fields: [
            {
              surface: "role_review_body",
              fieldId: "text",
              text,
              fingerprint,
              providerKey: "fake",
              providerModel: MODERATION_MODEL,
              policy: PUBLIC_TEXT_POLICY_VERSION,
              localPolicy: LOCAL_TEXT_POLICY_VERSION,
              checkedAt: new Date("2026-11-07T00:00:00.000Z"),
              decision: safeTextItemDecision(),
              classification: "allow",
              responseId: null,
            },
          ],
        },
        [{ surface: "role_review_body", text }],
        {
          entityKind: "role_review_revision",
          entityId: "33333333-3333-3333-3333-333333333333",
          resourceVersion: 1,
          actorUserId: "22222222-2222-2222-2222-222222222222",
          bindingKind: "publication",
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("human venue publication bind names venue_review_decision_id only", async () => {
    const service = new ContentModerationService({} as Pool, env, fake);
    const text = "Спокойный отзыв о площадке";
    const fingerprint = service.textFingerprint("venue_review_body", text);
    const { client, sqls } = captureClient();
    await service.bindReviewTexts(
      client,
      {
        fields: [
          {
            surface: "venue_review_body",
            fieldId: "text",
            text,
            fingerprint,
            providerKey: "fake",
            providerModel: MODERATION_MODEL,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: new Date("2026-11-07T00:00:00.000Z"),
            decision: safeTextItemDecision(),
            classification: "allow",
            responseId: null,
          },
        ],
      },
      [{ surface: "venue_review_body", text }],
      {
        entityKind: "venue_review_revision",
        entityId: "66666666-6666-6666-6666-666666666666",
        resourceVersion: 2,
        actorUserId: "22222222-2222-2222-2222-222222222222",
        actorPrincipalId: "44444444-4444-4444-4444-444444444444",
        bindingKind: "publication",
        venueReviewDecisionId: "77777777-7777-7777-7777-777777777777",
      },
    );
    const bindingSql = sqls.find((s) => s.includes("content_moderation_bindings"));
    expect(bindingSql).toContain("venue_review_decision_id");
    expect(bindingSql).not.toContain("role_reputation_decision_id");
  });

  it("venue candidate bind omits both human FK column names", async () => {
    const service = new ContentModerationService({} as Pool, env, fake);
    const text = "Кандидат отзыва о площадке";
    const fingerprint = service.textFingerprint("venue_review_body", text);
    const { client, sqls } = captureClient();
    await service.bindReviewTexts(
      client,
      {
        fields: [
          {
            surface: "venue_review_body",
            fieldId: "text",
            text,
            fingerprint,
            providerKey: "fake",
            providerModel: MODERATION_MODEL,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: new Date("2026-11-07T00:00:00.000Z"),
            decision: safeTextItemDecision(),
            classification: "allow",
            responseId: null,
          },
        ],
      },
      [{ surface: "venue_review_body", text }],
      {
        entityKind: "venue_review_revision",
        entityId: "66666666-6666-6666-6666-666666666666",
        resourceVersion: 1,
        actorUserId: "22222222-2222-2222-2222-222222222222",
        bindingKind: "candidate",
      },
    );
    const bindingSql = sqls.find((s) => s.includes("content_moderation_bindings"));
    expect(bindingSql).toBeDefined();
    expect(bindingSql).not.toContain("venue_review_decision_id");
    expect(bindingSql).not.toContain("role_reputation_decision_id");
  });
});
