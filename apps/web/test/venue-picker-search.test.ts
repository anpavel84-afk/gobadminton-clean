import { describe, expect, it } from "vitest";
import type { VenueSummary } from "../src/lib/consumer-types";
import { filterVenueOptions, resolveSelectedVenue, sortVenueOptions } from "../src/lib/venue-picker-utils";

const cityId = "a0000000-0000-4000-8000-000000000001";
const venues: VenueSummary[] = [
  { id: "3", cityId, name: "Ястреб", address: "Химки, улица Ленина, 7", timezone: "Europe/Moscow" },
  { id: "1", cityId, name: "Альфа", address: "Москва, Советская 10", timezone: "Europe/Moscow" },
  { id: "2", cityId, name: "Елка", address: "Мытищи, улица Лесная, 2", timezone: "Europe/Moscow" },
  { id: "4", cityId, name: "Бета", address: "Балашиха, улица Победы, 5", timezone: "Europe/Moscow" },
];

describe("compact alphabetic venue picker", () => {
  it("sorts Russian venue names alphabetically without changing original data", () => {
    expect(sortVenueOptions(venues).map(v => v.name)).toEqual(["Альфа", "Бета", "Елка", "Ястреб"]);
    expect(venues[0]?.name).toBe("Ястреб");
  });

  it("searches by name and address, ignoring case, whitespace and ё/е", () => {
    const sorted = sortVenueOptions(venues);
    expect(filterVenueOptions(sorted, "ЁЛКА").map(v => v.id)).toEqual(["2"]);
    expect(filterVenueOptions(sorted, "  улица  лесная ").map(v => v.id)).toEqual(["2"]);
    expect(filterVenueOptions(sorted, "ХИМКИ ЛЕНИНА").map(v => v.id)).toEqual(["3"]);
    expect(filterVenueOptions(sorted, "несуществующий")).toHaveLength(0);
    expect(filterVenueOptions(sorted, "")).toHaveLength(4);
  });
  it("keeps a cached Venue only in its original city group", () => {
    const cached = venues[0]!;
    expect(resolveSelectedVenue([], cached, cached.id, cityId)).toEqual(cached);
    expect(resolveSelectedVenue([], cached, cached.id, "a0000000-0000-4000-8000-000000000002")).toBeUndefined();
    expect(resolveSelectedVenue(venues, cached, cached.id, "a0000000-0000-4000-8000-000000000002")).toBeUndefined();
    expect(resolveSelectedVenue([], null, cached.id, cityId)).toBeUndefined();
  });

});
