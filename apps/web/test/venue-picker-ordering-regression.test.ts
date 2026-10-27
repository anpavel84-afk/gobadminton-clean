import { describe, expect, it } from "vitest";
import type { VenueSummary } from "../src/lib/consumer-types";
import { sortVenueOptions } from "../src/lib/venue-picker-utils";

const cityId = "a0000000-0000-4000-8000-000000000001";
const tz = "Europe/Moscow";

function venue(partial: Pick<VenueSummary, "id" | "name" | "address">): VenueSummary {
  return { cityId, timezone: tz, ...partial };
}

describe("sortVenueOptions ordering regression", () => {
  it("orders numeric Russian venue names with Зал 2 before Зал 10", () => {
    const input = [
      venue({ id: "10", name: "Зал 10", address: "Улица А" }),
      venue({ id: "2", name: "Зал 2", address: "Улица Б" }),
      venue({ id: "1", name: "Зал 1", address: "Улица В" }),
    ];

    expect(sortVenueOptions(input).map(v => v.name)).toEqual(["Зал 1", "Зал 2", "Зал 10"]);
  });

  it("breaks equal names by address then id", () => {
    const input = [
      venue({ id: "b", name: "Одинаковое", address: "Улица Б" }),
      venue({ id: "a2", name: "Одинаковое", address: "Улица А" }),
      venue({ id: "a1", name: "Одинаковое", address: "Улица А" }),
    ];

    expect(sortVenueOptions(input).map(v => v.id)).toEqual(["a1", "a2", "b"]);
  });

  it("returns a new array and leaves frozen input array and records unchanged", () => {
    const records = [
      Object.freeze(venue({ id: "z", name: "Ястреб", address: "Химки" })),
      Object.freeze(venue({ id: "a", name: "Альфа", address: "Москва" })),
    ];
    const input = Object.freeze([...records]);
    const snapshot = records.map(v => ({ ...v }));

    const sorted = sortVenueOptions(input as VenueSummary[]);

    expect(sorted).not.toBe(input);
    expect(sorted.map(v => v.name)).toEqual(["Альфа", "Ястреб"]);
    expect(input).toHaveLength(2);
    expect(input[0]).toBe(records[0]);
    expect(input[1]).toBe(records[1]);
    expect(records.map(v => ({ ...v }))).toEqual(snapshot);
  });
});
