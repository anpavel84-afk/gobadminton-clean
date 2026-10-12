import { Module } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { ContentModerationService } from "./moderation.service";
import { FakeModerationProvider } from "./fake-provider";
import { OpenAIModerationProvider } from "./openai-provider";
import { MODERATION_PROVIDER, MODERATION_MODEL, ModerationProviderError } from "./provider";

@Module({providers: [ContentModerationService, {
  provide: MODERATION_PROVIDER, inject: [APP_ENV], useFactory: (env: AppEnv) => {
    if (env.CONTENT_MODERATION_PROVIDER === "fake") return new FakeModerationProvider(env);
    if (env.CONTENT_MODERATION_PROVIDER === "openai") return new OpenAIModerationProvider(env);
    // Unconfigured test harnesses fail closed; non-test startup is rejected by loadEnv.
    return {key: "openai", model: MODERATION_MODEL, moderateImage: async () => {throw new ModerationProviderError("unavailable");}};
  },
}], exports: [ContentModerationService, MODERATION_PROVIDER]})
export class ModerationModule {}
