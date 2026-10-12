import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";

@Injectable()
export class InboxFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertEnabled(): void {
    if (!this.env.SOCIAL_INBOX_ENABLED) {
      throw notFound("SOCIAL_INBOX_DISABLED", "Входящие недоступны");
    }
  }

  get enabled(): boolean {
    return this.env.SOCIAL_INBOX_ENABLED;
  }

  get dmEnabled(): boolean {
    return this.env.SOCIAL_DM_ENABLED;
  }

  get invitationsEnabled(): boolean {
    return this.env.SOCIAL_INVITATIONS_ENABLED;
  }

  get gameChatEnabled(): boolean {
    return this.env.SOCIAL_GAME_CHAT_ENABLED;
  }
}
