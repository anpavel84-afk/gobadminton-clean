import type { UnifiedSnapshot } from "@gobadminton/contracts";
export const MOSCOW_BUNDLE = {
  version: "moscow-20261007-p4-098a869f-v001",
  cityId: "a0000000-0000-4000-8000-000000000001",
  prefix: "https://maps.gobadminton.ru/releases/moscow-20261007-p4-098a869f-v001/",
  styleHash: "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03",
  center: [37.6176, 55.7517] as [number, number],
  bounds: [[36, 54.5], [39.5, 56.5]] as [[number, number], [number, number]],
};
/** The accepted API truth is map=missing. Only explicit localhost synthetic development
 * may inspect the reviewed candidate; this never registers/promotes a real map. */
export function candidateMapAllowed(snapshot: UnifiedSnapshot, hostname: string, configured = process.env.NEXT_PUBLIC_RADAR_MAP_CANDIDATE): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) && configured === MOSCOW_BUNDLE.version && snapshot.exposureMode === "synthetic_demo" && snapshot.cityId === MOSCOW_BUNDLE.cityId;
}
export function allowedMapResource(url: string): boolean {
  if (url.startsWith("blob:")) return true; // MapLibre's locally bundled worker.
  const resource = url.replace(/^pmtiles:\/\//, "");
  try {
    const parsed = new URL(resource);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href.startsWith(MOSCOW_BUNDLE.prefix);
  } catch { return false; }
}
