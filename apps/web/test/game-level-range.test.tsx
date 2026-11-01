import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useId: () => "level-range",
    useState: <T,>(initial: T) => [initial, vi.fn()] as [T, React.Dispatch<React.SetStateAction<T>>],
  };
});

import { GameLevelRange } from "../src/components/consumer/games/GameLevelRange";
import {
  applyNtrpLevelBoundChange,
  inclusiveNtrpLevelIds,
  ntrpLevelSelectedFillStyle,
  ntrpLevelVisualPercent,
  parseNtrpLevelRange,
  serializeNtrpLevelIds,
} from "../src/lib/game-level-range";

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}

describe("inclusive NTRP level payload", () => {
  it("lists every half-step between bounds", () => {
    expect(inclusiveNtrpLevelIds(3, 4)).toEqual(["3.0", "3.5", "4.0"]);
    expect(serializeNtrpLevelIds(3, 3.5)).toBe("3.0, 3.5");
  });

  it("equal bounds mean a single level", () => {
    expect(inclusiveNtrpLevelIds(4, 4)).toEqual(["4.0"]);
    expect(serializeNtrpLevelIds(2.5, 2.5)).toBe("2.5");
  });

  it("clamps out-of-bounds and never reverses on crossing", () => {
    expect(inclusiveNtrpLevelIds(0, 9)).toEqual(inclusiveNtrpLevelIds(1, 7));
    expect(applyNtrpLevelBoundChange("lower", 5, 3, 3.5)).toEqual({
      lower: 3.5,
      upper: 3.5,
      serialized: "3.5",
    });
    expect(applyNtrpLevelBoundChange("upper", 2, 3, 3.5)).toEqual({
      lower: 3,
      upper: 3,
      serialized: "3.0",
    });
    expect(applyNtrpLevelBoundChange("lower", Number.NaN, 3, 3.5)).toBeNull();
    expect(applyNtrpLevelBoundChange("upper", "not-a-number", 3, 3.5)).toBeNull();
  });

  it("parses draft comma lists by inclusive min/max", () => {
    expect(parseNtrpLevelRange("3.0, 3.5")).toEqual({ lower: 3, upper: 3.5 });
    expect(parseNtrpLevelRange("4.0,3.0,3.5")).toEqual({ lower: 3, upper: 4 });
    expect(parseNtrpLevelRange("")).toEqual({ lower: 3, upper: 3.5 });
    expect(parseNtrpLevelRange("  ,  , ")).toEqual({ lower: 3, upper: 3.5 });
    expect(parseNtrpLevelRange("3.0, , 3.5,")).toEqual({ lower: 3, upper: 3.5 });
  });
});

describe("shared global track coordinates", () => {
  it("maps defaults and extremes onto stable 1..7 percents", () => {
    expect(ntrpLevelVisualPercent(1)).toBe(0);
    expect(ntrpLevelVisualPercent(7)).toBe(100);
    expect(ntrpLevelVisualPercent(3)).toBeCloseTo((2 / 6) * 100, 5);
    expect(ntrpLevelVisualPercent(3.5)).toBeCloseTo((2.5 / 6) * 100, 5);
    // Reported inverted До=3.5 bug was ~13% on a local 3..7 track; global track keeps ~41.7%.
    expect(ntrpLevelVisualPercent(3.5)).toBeGreaterThan(40);
    expect(ntrpLevelVisualPercent(3.5)).toBeLessThan(45);
  });

  it("keeps selected fill independent of the other thumb's native min/max", () => {
    expect(ntrpLevelSelectedFillStyle(3, 3.5)).toEqual({
      left: `${ntrpLevelVisualPercent(3)}%`,
      width: `${ntrpLevelVisualPercent(3.5) - ntrpLevelVisualPercent(3)}%`,
    });
    expect(ntrpLevelSelectedFillStyle(3.5, 3.5)).toEqual({
      left: `${ntrpLevelVisualPercent(3.5)}%`,
      width: "0%",
    });
    expect(ntrpLevelSelectedFillStyle(1, 7)).toEqual({ left: "0%", width: "100%" });
  });
});

describe("GameLevelRange common-track controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one control with От/До handles, summary, and shared track fill", () => {
    const html = renderToStaticMarkup(
      <GameLevelRange value="3.0, 3.5" onChange={() => {}} />,
    );
    expect(html).toContain("Уровни игроков");
    expect(html).toContain("3,0–3,5");
    expect(html).toContain(">От<");
    expect(html).toContain(">До<");
    expect(html.match(/type="range"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Нижний уровень"');
    expect(html).toContain('aria-label="Верхний уровень"');
    expect(html).toContain("gb-game-level-range");
    expect(html).toContain("gb-game-level-range__control");
    expect(html).toContain("gb-game-level-range__rail");
    expect(html).toContain("gb-game-level-range__fill");
    expect(html).toContain('id="level-range-lower"');
    expect(html).toContain('id="level-range-upper"');
    expect(html).toContain(`left:${ntrpLevelVisualPercent(3)}%`);
    expect(html).toContain(
      `width:${ntrpLevelVisualPercent(3.5) - ntrpLevelVisualPercent(3)}%`,
    );
  });

  it("keeps both native inputs on global 1..7 and fires inclusive payloads", () => {
    const seen: string[] = [];
    const tree = GameLevelRange({
      value: "3.0, 3.5",
      onChange: (next) => seen.push(next),
    });
    const ranges = elements(tree).filter(
      (node) => node.type === "input" && node.props.type === "range",
    );
    expect(ranges).toHaveLength(2);
    const lower = ranges[0]!;
    const upper = ranges[1]!;
    expect(lower.props.value).toBe(3);
    expect(upper.props.value).toBe(3.5);
    expect(lower.props.min).toBe(1);
    expect(lower.props.max).toBe(7);
    expect(upper.props.min).toBe(1);
    expect(upper.props.max).toBe(7);
    expect(lower.props.step).toBe(0.5);
    expect(upper.props.step).toBe(0.5);
    expect(lower.props["aria-valuemin"]).toBe(1);
    expect(lower.props["aria-valuemax"]).toBe(7);
    expect(upper.props["aria-valuemin"]).toBe(1);
    expect(upper.props["aria-valuemax"]).toBe(7);
    expect(lower.props["aria-valuenow"]).toBe(3);
    expect(upper.props["aria-valuenow"]).toBe(3.5);
    expect(lower.props["aria-label"]).toBe("Нижний уровень");
    expect(upper.props["aria-label"]).toBe("Верхний уровень");

    (lower.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "2.5" },
    });
    expect(seen.at(-1)).toBe("2.5, 3.0, 3.5");

    (upper.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "5" },
    });
    expect(seen.at(-1)).toBe("3.0, 3.5, 4.0, 4.5, 5.0");

    (lower.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "9" },
    });
    expect(seen.at(-1)).toBe("3.5");

    const before = seen.length;
    (lower.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "NaN" },
    });
    expect(seen.length).toBe(before);
  });

  it("supports Home/End-style extremes and overlapping equal thumbs without trapping", () => {
    const seen: string[] = [];
    const tree = GameLevelRange({
      value: "3.0, 3.5",
      onChange: (next) => seen.push(next),
    });
    const ranges = elements(tree).filter(
      (node) => node.type === "input" && node.props.type === "range",
    );
    const lower = ranges[0]!;
    const upper = ranges[1]!;

    // Native Home / End map to global track extremes; helpers clamp crossing.
    (lower.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "1" },
    });
    expect(seen.at(-1)).toBe(serializeNtrpLevelIds(1, 3.5));

    (upper.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "7" },
    });
    expect(seen.at(-1)).toBe(serializeNtrpLevelIds(3, 7));

    const equalTree = GameLevelRange({
      value: "4.0",
      onChange: () => {},
    });
    const equalHtml = renderToStaticMarkup(equalTree);
    expect(equalHtml).toContain("gb-game-level-range__control--equal");
    const equalRanges = elements(equalTree).filter(
      (node) => node.type === "input" && node.props.type === "range",
    );
    expect(equalRanges[0]!.props.min).toBe(1);
    expect(equalRanges[0]!.props.max).toBe(7);
    expect(equalRanges[0]!.props.value).toBe(4);
    expect(equalRanges[1]!.props.min).toBe(1);
    expect(equalRanges[1]!.props.max).toBe(7);
    expect(equalRanges[1]!.props.value).toBe(4);
    expect(equalRanges[0]!.props["aria-valuenow"]).toBe(4);
    expect(equalRanges[1]!.props["aria-valuenow"]).toBe(4);
    expect(typeof equalRanges[0]!.props.onFocus).toBe("function");
    expect(typeof equalRanges[1]!.props.onFocus).toBe("function");
    expect(typeof equalRanges[0]!.props.onPointerDown).toBe("function");
    expect(typeof equalRanges[1]!.props.onPointerDown).toBe("function");
  });

  it("preserves disabled state on both accessible handles", () => {
    const tree = GameLevelRange({
      value: "3.0, 3.5",
      onChange: () => {},
      disabled: true,
    });
    const ranges = elements(tree).filter(
      (node) => node.type === "input" && node.props.type === "range",
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.props.disabled).toBe(true);
    expect(ranges[1]!.props.disabled).toBe(true);
  });
});
