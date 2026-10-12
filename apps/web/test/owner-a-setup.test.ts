import { describe, expect, it } from "vitest";
import { profileCityReady, profileSetupPath, safeAuthReturnPath } from "../src/lib/auth-return";

describe("Owner A safe setup chain", () => {
  it.each(["/games/create", "/games/abc?from=feed#details", "/messages?conversation=abc", "/profile"])("preserves %s through encoded setup/reload", path => {
    const setup = new URL(profileSetupPath(path), "https://gobadminton.invalid");
    expect(setup.pathname).toBe("/profile/setup");
    expect(safeAuthReturnPath(setup.searchParams.get("returnTo"))).toBe(path);
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/%252fevil.test", "javascript:alert(1)", "/\n/evil.test", "/profile/setup", "/v1/auth/vk/start", "/%oops"])("rejects external/escaped/recursive target %s", target => expect(safeAuthReturnPath(target)).toBe("/games"));
  it("requires server city only, with optional fields empty and private defaults", () => {
    expect(profileCityReady({ cityId: null })).toBe(false);
    expect(profileCityReady({ cityId: "server-city" })).toBe(true);
  });
});
