import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import {
  DEV_MAP_VERSION,
  DEV_SPB_MAP_STYLE_SHA256,
  DEV_SPB_MAP_VERSION,
  devMapPreview,
} from "../../src/radar/dev-map-preview";
import { MOSCOW_CITY_ID, SPB_CITY_ID } from "../../src/venues/venues.service";

const moscowStyle = "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03";
const base = {
  NODE_ENV: "test",
  APP_ENV: "mvp",
  DATABASE_URL: "postgres://test:test@localhost/test",
  PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
  PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
  RADAR_DEV_MAP_PREVIEW_ENABLED: "1",
  RADAR_DEV_MAP_PREVIEW_VERSION: DEV_MAP_VERSION,
  RADAR_DEV_MAP_PREVIEW_STYLE_SHA256: moscowStyle,
};
const spbEnabled = {
  ...base,
  RADAR_DEV_SPB_MAP_PREVIEW_ENABLED: "1",
  RADAR_DEV_SPB_MAP_PREVIEW_VERSION: DEV_SPB_MAP_VERSION,
  RADAR_DEV_SPB_MAP_PREVIEW_STYLE_SHA256: DEV_SPB_MAP_STYLE_SHA256,
};
const spbPreview = {
  availability: "dev_preview",
  mapId: "saint-petersburg",
  version: DEV_SPB_MAP_VERSION,
} as const;
const moscowPreview = {
  availability: "dev_preview",
  mapId: "moscow",
  version: DEV_MAP_VERSION,
} as const;
const missing = { availability: "missing", mapId: null, version: null } as const;

describe("Saint Petersburg DEV map registration", () => {
  it("defaults SPb preview off and keeps Moscow registration independent", () => {
    const env = loadEnv(base);
    expect(env.RADAR_DEV_SPB_MAP_PREVIEW_ENABLED).toBe(false);
    expect(devMapPreview(env, SPB_CITY_ID)).toEqual(missing);
    expect(devMapPreview(env, MOSCOW_CITY_ID)).toEqual(moscowPreview);
  });

  it("registers SPb only with exact version and style hash on approved origins", () => {
    expect(devMapPreview(loadEnv(spbEnabled), SPB_CITY_ID)).toEqual(spbPreview);
    expect(devMapPreview(loadEnv({ ...spbEnabled, APP_ENV: "stage" }), SPB_CITY_ID)).toEqual(spbPreview);
    const prod = {
      ...loadEnv(spbEnabled),
      NODE_ENV: "production" as const,
      APP_ENV: "prod" as const,
      PUBLIC_WEB_ORIGIN: "https://gobadminton.ru",
      PUBLIC_API_ORIGIN: "https://gobadminton.ru",
    };
    expect(devMapPreview(prod, SPB_CITY_ID)).toEqual(spbPreview);
    expect(devMapPreview(prod, MOSCOW_CITY_ID)).toEqual(moscowPreview);
  });

  it("returns missing for absent, wrong hash, wrong version, wrong city and local/mixed origins", () => {
    expect(devMapPreview(loadEnv(base), SPB_CITY_ID)).toEqual(missing);
    for (const patch of [
      { RADAR_DEV_SPB_MAP_PREVIEW_ENABLED: "0" },
      { RADAR_DEV_SPB_MAP_PREVIEW_VERSION: "other" },
      { RADAR_DEV_SPB_MAP_PREVIEW_STYLE_SHA256: "wrong" },
      { RADAR_DEV_SPB_MAP_PREVIEW_STYLE_SHA256: moscowStyle },
      { APP_ENV: "local" },
      { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" },
      { PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    ]) {
      expect(devMapPreview(loadEnv({ ...spbEnabled, ...patch }), SPB_CITY_ID)).toEqual(missing);
    }
    expect(devMapPreview(loadEnv(spbEnabled), MOSCOW_CITY_ID)).toEqual(moscowPreview);
    expect(devMapPreview(loadEnv(spbEnabled), "other")).toEqual(missing);
  });
});
