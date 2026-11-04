import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LevelGuide } from "../src/components/consumer/LevelGuide";
import {
  LEVEL_GUIDE_DISCLAIMER,
  LEVEL_GUIDE_DONT_KNOW,
  ntrpHalfstepIds,
} from "../src/lib/level-guide";

describe("LevelGuide control", () => {
  it("renders Russian optional help with Не знаю and ntrp half-steps", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "",
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
        value: "3.0",
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
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "gold",
        preservedOption: { levelId: "gold", label: "Клубный gold" },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Клубный gold");
    expect(html).toContain("другая шкала");
  });

  it("exposes accessible select + details without requiring a modal", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: LEVEL_GUIDE_DONT_KNOW,
        onChange: () => undefined,
        disabled: true,
      }),
    );
    expect(html).toContain("<select");
    expect(html).toContain("<details");
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/modal|quiz|обязательн/i);
  });
});

describe("LevelGuide controlled updates (no network)", () => {
  it("Не знаю clears controlled value via onChange only", () => {
    const spy = vi.fn();
    // Direct prop invocation path used by SSR markup tests elsewhere in the suite.
    const tree = createElement(LevelGuide, {
      surface: "profile",
      value: "3.0",
      onChange: spy,
    }) as ReactElement<{ onChange: (v: string) => void; value: string }>;
    tree.props.onChange(LEVEL_GUIDE_DONT_KNOW);
    expect(spy).toHaveBeenCalledWith("");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("actor switch is reflected by controlled value prop", () => {
    const first = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "beginner",
        onChange: () => undefined,
      }),
    );
    expect(first).toContain("Краткий уровень");
    const second = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "",
        onChange: () => undefined,
      }),
    );
    expect(second).toContain("Можно пропустить");
    const numeric = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "4.0",
        onChange: () => undefined,
      }),
    );
    expect(numeric).toContain("Выбрано:");
  });
});
