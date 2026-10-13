import type { UnifiedSnapshot } from "@gobadminton/contracts";
export const MOSCOW_BUNDLE = {
  version: "moscow-20261007-p4-098a869f-v001",
  cityId: "a0000000-0000-4000-8000-000000000001",
  prefix: "https://maps.gobadminton.ru/releases/moscow-20261007-p4-098a869f-v001/",
  styleHash: "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03",
  center: [37.6176, 55.7517] as [number, number],
  bounds: [[36, 54.5], [39.5, 56.5]] as [[number, number], [number, number]],
};
/** The pinned basemap is a candidate, not a registered API mapId. On Germany DEV
 * it is served locally and checksum-verified; PROD stays fail-closed. */
export const MOSCOW_DEV_BUNDLE = {
  ...MOSCOW_BUNDLE,
  prefix: "https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/",
  styleFile: "style-dev.json",
  styleHash: "0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d",
};
export type RadarMapBundle = typeof MOSCOW_BUNDLE | typeof MOSCOW_DEV_BUNDLE;
export function mapBundleForHost(hostname: string): RadarMapBundle {
  return hostname === "dev.gobadminton.ru" ? MOSCOW_DEV_BUNDLE : MOSCOW_BUNDLE;
}
/** Public venue geography does not disclose player coordinates and may render
 * before sign-in. Moscow-only and exclusively on the exact Germany DEV host. */
export function publicDevMapAllowed(hostname: string, cityId: string | null | undefined): boolean {
  return hostname === "dev.gobadminton.ru" && (!cityId || cityId === MOSCOW_BUNDLE.cityId);
}
/** Legacy localhost candidate remains synthetic-only. DEV uses isolated local
 * assets, never the Moscow PROD transport or an inferred user position. */
export function candidateMapAllowed(snapshot: UnifiedSnapshot, hostname: string, configured = process.env.NEXT_PUBLIC_RADAR_MAP_CANDIDATE): boolean {
  return publicDevMapAllowed(hostname, snapshot.cityId) || (["localhost", "127.0.0.1", "[::1]"].includes(hostname) && configured === MOSCOW_BUNDLE.version && snapshot.exposureMode === "synthetic_demo" && snapshot.cityId === MOSCOW_BUNDLE.cityId);
}
export function allowedMapResource(url: string, bundle: RadarMapBundle = MOSCOW_BUNDLE): boolean {
  if (url.startsWith("blob:")) return true; // MapLibre's locally bundled worker.
  const resource = url.replace(/^pmtiles:\/\//, "");
  try {
    const parsed = new URL(resource);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href.startsWith(bundle.prefix);
  } catch { return false; }
}
