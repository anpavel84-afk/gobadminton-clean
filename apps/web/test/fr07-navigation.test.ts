import { describe, expect, it } from "vitest";
import { locationReturnPath } from "../src/lib/location-context";

describe("FR-07 city selection return boundary", () => {
  it("resumes creation only for the admitted internal destination", () => {
    expect(locationReturnPath("/games/create")).toBe("/games/create");
    for (const target of [null, "", "https://example.com", "//example.com", "/account/demo", "/games/create?publish=true", "javascript:alert(1)"]) {
      expect(locationReturnPath(target)).toBe("/games");
    }
  });
});
