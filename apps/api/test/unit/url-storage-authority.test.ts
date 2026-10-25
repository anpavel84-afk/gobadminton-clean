import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { IdentityService } from "../../src/auth/identity.service";
import type { VerifiedIdentity } from "../../src/auth/providers/types";
import { httpsCreditUrl, privateContactWebsite } from "../../src/lib/original-http-authority";

const contract = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../packages/contracts/openapi.json"), "utf8")) as {
  components: { schemas: Record<string, unknown> };
};

function patterns(node: unknown, key: string, found: { pattern: string; format?: string }[] = []): { pattern: string; format?: string }[] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) patterns(item, key, found);
    return found;
  }
  const record = node as Record<string, unknown>;
  for (const [name, value] of Object.entries(record)) {
    if (name === key && value && typeof value === "object" && !Array.isArray(value) && typeof (value as { pattern?: unknown }).pattern === "string") {
      const schema = value as { pattern: string; format?: string };
      found.push({ pattern: schema.pattern, format: schema.format });
    } else patterns(value, key, found);
  }
  return found;
}

const creditPattern = patterns(contract.components.schemas.VenueCover, "url").map(item => item.pattern).find(item => item.startsWith("^https://"));
const gallery = patterns(contract.components.schemas.VenueProfile, "url").find(item => item.format === "uri");
const contactPatterns = [
  ...patterns(contract.components.schemas.VenueSummary, "contactWebsite"),
  ...patterns(contract.components.schemas.AdminVenueCommand, "contactWebsite"),
  ...patterns(contract.components.schemas.AdminVenueFields, "contactWebsite"),
].map(item => item.pattern);

const preserved = [
  "https://club.example", "https://club.example/logo", "https://example.org/photos",
  "https://example.com", "https://example.com/", "https://example.invalid/",
  "https://example.org/@user", "https://example.org:443/a",
  "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B",
  "https://[::1]/", "https:///example.org/path", "https://example.org/%40",
  "https://example.com/a%20b", "https://example.com/%D1%84%D0%BE%D1%82%D0%BE",
];
const rejectedByPattern = [
  "https://vk.com@evil.example/", "https://user:pass@evil.example/logo",
  "https://@example.org/", "https:///@example.org/", "https:////@example.org/",
  "https://example.org/\\x", "https://example.org/\n", "https://example.org/\u0085",
  "https://example.org:444/", "https://example.com/a b", "https://example.com/a|b",
];

function identity(avatarUrl: string): VerifiedIdentity {
  return { provider: "vk", issuerNamespace: "vkid:test", subject: "subject-1", avatarUrl };
}

function callsFor(mode: "update" | "insert" | "link") {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("FOR UPDATE OF ei")) {
      return mode === "update"
        ? { rowCount: 1, rows: [{ id: "user-1", status: "active", locale: "ru", display_name: "Игрок", user_id: "user-1" }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("INSERT INTO users")) return { rowCount: 1, rows: [{ id: "user-1", status: "active", locale: "ru", display_name: "Игрок" }] };
    if (sql.includes("SELECT status FROM users")) return { rowCount: 1, rows: [{ status: "active" }] };
    if (sql.includes("SELECT user_id FROM external_identities")) return { rowCount: 1, rows: [{ user_id: "user-1" }] };
    return { rowCount: 1, rows: [] };
  };
  const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { calls, service: new IdentityService(pool) };
}

function storedAvatar(calls: { sql: string; params?: unknown[] }[]): unknown {
  const write = calls.find(call => call.sql.includes("avatar_url") && call.params);
  const params = write?.params ?? [];
  return write?.sql.includes("INSERT INTO external_identities") ? params[6] : params[2];
}

describe("external URL storage contract", () => {
  it("tightens credit and contact patterns and leaves the application check stricter", () => {
    expect(creditPattern).toBeTruthy();
    expect(gallery?.pattern).toBe(creditPattern);
    expect(gallery?.format).toBe("uri");
    expect(new Set(contactPatterns).size).toBe(1);
    expect(contactPatterns).toHaveLength(3);
    const credit = new RegExp(creditPattern!);
    const contact = new RegExp(contactPatterns[0]!);
    for (const url of preserved) {
      expect(credit.test(url), url).toBe(true);
      expect(httpsCreditUrl(url), url).not.toBeNull();
    }
    for (const url of rejectedByPattern) expect(credit.test(url), url).toBe(false);
    const bomb = "https://a/?" + "'".repeat(97);
    expect(bomb.length).toBeLessThanOrEqual(300);
    expect(credit.test(bomb)).toBe(true);
    expect(httpsCreditUrl(bomb)).toBeNull();
    expect(credit.test("https://example.org/%00")).toBe(true);
    expect(httpsCreditUrl("https://example.org/%00")).toBeNull();
    for (const url of ["", "http://venue.example.invalid", "https://example.org:444/", "https://example.org/@user", "https://[::1]/"]) {
      expect(contact.test(url), url).toBe(true);
    }
    expect(privateContactWebsite("https://example.org:444/")).toBe("https://example.org:444/");
    expect(contact.test("https://vk.com@evil.example/")).toBe(false);
    expect(contact.test("https://example.org/\\x")).toBe(false);
    expect(contact.test("https://example.org/\n")).toBe(false);
    expect(contact.test("https://example.org/\u0085")).toBe(false);
    expect(privateContactWebsite("")).toBeNull();
    const loose = JSON.stringify(contract).includes('"^https://"') || JSON.stringify(contract).includes('"^(https?://|$)"');
    expect(loose).toBe(false);
  });

  it("writes null for a rejected avatar and the href for an allowlisted one", async () => {
    const good = "https://sun1-1.userapi.com/photo";
    const bad = ["https://vk.com@evil.example/", "https://sun1-1.userapi.com/a\\b", "https://sun1-1.userapi.com/\n", "https://example.test/avatar.png"];
    for (const mode of ["update", "insert", "link"] as const) {
      const kept = callsFor(mode);
      await (mode === "link" ? kept.service.linkIdentityToUser("user-1", identity(good)) : kept.service.resolveOrCreateUser(identity(good)));
      expect(storedAvatar(kept.calls), mode).toBe(good);
      for (const avatarUrl of bad) {
        const rejected = callsFor(mode);
        await (mode === "link" ? rejected.service.linkIdentityToUser("user-1", identity(avatarUrl)) : rejected.service.resolveOrCreateUser(identity(avatarUrl)));
        expect(storedAvatar(rejected.calls), `${mode} ${avatarUrl}`).toBeNull();
      }
    }
  });
});
