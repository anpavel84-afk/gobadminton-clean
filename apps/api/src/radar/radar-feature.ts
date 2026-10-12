import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { isDemoUuid } from "../database/demo-ids";
import { notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";
import type { RadarExposureMode } from "./constants";

@Injectable()
export class RadarFeatureService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  /** Live Radar for any active authenticated non-demo consumer. Process unset remains fail-closed; compose durable default is on. */
  get liveEnabled(): boolean {
    return this.env.SOCIAL_RADAR_ENABLED;
  }

  /** Synthetic/internal city-scoped demo path. Default off. */
  get demoEnabled(): boolean {
    return this.env.SOCIAL_RADAR_DEMO_ENABLED;
  }

  get anyEnabled(): boolean {
    return this.liveEnabled || this.demoEnabled;
  }

  /** Identity namespaces never change exposure mode when flags change. */
  assertAccess(userId: string): RadarExposureMode {
    if (isDemoUuid(userId)) {
      if (this.demoEnabled) return "synthetic_demo";
    } else if (this.liveEnabled) {
      return "live";
    }
    throw notFound("SOCIAL_RADAR_DISABLED", "Radar недоступен");
  }

  /** @deprecated Prefer assertAccess(userId). Kept for call-site migration. */
  assertEnabled(): void {
    if (!this.anyEnabled) {
      throw notFound("SOCIAL_RADAR_DISABLED", "Radar недоступен");
    }
  }

  get enabled(): boolean {
    return this.anyEnabled;
  }
}
