import type { AppEnv } from "../config/env";
import { MODERATION_MODEL, safeImageDecision, type ContentModerationProvider, type ImageDecision, type ModerationImage } from "./provider";

/** Explicit synthetic fixture injection only. Never classifies content or records image bytes. */
export class FakeModerationProvider implements ContentModerationProvider {
  readonly key = "fake";
  readonly model = MODERATION_MODEL;
  calls = 0;
  constructor(env: Pick<AppEnv, "NODE_ENV" | "APP_ENV">,
    public fixture: (input: ModerationImage) => Promise<ImageDecision> = async () => safeImageDecision()) {
    if (env.NODE_ENV !== "test" || env.APP_ENV !== "local") throw new Error("Fake moderation requires local NODE_ENV=test");
  }
  async moderateImage(input: ModerationImage): Promise<ImageDecision> {
    await input.beforeAttempt();
    input.signal.throwIfAborted();
    this.calls++;
    return this.fixture(input);
  }
}
