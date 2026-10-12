import { describe, expect, it } from "vitest";
import {
  buildAuthErrorRedirect,
  buildWebRedirect,
  normalizeReturnPath,
} from "../../src/auth/return-path";

describe("normalizeReturnPath", () => {
  it("accepts local paths", () => {
    expect(normalizeReturnPath("/account")).toBe("/account");
    expect(normalizeReturnPath("/games?tab=mine")).toBe("/games?tab=mine");
    expect(normalizeReturnPath(undefined)).toBe("/");
  });

  it("rejects open redirects and unsafe values", () => {
    expect(normalizeReturnPath("https://evil.example/")).toBeNull();
    expect(normalizeReturnPath("//evil.example")).toBeNull();
    expect(normalizeReturnPath("/\\evil")).toBeNull();
    expect(normalizeReturnPath("account")).toBeNull();
    expect(normalizeReturnPath("///evil")).toBeNull();
  });

  it("builds web redirects only on configured origin", () => {
    expect(buildWebRedirect("https://gobadminton.ru", "/account")).toBe(
      "https://gobadminton.ru/account",
    );
    expect(
      buildAuthErrorRedirect("https://gobadminton.ru", "/account", "INVALID_STATE"),
    ).toContain("authError=INVALID_STATE");
  });
});
