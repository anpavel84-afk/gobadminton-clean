import { describe, expect, it } from "vitest";
import {
  hashSecret,
  hashedSecretsEqual,
  openSecret,
  pkceChallengeS256,
  randomToken,
  sealSecret,
  secretsEqual,
} from "../../src/auth/crypto";

describe("auth crypto", () => {
  it("produces unique opaque tokens", () => {
    expect(randomToken()).not.toEqual(randomToken());
  });

  it("hashes secrets with pepper and compares in constant-time style", () => {
    const pepper = "x".repeat(32);
    const hash = hashSecret(pepper, "session-secret");
    expect(hashedSecretsEqual(pepper, "session-secret", hash)).toBe(true);
    expect(hashedSecretsEqual(pepper, "other", hash)).toBe(false);
    expect(secretsEqual(hash, hash)).toBe(true);
  });

  it("seals and opens PKCE verifiers", () => {
    const pepper = "y".repeat(32);
    const sealed = sealSecret(pepper, "verifier-value");
    expect(sealed).not.toContain("verifier-value");
    expect(openSecret(pepper, sealed)).toBe("verifier-value");
  });

  it("builds S256 PKCE challenges", () => {
    expect(pkceChallengeS256("abc")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
