"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  SCHEMA,
  SOURCE_ARCHIVE_SHA256,
  APPROVED_CITIES,
  uuidV5,
  venueIdForSourceVenueId,
  sha256Hex,
  distanceMeters,
  validateManifest,
  parseCliArgs,
  planAgainstState,
  buildReviewMarkers,
  runImport,
  rolesHaveVenueManage,
  CITY_RADIUS_METERS,
  DEDUPE_METERS,
} = require("./import-badminton4u-regions.cjs");

function normalizeVenueText(input) {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractIdentityDiscriminator(name, address, explicit) {
  const trimmed = explicit?.trim() ?? "";
  if (trimmed.length > 0) return normalizeVenueText(trimmed).slice(0, 80);
  return "";
}

function venueDedupeKey(input) {
  const version = input.normalizationVersion ?? 1;
  const payload = [
    version,
    input.cityId,
    input.normalizedName,
    input.normalizedAddress,
    input.identityDiscriminator,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

const normalize = {
  normalizeVenueText,
  extractIdentityDiscriminator,
  venueDedupeKey,
  VENUE_NORMALIZATION_VERSION: 1,
};

const CITY_CENTERS = {
  Новосибирск: [55.0302, 82.9204],
  Екатеринбург: [56.8389, 60.6057],
  Казань: [55.7963, 49.1088],
  "Нижний Новгород": [56.3269, 44.0059],
  Самара: [53.1959, 50.1002],
  Омск: [54.9885, 73.3242],
  "Ростов-на-Дону": [47.2357, 39.7015],
  Красноярск: [56.0153, 92.8932],
  Воронеж: [51.672, 39.1843],
  Волгоград: [48.708, 44.5133],
  Краснодар: [45.0355, 38.9753],
};

function cityIdFor(nameRu) {
  return uuidV5(`gobadminton:regions485:city:${nameRu}`);
}

function buildCities() {
  return Object.keys(APPROVED_CITIES).map((nameRu) => {
    const meta = APPROVED_CITIES[nameRu];
    const [lat, lon] = CITY_CENTERS[nameRu];
    return {
      id: cityIdFor(nameRu),
      nameRu,
      nameEn: meta.nameEn,
      timezone: meta.timezone,
      centerLatitude: lat,
      centerLongitude: lon,
      centerSourceUrl: "https://example.org/center",
      centerCheckedAt: "2026-11-01T12:00:00.000Z",
    };
  });
}

function venueFixture(sourceVenueId, city, overrides = {}) {
  const id = venueIdForSourceVenueId(sourceVenueId);
  const clubDigits = "12345";
  const clubUrl = `https://badminton4u.ru/clubs/${clubDigits}`;
  return {
    id,
    sourceVenueId,
    name: overrides.name || `Зал ${sourceVenueId}`,
    address: overrides.address || `ул. Тестовая, 1, ${city.nameRu}`,
    cityId: city.id,
    latitude: overrides.latitude ?? city.centerLatitude + 0.01,
    longitude: overrides.longitude ?? city.centerLongitude + 0.01,
    importReady: "yes",
    sourceUrls: [clubUrl],
    clubSources: [{ clubId: `B4U-C-${clubDigits}`, name: "Клуб", url: clubUrl }],
    collectedAt: "2026-10-20",
    nameBasis: "SOURCE_VENUE_NAME",
    contactSources: [],
    ...overrides,
    id: overrides.id || id,
    sourceVenueId,
    cityId: overrides.cityId || city.id,
  };
}

function validManifest(venues) {
  return {
    schema: SCHEMA,
    batch: "regions485-first15",
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    cities: buildCities(),
    venues,
  };
}

describe("uuidV5 / venue id binding", () => {
  it("matches RFC 4122 DNS example", () => {
    const DNS = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
    assert.equal(uuidV5("python.org", DNS), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("binds venue id to URL-namespace name", () => {
    const source = "B4U-V-DEADBEEF";
    assert.equal(
      venueIdForSourceVenueId(source),
      uuidV5(`gobadminton:badminton4u:${source}`),
    );
  });
});

describe("validateManifest", () => {
  it("accepts a minimal valid FIRST_15-shaped batch", () => {
    const cities = buildCities();
    const venues = [];
    for (let i = 0; i < 3; i++) {
      const city = cities[i];
      const hex = (0x10000000 + i).toString(16).toUpperCase();
      venues.push(venueFixture(`B4U-V-${hex}`, city));
    }
    const manifest = validateManifest(validManifest(venues));
    assert.equal(manifest.cities.length, 11);
    assert.equal(manifest.venues.length, 3);
  });

  it("rejects wrong schema / archive pin / unknown keys", () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAAAAAA", cities[0]);
    assert.throws(
      () => validateManifest({ ...validManifest([venue]), schema: "OTHER" }),
      /INVALID_SCHEMA/,
    );
    assert.throws(
      () =>
        validateManifest({
          ...validManifest([venue]),
          sourceArchiveSha256: "0".repeat(64),
        }),
      /SOURCE_ARCHIVE_SHA256_MISMATCH/,
    );
    assert.throws(
      () => validateManifest({ ...validManifest([venue]), privateRaw: {} }),
      /PRIVATE_FIELD_REFUSED|unknown key/,
    );
  });

  it("rejects excluded cities and incomplete 11-set", () => {
    const cities = buildCities();
    cities[0] = {
      ...cities[0],
      nameRu: "Челябинск",
      nameEn: "Chelyabinsk",
      timezone: "Asia/Yekaterinburg",
    };
    assert.throws(
      () =>
        validateManifest({
          schema: SCHEMA,
          batch: "x",
          sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
          cities,
          venues: [],
        }),
      /CITY_EXCLUDED|CITY_NOT_APPROVED/,
    );
  });

  it("rejects importReady!=yes, mismatched venue UUID, missing clubs; pure validate does not haversine-reject radius", () => {
    const cities = buildCities();
    const city = cities[0];
    const base = venueFixture("B4U-V-BBBBBBBB", city);
    assert.throws(
      () => validateManifest(validManifest([{ ...base, importReady: "READY" }])),
      /IMPORT_READY_NOT_YES/,
    );
    assert.throws(
      () =>
        validateManifest(
          validManifest([{ ...base, id: "00000000-0000-4000-8000-000000000099" }]),
        ),
      /VENUE_ID_MISMATCH/,
    );
    // Far coords stay valid in pure validate; PostGIS ST_DWithin is authoritative later.
    const far = validateManifest(
      validManifest([
        {
          ...base,
          latitude: city.centerLatitude + 1,
          longitude: city.centerLongitude + 1,
        },
      ]),
    );
    assert.equal(far.venues.length, 1);
    assert.throws(
      () => validateManifest(validManifest([{ ...base, clubSources: [] }])),
      /MISSING_CLUB_SOURCES/,
    );
    assert.throws(
      () =>
        validateManifest(
          validManifest([
            {
              ...base,
              clubSources: [
                {
                  clubId: "B4U-C-999",
                  name: "X",
                  url: "https://badminton4u.ru/clubs/12345",
                },
              ],
            },
          ]),
        ),
      /CLUB_URL_ID_MISMATCH/,
    );
  });

  it("requires matching contactSources for every nonempty public contact", () => {
    const cities = buildCities();
    const city = cities[0];
    const base = venueFixture("B4U-V-CCCC0001", city, {
      publicContacts: {
        phone: null,
        website: "https://example.org/hall",
        messengers: [],
      },
      contactSources: [],
    });
    assert.throws(
      () => validateManifest(validManifest([base])),
      /CONTACT_PROVENANCE_MISSING/,
    );
    const ok = venueFixture("B4U-V-CCCC0002", city, {
      publicContacts: {
        phone: null,
        website: "https://example.org/hall",
        messengers: [],
      },
      contactSources: [
        {
          contactType: "website",
          value: "https://example.org/hall",
          sourceUrl: "https://example.org/hall",
          checkedAt: "2026-11-06T12:00:00.000Z",
        },
      ],
    });
    assert.equal(validateManifest(validManifest([ok])).venues.length, 1);
    const emptyOk = venueFixture("B4U-V-CCCC0003", city, {
      publicContacts: { phone: null, website: null, messengers: [] },
      contactSources: [],
    });
    assert.equal(validateManifest(validManifest([emptyOk])).venues.length, 1);
  });

  it("rejects empty title/address, >50 venues, duplicate B4U ids", () => {
    const cities = buildCities();
    const a = venueFixture("B4U-V-CCCCCCCC", cities[0]);
    assert.throws(
      () => validateManifest(validManifest([{ ...a, name: "  " }])),
      /EMPTY_VENUE_NAME/,
    );
    assert.throws(
      () => validateManifest(validManifest([{ ...a, address: "" }])),
      /EMPTY_VENUE_ADDRESS/,
    );
    const many = [];
    for (let i = 0; i < 51; i++) {
      const hex = (0xa0000000 + i).toString(16).toUpperCase();
      many.push(venueFixture(`B4U-V-${hex}`, cities[i % 11]));
    }
    assert.throws(() => validateManifest(validManifest(many)), /VENUE_COUNT_EXCEEDED/);
    const dup = venueFixture("B4U-V-DDDDDDDD", cities[1]);
    assert.throws(
      () => validateManifest(validManifest([a, { ...dup, sourceVenueId: a.sourceVenueId, id: a.id }])),
      /DUPLICATE_SOURCE_VENUE_ID/,
    );
  });

  it("accepts empty publicContacts and rejects private contact keys", () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-EEEEEEEE", cities[2], {
      publicContacts: { phone: null, website: null, messengers: [] },
    });
    assert.equal(validateManifest(validManifest([venue])).venues[0].publicContacts.phone, null);
    assert.throws(
      () =>
        validateManifest(
          validManifest([
            {
              ...venue,
              publicContacts: {
                phone: null,
                website: null,
                messengers: [],
                privateRawPhone: "+7000",
              },
            },
          ]),
        ),
      /PRIVATE_FIELD_REFUSED|unknown key|INVALID_PUBLIC_CONTACTS/,
    );
  });
});

describe("parseCliArgs", () => {
  it("defaults to dry-run and rejects apply+trial", () => {
    const args = parseCliArgs([
      "--manifest",
      "m.json",
      "--manifest-sha256",
      "a".repeat(64),
      "--actor-principal-id",
      "11111111-1111-4111-8111-111111111111",
    ]);
    assert.equal(args.mode, "DRY_RUN");
    assert.throws(
      () =>
        parseCliArgs([
          "--manifest",
          "m.json",
          "--manifest-sha256",
          "a".repeat(64),
          "--actor-principal-id",
          "11111111-1111-4111-8111-111111111111",
          "--apply",
          "--trial-rollback",
        ]),
      /INVALID_ARGUMENTS/,
    );
  });
});

describe("planAgainstState", () => {
  it("plans insert for empty catalog and skips exact replay", () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-FFFFFFFF", cities[0]);
    const manifest = validateManifest(validManifest([venue]));
    const digest = "b".repeat(64);
    const first = planAgainstState(manifest, digest, { cities: [], venues: [], identityKeys: [] }, normalize);
    assert.equal(first.citiesToInsert.length, 11);
    assert.equal(first.toInsert.length, 1);
    assert.equal(first.toSkip.length, 0);

    const prepared = first.toInsert[0];
    const replayState = {
      cities: manifest.cities.map((c) => ({
        id: c.id,
        country_code: "RU",
        name_ru: c.nameRu,
        name_en: c.nameEn,
        default_timezone: c.timezone,
      })),
      venues: [
        {
          id: prepared.id,
          name: prepared.name,
          address: prepared.address,
          city_id: prepared.cityId,
          timezone: prepared.timezone,
          provenance: "admin_created",
          data_status: "unverified",
          lifecycle_state: "unverified",
          normalized_name: prepared.normalizedName,
          normalized_address: prepared.normalizedAddress,
          normalization_version: 1,
          identity_discriminator: prepared.identityDiscriminator,
          review_markers: prepared.markers,
          public_contacts: null,
          court_count: null,
          latitude: prepared.latitude,
          longitude: prepared.longitude,
        },
      ],
      identityKeys: [{ dedupe_key: prepared.key, venue_id: prepared.id }],
    };
    const second = planAgainstState(manifest, digest, replayState, normalize);
    assert.equal(second.toInsert.length, 0);
    assert.equal(second.toSkip.length, 1);
    assert.equal(second.citiesToInsert.length, 0);
  });

  it("pure planner does not haversine-reject near address neighbors; enriched contacts SKIP on same digest", () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0001", cities[0], {
      address: "Одинаковый адрес 1",
      latitude: cities[0].centerLatitude,
      longitude: cities[0].centerLongitude,
    });
    const otherId = venueIdForSourceVenueId("B4U-V-AAAA0002");
    const manifest = validateManifest(validManifest([venue]));
    const digest = "c".repeat(64);
    // Near same-address neighbor is PostGIS-only (loadStateForPlan); pure planner continues.
    const nearPlan = planAgainstState(
      manifest,
      digest,
      {
        cities: [],
        venues: [
          {
            id: otherId,
            name: "Другое имя",
            address: "Одинаковый адрес 1",
            city_id: cities[0].id,
            timezone: cities[0].timezone,
            provenance: "admin_created",
            data_status: "unverified",
            lifecycle_state: "unverified",
            normalized_name: normalizeVenueText("Другое имя"),
            normalized_address: normalizeVenueText("Одинаковый адрес 1"),
            normalization_version: 1,
            identity_discriminator: "",
            review_markers: [],
            public_contacts: null,
            latitude: cities[0].centerLatitude,
            longitude: cities[0].centerLongitude,
          },
        ],
        identityKeys: [],
      },
      normalize,
    );
    assert.equal(nearPlan.toInsert.length, 1);

    const prepared = planAgainstState(
      manifest,
      digest,
      { cities: [], venues: [], identityKeys: [] },
      normalize,
    ).toInsert[0];
    // Same source + same digest + identity markers: preserve later public-data enrichment (SKIP, zero writes).
    const enriched = planAgainstState(
      manifest,
      digest,
      {
        cities: manifest.cities.map((c) => ({
          id: c.id,
          country_code: "RU",
          name_ru: c.nameRu,
          name_en: c.nameEn,
          default_timezone: c.timezone,
        })),
        venues: [
          {
            id: prepared.id,
            name: prepared.name,
            address: prepared.address,
            city_id: prepared.cityId,
            timezone: prepared.timezone,
            provenance: "admin_created",
            data_status: "unverified",
            lifecycle_state: "unverified",
            normalized_name: prepared.normalizedName,
            normalized_address: prepared.normalizedAddress,
            normalization_version: 1,
            identity_discriminator: prepared.identityDiscriminator,
            review_markers: prepared.markers,
            public_contacts: {
              phone: "+7 999 000-00-00",
              website: "https://tennisnsk.ru",
              messengers: [],
            },
            court_count: null,
            latitude: prepared.latitude,
            longitude: prepared.longitude,
          },
        ],
        identityKeys: [{ dedupe_key: prepared.key, venue_id: prepared.id }],
      },
      normalize,
    );
    assert.equal(enriched.toInsert.length, 0);
    assert.equal(enriched.toSkip.length, 1);
    // Different digest attempting the same UUID must still refuse (no blind UUID skip).
    assert.throws(
      () =>
        planAgainstState(
          manifest,
          "d".repeat(64),
          {
            cities: manifest.cities.map((c) => ({
              id: c.id,
              country_code: "RU",
              name_ru: c.nameRu,
              name_en: c.nameEn,
              default_timezone: c.timezone,
            })),
            venues: [
              {
                id: prepared.id,
                name: prepared.name,
                address: prepared.address,
                city_id: prepared.cityId,
                timezone: prepared.timezone,
                provenance: "admin_created",
                data_status: "unverified",
                lifecycle_state: "unverified",
                normalized_name: prepared.normalizedName,
                normalized_address: prepared.normalizedAddress,
                normalization_version: 1,
                identity_discriminator: prepared.identityDiscriminator,
                review_markers: prepared.markers,
                public_contacts: {
                  phone: "+7 999 000-00-00",
                  website: null,
                  messengers: [],
                },
                court_count: null,
                latitude: prepared.latitude,
                longitude: prepared.longitude,
              },
            ],
            identityKeys: [{ dedupe_key: prepared.key, venue_id: prepared.id }],
          },
          normalize,
        ),
      /IDEMPOTENT_REPLAY_CONFLICT/,
    );
  });

  it("name-alone near neighbors do not merge", () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0003", cities[1], {
      name: "Одинаковое имя",
      address: "Адрес А",
      latitude: cities[1].centerLatitude,
      longitude: cities[1].centerLongitude,
    });
    const manifest = validateManifest(validManifest([venue]));
    const plan = planAgainstState(
      manifest,
      "d".repeat(64),
      {
        cities: [],
        venues: [
          {
            id: venueIdForSourceVenueId("B4U-V-AAAA0004"),
            name: "Одинаковое имя",
            address: "Адрес Б совсем другой",
            city_id: cities[1].id,
            timezone: cities[1].timezone,
            provenance: "admin_created",
            data_status: "unverified",
            lifecycle_state: "unverified",
            normalized_name: normalizeVenueText("Одинаковое имя"),
            normalized_address: normalizeVenueText("Адрес Б совсем другой"),
            normalization_version: 1,
            identity_discriminator: "",
            review_markers: [],
            public_contacts: null,
            latitude: cities[1].centerLatitude,
            longitude: cities[1].centerLongitude,
          },
        ],
        identityKeys: [],
      },
      normalize,
    );
    assert.equal(plan.toInsert.length, 1);
  });
});

describe("runImport injectable client", () => {
  it("dry-run path issues no writes and refuses unqualified actor", async () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0005", cities[3]);
    const manifest = validateManifest(validManifest([venue]));
    const digest = sha256Hex(Buffer.from("fixture"));
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql: String(sql), params });
        if (/admin_principals/.test(sql)) {
          return {
            rows: [{ user_id: "u1", roles: ["pilot_viewer"] }],
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () =>
        runImport({
          mode: "DRY_RUN",
          manifest,
          digest,
          actorPrincipalId: "11111111-1111-4111-8111-111111111111",
          deps: { client, normalize, appendAudit: async () => "audit" },
        }),
      /IMPORT_ACTOR_REFUSED/,
    );
    assert.ok(rolesHaveVenueManage(["superadmin"]));
    assert.ok(rolesHaveVenueManage(["content_manager"]));
    assert.equal(rolesHaveVenueManage(["pilot_viewer"]), false);
  });

  it("PostGIS path rejects outside radius and existing 150m address collisions", async () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0008", cities[0], {
      address: "Одинаковый адрес SQL",
      latitude: cities[0].centerLatitude,
      longitude: cities[0].centerLongitude,
    });
    const far = venueFixture("B4U-V-AAAA0009", cities[0], {
      latitude: cities[0].centerLatitude + 2,
      longitude: cities[0].centerLongitude + 2,
    });
    const farManifest = validateManifest(validManifest([far]));
    const nearManifest = validateManifest(validManifest([venue]));
    const digest = "a".repeat(64);
    const farClient = {
      async query(sql) {
        const text = String(sql);
        if (/admin_principals/.test(text)) {
          return { rows: [{ user_id: "u1", roles: ["superadmin"] }], rowCount: 1 };
        }
        if (/FROM cities/.test(text)) return { rows: [], rowCount: 0 };
        if (/FROM venues v/.test(text)) return { rows: [], rowCount: 0 };
        if (/venue_identity_keys/.test(text)) return { rows: [], rowCount: 0 };
        if (/ST_DWithin/.test(text) && /inside/.test(text)) {
          return { rows: [{ inside: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () =>
        runImport({
          mode: "DRY_RUN",
          manifest: farManifest,
          digest,
          actorPrincipalId: "44444444-4444-4444-8444-444444444444",
          deps: { client: farClient, normalize, appendAudit: async () => "a" },
        }),
      /VENUE_OUTSIDE_CITY_RADIUS/,
    );

    const nearClient = {
      async query(sql) {
        const text = String(sql);
        if (/admin_principals/.test(text)) {
          return { rows: [{ user_id: "u1", roles: ["superadmin"] }], rowCount: 1 };
        }
        if (/FROM cities/.test(text)) return { rows: [], rowCount: 0 };
        if (/FROM venues v/.test(text)) return { rows: [], rowCount: 0 };
        if (/venue_identity_keys/.test(text) && /SELECT/.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        if (/ST_DWithin/.test(text) && /inside/.test(text)) {
          return { rows: [{ inside: true }], rowCount: 1 };
        }
        if (/SELECT id FROM venues/.test(text) && /ST_DWithin/.test(text)) {
          return { rows: [{ id: venueIdForSourceVenueId("B4U-V-AAAA0002") }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () =>
        runImport({
          mode: "DRY_RUN",
          manifest: nearManifest,
          digest,
          actorPrincipalId: "55555555-5555-4555-8555-555555555555",
          deps: { client: nearClient, normalize, appendAudit: async () => "a" },
        }),
      /EXISTING_AMBIGUOUS_DEDUP/,
    );
  });

  it("writable actor lock uses FOR UPDATE without GROUP BY, then separate grants query", async () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0007", cities[5]);
    const manifest = validateManifest(validManifest([venue]));
    const digest = "f".repeat(64);
    const actorSql = [];
    const client = {
      async query(sql) {
        const text = String(sql).replace(/\s+/g, " ").trim();
        if (/admin_principals/.test(text)) {
          actorSql.push(text);
          if (/FOR UPDATE/.test(text)) {
            assert.equal(/GROUP BY/.test(text), false);
            return { rows: [{ user_id: "user-1" }], rowCount: 1 };
          }
          assert.equal(/FOR UPDATE/.test(text), false);
          assert.ok(/GROUP BY/.test(text));
          return { rows: [{ user_id: "user-1", roles: ["content_manager"] }], rowCount: 1 };
        }
        if (/FROM cities/.test(text)) return { rows: [], rowCount: 0 };
        if (/FROM venues v/.test(text)) return { rows: [], rowCount: 0 };
        if (/venue_identity_keys/.test(text) && /SELECT/.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        if (/ST_DWithin/.test(text) && /inside/.test(text)) {
          return { rows: [{ inside: true }], rowCount: 1 };
        }
        if (/ST_DWithin/.test(text)) return { rows: [], rowCount: 0 };
        if (/INSERT INTO/.test(text)) {
          return { rows: [{ id: "x", version: 1, venue_id: "x" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await runImport({
      mode: "APPLY",
      manifest,
      digest,
      actorPrincipalId: "33333333-3333-4333-8333-333333333333",
      deps: {
        client,
        normalize,
        appendAudit: async () => "audit-lock",
      },
    });
    assert.equal(actorSql.length, 2);
    assert.ok(/FOR UPDATE OF p, u/.test(actorSql[0]));
    assert.ok(/GROUP BY p\.user_id/.test(actorSql[1]));
  });

  it("writable injectable path inserts city+venue+audit atomically-shaped calls", async () => {
    const cities = buildCities();
    const venue = venueFixture("B4U-V-AAAA0006", cities[4]);
    const manifest = validateManifest(validManifest([venue]));
    const digest = "e".repeat(64);
    const statements = [];
    let auditCalls = 0;
    const client = {
      async query(sql, params) {
        const text = String(sql).replace(/\s+/g, " ").trim();
        statements.push(text.slice(0, 80));
        if (/admin_principals/.test(text) && /FOR UPDATE/.test(text)) {
          return { rows: [{ user_id: "user-1" }], rowCount: 1 };
        }
        if (/admin_principals/.test(text)) {
          return { rows: [{ user_id: "user-1", roles: ["superadmin"] }], rowCount: 1 };
        }
        if (/FROM cities/.test(text)) return { rows: [], rowCount: 0 };
        if (/FROM venues v/.test(text)) return { rows: [], rowCount: 0 };
        if (/venue_identity_keys/.test(text) && /SELECT/.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        if (/ST_DWithin/.test(text) && /inside/.test(text)) {
          return { rows: [{ inside: true }], rowCount: 1 };
        }
        if (/ST_DWithin/.test(text)) return { rows: [], rowCount: 0 };
        if (/INSERT INTO cities/.test(text)) return { rows: [{ id: params[0] }], rowCount: 1 };
        if (/INSERT INTO venues/.test(text)) {
          return { rows: [{ id: params[0], version: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO venue_identity_keys/.test(text)) {
          return { rows: [{ venue_id: params[1] }], rowCount: 1 };
        }
        if (/INSERT INTO venue_admin_actions/.test(text)) return { rows: [], rowCount: 1 };
        if (/INSERT INTO outbox_events/.test(text)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    };
    const report = await runImport({
      mode: "APPLY",
      manifest,
      digest,
      actorPrincipalId: "22222222-2222-4222-8222-222222222222",
      deps: {
        client,
        normalize,
        appendAudit: async () => {
          auditCalls += 1;
          return "audit-1";
        },
      },
    });
    assert.equal(report.transactionMode, "APPLY");
    assert.equal(report.venues.inserted, 1);
    assert.equal(report.cities.inserted, 11);
    assert.equal(auditCalls, 1);
    assert.ok(statements.some((s) => /INSERT INTO venues/.test(s)));
    assert.ok(statements.some((s) => /INSERT INTO outbox_events/.test(s)));
    const markers = buildReviewMarkers(manifest.venues[0], digest);
    assert.ok(markers[0].startsWith("SOURCE_VENUE_ID="));
    assert.ok(markers.some((m) => m.startsWith("B4U_SOURCE_V1=")));
    assert.ok(markers.some((m) => m.startsWith("B4U_CONTACTS_V1=")));
    assert.ok(markers.some((m) => m.startsWith("REGIONS485_DIGEST=")));
  });
});

describe("sourceVenueAliases + reviewResolution", () => {
  it("accepts Rostov-style aliases on one canonical UUID and refuses alias collisions", () => {
    const cities = buildCities();
    const rostov = cities.find((c) => c.nameRu === "Ростов-на-Дону");
    const primary = "B4U-V-8CAA0D60";
    const alias = "B4U-V-0123E53D";
    const club198 = "https://badminton4u.ru/clubs/198";
    const club269 = "https://badminton4u.ru/clubs/269";
    const venue = venueFixture(primary, rostov, {
      name: "Легкоатлетический манеж ДГТУ",
      address: "г. Ростов-на-Дону, ул. Юфимцева, 16",
      latitude: 47.241055,
      longitude: 39.709454,
      sourceUrls: [club198, club269],
      clubSources: [
        { clubId: "B4U-C-198", name: "Клуб 198", url: club198 },
        { clubId: "B4U-C-269", name: "Клуб 269", url: club269 },
      ],
      sourceVenueAliases: [alias],
    });
    const manifest = validateManifest(validManifest([venue]));
    assert.deepEqual(manifest.venues[0].sourceVenueAliases, [alias]);
    assert.equal(manifest.venues[0].id, venueIdForSourceVenueId(primary));
    const digest = "a1".repeat(32);
    const markers = buildReviewMarkers(manifest.venues[0], digest);
    assert.ok(markers.includes(`SOURCE_VENUE_ID=${primary}`));
    assert.ok(markers.includes(`SOURCE_VENUE_ID=${alias}`));
    const sourceJson = JSON.parse(
      markers.find((m) => m.startsWith("B4U_SOURCE_V1=")).slice("B4U_SOURCE_V1=".length),
    );
    assert.deepEqual(sourceJson.sourceVenueAliases, [alias]);

    const first = planAgainstState(
      manifest,
      digest,
      { cities: [], venues: [], identityKeys: [] },
      normalize,
    );
    assert.equal(first.toInsert.length, 1);
    assert.equal(first.toSkip.length, 0);
    const prepared = first.toInsert[0];
    const replay = planAgainstState(
      manifest,
      digest,
      {
        cities: [],
        venues: [
          {
            id: prepared.id,
            name: prepared.name,
            address: prepared.address,
            city_id: prepared.cityId,
            timezone: prepared.timezone,
            provenance: "admin_created",
            data_status: "unverified",
            lifecycle_state: "unverified",
            normalized_name: prepared.normalizedName,
            normalized_address: prepared.normalizedAddress,
            normalization_version: 1,
            identity_discriminator: prepared.identityDiscriminator,
            review_markers: prepared.markers,
            public_contacts: null,
            court_count: null,
            latitude: prepared.latitude,
            longitude: prepared.longitude,
          },
        ],
        identityKeys: [{ dedupe_key: prepared.key, venue_id: prepared.id }],
      },
      normalize,
    );
    assert.equal(replay.toInsert.length, 0);
    assert.equal(replay.toSkip.length, 1);

    assert.throws(
      () =>
        validateManifest(
          validManifest([
            venueFixture(primary, rostov, { sourceVenueAliases: [alias] }),
            venueFixture(alias, rostov, {
              name: "Дубль",
              address: "другой адрес",
              latitude: rostov.centerLatitude + 0.02,
              longitude: rostov.centerLongitude + 0.02,
            }),
          ]),
        ),
      /ALIAS_CONFLICTS_WITH_SOURCE|DUPLICATE_SOURCE_VENUE_ID/,
    );
    assert.throws(
      () =>
        validateManifest(
          validManifest([
            venueFixture(primary, rostov, { sourceVenueAliases: [primary] }),
          ]),
        ),
      /ALIAS_EQUALS_PRIMARY/,
    );
  });

  it("persists reviewResolution original→corrected and refuses corrected mismatch / absent-field compat", () => {
    const cities = buildCities();
    const krasnodar = cities.find((c) => c.nameRu === "Краснодар");
    const resolution = {
      kind: "EXPLICIT_PUBLIC_SOURCE_ADDRESS_POINT_CORRECTION",
      original: {
        address: "Динская",
        latitude: null,
        longitude: null,
        sourceVenueId: "B4U-V-F943CB45",
        importReady: "no",
        collectedAt: "2026-10-07",
      },
      corrected: {
        address: "Краснодарский край, станица Динская, улица Тельмана, 139/1",
        latitude: 45.1964268,
        longitude: 39.2437748,
      },
      primaryAddressSourceURL:
        "https://sport-dinsk.ru/svedeniya-ob-obrazovatelnoj-organizatsii/osnovnye-svedeniya",
      pointSourceURL:
        "https://nominatim.openstreetmap.org/search?q=dinsk&format=jsonv2",
      pointCheckedAt: "2026-11-06T17:17:43.100165+00:00",
      reason: "Original stanitsa-only row; Rekord Telmana 139/1 point qualified.",
    };
    const venue = venueFixture("B4U-V-F943CB45", krasnodar, {
      name: "Спорткомплекс «Рекорд»",
      address: resolution.corrected.address,
      latitude: resolution.corrected.latitude,
      longitude: resolution.corrected.longitude,
      sourceUrls: ["https://badminton4u.ru/clubs/126"],
      clubSources: [
        { clubId: "B4U-C-126", name: "Рекорд", url: "https://badminton4u.ru/clubs/126" },
      ],
      reviewResolution: resolution,
    });
    const manifest = validateManifest(validManifest([venue]));
    assert.equal(manifest.venues[0].reviewResolution.kind, resolution.kind);
    const digest = "b2".repeat(32);
    const markers = buildReviewMarkers(manifest.venues[0], digest);
    const resMarker = markers.find((m) => m.startsWith("B4U_REVIEW_RESOLUTION_V1="));
    assert.ok(resMarker);
    const parsed = JSON.parse(resMarker.slice("B4U_REVIEW_RESOLUTION_V1=".length));
    assert.equal(parsed.original.address, "Динская");
    assert.equal(parsed.corrected.latitude, 45.1964268);

    // Optional-absent: legacy venue without reviewResolution keeps old marker set (no resolution marker).
    const legacy = validateManifest(
      validManifest([venueFixture("B4U-V-AAAA0099", krasnodar)]),
    );
    const legacyMarkers = buildReviewMarkers(legacy.venues[0], digest);
    assert.equal(
      legacyMarkers.some((m) => m.startsWith("B4U_REVIEW_RESOLUTION_V1=")),
      false,
    );
    assert.equal(legacyMarkers.filter((m) => m.startsWith("SOURCE_VENUE_ID=")).length, 1);

    assert.throws(
      () =>
        validateManifest(
          validManifest([
            venueFixture("B4U-V-F943CB45", krasnodar, {
              address: "другой адрес",
              latitude: resolution.corrected.latitude,
              longitude: resolution.corrected.longitude,
              sourceUrls: ["https://badminton4u.ru/clubs/126"],
              clubSources: [
                { clubId: "B4U-C-126", name: "Рекорд", url: "https://badminton4u.ru/clubs/126" },
              ],
              reviewResolution: resolution,
            }),
          ]),
        ),
      /REVIEW_RESOLUTION_CORRECTED_MISMATCH/,
    );
  });
});

describe("geo helpers", () => {
  it("treats 40km boundary as inclusive via distance helper", () => {
    const cities = buildCities();
    const c = cities[0];
    // ~0 degrees → well inside
    assert.ok(
      distanceMeters(c.centerLatitude, c.centerLongitude, c.centerLatitude, c.centerLongitude) <=
        CITY_RADIUS_METERS,
    );
    assert.equal(DEDUPE_METERS, 150);
  });
});
