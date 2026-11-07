import type { AppEnv } from "../config/env";
import {
  MODERATION_MODEL,
  safeImageDecision,
  safeTextBatchDecision,
  type ContentModerationProvider,
  type ImageDecision,
  type ModerationImage,
  type ModerationTextBatch,
  type TextBatchDecision,
} from "./provider";

/** Explicit synthetic fixture injection only. Never classifies content or records payloads. */
export class FakeModerationProvider implements ContentModerationProvider {
  readonly key = "fake";
  readonly model = MODERATION_MODEL;
  /** Image-only call counter — existing image tests assert this. */
  calls = 0;
  /** Separate text counter so image assertions stay image-only. */
  textCalls = 0;
  constructor(
    env: Pick<AppEnv, "NODE_ENV" | "APP_ENV">,
    public fixture: (input: ModerationImage) => Promise<ImageDecision> = async () => safeImageDecision(),
    public textFixture: (input: ModerationTextBatch) => Promise<TextBatchDecision> = async (input) =>
      safeTextBatchDecision(input.texts.length),
  ) {
    if (env.NODE_ENV !== "test" || env.APP_ENV !== "local") throw new Error("Fake moderation requires local NODE_ENV=test");
  }
  async moderateImage(input: ModerationImage): Promise<ImageDecision> {
    await input.beforeAttempt();
    input.signal.throwIfAborted();
    this.calls++;
    return this.fixture(input);
  }
  async moderateTexts(input: ModerationTextBatch): Promise<TextBatchDecision> {
    await input.beforeAttempt();
    input.signal.throwIfAborted();
    this.textCalls++;
    return this.textFixture(input);
  }
}
