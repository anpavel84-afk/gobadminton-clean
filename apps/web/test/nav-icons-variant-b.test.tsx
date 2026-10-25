import { createElement, type AnchorHTMLAttributes } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InboxBadge, RootNav } from "../src/components/consumer/RootNav";
import { MessageGlyph, NavIcon } from "../src/components/consumer/NavIcon";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

// Independent task-specification fixtures: never read production geometry.
const expectedTabs = [
  { href: "/games", label: "Игры", shapes: [
    '<path d="M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z"></path>',
    '<path d="M5.32 14.92 L10.739503532 3.677165335 A1.4 1.4 0 0 1 13.277165335 4.860496468 L5.32 14.92 Z"></path>',
    '<path d="M7.2 16.8 L16.820101013 5.2 A1.4 1.4 0 0 1 18.8 7.179898987 L7.2 16.8 Z"></path>',
    '<path d="M9.08 18.68 L19.139503532 10.722834665 A1.4 1.4 0 0 1 20.322834665 13.260496468 L9.08 18.68 Z"></path>',
  ] },
  { href: "/players", label: "Игроки", shapes: [
    '<circle cx="8.7" cy="6.7" r="2.65"></circle>',
    '<path d="M3.2 20.4v-1.6c0-3.4 2.25-5.45 5.5-5.45s5.5 2.05 5.5 5.45v1.6"></path>',
    '<path d="M16.8 8.0c1.55.3 2.55 1.54 2.55 3.0s-1 2.72-2.5 3.0"></path>',
    '<path d="M18.1 15.3c2.2.82 3.3 2.3 3.3 5.1"></path>',
  ] },
  { href: "/my-games", label: "Мои игры", shapes: [
    '<path d="M8.2 4.3H5.25A2.25 2.25 0 0 0 3 6.55v13.2A2.25 2.25 0 0 0 5.25 22h13.5A2.25 2.25 0 0 0 21 19.75V6.55a2.25 2.25 0 0 0-2.25-2.25H15.8"></path>',
    '<path d="M9.2 4V3.5a2.8 2.8 0 0 1 5.6 0V4h.9v2.55H8.3V4h.9Z"></path>',
    '<path d="m7.85 14.05 2.7 2.7 5.9-6.1"></path>',
  ] },
  { href: "/messages", label: "Сообщения", shapes: [
    '<path d="M5 3.7h14A3.3 3.3 0 0 1 22.3 7v8.55a3.3 3.3 0 0 1-3.3 3.3H9.75l-4.25 3.0v-3H5a3.3 3.3 0 0 1-3.3-3.3V7A3.3 3.3 0 0 1 5 3.7Z"></path>',
  ] },
];

function required(value: string | undefined): string {
  if (value === undefined) throw new Error("Expected markup capture is missing");
  return value;
}

describe("NAV1 Variant B bottom navigation", () => {
  it.each(["games", "players"] as const)("renders ordered accessible links with %s active", active => {
    const html = renderToStaticMarkup(createElement(RootNav, { active }));
    expect(html).toMatch(/^<nav class="gb-bottom-nav" aria-label="Основная навигация">/);
    expect(html).not.toMatch(/<img\b|gb-message-glyph|gb-message-count/);
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(4);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expectedTabs.forEach((tab, index) => {
      const link = links[index];
      if (link === undefined) throw new Error(`Missing link for ${tab.href}`);
      const attributes = required(link[1]);
      const body = required(link[2]);
      expect(attributes).toContain(`href="${tab.href}"`);
      expect(attributes.includes('aria-current="page"')).toBe(tab.href === `/${active}`);
      expect(body).toContain(`<span>${tab.label}</span>`);
      const icons = [...body.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
      expect(icons).toHaveLength(1);
      const icon = icons[0];
      if (icon === undefined) throw new Error(`Missing SVG for ${tab.href}`);
      const svgAttributes = required(icon[1]);
      const expectedAttributes = {
        class: "gb-nav-icon", viewBox: "0 0 24 24", width: "24", height: "24",
        fill: "none", stroke: "currentColor", "stroke-width": "1.8",
        "stroke-linecap": "round", "stroke-linejoin": "round",
        focusable: "false", "aria-hidden": "true",
      };
      expect(Object.fromEntries([...svgAttributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(
        match => [required(match[1]), required(match[2])],
      ))).toEqual(expectedAttributes);
      expect(svgAttributes).not.toMatch(/\brole=|aria-label=|\btitle=/);
      expect(required(icon[2])).toBe(tab.shapes.join(""));
      expect(body).toBe(`<svg${svgAttributes}>${tab.shapes.join("")}</svg><span>${tab.label}</span>`);
    });
  });

  it("preserves badge SSR, the shared message glyph and profile asset", () => {
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 7 }))).toBe('<b class="gb-message-count" aria-label="7 требуют внимания">7</b>');
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 142 }))).toBe('<b class="gb-message-count" aria-label="142 требуют внимания">99+</b>');
    expect(renderToStaticMarkup(createElement(MessageGlyph))).toBe('<span class="gb-message-glyph" aria-hidden="true"></span>');
    const profile = renderToStaticMarkup(createElement(NavIcon, { name: "profile" }));
    expect(profile).toContain('<img class="gb-nav-icon" src="/brand/profile.svg" alt="" aria-hidden="true"/>');
    expect(profile).not.toContain("<svg");
  });

  it("adds one mobile active-icon circle while preserving layout, underline and safe areas", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/foundation.css"), "utf8");
    const selector = '.gb-bottom-nav a[aria-current="page"] .gb-nav-icon';
    const rule = `${selector} { border-radius: 50%; background-color: var(--gb-lime-soft); box-shadow: 0 0 0 4px var(--gb-lime-soft); }`;
    expect(css.split(selector)).toHaveLength(2);
    expect(css).toContain(rule);
    // Balance braces so a rule moved outside the mobile media block fails.
    const mediaStart = css.indexOf("@media (max-width: 720px)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const opening = css.indexOf("{", mediaStart);
    let depth = 1;
    let end = opening + 1;
    for (; end < css.length && depth > 0; end++) {
      if (css[end] === "{") depth++;
      if (css[end] === "}") depth--;
    }
    expect(depth).toBe(0);
    const mobile = css.slice(opening + 1, end - 1);
    expect(mobile).toContain(rule);
    expect(mobile).toMatch(/\.gb-bottom-nav a\[aria-current="page"\]::after\s*\{[^}]*background: var\(--gb-lime-deep\);/);
    expect(mobile).toContain("grid-template-columns: repeat(4, 1fr)");
    for (const side of ["bottom", "left", "right"]) {
      expect(mobile).toContain(`env(safe-area-inset-${side}, 0px)`);
    }
    expect(mobile).toContain("min-height: 59px");
    expect(mobile).toContain("gap: 7px");
    expect(mobile).toContain("width: clamp(24px, calc(24px + (100vw - 320px) / 27.5), 28px)");
    expect(mobile).toContain("height: clamp(24px, calc(24px + (100vw - 320px) / 27.5), 28px)");
    expect(mobile).toContain('color: var(--gb-ink-soft)');
    expect(mobile).toContain('.gb-bottom-nav a[aria-current="page"] { color: var(--gb-ink); }');
  });
});

// Geometry is measured from SSR, independently of expectedTabs.
type Point = readonly [number, number];
type Edge = readonly [Point, Point];
const epsilon = 0.01, h = 0.05;
function at<T>(xs: readonly T[], i: number): T {
  const value = xs[i];
  if (value === undefined) throw new Error(`Missing item ${i}`);
  return value;
}
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Point, t: number): Point => [a[0] * t, a[1] * t];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const distance = (a: Point, b: Point) => Math.hypot(...sub(a, b));
const lerp = (a: Point, b: Point, t: number) => add(a, scale(sub(b, a), t));
function pointDistance(p: Point, [a, b]: Edge): number {
  const v = sub(b, a), length = dot(v, v);
  return distance(p, lerp(a, b, length === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), v) / length))));
}
function edges(points: readonly Point[]): Edge[] {
  return points.slice(1).map((p, i) => [at(points, i), p]);
}
function edgeDistance(a: Edge, b: Edge): number {
  const v = sub(a[1], a[0]), w = sub(b[1], b[0]), q = sub(b[0], a[0]);
  const det = cross(v, w);
  if (det !== 0) {
    const t = cross(q, w) / det, u = cross(q, v) / det;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointDistance(a[0], b), pointDistance(a[1], b), pointDistance(b[0], a), pointDistance(b[1], a));
}
function flatten(d: string): Point[] {
  // Explicit commands only; no implicit repetitions, relative commands or trailing tokens.
  let offset = 0;
  const token = (pattern: RegExp): string => {
    const match = pattern.exec(d.slice(offset));
    if (match === null) throw new Error(`Invalid path at ${offset}`);
    offset += match[0].length;
    return required(match[1]);
  };
  const numericToken = () => token(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
  const number = () => {
    const value = Number(numericToken());
    if (!Number.isFinite(value)) throw new Error("Nonfinite coordinate");
    return value;
  };
  const flag = () => {
    // Validate spelling before conversion: SVG flags are literal 0 or 1.
    const value = numericToken();
    if (value !== "0" && value !== "1") throw new Error("Invalid arc flag");
    return Number(value);
  };
  const point = (): Point => [number(), number()];
  if (token(/^\s*([MLCAZ])/) !== "M") throw new Error("Expected M");
  const start = point(), result: Point[] = [start];
  let current = start, segments = 0;
  const line = (end: Point) => {
    const count = Math.max(1, Math.ceil(distance(current, end) / h)), origin = current;
    for (let i = 1; i <= count; i++) result.push(lerp(origin, end, i / count));
    current = end;
  };
  const cubic = (a: Point, b: Point, c: Point, end: Point, depth = 0): void => {
    if (depth > 40) throw new Error("Curve subdivision overflow");
    if (Math.max(pointDistance(b, [a, end]), pointDistance(c, [a, end])) <= epsilon) { line(end); return; }
    const ab = lerp(a, b, .5), bc = lerp(b, c, .5), ce = lerp(c, end, .5);
    const abc = lerp(ab, bc, .5), bce = lerp(bc, ce, .5), mid = lerp(abc, bce, .5);
    cubic(a, ab, abc, mid, depth + 1); cubic(mid, bce, ce, end, depth + 1);
  };
  while (true) {
    const command = token(/^\s*([LCAZ])/);
    if (command === "Z") {
      if (segments === 0 || d.slice(offset).trim() !== "") throw new Error("Empty or trailing path");
      line(start); return result;
    }
    segments++;
    if (command === "L") line(point());
    if (command === "C") { const b = point(), c = point(), end = point(); cubic(current, b, c, end); }
    if (command === "A") {
      let rx = number(), ry = number();
      const phi = number() * Math.PI / 180, large = flag(), sweep = flag(), end = point();
      if (rx < 0 || ry < 0 || ![0, 1].includes(large) || ![0, 1].includes(sweep)) throw new Error("Invalid arc");
      if (distance(current, end) === 0) continue;
      if (rx === 0 || ry === 0) { line(end); continue; }
      const cos = Math.cos(phi), sin = Math.sin(phi), delta = scale(sub(current, end), .5);
      const x = cos * delta[0] + sin * delta[1], y = -sin * delta[0] + cos * delta[1];
      const correction = Math.max(1, Math.hypot(x / rx, y / ry)); rx *= correction; ry *= correction;
      const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - (x / rx) ** 2 - (y / ry) ** 2) / ((x / rx) ** 2 + (y / ry) ** 2)));
      const cx = factor * rx * y / ry, cy = -factor * ry * x / rx;
      const center = add(lerp(current, end, .5), [cos * cx - sin * cy, sin * cx + cos * cy]);
      const from: Point = [(x - cx) / rx, (y - cy) / ry], to: Point = [(-x - cx) / rx, (-y - cy) / ry];
      const theta = Math.atan2(from[1], from[0]);
      let angle = Math.atan2(cross(from, to), dot(from, to));
      if (sweep === 0 && angle > 0) angle -= 2 * Math.PI;
      if (sweep === 1 && angle < 0) angle += 2 * Math.PI;
      const radius = Math.max(rx, ry);
      const step = Math.min(Math.PI, 2 * Math.acos(Math.max(-1, 1 - epsilon / radius)), h / radius);
      const count = Math.ceil(Math.abs(angle) / step);
      for (let i = 1; i <= count; i++) {
        const t = theta + angle * i / count;
        result.push(i === count ? end : add(center, [cos * rx * Math.cos(t) - sin * ry * Math.sin(t), sin * rx * Math.cos(t) + cos * ry * Math.sin(t)]));
      }
      current = end;
    }
  }
}

// Exact capsule clipping: split at circle and parallel-side intersections, then classify intervals.
const seam: Edge = [[5.4, 15], [9, 18.6]];
function outside(edge: Edge, boundary: Edge = seam, radius = 1.2 - epsilon): Edge[] {
  const [a, b] = edge, v = sub(b, a), axis = sub(boundary[1], boundary[0]);
  const cuts = [0, 1], length = Math.hypot(...axis), normal: Point = [-axis[1] / length, axis[0] / length];
  const push = (t: number) => { if (t > 0 && t < 1) cuts.push(t); };
  for (const c of boundary) {
    const q = sub(a, c), aa = dot(v, v), bb = 2 * dot(q, v), cc = dot(q, q) - radius ** 2;
    const discriminant = bb * bb - 4 * aa * cc;
    if (aa > 0 && discriminant >= 0) {
      push((-bb - Math.sqrt(discriminant)) / (2 * aa)); push((-bb + Math.sqrt(discriminant)) / (2 * aa));
    }
  }
  const slope = dot(v, normal);
  if (slope !== 0) for (const sign of [-1, 1]) push((sign * radius - dot(sub(a, boundary[0]), normal)) / slope);
  cuts.sort((x, y) => x - y);
  return cuts.slice(1).flatMap((t, i) => {
    const previous = at(cuts, i);
    return t > previous && pointDistance(lerp(a, b, (t + previous) / 2), boundary) > radius
      ? [[lerp(a, b, previous), lerp(a, b, t)] as Edge] : [];
  });
}
function directed(points: readonly Point[], target: readonly Edge[]): number {
  return Math.max(...points.map(p => Math.min(...target.map(e => pointDistance(p, e)))));
}
function span(points: readonly Point[], axis: Point): number {
  const values = points.map(p => dot(p, axis));
  return Math.max(...values) - Math.min(...values);
}
function ssrContours(): string[] {
  const html = renderToStaticMarkup(createElement(NavIcon, { name: "games" }));
  const body = required(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/.exec(html)?.[1]);
  const matches = [...body.matchAll(/<path d="([^"]+)"><\/path>/g)];
  expect(matches).toHaveLength(4);
  expect(matches.map(m => m[0]).join("")).toBe(body);
  return matches.map(m => required(m[1]));
}

describe("NAV1b geometry", () => {
  it("measures the SSR cork and three feathers with conservative error bounds", () => {
    const ds = ssrContours();
    expect(at(ds, 0)).toBe("M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z");
    const contours = ds.map(flatten), head = at(contours, 0), upper = at(contours, 1), middle = at(contours, 2), lower = at(contours, 3);
    const reflect = (p: Point): Point => [24 - p[1], 24 - p[0]];
    for (const [a, b] of [[upper, lower], [head, head], [middle, middle]]) {
      if (a === undefined || b === undefined) throw new Error("Missing symmetry pair");
      expect(Math.max(directed(a.map(reflect), edges(b)), directed(b.map(reflect), edges(a))) + h / 2 + 2 * epsilon).toBeLessThanOrEqual(.6);
    }
    const remaining = [upper, middle, lower].map(p => edges(p).flatMap(e => outside(e)));
    for (const part of remaining) expect(part.length).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) {
      const d = Math.min(...at(remaining, i).map(a => Math.min(...at(remaining, i + 1).map(b => edgeDistance(a, b)))));
      expect(d - 2 * epsilon).toBeGreaterThanOrEqual(2.6);
      expect(d - 2 * epsilon - 1.8).toBeGreaterThanOrEqual(.8);
    }
    const all = contours.flat(), u: Point = [Math.SQRT1_2, -Math.SQRT1_2];
    for (const p of all) for (const value of p) { expect(value).toBeGreaterThanOrEqual(1.5 + epsilon); expect(value).toBeLessThanOrEqual(22.5 - epsilon); }
    for (const axis of [[1, 0], [0, 1]] as const) expect(span(all, axis)).toBeGreaterThanOrEqual(14 + 2 * epsilon);
    expect(span(middle, u) - 2 * epsilon).toBeGreaterThanOrEqual(2.5 * (span(head, u) + 2 * epsilon));
    const uniqueHead = head.slice(0, -1);
    expect(uniqueHead.reduce((sum, p) => sum + p[0], 0) / uniqueHead.length).toBeLessThan(9);
    expect(uniqueHead.reduce((sum, p) => sum + p[1], 0) / uniqueHead.length).toBeGreaterThan(15);
    const tips: Point[] = [[12.6, 3], [18.8, 5.2], [21, 11.4]];
    [upper, middle, lower].forEach((p, i) => {
      const far = p.reduce((a, b) => dot(a, u) > dot(b, u) ? a : b), tip = at(tips, i);
      expect(Math.abs(far[0] - tip[0])).toBeLessThanOrEqual(.6); expect(Math.abs(far[1] - tip[1])).toBeLessThanOrEqual(.6);
      const angle = (-45 + (i - 1) * 20) * Math.PI / 180;
      const width = span(p, [-Math.sin(angle), Math.cos(angle)]);
      expect(width).toBeGreaterThanOrEqual(2.6 + 2 * epsilon); expect(width).toBeLessThanOrEqual(3 - 2 * epsilon);
    });
  });

  it("rejects incomplete paths, implicit commands, garbage, flags and nonfinite numbers", () => {
    for (const d of ["", "M0 0 Z", "M0 0 L1 Z", "M0 0 L1 1 2 2 Z", "M0 0 L1 1 Z junk", "M0 0 M1 1 Z", "M0 0 Q1 1 2 2 Z", "M0 0 LNaN 1 Z", "M0 0 LInfinity 1 Z", "M0 0 L1e999 1 Z", "M0 0 A1 1 0 2 0 2 2 Z", "M0 0 A1 1 0 0 .5 2 2 Z", "M0 0 A1 1 0 0 1 2 Z", "M0 0 L1 1"]) expect(() => flatten(d)).toThrow();
  });
  it("requires literal arc flags in both flag positions", () => {
    for (const invalid of ["0.0", "1.0", ".0", "0.", "1e0", "0E0", "-0", "+1", "-1", "+0", "00", "01", "2", "NaN", "Infinity"]) {
      expect(() => flatten(`M0 0 A1 1 0 ${invalid} 1 2 2 Z`)).toThrow();
      expect(() => flatten(`M0 0 A1 1 0 0 ${invalid} 2 2 Z`)).toThrow();
    }
    expect(() => flatten("M0 0 A1 1 0 -0 +1 2 2 Z")).toThrow();
    for (const large of ["0", "1"]) {
      for (const sweep of ["0", "1"]) {
        expect(() => flatten(`M0 0 A2 2 0 ${large} ${sweep} 2 2 Z`)).not.toThrow();
      }
    }
  });
  it("flattens L/Z exactly and handles degenerate arcs", () => {
    const line = flatten("M0 0 L1 0 Z");
    expect(line.every(p => p[1] === 0)).toBe(true);
    expect(flatten("M0 0 A0 2 30 0 1 1 0 Z")).toEqual(line);
    expect(flatten("M0 0 A2 2 30 0 1 0 0 L1 0 Z")).toEqual(line);
    expect(at(line, line.length - 1)).toEqual([0, 0]);
  });
  it("bounds both directions against independent bowed-cubic and rotated-ellipse equations", () => {
    const cubic = flatten("M0 0 C0 4 4 4 4 0 Z");
    const analyticC: Point[] = Array.from({ length: 4001 }, (_, i) => { const t = i / 4000; return [12 * t * t - 8 * t ** 3, 12 * t * (1 - t)]; });
    analyticC.push([0, 0]);
    const r = Math.SQRT1_2;
    const arc = flatten(`M${3 * r} ${3 * r} A3 1 45 0 1 ${-r} ${r} Z`);
    const analyticA: Point[] = Array.from({ length: 4001 }, (_, i) => { const t = Math.PI / 2 * i / 4000; return [r * (3 * Math.cos(t) - Math.sin(t)), r * (3 * Math.cos(t) + Math.sin(t))]; });
    analyticA.push(at(analyticA, 0));
    for (const [actual, reference] of [[cubic, analyticC], [arc, analyticA]]) {
      if (actual === undefined || reference === undefined) throw new Error("Missing analytic pair");
      expect(directed(actual, edges(reference))).toBeLessThanOrEqual(epsilon);
      expect(directed(reference, edges(actual))).toBeLessThanOrEqual(epsilon);
      for (const [a, b] of edges(actual)) expect(distance(a, b)).toBeLessThanOrEqual(h + 1e-12);
    }
    const corrected = flatten("M0 0 A1 1 0 0 1 4 0 Z");
    expect(Math.min(...corrected.map(p => p[1]))).toBeCloseTo(-2, 2);
  });
  it("detects crossing and overlapping segments and retains both outside parts of a capsule crossing", () => {
    expect(edgeDistance([[0, 0], [4, 4]], [[0, 4], [4, 0]])).toBe(0);
    expect(edgeDistance([[0, 0], [4, 0]], [[2, 0], [6, 0]])).toBe(0);
    const parts = outside([[-3, 0], [5, 0]], [[0, 0], [2, 0]], 1);
    expect(parts).toEqual([[[-3, 0], [-1, 0]], [[3, 0], [5, 0]]]);
    expect(outside([[1, -3], [1, 3]], [[0, 0], [2, 0]], 1)).toEqual([[[1, -3], [1, -1]], [[1, 1], [1, 3]]]);
  });
});
