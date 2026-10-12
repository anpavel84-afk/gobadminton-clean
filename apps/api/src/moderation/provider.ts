/** Internal port. No provider JSON, scores, or content belong in public DTOs. */
export const MODERATION_PROVIDER = Symbol("MODERATION_PROVIDER");
export const MODERATION_MODEL = "omni-moderation-2024-09-26";
export const IMAGE_CATEGORIES = ["self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "violence", "violence/graphic"] as const;
export type ImageCategory = typeof IMAGE_CATEGORIES[number];
export type ImageDecision = {
  model: string;
  responseId: string | null;
  flagged: boolean;
  categories: Record<ImageCategory, boolean>;
};
export type ModerationImage = {
  mime: "image/png";
  bytes: Buffer;
  signal: AbortSignal;
  /** Reserve every actual provider attempt, including a retry, before any network I/O. */
  beforeAttempt: () => Promise<void>;
};
export interface ContentModerationProvider {
  readonly key: "openai" | "fake";
  readonly model: string;
  moderateImage(input: ModerationImage): Promise<ImageDecision>;
}
export class ModerationProviderError extends Error {
  constructor(readonly kind: "unavailable" | "schema", readonly retryAfterSeconds?: number) {
    super(`Moderation ${kind}`);
  }
}
export function safeImageDecision(): ImageDecision {
  return {model: MODERATION_MODEL, responseId: null, flagged: false,
    categories: Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, false])) as Record<ImageCategory, boolean>};
}
