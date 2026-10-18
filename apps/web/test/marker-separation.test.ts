import { expect, it } from "vitest";
import { separateMarkerPoints } from "../src/lib/games-venue-map";
it("separates nearby targets deterministically by ID without moving their true point outside the target", () => {
  const points = [{ id: "b", x: 5, y: 0 }, { id: "a", x: 0, y: 0 }];
  const result = separateMarkerPoints(points);
  expect(result).toEqual(separateMarkerPoints([...points].reverse()));
  expect(result).toEqual(separateMarkerPoints(points));
  expect(result.map(p => p.id)).toEqual(["a", "b"]);
  expect(result[0]).not.toMatchObject({ x: result[1]!.x, y: result[1]!.y });
  for (const p of result) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(28);
});
it("leaves isolated points at their true position", () => {
  expect(separateMarkerPoints([{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }]))
    .toEqual([{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }]);
});
it("bounds offsets in a reproducible dense 100-point sample", () => {
  let seed = 86;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const points = Array.from({ length: 100 }, (_, id) => ({ id: String(id), x: random() * 100, y: random() * 100 }));
  for (const p of separateMarkerPoints(points)) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(28);
});
