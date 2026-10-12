export type CapacityInput = {
  capacity: number;
  externalReservedCount: number;
  confirmedCount: number;
};

export type CapacityViolation =
  | "CAPACITY_NONPOSITIVE"
  | "EXTERNAL_RESERVED_NEGATIVE"
  | "CONFIRMED_NEGATIVE"
  | "CAPACITY_OVERFLOW";

/** INV-01 / INV-02 fail-closed checks. */
export function validateCapacityInvariant(
  input: CapacityInput,
): CapacityViolation | null {
  if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
    return "CAPACITY_NONPOSITIVE";
  }
  if (
    !Number.isInteger(input.externalReservedCount) ||
    input.externalReservedCount < 0
  ) {
    return "EXTERNAL_RESERVED_NEGATIVE";
  }
  if (!Number.isInteger(input.confirmedCount) || input.confirmedCount < 0) {
    return "CONFIRMED_NEGATIVE";
  }
  if (input.confirmedCount + input.externalReservedCount > input.capacity) {
    return "CAPACITY_OVERFLOW";
  }
  return null;
}

/** INV-03: pending does not consume capacity. */
export function availablePlaces(input: CapacityInput): number {
  const violation = validateCapacityInvariant(input);
  if (violation) {
    throw new Error(`Invalid capacity state: ${violation}`);
  }
  return input.capacity - input.externalReservedCount - input.confirmedCount;
}
