import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";
import { INVITATION_TTL_SECONDS_DEFAULT } from "./constants";

@Injectable()
export class InvitationFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertEnabled(): void {
    if (!this.env.SOCIAL_INVITATIONS_ENABLED) {
      throw notFound(
        "SOCIAL_INVITATIONS_DISABLED",
        "Приглашения на игру недоступны",
      );
    }
  }

  get enabled(): boolean {
    return this.env.SOCIAL_INVITATIONS_ENABLED;
  }

  ttlSeconds(): number {
    return this.env.SOCIAL_INVITATION_TTL_SECONDS;
  }

  expiresAt(now: Date, applicationDeadlineAt: Date): Date {
    const ttl = new Date(now.getTime() + this.ttlSeconds() * 1000);
    return ttl < applicationDeadlineAt ? ttl : applicationDeadlineAt;
  }
}

export const INVITATION_FIXTURE_DEFAULTS = {
  ttlSeconds: INVITATION_TTL_SECONDS_DEFAULT,
} as const;
