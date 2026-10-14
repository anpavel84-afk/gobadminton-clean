import type { AppEnv } from "../config/env";
import type { UnifiedMap } from "@gobadminton/contracts";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
export const DEV_MAP_VERSION = "moscow-20261007-p4-098a869f-v001";
export function devMapPreview(env: AppEnv, cityId: string): UnifiedMap {
  const enabled = cityId === MOSCOW_CITY_ID && ["mvp", "stage"].includes(env.APP_ENV) &&
    env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru" && env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru" &&
    env.RADAR_DEV_MAP_PREVIEW_ENABLED === true && env.RADAR_DEV_MAP_PREVIEW_VERSION === DEV_MAP_VERSION &&
    env.RADAR_DEV_MAP_PREVIEW_STYLE_SHA256 === "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03";
  return enabled ? { availability: "dev_preview", mapId: "moscow", version: DEV_MAP_VERSION } : { availability: "missing", mapId: null, version: null };
}
