import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";
import { GAME_CHAT_MESSAGE_RETENTION_SECONDS_DEFAULT } from "./constants";

@Injectable()
export class GameChatFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertEnabled(): void {
    if (!this.env.SOCIAL_GAME_CHAT_ENABLED) {
      throw notFound("SOCIAL_GAME_CHAT_DISABLED", "Чат игры недоступен");
    }
  }

  get enabled(): boolean {
    return this.env.SOCIAL_GAME_CHAT_ENABLED;
  }

  messageRetentionSeconds(): number {
    return this.env.SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS;
  }

  purgeEligibleAt(createdAt: Date): Date {
    return new Date(
      createdAt.getTime() + this.messageRetentionSeconds() * 1000,
    );
  }
}

export const GAME_CHAT_FIXTURE_DEFAULTS = {
  messageRetentionSeconds: GAME_CHAT_MESSAGE_RETENTION_SECONDS_DEFAULT,
} as const;
