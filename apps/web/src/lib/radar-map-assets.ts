import type { UnifiedSnapshot } from "@gobadminton/contracts";
import type { RadarConfig } from "./unified-directory";
import { REGIONAL_MAP_PACKS, regionalMapPackForCity, type RegionalMapPack } from "./regional-map-packs";
export const MOSCOW_BUNDLE = {
  version: "moscow-20261007-p4-098a869f-v001",
  cityId: "a0000000-0000-4000-8000-000000000001",
  prefix: "https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/",
  styleHash: "0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d",
  center: [37.6176, 55.7517] as [number, number],
  bounds: [[36, 54.5], [39.5, 56.5]] as [[number, number], [number, number]],
};
/** Fixed Saint Petersburg pack — closed second city only; not a provider registry. */
export const SAINT_PETERSBURG_BUNDLE = {
  version: "saint-petersburg-20261104-p4-b7d3b1a8-v001",
  cityId: "a0000000-0000-4000-8000-000000000002",
  mapId: "saint-petersburg" as const,
  prefix: "https://dev.gobadminton.ru/map-assets/releases/saint-petersburg-20261104-p4-b7d3b1a8-v001/",
  styleHash: "d87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea",
  center: [30.3158, 59.9391] as [number, number],
  bounds: [[27.25, 58.35], [36.05, 62.25]] as [[number, number], [number, number]],
  defaultZoom: 10.5,
};
export type FixedMapBundle =
  | typeof MOSCOW_BUNDLE
  | typeof SAINT_PETERSBURG_BUNDLE
  | RegionalMapPack;
export { REGIONAL_MAP_PACKS, regionalMapPackForCity };
export const DEV_APP_ORIGIN = "https://dev.gobadminton.ru";
export const PROD_APP_ORIGIN = "https://gobadminton.ru";
/** Exact browser app origin: registered DEV or canonical PROD only. */
export function isApprovedAppOrigin(origin: string): boolean {
  return origin === DEV_APP_ORIGIN || origin === PROD_APP_ORIGIN;
}
/** Closed lookup of known city packs; unknown city → null (honest unavailable). */
export function mapBundleForCity(cityId: string | null | undefined): FixedMapBundle | null {
  if (cityId === MOSCOW_BUNDLE.cityId) return MOSCOW_BUNDLE;
  if (cityId === SAINT_PETERSBURG_BUNDLE.cityId) return SAINT_PETERSBURG_BUNDLE;
  return regionalMapPackForCity(cityId);
}
export function mapIdForBundle(bundle: FixedMapBundle): string {
  if ("mapId" in bundle && typeof bundle.mapId === "string") return bundle.mapId;
  return "moscow";
}
/** Human city label for accessibility/status — never invent Moscow for other packs. */
export function cityLabelForBundle(bundle: FixedMapBundle): string {
  if ("cityLabel" in bundle && typeof bundle.cityLabel === "string") return bundle.cityLabel;
  if (bundle === SAINT_PETERSBURG_BUNDLE || mapIdForBundle(bundle) === "saint-petersburg") {
    return "Санкт-Петербург";
  }
  return "Москва";
}
export function pointInBundleBounds(lon: number, lat: number, bundle: FixedMapBundle): boolean {
  const [[west, south], [east, north]] = bundle.bounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}
/** Server registration and exact browser origin are both required. */
export function candidateMapAllowed(snapshot: UnifiedSnapshot, origin: string): boolean {
  if (!isApprovedAppOrigin(origin) || snapshot.map.availability !== "dev_preview") return false;
  if (!["authenticated_live", "synthetic_demo"].includes(snapshot.exposureMode)) return false;
  const bundle = mapBundleForCity(snapshot.cityId);
  if (!bundle) return false;
  return snapshot.map.mapId === mapIdForBundle(bundle) && snapshot.map.version === bundle.version;
}
/** Public basemap may remain visible while a short-lived signed people query
 * expires. No participant/pin is allowed without that separate live query. */
export function candidateMapConfigAllowed(config: RadarConfig | null, cityId: string | undefined, origin: string): boolean {
  const bundle = mapBundleForCity(cityId);
  if (!isApprovedAppOrigin(origin) || !bundle ||
      config?.unifiedDirectory.enabled !== true ||
      !["live", "synthetic_demo"].includes(config.exposureMode)) return false;
  const map = config.cities.find(c => c.cityId === cityId)?.map;
  return map?.availability === "dev_preview" && map.mapId === mapIdForBundle(bundle) && map.version === bundle.version;
}
/** Credential/query/hash rejected; URL must stay under the selected pack prefix. */
export function allowedMapResource(url: string, bundle: FixedMapBundle = MOSCOW_BUNDLE): boolean {
  const resource = url.replace(/^pmtiles:\/\//, "");
  try {
    const parsed = new URL(resource);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href.startsWith(bundle.prefix);
  } catch { return false; }
}
