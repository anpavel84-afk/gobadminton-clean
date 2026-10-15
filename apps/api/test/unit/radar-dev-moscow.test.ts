import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { devMoscowTestAllowed, devMoscowFixturesEnabled, DEV_MOSCOW_PEER_IDS } from "../../src/radar/dev-moscow-test";
import { loadEnv } from "../../src/config/env";
import type { AppEnv } from "../../src/config/env";
import { isDemoUuid } from "../../src/database/demo-ids";
describe("DEV Moscow owner boundary", () => {
  const owner = randomUUID();
  const env = { APP_ENV: "stage", PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru", PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru", RADAR_DEV_TEST_OWNER_USER_ID: owner } as AppEnv;
  it("fails closed on disabled, PROD, other origins and other actor", () => {
    expect(devMoscowTestAllowed(env, owner)).toBe(true);
    for (const patch of [{ RADAR_DEV_TEST_OWNER_USER_ID: undefined }, { APP_ENV: "prod" }, { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" }, { PUBLIC_API_ORIGIN: "https://gobadminton.ru" }, { RADAR_DEV_TEST_OWNER_USER_ID: DEV_MOSCOW_PEER_IDS[0] }])
      expect(devMoscowTestAllowed({ ...env, ...patch } as AppEnv, owner)).toBe(false);
    expect(devMoscowTestAllowed(env, DEV_MOSCOW_PEER_IDS[0]!)).toBe(false);
    expect(devMoscowTestAllowed(undefined, owner)).toBe(false);
  });
  it("refuses startup when explicitly configured in PROD or outside exact DEV", () => {
    const raw = { NODE_ENV:"test", APP_ENV:"stage", DATABASE_URL:"postgres://test:test@localhost/test", PUBLIC_API_ORIGIN:"https://dev.gobadminton.ru", PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru", RADAR_DEV_TEST_OWNER_USER_ID:owner };
    expect(loadEnv(raw).RADAR_DEV_TEST_OWNER_USER_ID).toBe(owner);
    const second = randomUUID();
    expect(loadEnv({ ...raw, RADAR_DEV_TEST_SECOND_USER_ID: second }).RADAR_DEV_TEST_SECOND_USER_ID).toBe(second);
    for (const patch of [{ APP_ENV: "prod" }, { PUBLIC_API_ORIGIN: "https://gobadminton.ru" }, { PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru/" }, { RADAR_DEV_TEST_SECOND_USER_ID: "invalid" }, { RADAR_DEV_TEST_OWNER_USER_ID: undefined }])
      expect(() => loadEnv({ ...raw, RADAR_DEV_TEST_SECOND_USER_ID: second, ...patch })).toThrow(/Invalid API configuration/);
    for (const patch of [{ APP_ENV:"prod" }, { PUBLIC_WEB_ORIGIN:"https://gobadminton.ru" }, { PUBLIC_API_ORIGIN:"https://gobadminton.ru" }, { RADAR_DEV_TEST_OWNER_USER_ID:"invalid" }])
      expect(() => loadEnv({ ...raw, ...patch })).toThrow(/Invalid API configuration/);
  });
  it("enables fixtures for non-owner viewers only on exact DEV", () => {
    expect(devMoscowFixturesEnabled(env)).toBe(true);
    expect(devMoscowTestAllowed(env, randomUUID())).toBe(false);
    for (const patch of [{ RADAR_DEV_TEST_OWNER_USER_ID: undefined }, { APP_ENV: "prod" }, { APP_ENV: "local" }, { PUBLIC_API_ORIGIN: "https://gobadminton.ru" }, { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" }])
      expect(devMoscowFixturesEnabled({ ...env, ...patch } as AppEnv)).toBe(false);
    expect(devMoscowFixturesEnabled(undefined)).toBe(false);
  });
  it("admits precisely owner and second UUID, with no wildcard or malformed config", () => {
    const second = randomUUID();
    const configured = { ...env, RADAR_DEV_TEST_SECOND_USER_ID: second };
    expect(devMoscowTestAllowed(configured, owner)).toBe(true);
    expect(devMoscowTestAllowed(configured, second)).toBe(true);
    expect(devMoscowTestAllowed(configured, randomUUID())).toBe(false);
    for (const patch of [{ APP_ENV: "prod" }, { PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru/" }, { PUBLIC_API_ORIGIN: "https://gobadminton.ru" }, { RADAR_DEV_TEST_SECOND_USER_ID: "invalid" }, { RADAR_DEV_TEST_OWNER_USER_ID: undefined }]) {
      expect(devMoscowTestAllowed({ ...configured, ...patch } as AppEnv, second)).toBe(false);
    }
  });
  it("reserves exactly six deterministic identities outside demo namespace", () => {
    expect(new Set(DEV_MOSCOW_PEER_IDS).size).toBe(6);
    expect(DEV_MOSCOW_PEER_IDS.some(isDemoUuid)).toBe(false);
    expect(DEV_MOSCOW_PEER_IDS).not.toContain(owner);
  });
});
