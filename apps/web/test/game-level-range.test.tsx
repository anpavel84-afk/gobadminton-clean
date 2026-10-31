import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useId: () => "level-range",
  };
});

import { GameLevelRange } from "../src/components/consumer/games/GameLevelRange";
import {
  applyNtrpLevelBoundChange,
  inclusiveNtrpLevelIds,
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

describe("GameLevelRange native controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders От/До ranges, summary, and accessible labels", () => {
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
    expect(html).toContain('id="level-range-lower"');
    expect(html).toContain('id="level-range-upper"');
  });

  it("fires inclusive payload from real native-style onChange callbacks", () => {
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
    expect(lower.props.max).toBe(3.5);
    expect(lower.props["aria-valuemin"]).toBe(1);
    expect(lower.props["aria-valuemax"]).toBe(3.5);
    expect(upper.props.min).toBe(3);
    expect(upper.props.max).toBe(7);
    expect(upper.props["aria-valuemin"]).toBe(3);
    expect(upper.props["aria-valuemax"]).toBe(7);
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

    const equalTree = GameLevelRange({
      value: "4.0",
      onChange: () => {},
    });
    const equalRanges = elements(equalTree).filter(
      (node) => node.type === "input" && node.props.type === "range",
    );
    expect(equalRanges[0]!.props.min).toBe(1);
    expect(equalRanges[0]!.props.max).toBe(4);
    expect(equalRanges[0]!.props["aria-valuemax"]).toBe(4);
    expect(equalRanges[1]!.props.min).toBe(4);
    expect(equalRanges[1]!.props.max).toBe(7);
    expect(equalRanges[1]!.props["aria-valuemin"]).toBe(4);
  });
});
