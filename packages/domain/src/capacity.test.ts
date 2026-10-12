import { describe, expect, it } from "vitest";
import { availablePlaces, validateCapacityInvariant } from "./capacity";

describe("capacity invariants", () => {
  it("rejects non-positive capacity (INV-01)", () => {
    expect(
      validateCapacityInvariant({
        capacity: 0,
        externalReservedCount: 0,
        confirmedCount: 0,
      }),
    ).toBe("CAPACITY_NONPOSITIVE");
  });

  it("rejects externalReserved > capacity (INV-02)", () => {
    expect(
      validateCapacityInvariant({
        capacity: 4,
        externalReservedCount: 5,
        confirmedCount: 0,
      }),
    ).toBe("CAPACITY_OVERFLOW");
  });

  it("computes availablePlaces without counting pending (INV-03)", () => {
    expect(
      availablePlaces({
        capacity: 10,
        externalReservedCount: 2,
        confirmedCount: 3,
      }),
    ).toBe(5);
  });
});
