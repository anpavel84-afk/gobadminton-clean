import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";

@Injectable()
export class SocialFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertEnabled(): void {
    if (!this.env.SOCIAL_DIRECTORY_ENABLED) {
      throw notFound(
        "SOCIAL_DIRECTORY_DISABLED",
        "Социальный каталог недоступен",
      );
    }
  }

  get enabled(): boolean {
    return this.env.SOCIAL_DIRECTORY_ENABLED;
  }
}
