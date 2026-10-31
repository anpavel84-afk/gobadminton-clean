import { expect, it } from "vitest";
import type { UnifiedSnapshot } from "@gobadminton/contracts";
import {
  DEV_APP_ORIGIN,
  MOSCOW_BUNDLE,
  PROD_APP_ORIGIN,
  candidateMapAllowed,
  candidateMapConfigAllowed,
  isApprovedAppOrigin,
} from "../src/lib/radar-map-assets";
import type { RadarConfig } from "../src/lib/unified-directory";

const preview = {
  cityId: MOSCOW_BUNDLE.cityId,
  exposureMode: "synthetic_demo",
  map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version },
} as UnifiedSnapshot;

const config = {
  exposureMode: "live",
  unifiedDirectory: { enabled: true },
  cities: [{
    cityId: MOSCOW_BUNDLE.cityId,
    regionId: "moscow",
    map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version },
  }],
} as RadarConfig;

it("approves only exact DEV and canonical PROD app origins", () => {
  expect(isApprovedAppOrigin(DEV_APP_ORIGIN)).toBe(true);
  expect(isApprovedAppOrigin(PROD_APP_ORIGIN)).toBe(true);
  for (const origin of [
    "https://www.gobadminton.ru",
    "https://api.gobadminton.ru",
    "http://gobadminton.ru",
    "https://gobadminton.ru/",
    "https://dev.gobadminton.ru.evil",
    "https://unknown.host",
    "http://127.0.0.1:3001",
  ]) {
    expect(isApprovedAppOrigin(origin)).toBe(false);
  }
});

it("admits registered Moscow candidate map on exact DEV and canonical PROD", () => {
  expect(candidateMapAllowed(preview, DEV_APP_ORIGIN)).toBe(true);
  expect(candidateMapAllowed(preview, PROD_APP_ORIGIN)).toBe(true);
  expect(candidateMapConfigAllowed(config, MOSCOW_BUNDLE.cityId, DEV_APP_ORIGIN)).toBe(true);
  expect(candidateMapConfigAllowed(config, MOSCOW_BUNDLE.cityId, PROD_APP_ORIGIN)).toBe(true);
});

it("rejects wrong APP, mixed lookalikes, unknown host, and missing registration", () => {
  for (const origin of [
    "https://www.gobadminton.ru",
    "https://api.gobadminton.ru",
    "https://unknown.host",
    "http://localhost:3001",
  ]) {
    expect(candidateMapAllowed(preview, origin)).toBe(false);
    expect(candidateMapConfigAllowed(config, MOSCOW_BUNDLE.cityId, origin)).toBe(false);
  }
  expect(candidateMapAllowed({ ...preview, map: { availability: "missing", mapId: null, version: null } }, PROD_APP_ORIGIN)).toBe(false);
  expect(candidateMapAllowed({ ...preview, cityId: "other" }, PROD_APP_ORIGIN)).toBe(false);
  expect(candidateMapConfigAllowed(null, MOSCOW_BUNDLE.cityId, PROD_APP_ORIGIN)).toBe(false);
  expect(candidateMapConfigAllowed(config, "another-city", PROD_APP_ORIGIN)).toBe(false);
});
