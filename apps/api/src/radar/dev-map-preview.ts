import type { AppEnv } from "../config/env";
import { MOSCOW_CITY_ID, SPB_CITY_ID } from "../venues/venues.service";
export const DEV_MAP_VERSION = "moscow-20261007-p4-098a869f-v001" as const;
export const DEV_SPB_MAP_VERSION = "saint-petersburg-20261104-p4-b7d3b1a8-v001" as const;
/** Client style hash for SPb equals API registration hash (descriptor). Moscow API hash stays separate. */
export const DEV_SPB_MAP_STYLE_SHA256 =
  "d87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea" as const;
type DevMapPreview =
  | { availability: "missing"; mapId: null; version: null }
  | { availability: "dev_preview"; mapId: "moscow"; version: typeof DEV_MAP_VERSION }
  | { availability: "dev_preview"; mapId: "saint-petersburg"; version: typeof DEV_SPB_MAP_VERSION };
function approvedOrigins(env: AppEnv): boolean {
  const dev = ["mvp", "stage"].includes(env.APP_ENV)
    && env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru";
  const prod = env.NODE_ENV === "production" && env.APP_ENV === "prod"
    && env.PUBLIC_WEB_ORIGIN === "https://gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://gobadminton.ru";
  return dev || prod;
}
export function devMapPreview(env: AppEnv, cityId: string): DevMapPreview {
  const missing = { availability: "missing" as const, mapId: null, version: null };
  if (!approvedOrigins(env)) return missing;
  // Legacy availability label `dev_preview` retained; flag is set by trusted release after install.
  if (
    cityId === MOSCOW_CITY_ID
    && env.RADAR_DEV_MAP_PREVIEW_ENABLED === true
    && env.RADAR_DEV_MAP_PREVIEW_VERSION === DEV_MAP_VERSION
    && env.RADAR_DEV_MAP_PREVIEW_STYLE_SHA256 === "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03"
  ) {
    return { availability: "dev_preview", mapId: "moscow", version: DEV_MAP_VERSION };
  }
  if (
    cityId === SPB_CITY_ID
    && env.RADAR_DEV_SPB_MAP_PREVIEW_ENABLED === true
    && env.RADAR_DEV_SPB_MAP_PREVIEW_VERSION === DEV_SPB_MAP_VERSION
    && env.RADAR_DEV_SPB_MAP_PREVIEW_STYLE_SHA256 === DEV_SPB_MAP_STYLE_SHA256
  ) {
    return { availability: "dev_preview", mapId: "saint-petersburg", version: DEV_SPB_MAP_VERSION };
  }
  return missing;
}
