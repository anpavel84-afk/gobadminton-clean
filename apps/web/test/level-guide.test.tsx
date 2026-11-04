import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelGuide } from "../src/components/consumer/LevelGuide";
import type { SocialLevel } from "../src/lib/consumer-types";
import {
  LEVEL_GUIDE_DISCLAIMER,
  LEVEL_GUIDE_DONT_KNOW,
  LEVEL_GUIDE_KEEP_CONTROL,
  formatPreservedLevelChoiceLabel,
  levelGuideControlValue,
  ntrpHalfstepIds,
} from "../src/lib/level-guide";

describe("LevelGuide control", () => {
  it("renders Russian optional help with Не знаю and ntrp half-steps", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: { kind: "none" },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Помощь с выбором уровня");
    expect(html).toContain("Не знаю");
    expect(html).toContain("Что означают уровни");
    expect(html).toContain(LEVEL_GUIDE_DISCLAIMER);
    expect(html).toContain("не официальная квалификация");
    for (const id of ["1.0", "3.5", "7.0"]) expect(html).toContain(id);
    expect(ntrpHalfstepIds()).toHaveLength(13);
    expect(html).toContain("Начинающий");
    expect(html).toContain('data-level-guide="true"');
  });

  it("keeps discovery copy honest about loaded-list ntrp scope", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "discovery",
        value: { kind: "ntrp", levelId: "3.0" },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Фильтр по моему уровню");
    expect(html).toContain("Сбросить фильтр");
    expect(html).toContain("уже загруженным");
    expect(html).not.toContain("Начинающий");
    expect(html).toContain("aria-pressed");
  });

  it("preserves unknown custom option without forcing ntrp wrap in the control", () => {
    const existing: SocialLevel = {
      scaleId: "custom-club",
      scaleVersion: 1,
      levelId: "gold",
      provenance: "self_declared",
    };
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: { kind: "keep", level: existing },
        preservedLevel: existing,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain(formatPreservedLevelChoiceLabel(existing));
    expect(html).toContain("другая шкала");
    expect(html).toContain(LEVEL_GUIDE_KEEP_CONTROL);
  });

  it("LG458-01: shows distinct preserved option vs NTRP option for same numeric id", () => {
    const existing: SocialLevel = {
      scaleId: "custom-club",
      scaleVersion: 9,
      levelId: "3.0",
      provenance: "self_declared",
    };
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: { kind: "keep", level: existing },
        preservedLevel: existing,
        onChange: () => undefined,
      }),
    );
    const keepLabel = formatPreservedLevelChoiceLabel(existing);
    expect(html).toContain(keepLabel);
    expect(html).toContain(`value="${LEVEL_GUIDE_KEEP_CONTROL}"`);
    expect(html).toContain('value="3.0"');
    expect(levelGuideControlValue({ kind: "keep", level: existing })).toBe(LEVEL_GUIDE_KEEP_CONTROL);
    expect(html).toContain("другая шкала");
    expect(html).not.toContain("Выбрано:");
    // Catalog ntrp optgroup still lists 3.0 as a separate explicit choice.
    expect(html).toContain("Числовая шкала ntrp v1");
  });

  it("exposes accessible select + details without requiring a modal", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: { kind: "none" },
        onChange: () => undefined,
        disabled: true,
      }),
    );
    expect(html).toContain("<select");
    expect(html).toContain("<details");
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/modal|quiz|обязательн/i);
    expect(LEVEL_GUIDE_DONT_KNOW).toBe("");
  });
});
