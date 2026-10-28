import { describe, expect, it } from "vitest";
import {
  forbiddenUrlScalars,
  httpUrlAgreesWithOriginalAuthority,
  httpsCreditUrl,
  originalHttpAuthority,
} from "../src/lib/original-http-authority";

/** Identical matrix to apps/api/test/unit/url-authority-class.test.ts. */
const grammar: unknown[] = [
  "https://@example.org/", "https://:@example.org/", "https:///@example.org/", "https:///:@example.org/",
  "https:////@example.org/", "https:////:@example.org/", "https:///@:@example.org/",
  "https://user@example.org/", "https://user:pass@example.org/", "https://u:@example.org/", "https://:p@example.org/",
  "https://a@b@example.org/", "https://@@example.org/",
  "https://example%40org/", "https://example%2Forg/", "https://example%5Corg/", "https://example%3A80/", "https://example%00org/",
  "https://%40example.org/", "https:///%40example.org/",
  "https://example.org:444/", "https://example.org:80/", "https://example.org:0/", "https://example.org:65536/",
  "https://example.org/\n", "https://example.org/\t", "https://example.org/\u0000", "https://example.org/%0a", "https://example.org/%00",
  "https://example.org/\ud800", "https://example.org/%C0%AF",
  "https:///@evil.example/phish", "https:///:@evil.example/", "https:////@evil.example/",
  "https://vk.com@evil.example/phish", "https://user:pass@evil.example/logo",
  "", " ", 42, false, {}, [], null, undefined,
  "https://a/?" + "'".repeat(97),
];
const preserved = [
  "https://club.example", "https://club.example/logo", "https://example.org/photos",
  "https://example.com", "https://example.com/", "https://example.invalid/",
  "https://example.org/@user", "https://example.org:443/a", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B",
  "https://[::1]/", "https:///example.org/path", "https://example.org/%40",
];
const agreeingPorts = new Set(["https://example.org:444/", "https://example.org:80/", "https://example.org:0/"]);

describe("original HTTP authority helper", () => {
  it("recovers the host before WHATWG discards empty userinfo", () => {
    expect(originalHttpAuthority("https://example.org:443/a")).toEqual({ scheme: "https", host: "example.org", port: "" });
    expect(originalHttpAuthority("http://example.org:80/")).toEqual({ scheme: "http", host: "example.org", port: "" });
    expect(originalHttpAuthority("https:///example.org/path")).toEqual({ scheme: "https", host: "example.org", port: "" });
    expect(originalHttpAuthority("https://example.org:444/")).toEqual({ scheme: "https", host: "example.org", port: "444" });
    expect(originalHttpAuthority("https:///@example.org/")).toBeNull();
    expect(originalHttpAuthority("https:////@evil.example/")).toBeNull();
    expect(originalHttpAuthority("https://vk.com@evil.example/phish")).toBeNull();
    expect(originalHttpAuthority("https://user:pass@evil.example/logo")).toBeNull();
  });

  it("returns a serialized credit href only when original authority agrees and the href stays within 300 characters", () => {
    const bomb = "https://a/?" + "'".repeat(97);
    expect(bomb).toHaveLength(108);
    expect(new URL(bomb).href).toHaveLength(302);
    expect(httpsCreditUrl(bomb)).toBeNull();
    expect(httpUrlAgreesWithOriginalAuthority(bomb, forbiddenUrlScalars)?.href).toBe(new URL(bomb).href);
    for (const url of preserved) {
      const href = new URL(url).href;
      expect(href.length).toBeLessThanOrEqual(300);
      expect(httpsCreditUrl(url)).toBe(href);
      expect(httpUrlAgreesWithOriginalAuthority(url, forbiddenUrlScalars)?.href).toBe(href);
    }
    const badCreditPorts = [
      "https://example.org:0443/a", "https://example.org:00443/a", "https://example.org:/a",
      "https://[::1]:0443/", "https://[::1]:/",
    ];
    for (const url of badCreditPorts) {
      expect(httpsCreditUrl(url)).toBeNull();
      expect(originalHttpAuthority(url)?.port).toBe("");
    }
    expect(httpsCreditUrl("https://example.org:443/a")).toBe("https://example.org/a");
    expect(httpsCreditUrl("https://[::1]:443/")).toBe("https://[::1]/");
    for (const url of grammar) {
      expect(httpsCreditUrl(url)).toBeNull();
      if (typeof url !== "string") continue;
      const agreed = httpUrlAgreesWithOriginalAuthority(url, forbiddenUrlScalars);
      if (url === bomb || agreeingPorts.has(url)) expect(agreed?.href).toBe(new URL(url).href);
      else expect(agreed).toBeNull();
    }
  });
});
