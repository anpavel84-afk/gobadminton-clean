import { availablePlaces, validateCapacityInvariant } from "../../src/domain/capacity";
import { describe, expect, it } from "vitest";

describe("domain capacity policies", () => {
  it("enforces INV-01/INV-02 fail-closed", () => {
    expect(
      validateCapacityInvariant({
        capacity: 0,
        externalReservedCount: 0,
        confirmedCount: 0,
      }),
    ).toBe("CAPACITY_NONPOSITIVE");
    expect(
      validateCapacityInvariant({
        capacity: 4,
        externalReservedCount: 5,
        confirmedCount: 0,
      }),
    ).toBe("CAPACITY_OVERFLOW");
  });

  it("computes availablePlaces without pending (INV-03)", () => {
    expect(
      availablePlaces({
        capacity: 8,
        externalReservedCount: 1,
        confirmedCount: 2,
      }),
    ).toBe(5);
  });
});
