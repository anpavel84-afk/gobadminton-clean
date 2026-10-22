import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { FastifyRequest } from "fastify";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { AdminService, AdminActor } from "../../src/admin/admin.service";
import { venueCommand, venueCreate } from "../../src/admin/venues.dto";
import type { IdempotencyService } from "../../src/common/idempotency.service";
import type { MutationRunner } from "../../src/common/mutation-runner.service";
import { AdminVenuesService } from "../../src/venues/admin-venues.service";
import { VenuesService } from "../../src/venues/venues.service";
import { readVenueProfile, venueProfileEditSchema, venueProfileSelectSql } from "../../src/venues/venue-profile";
import { publicContactPhone, publicContactUrl, publicVenueContactsSchema, readPublicVenueContacts } from "../../src/venues/public-venue-contacts";

const contract = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../packages/contracts/openapi.json"), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
function validator(name: string) {
  return ajv.compile({ components: contract.components, $ref: `#/components/schemas/${name}` });
}
const validVenue = validator("Venue"), validAdmin = validator("AdminVenue"), validCommand = validator("AdminVenueCommand");
function matches(validate: ReturnType<typeof validator>, value: unknown) {
  // Wire serialization also converts pg Date objects in admin history.
  expect(validate(JSON.parse(JSON.stringify(value))), JSON.stringify(validate.errors)).toBe(true);
}
function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}
const id = "a0000000-0000-4000-8000-000000000003", cityId = "a0000000-0000-4000-8000-000000000001";
const targetId = "a0000000-0000-4000-8000-000000000004";
const fields = { cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55, longitude: 37 };
const facts = { courtCount: 0, amenities: { parking: false, showers: null } };
const contacts = { phone: "+1234567", website: "https://example.com/", messengers: [] };
const date = "2026-10-22T00:00:00.000Z";
const coverUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const base = {
  id, city_id: cityId, city_name: "Москва", name: fields.name, address: fields.address,
  timezone: fields.timezone, latitude: 55, longitude: 37, lifecycle_state: "verified",
  canonical_venue_id: null as string | null, identity_discriminator: "", version: 1,
  normalized_name: "зал", normalized_address: "адрес", data_status: "verified", provenance: "admin_created",
  public_contacts: contacts as unknown, contact_phone: "private", contact_website: "https://private.invalid", booking_note: "private",
  court_count: 0 as number | null, amenity_parking: false as boolean | null, amenity_showers: null as boolean | null,
  public_profile_updated_at: date, cover_url: coverUrl, cover_credit_kind: "photo", cover_credit_text: "Фото: Клуб", cover_credit_url: "https://example.com/",
  cover_key: "private-storage", cover_actor_id: "private-actor", cover_moderation_approval_id: "private-approval",
};
const actor: AdminActor = {
  principalId: id, roles: ["content_manager"], sessionId: id,
  principal: { id, user_id: id, status: "active", version: 1 },
  session: { id, principal_id: id, credential_id: id, audience: "gobadminton-admin", csrf_ciphertext: "synthetic",
    expires_at: new Date("2030-01-01T00:00:00Z"), last_seen_at: new Date(date), step_up_at: new Date(date), revoked_at: null },
};
const request = {} as FastifyRequest;
function command(profile?: unknown) {
  return { action: "edit", expectedVersion: 1, reasonCode: "synthetic_review", fields: { ...fields, ...(profile === undefined ? {} : { profile }) } };
}
function publicService(query: Pool["query"]) {
  return new VenuesService({ query } as Pool, {} as IdempotencyService, {} as MutationRunner);
}

describe("venue profile production validation and safe mapping", () => {
  it("strict bounded replacements, omission and clear agree with OpenAPI", () => {
    for (const profile of [undefined, null, facts, { courtCount: 2147483647, amenities: { parking: true, showers: false } }]) {
      const input = command(profile);
      expect(venueCommand.safeParse(input).success).toBe(true); matches(validCommand, input);
    }
    for (const profile of [{}, { ...facts, courtCount: -1 }, { ...facts, courtCount: 2147483648 }, { ...facts, courtCount: 0.5 },
      { ...facts, courtCount: "0" }, { ...facts, amenities: { parking: false } }, { ...facts, amenities: { parking: 0, showers: null } },
      { ...facts, amenities: { ...facts.amenities, pool: true } }, ...["updatedAt", "gallery", "contactPhone", "court_count", "rating", "actorId"].map(key => ({ ...facts, [key]: null }))]) {
      expect(venueProfileEditSchema.safeParse(profile).success).toBe(false);
      expect(venueCommand.safeParse(command(profile)).success).toBe(false);
      expect(validCommand(command(profile))).toBe(false);
    }
    expect(venueCreate.safeParse({ ...fields, reasonCode: "synthetic_review", profile: facts }).success).toBe(false);
    expect(venueCommand.safeParse({ ...command(facts), injected: true }).success).toBe(false);
  });
  it("unknown values stay null, explicit 0/false survive and no timestamps are borrowed", () => {
    expect(readVenueProfile({})).toEqual({ courtCount: null, amenities: { parking: null, showers: null }, updatedAt: null, gallery: { coverage: "cover_only", items: [] } });
    expect(readVenueProfile(base)).toMatchObject({ ...facts, updatedAt: date });
    for (const value of [undefined, null, "0", -1, 2147483648, NaN, Infinity, 0.1, {}, []]) {
      expect(readVenueProfile({ court_count: value, amenity_parking: value, public_profile_updated_at: "invalid" })).toMatchObject({ courtCount: null, amenities: { parking: null }, updatedAt: null });
    }
    expect(readVenueProfile({ ...base, public_profile_updated_at: new Date(date) }).updatedAt).toBe(date);
    expect(readVenueProfile({ ...base, public_profile_updated_at: null }).updatedAt).toBeNull();
  });
  it("gallery fails closed; never claims more than current eligible cover photo", () => {
    expect(readVenueProfile({ ...base, cover_credit_url: "https://example.com" }).gallery.items[0]?.credit.url).toBe("https://example.com");
    expect(readVenueProfile(base).gallery).toEqual({ coverage: "cover_only", items: [{ url: coverUrl, credit: { kind: "photo", text: "Фото: Клуб", url: "https://example.com/" } }] });
    for (const row of [{ ...base, cover_url: null }, { ...base, cover_url: "https://arbitrary.invalid/photo" },
      ...[null, "logo", "illustration", "unknown"].map(cover_credit_kind => ({ ...base, cover_credit_kind })),
      ...[null, "http://example.com/", "https://user@example.com/", "https://example.com/\n", "https://example.com/\\x", "javascript:x"].map(cover_credit_url => ({ ...base, cover_credit_url })),
      { ...base, cover_credit_text: "Фото: " }, { ...base, cover_credit_text: "Фото: Club\nprivate" }]) {
      expect(readVenueProfile(row).gallery).toEqual({ coverage: "cover_only", items: [] });
    }
  });
  it("retains #142 phone/WHATWG/messenger boundaries and tolerant safe neighbors", () => {
    expect(publicContactPhone("  +1234567  ")).toBe("+1234567");
    for (const value of ["123456", "1".repeat(16), "12+345678", "１２３４５６７", "\n1234567", "1234567\u0085"]) expect(publicContactPhone(value)).toBeNull();
    expect(publicContactUrl(" HTTP://пример.рф:80/a/../b ")).toBe("http://xn--e1afmkfd.xn--p1ai/b");
    for (const value of ["https://user@host/", "https://host:444/", "https://foo／bar.example/", "https://host/\\x", "https://host/\n", "javascript:x", "https://example.com/" + "я".repeat(100)]) expect(publicContactUrl(value)).toBeNull();
    expect(publicContactUrl("https://example.com/" + "a".repeat(280))).not.toBeNull();
    expect(publicContactUrl("https://example.com/" + "a".repeat(281))).toBeNull();
    for (const value of ["http://t.me/club", "https://t.me/", "https://t.me.evil/club", "https://t.me/a/.."]) expect(publicContactUrl(value, "telegram")).toBeNull();
    for (const value of [{ ...contacts, private: true }, { ...contacts, phone: undefined }, { ...contacts, messengers: [{ kind: "vk", url: "https://vk.com/a" }, { kind: "vk", url: "https://vk.com/b" }] }]) expect(publicVenueContactsSchema.safeParse(value).success).toBe(false);
    expect(readPublicVenueContacts({ ...contacts, phone: "unsafe", messengers: [{ kind: "telegram", url: "https://evil.invalid/a" }, { kind: "vk", url: "https://vk.com/a" }], private: "secret" })).toEqual({ ...contacts, phone: null, messengers: [{ kind: "vk", url: "https://vk.com/a" }] });
  });
});

describe("production service bindings and runtime responses against actual OpenAPI", () => {
  it("validates unchanged gallery attribution, failing closed when only its normalized URL is a URI", async () => {
    const validProfile = validator("VenueProfile");
    for (const attribution of ["https://example.com/a b", "https://example.com/фото", "https://example.com/a|b", "https://example.com/%zz"]) {
      // Existing cover storage can contain these WHATWG-parseable values.
      expect(publicContactUrl(attribution)).not.toBeNull();
      const invalid = readVenueProfile(base);
      invalid.gallery.items[0]!.credit.url = attribution;
      expect(validProfile(invalid)).toBe(false);
      expect(validProfile.errors).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: "format" })]));

      const row = { ...base, cover_credit_url: attribution };
      const service = publicService((async () => result([row])) as Pool["query"]);
      const detail = await service.getById(id), page = await service.searchCatalog({ cityId });
      for (const response of [detail, page.items[0]!]) {
        expect(response.profile?.gallery).toEqual({ coverage: "cover_only", items: [] });
        matches(validVenue, response);
      }
      const admin: Pick<AdminService, "privilegedRead"> = {
        privilegedRead: async (_r, _permission, read) => read({ query: (async () => result([row])) as PoolClient["query"] } as PoolClient, actor),
      };
      const adminPage = await new AdminVenuesService(admin as AdminService).list(request, { limit: 20 });
      expect(adminPage.items[0]?.profile.gallery.items).toEqual([]);
      matches(validAdmin, adminPage.items[0]);
    }
    for (const attribution of ["https://example.com", "https://example.com/a%20b", "https://example.com/%D1%84%D0%BE%D1%82%D0%BE"]) {
      const response = await publicService((async () => result([{ ...base, cover_credit_url: attribution }])) as Pool["query"]).getById(id);
      expect(response.profile?.gallery.items[0]?.credit.url).toBe(attribution);
      matches(validVenue, response);
    }
  });
  it("catalog, canonical alias and missing rollout columns use the same complete profile", async () => {
    const sqls: string[] = [];
    let alias = false;
    const service = publicService((async (sql: string) => {
      sqls.push(sql);
      return result([alias && sqls.length === 1 ? { ...base, lifecycle_state: "merged", canonical_venue_id: targetId }
        : { ...base, id: alias ? targetId : id }]);
    }) as Pool["query"]);
    const page = await service.searchCatalog({ cityId }); matches(validVenue, page.items[0]);
    expect(page.items[0]?.profile).toEqual(readVenueProfile(base));
    expect(sqls[0]).toContain("LIMIT $"); expect(sqls[0]).toContain("ORDER BY normalized_name ASC, id ASC");
    sqls.length = 0; alias = true;
    const detail = await service.getById(id); matches(validVenue, detail);
    expect(detail).toMatchObject({ id: targetId, resolvedFromVenueId: id, profile: readVenueProfile(base) });
    expect(JSON.stringify(detail)).not.toMatch(/private|cover_key|actor_id|approval_id/);
    for (const sql of sqls) { expect(sql).not.toContain("SELECT *"); expect(sql).toContain(venueProfileSelectSql("v")); }
    const old = publicService((async () => result([{ ...base, court_count: undefined, amenity_parking: undefined, amenity_showers: undefined, public_profile_updated_at: undefined, public_contacts: undefined }])) as Pool["query"]);
    const oldDetail = await old.getById(id); matches(validVenue, oldDetail);
    expect(oldDetail.profile).toMatchObject({ courtCount: null, amenities: { parking: null, showers: null }, updatedAt: null });
    // Current contract accepts old API/receipt bodies with the additive fields omitted.
    matches(validVenue, { ...detail, profile: undefined, publicContacts: undefined });
    expect(validVenue({ ...detail, profile: { ...detail.profile, courtCount: -1 } })).toBe(false);
    expect(validVenue({ ...detail, profile: { ...detail.profile, rating: 5 } })).toBe(false);
    expect(validVenue({ ...detail, contactPhone: "private" })).toBe(false);
  });
  it("fuzzy candidates, reuse and INSERT RETURNING share the safe projection", async () => {
    for (const mode of ["fuzzy", "reuse", "insert"] as const) {
      const sqls: string[] = [];
      const query = (async (sql: string) => {
        sqls.push(sql);
        if (sql.includes("SELECT id FROM cities")) return result([{ id: cityId }]);
        if (sql.includes("SELECT venue_id FROM venue_identity_keys")) return result(mode === "reuse" ? [{ venue_id: id }] : []);
        if (sql.includes("FROM venues v")) return result([base]);
        if (sql.includes("AS distance_m")) return result(mode === "fuzzy" ? [{ ...base, distance_m: 0 }] : []);
        if (sql.includes("INSERT INTO venues (")) return result([base]);
        if (sql.includes("INSERT INTO venue_identity_keys")) return result([{ venue_id: id }]);
        return result([]);
      }) as PoolClient["query"];
      const client = { query } as PoolClient;
      const runner: Pick<MutationRunner, "runIdempotent"> = { runIdempotent: async input => input.execute(client) };
      const hash: Pick<IdempotencyService, "requestHash"> = { requestHash: () => "synthetic" };
      const response = await new VenuesService({} as Pool, hash as IdempotencyService, runner as MutationRunner).propose(id, id, "synthetic-key", fields);
      const venues = "candidates" in response.body ? response.body.candidates : [response.body];
      expect(response.statusCode).toBe(mode === "fuzzy" ? 409 : mode === "reuse" ? 200 : 201);
      for (const venue of venues) { matches(validVenue, venue); expect(venue.profile).toEqual(readVenueProfile(base)); }
      expect(JSON.stringify(response.body)).not.toContain("private");
      const projection = sqls.find(sql => mode === "fuzzy" ? sql.includes("AS distance_m") : mode === "reuse" ? sql.includes("FROM venues v") : sql.includes("INSERT INTO venues ("));
      expect(projection).toContain(venueProfileSelectSql(mode === "reuse" ? "v" : "venues"));
    }
  });
  it("edit preserves/clears/replaces facts, immutable date, metadata audit and version/collision no-write", async () => {
    for (const mode of ["omit", "clear", "replace", "stale", "collision"] as const) {
      let row = { ...base }; const calls: { sql: string; values: unknown[] }[] = [];
      const client = { query: (async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT v.*")) return result([row]);
        if (sql.startsWith("SELECT venue_id FROM")) return result(mode === "collision" ? [{ venue_id: targetId }] : []);
        if (sql.startsWith("UPDATE venues SET name=")) {
          if (values[14]) row = { ...row, court_count: values[15] as number | null, amenity_parking: values[16] as boolean | null, amenity_showers: values[17] as boolean | null };
          row = { ...row, version: row.version + 1 };
        }
        if (sql.includes("INSERT INTO privileged_audit_events")) return result([{ id }]);
        return result([]);
      }) as PoolClient["query"] } as PoolClient;
      const admin: Pick<AdminService, "privilegedCommand" | "privilegedRead"> = {
        privilegedCommand: async (_r, _k, permission, stepUp, _op, _body, execute) => {
          expect(permission).toBe("venue.manage"); expect(stepUp).toBe(true); return execute(client, actor, "hash");
        }, privilegedRead: async (_r, permission, read) => { expect(permission).toBe("venue.manage"); return read(client, actor); },
      };
      const service = new AdminVenuesService(admin as AdminService);
      const input = venueCommand.parse({ ...command(mode === "omit" ? undefined : mode === "clear" ? null : facts), expectedVersion: mode === "stale" ? 2 : 1 });
      if (mode === "stale") { await expect(service.command(request, "synthetic-key", id, input)).rejects.toMatchObject({ status: 409 }); }
      else {
        const response = await service.command(request, "synthetic-key", id, input); matches(validAdmin, response);
        expect(response.profile).toEqual(readVenueProfile(row));
        expect(response.profile.updatedAt).toBe(date); expect(response.cityName).toBe("Москва");
        matches(validAdmin, await service.detail(request, id));
        const page = await service.list(request, { limit: 20 }); matches(validAdmin, page.items[0]);
        if (mode === "collision") expect(response).toHaveProperty("reviewRequired", true);
      }
      const update = calls.find(call => call.sql.startsWith("UPDATE venues SET name="));
      if (mode === "stale" || mode === "collision") expect(update).toBeUndefined();
      else {
        expect(update?.values.slice(14)).toEqual(mode === "omit" ? [false, null, null, null] : mode === "clear" ? [true, null, null, null] : [true, 0, false, null]);
        expect(update?.sql).toContain("CASE WHEN $15::boolean THEN $16::integer ELSE court_count END");
        expect(update?.sql).not.toContain("public_profile_updated_at=");
        expect(row).toMatchObject(mode === "clear" ? { court_count: null, amenity_parking: null, amenity_showers: null } : { court_count: 0, amenity_parking: false });
      }
      for (const call of calls.filter(c => /INSERT INTO (privileged_audit_events|outbox_events)/.test(c.sql))) expect(JSON.stringify(call.values)).not.toMatch(/courtCount|amenities|1234567|example.com|private/);
      expect(validAdmin({ ...base, profile: readVenueProfile(base) })).toBe(false);
    }
  });
});
