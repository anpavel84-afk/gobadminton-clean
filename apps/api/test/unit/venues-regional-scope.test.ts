import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REGIONAL_CITY_RADIUS_METERS,
  VenuesService,
  regionalCityCenter,
} from "../../src/venues/venues.service";
import type { IdempotencyService } from "../../src/common/idempotency.service";
import type { MutationRunner } from "../../src/common/mutation-runner.service";
import type { Pool } from "pg";

const MOSCOW = "a0000000-0000-4000-8000-000000000001";
const SPB = "a0000000-0000-4000-8000-000000000002";
const CONTRACTS = path.resolve(__dirname, "../../../../packages/contracts/src/regional-cities.ts");

describe("regional city catalog scope", () => {
  it("mirrors the 11 contract city ids/centers and 40 km radius", () => {
    const source = readFileSync(CONTRACTS, "utf8");
    const ids = [...source.matchAll(/id: "([0-9a-f-]{36})"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(11);
    expect(REGIONAL_CITY_RADIUS_METERS).toBe(40000);
    expect(source).toContain("REGIONAL_CITY_RADIUS_METERS = 40000");
    for (const id of ids) {
      expect(regionalCityCenter(id)).not.toBeNull();
    }
    expect(regionalCityCenter(MOSCOW)).toBeNull();
    expect(regionalCityCenter(SPB)).toBeNull();
    expect(regionalCityCenter("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
  });

  it("searchCatalog applies ST_DWithin 40 km only for the 11 regional city ids", async () => {
    const sqls: string[] = [];
    const service = new VenuesService(
      {
        query: async (sql: string) => {
          sqls.push(String(sql));
          return { rows: [], rowCount: 0 };
        },
      } as unknown as Pool,
      {} as IdempotencyService,
      {} as MutationRunner,
      {} as import("../../src/moderation/moderation.service").ContentModerationService,
    );
    const regionalId = "1775016f-373e-5a15-958b-1305770b2b16";
    await service.searchCatalog({ cityId: regionalId, limit: 10 });
    expect(sqls.some((s) => /ST_DWithin/.test(s))).toBe(true);
    expect(sqls.find((s) => /ST_DWithin/.test(s))).toMatch(/ST_SetSRID\(ST_MakePoint/);

    sqls.length = 0;
    await service.searchCatalog({ cityId: MOSCOW, limit: 10 });
    expect(sqls.some((s) => /ST_DWithin/.test(s))).toBe(false);

    sqls.length = 0;
    await service.searchCatalog({ cityId: SPB, limit: 10 });
    expect(sqls.some((s) => /ST_DWithin/.test(s))).toBe(false);
  });
});
