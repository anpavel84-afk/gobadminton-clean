import OpenAI from "openai";
import { z } from "zod";
import type { AppEnv } from "../config/env";
import {
  IMAGE_CATEGORIES,
  MODERATION_MODEL,
  ModerationProviderError,
  TEXT_CATEGORIES,
  type ContentModerationProvider,
  type ImageDecision,
  type ModerationImage,
  type ModerationTextBatch,
  type TextBatchDecision,
  type TextItemDecision,
} from "./provider";

const imageCategories = z.object(Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, z.boolean()])));
const imageInputTypes = z.object(Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, z.array(z.enum(["image", "text"]))])));
const imageResponseSchema = z.object({
  id: z.string().min(1).max(200), model: z.literal(MODERATION_MODEL),
  results: z.array(z.object({flagged: z.boolean(), categories: imageCategories, category_applied_input_types: imageInputTypes})).length(1),
});

const textCategories = z.object(Object.fromEntries(TEXT_CATEGORIES.map(key => [key, z.boolean()])));
const textInputTypes = z.object(Object.fromEntries(TEXT_CATEGORIES.map(key => [key, z.array(z.enum(["image", "text"]))])));
const textResultSchema = z.object({
  flagged: z.boolean(),
  categories: textCategories,
  category_applied_input_types: textInputTypes,
});

export function parseImageResponse(raw: unknown): ImageDecision {
  const parsed = imageResponseSchema.safeParse(raw);
  if (!parsed.success) throw new ModerationProviderError("schema");
  const result = parsed.data.results[0]!;
  // Empty input metadata is normal for an unflagged category. A true flag must apply to image.
  for (const key of IMAGE_CATEGORIES) {
    if (result.categories[key] && !result.category_applied_input_types[key]?.includes("image")) throw new ModerationProviderError("schema");
  }
  const flags = Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, result.categories[key]])) as ImageDecision["categories"];
  if (result.flagged && !Object.values(flags).some(Boolean)) throw new ModerationProviderError("schema");
  return {model: parsed.data.model, responseId: parsed.data.id, flagged: result.flagged, categories: flags};
}

export function parseTextResponse(raw: unknown, expectedCount: number): TextBatchDecision {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 16) {
    throw new ModerationProviderError("schema");
  }
  const schema = z.object({
    id: z.string().min(1).max(200),
    model: z.literal(MODERATION_MODEL),
    results: z.array(textResultSchema).length(expectedCount),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ModerationProviderError("schema");
  const results: TextItemDecision[] = parsed.data.results.map((result) => {
    for (const key of TEXT_CATEGORIES) {
      if (result.categories[key] && !result.category_applied_input_types[key]?.includes("text")) {
        throw new ModerationProviderError("schema");
      }
    }
    const flags = Object.fromEntries(
      TEXT_CATEGORIES.map((key) => [key, result.categories[key]]),
    ) as TextItemDecision["categories"];
    if (result.flagged && !Object.values(flags).some(Boolean)) {
      throw new ModerationProviderError("schema");
    }
    return { flagged: result.flagged, categories: flags };
  });
  return { model: parsed.data.model, responseId: parsed.data.id, results };
}

export class OpenAIModerationProvider implements ContentModerationProvider {
  readonly key = "openai";
  readonly model = MODERATION_MODEL;
  private readonly client: OpenAI;
  constructor(env: AppEnv, fetchOverride?: typeof fetch) {
    if (!env.OPENAI_MODERATION_API_KEY) throw new Error("Missing moderation configuration");
    this.client = new OpenAI({apiKey: env.OPENAI_MODERATION_API_KEY, baseURL: env.OPENAI_MODERATION_BASE_URL,
      maxRetries: 0, timeout: 4000, logLevel: "off", ...(fetchOverride ? {fetch: fetchOverride} : {})});
  }
  async moderateImage(input: ModerationImage): Promise<ImageDecision> {
    const deadline = Date.now() + 6000;
    for (let attempt = 0; ; attempt++) {
      await input.beforeAttempt();
      input.signal.throwIfAborted();
      try {
        const response = await this.client.moderations.create({model: MODERATION_MODEL,
          input: [{type: "image_url", image_url: {url: `data:image/png;base64,${input.bytes.toString("base64")}`}}]},
        {signal: input.signal, timeout: Math.min(4000, Math.max(1, deadline - Date.now()))});
        return parseImageResponse(response);
      } catch (error) {
        if (error instanceof ModerationProviderError) throw error;
        if (error instanceof SyntaxError) throw new ModerationProviderError("schema");
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        const retryable = error instanceof OpenAI.APIConnectionError || status === 408 || (status !== undefined && status >= 500);
        if (attempt === 0 && retryable && !input.signal.aborted && deadline - Date.now() > 250) continue;
        const retry = error instanceof OpenAI.APIError ? Number(error.headers?.get("retry-after")) : NaN;
        throw new ModerationProviderError("unavailable", Number.isFinite(retry) && retry > 0 ? Math.min(60, Math.ceil(retry)) : undefined);
      }
    }
  }
  async moderateTexts(input: ModerationTextBatch): Promise<TextBatchDecision> {
    const deadline = Date.now() + 6000;
    const expected = input.texts.length;
    if (expected < 1 || expected > 16) throw new ModerationProviderError("schema");
    for (let attempt = 0; ; attempt++) {
      await input.beforeAttempt();
      input.signal.throwIfAborted();
      try {
        const response = await this.client.moderations.create(
          {
            model: MODERATION_MODEL,
            input: input.texts.map((text) => ({ type: "text" as const, text })),
          },
          { signal: input.signal, timeout: Math.min(4000, Math.max(1, deadline - Date.now())) },
        );
        return parseTextResponse(response, expected);
      } catch (error) {
        if (error instanceof ModerationProviderError) throw error;
        if (error instanceof SyntaxError) throw new ModerationProviderError("schema");
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        const retryable =
          error instanceof OpenAI.APIConnectionError ||
          status === 408 ||
          (status !== undefined && status >= 500);
        if (attempt === 0 && retryable && !input.signal.aborted && deadline - Date.now() > 250) continue;
        const retry = error instanceof OpenAI.APIError ? Number(error.headers?.get("retry-after")) : NaN;
        throw new ModerationProviderError(
          "unavailable",
          Number.isFinite(retry) && retry > 0 ? Math.min(60, Math.ceil(retry)) : undefined,
        );
      }
    }
  }
}
