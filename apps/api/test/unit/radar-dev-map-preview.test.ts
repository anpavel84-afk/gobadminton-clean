import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import { devMapPreview, DEV_MAP_VERSION } from "../../src/radar/dev-map-preview";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
const raw = { NODE_ENV: "test", APP_ENV: "mvp", DATABASE_URL: "postgres://test:test@localhost/test", PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru", PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru", RADAR_DEV_MAP_PREVIEW_ENABLED: "1", RADAR_DEV_MAP_PREVIEW_VERSION: DEV_MAP_VERSION, RADAR_DEV_MAP_PREVIEW_STYLE_SHA256: "a9d887c39bbdfca6ce2c1ab46b73b1d72217a50855aec033b2ad57a2087b8e03" };
describe("explicit DEV map registration", () => {
  it("parses explicit flags and registers only the immutable Moscow preview", () => {
    expect(devMapPreview(loadEnv(raw), MOSCOW_CITY_ID)).toEqual({ availability: "dev_preview", mapId: "moscow", version: DEV_MAP_VERSION });
    expect(devMapPreview(loadEnv({ ...raw, APP_ENV: "stage" }), MOSCOW_CITY_ID).availability).toBe("dev_preview");
  });
  it("fails closed for PROD, local, wrong origins, flags, version, checksum and city", () => {
    for (const patch of [{ APP_ENV: "prod" }, { APP_ENV: "local" }, { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" }, { PUBLIC_API_ORIGIN: "https://gobadminton.ru" }, { RADAR_DEV_MAP_PREVIEW_ENABLED: "0" }, { RADAR_DEV_MAP_PREVIEW_VERSION: "other" }, { RADAR_DEV_MAP_PREVIEW_STYLE_SHA256: "wrong" }]) {
      expect(devMapPreview(loadEnv({ ...raw, ...patch }), MOSCOW_CITY_ID)).toEqual({ availability: "missing", mapId: null, version: null });
    }
    expect(devMapPreview(loadEnv(raw), "other").availability).toBe("missing");
  });
});
