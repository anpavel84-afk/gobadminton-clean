import type { UnifiedSnapshot } from "@gobadminton/contracts";
export const MOSCOW_BUNDLE = {
  version: "moscow-20261007-p4-098a869f-v001",
  cityId: "a0000000-0000-4000-8000-000000000001",
  prefix: "https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/",
  styleHash: "0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d",
  center: [37.6176, 55.7517] as [number, number],
  bounds: [[36, 54.5], [39.5, 56.5]] as [[number, number], [number, number]],
};
/** Server registration and exact browser origin are both required. */
export function candidateMapAllowed(snapshot: UnifiedSnapshot, origin: string): boolean {
  return origin === "https://dev.gobadminton.ru" && snapshot.map.availability === "dev_preview" &&
    snapshot.map.mapId === "moscow" && snapshot.map.version === MOSCOW_BUNDLE.version &&
    ["authenticated_live", "synthetic_demo"].includes(snapshot.exposureMode) && snapshot.cityId === MOSCOW_BUNDLE.cityId;
}
export function allowedMapResource(url: string): boolean {
  const resource = url.replace(/^pmtiles:\/\//, "");
  try {
    const parsed = new URL(resource);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href.startsWith(MOSCOW_BUNDLE.prefix);
  } catch { return false; }
}
