import { describe, expect, it } from "vitest";
import type { LevelRule, SocialLevel } from "./consumer-types";
import {
  filterGamesBySelectedNtrpLevel,
  gameAllowsSelectedNtrpLevel,
  isExactNtrpV1Rule,
  isKnownProfileLevelChoice,
  isNtrpHalfstepId,
  normalizeNtrpLevelId,
  ntrpHalfstepIds,
  ntrpSelfDeclaredLevel,
  resolveProfileLevelForSave,
} from "./level-guide";

const ntrpRule = (ids: string[]): LevelRule => ({
  scaleId: "ntrp",
  scaleVersion: 1,
  allowedLevelIds: ids,
});

describe("level-guide half-steps and normalize", () => {
  it("lists 13 inclusive ntrp v1 half-steps from 1.0 to 7.0", () => {
    const ids = ntrpHalfstepIds();
    expect(ids).toHaveLength(13);
    expect(ids[0]).toBe("1.0");
    expect(ids[ids.length - 1]).toBe("7.0");
    expect(ids).toContain("3.5");
    expect(ids).not.toContain("3.2");
  });

  it("normalizes 3 / 3.0 / 3,0 and rejects non-half-steps", () => {
    expect(normalizeNtrpLevelId("3")).toBe("3.0");
    expect(normalizeNtrpLevelId("3.0")).toBe("3.0");
    expect(normalizeNtrpLevelId("3,0")).toBe("3.0");
    expect(normalizeNtrpLevelId("3.2")).toBeNull();
    expect(normalizeNtrpLevelId("0.5")).toBeNull();
    expect(normalizeNtrpLevelId("8")).toBeNull();
    expect(normalizeNtrpLevelId("")).toBeNull();
    expect(normalizeNtrpLevelId("beginner")).toBeNull();
  });
});

describe("level-guide membership against levelRule", () => {
  it("includes boundary half-steps only for exact ntrp/v1", () => {
    const rule = ntrpRule(["3.0", "3.5"]);
    expect(gameAllowsSelectedNtrpLevel(rule, "3.0")).toBe(true);
    expect(gameAllowsSelectedNtrpLevel(rule, "3")).toBe(true);
    expect(gameAllowsSelectedNtrpLevel(rule, "3.5")).toBe(true);
    expect(gameAllowsSelectedNtrpLevel(rule, "2.5")).toBe(false);
    expect(gameAllowsSelectedNtrpLevel(rule, "4.0")).toBe(false);
  });

  it("does not claim legacy / other scales compatible", () => {
    expect(isExactNtrpV1Rule({ scaleId: "gb-social-pilot", scaleVersion: 1, allowedLevelIds: ["beginner"] })).toBe(false);
    expect(gameAllowsSelectedNtrpLevel(
      { scaleId: "pilot", scaleVersion: 1, allowedLevelIds: ["3.0"] },
      "3.0",
    )).toBe(false);
    expect(gameAllowsSelectedNtrpLevel(
      { scaleId: "ntrp", scaleVersion: 2, allowedLevelIds: ["3.0"] },
      "3.0",
    )).toBe(false);
    expect(gameAllowsSelectedNtrpLevel(ntrpRule(["3.0"]), null)).toBe(true);
    expect(gameAllowsSelectedNtrpLevel(ntrpRule(["3.0"]), "")).toBe(true);
  });

  it("derives a filtered list without mutating the raw array", () => {
    const raw = [
      { id: "a", levelRule: ntrpRule(["2.5", "3.0"]) },
      { id: "b", levelRule: ntrpRule(["4.0"]) },
      { id: "c", levelRule: { scaleId: "legacy", scaleVersion: 1, allowedLevelIds: ["3.0"] } },
    ];
    const copy = [...raw];
    const visible = filterGamesBySelectedNtrpLevel(raw, "3.0");
    expect(visible.map((g) => g.id)).toEqual(["a"]);
    expect(raw).toEqual(copy);
    expect(filterGamesBySelectedNtrpLevel(raw, null)).toHaveLength(3);
  });
});

describe("level-guide profile save resolution", () => {
  it("preserves existing SocialLevel object on no-op same levelId", () => {
    const existing: SocialLevel = {
      scaleId: "custom-club",
      scaleVersion: 9,
      levelId: "gold",
      provenance: "self_declared",
    };
    expect(resolveProfileLevelForSave("gold", existing)).toBe(existing);
    expect(isKnownProfileLevelChoice("gold")).toBe(false);
  });

  it("stores ntrp/v1/self_declared for numeric choice, not gb-social-pilot", () => {
    const next = resolveProfileLevelForSave("3.5", null);
    expect(next).toEqual({
      scaleId: "ntrp",
      scaleVersion: 1,
      levelId: "3.5",
      provenance: "self_declared",
    });
    expect(ntrpSelfDeclaredLevel("3")).toEqual({
      scaleId: "ntrp",
      scaleVersion: 1,
      levelId: "3.0",
      provenance: "self_declared",
    });
  });

  it("keeps pilot symbols and clears only on empty / Не знаю", () => {
    expect(resolveProfileLevelForSave("beginner", null)).toEqual({
      scaleId: "gb-social-pilot",
      scaleVersion: 1,
      levelId: "beginner",
      provenance: "self_declared",
    });
    expect(resolveProfileLevelForSave("", { scaleId: "ntrp", scaleVersion: 1, levelId: "3.0", provenance: "self_declared" })).toBeNull();
    expect(isNtrpHalfstepId("3.0")).toBe(true);
    expect(isNtrpHalfstepId("beginner")).toBe(false);
  });
});
