import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";
import {
  DM_MESSAGE_RETENTION_SECONDS_DEFAULT,
  DM_REQUEST_TTL_SECONDS_DEFAULT,
} from "./constants";

@Injectable()
export class DmFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertEnabled(): void {
    if (!this.env.SOCIAL_DM_ENABLED) {
      throw notFound("SOCIAL_DM_DISABLED", "Обмен сообщениями недоступен");
    }
  }

  get enabled(): boolean {
    return this.env.SOCIAL_DM_ENABLED;
  }

  requestTtlSeconds(): number {
    return this.env.SOCIAL_DM_REQUEST_TTL_SECONDS;
  }

  messageRetentionSeconds(): number {
    return this.env.SOCIAL_DM_MESSAGE_RETENTION_SECONDS;
  }

  requestExpiresAt(now = new Date()): Date {
    return new Date(now.getTime() + this.requestTtlSeconds() * 1000);
  }

  purgeEligibleAt(createdAt: Date): Date {
    return new Date(
      createdAt.getTime() + this.messageRetentionSeconds() * 1000,
    );
  }
}

export const DM_FIXTURE_DEFAULTS = {
  requestTtlSeconds: DM_REQUEST_TTL_SECONDS_DEFAULT,
  messageRetentionSeconds: DM_MESSAGE_RETENTION_SECONDS_DEFAULT,
} as const;
