import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEV_MOSCOW_PEER_IDS,
  FIXTURE_PERSONAS,
  gameTitle,
  operationId,
  parseEnrichmentArgs,
  planGameSchedule,
  planPersonaActions,
  validateManifest,
  type EnrichmentManifest,
} from "../../src/database/dev-radar-fixture-enrichment";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";

const asOf = "2026-10-30T00:00:00.000Z";
function manifest(overrides: Partial<EnrichmentManifest> = {}): EnrichmentManifest {
  return {
    asOf,
    operationKey: "radar398-enrich-v1",
    venueId: "a0000000-0000-4000-8000-000000000099",
    coverPaths: { courts: "/tmp/courts.jpg", gear: "/tmp/gear.jpg" },
    avatars: DEV_MOSCOW_PEER_IDS.map((userId, i) => ({
      userId,
      path: `/tmp/avatar-${i + 1}.png`,
      sha256: createHash("sha256").update(`avatar-${i + 1}`).digest("hex"),
    })),
    ...overrides,
  };
}

describe("dev radar fixture enrichment planning", () => {
  it("defaults dry-run and binds immutable --as-of to the manifest", () => {
    expect(parseEnrichmentArgs(["--manifest", "/m.json", "--as-of", asOf])).toEqual({
      apply: false,
      manifestPath: "/m.json",
      asOf,
    });
    expect(parseEnrichmentArgs(["--manifest", "/m.json", "--as-of", asOf, "--apply"]).apply).toBe(true);
    expect(() => parseEnrichmentArgs(["--manifest", "/m.json"])).toThrow(/INVALID_ARGUMENTS/);
    expect(() => validateManifest(manifest({ asOf: "2026-01-01T00:00:00.000Z" }), asOf)).toThrow(/AS_OF_MISMATCH/);
  });

  it("refuses foreign avatar identities and non-six manifests", () => {
    const foreign = manifest();
    foreign.avatars[0] = { ...foreign.avatars[0]!, userId: "d0f00001-0000-4000-8000-000000000001" };
    expect(() => validateManifest(foreign, asOf)).toThrow(/FOREIGN_AVATAR_IDENTITY/);
    expect(() => validateManifest(manifest({ avatars: manifest().avatars.slice(0, 5) }), asOf)).toThrow(/INVALID_AVATARS/);
  });

  it("plans only missing enrichment actions and keeps stable TEST titles", () => {
    expect(FIXTURE_PERSONAS).toHaveLength(6);
    expect(FIXTURE_PERSONAS.every((p) => p.displayName.startsWith("TEST · DEV Москва"))).toBe(true);
    expect(gameTitle(FIXTURE_PERSONAS[0]!, 1)).toBe("TEST · DEV Москва 1 · игра 1");
    const empty = planPersonaActions({
      persona: FIXTURE_PERSONAS[0]!,
      profile: {
        bio: null, city_id: null, area_key: null, level_id: null,
        directory_visible: false, avatar_key: null, cover_key: null, version: 1,
      },
      gameTitles: [],
    });
    expect(empty.actions).toEqual([
      "patch_profile", "set_visibility", "upload_avatar", "upload_cover", "create_game:1", "create_game:2",
    ]);
    const done = planPersonaActions({
      persona: FIXTURE_PERSONAS[0]!,
      profile: {
        bio: FIXTURE_PERSONAS[0]!.bio,
        city_id: MOSCOW_CITY_ID,
        area_key: FIXTURE_PERSONAS[0]!.areaKey,
        level_id: FIXTURE_PERSONAS[0]!.levelId,
        directory_visible: true,
        avatar_key: "a".repeat(64) + ".png",
        cover_key: "b".repeat(64) + ".png",
        version: 4,
      },
      gameTitles: [gameTitle(FIXTURE_PERSONAS[0]!, 1), gameTitle(FIXTURE_PERSONAS[0]!, 2)],
    });
    expect(done.actions).toEqual([]);
    expect(done.skipReasons).toEqual(expect.arrayContaining([
      "PROFILE_ALREADY_ENRICHED", "DIRECTORY_ALREADY_VISIBLE", "AVATAR_PRESENT", "COVER_PRESENT", "GAME_EXISTS:1", "GAME_EXISTS:2",
    ]));
  });

  it("binds operation keys and future game times to as-of", () => {
    const m = manifest();
    const a = operationId(m, DEV_MOSCOW_PEER_IDS[0]!, "profile");
    const b = operationId(m, DEV_MOSCOW_PEER_IDS[0]!, "profile");
    const c = operationId(m, DEV_MOSCOW_PEER_IDS[1]!, "profile");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const schedule = planGameSchedule(asOf, 1, 1);
    expect(Date.parse(schedule.startsAt)).toBeGreaterThan(Date.parse(asOf));
    expect(Date.parse(schedule.endsAt)).toBeGreaterThan(Date.parse(schedule.startsAt));
    expect(Date.parse(schedule.deadlineAt)).toBeLessThanOrEqual(Date.parse(schedule.startsAt));
  });
});
