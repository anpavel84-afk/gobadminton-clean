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
    '<path d="M8.466459066 13.604835896 L12.777165335 4.360496468 A1.4 1.4 0 0 0 10.239503532 3.177165335 L5.928797262 12.421504763 A1.4 1.4 0 0 0 8.466459066 13.604835896 Z"></path>',
    '<path d="M16.471572875 9.508326112 L19.3 6.679898987 A1.4 1.4 0 0 0 17.320101013 4.7 L14.491673888 7.528427125 A1.4 1.4 0 0 0 16.471572875 9.508326112 Z"></path>',
    '<path d="M11.578495237 18.071202738 L20.822834665 13.760496468 A1.4 1.4 0 0 0 19.639503532 11.222834665 L10.395164104 15.533540934 A1.4 1.4 0 0 0 11.578495237 18.071202738 Z"></path>',
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
  it.each(["games", "players"] as const)("renders four ordered accessible links and exact decorative SVGs active=%s", active => {
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

// Geometry is parsed exclusively from real SSR, independently of expectedTabs.
type Point = readonly [number, number];
type Edge = readonly [Point, Point];
const EPS = 0.01;
const H = 0.05;
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Point, t: number): Point => [a[0] * t, a[1] * t];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const norm = (a: Point) => Math.hypot(...a);
const lerp = (a: Point, b: Point, t: number) => add(a, mul(sub(b, a), t));
function at<T>(values: readonly T[], i: number): T {
  const value = values[i];
  if (value === undefined) throw new Error(`Missing element ${i}`);
  return value;
}
function pointDistance(p: Point, [a, b]: Edge): number {
  const v = sub(b, a), d = dot(v, v);
  return norm(sub(p, lerp(a, b, d === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), v) / d)))));
}
function edges(points: readonly Point[]): Edge[] {
  return points.slice(1).map((p, i) => [at(points, i), p]);
}
function edgeDistance(a: Edge, b: Edge): number {
  const u = sub(a[1], a[0]), v = sub(b[1], b[0]), w = sub(b[0], a[0]);
  const den = cross(u, v);
  if (den !== 0) {
    const t = cross(w, v) / den, s = cross(w, u) / den;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0;
  }
  return Math.min(pointDistance(a[0], b), pointDistance(a[1], b), pointDistance(b[0], a), pointDistance(b[1], a));
}

// Explicit absolute commands only, with exactly one parameter group per command.
// Adaptive C subdivision bounds both curve-to-chord and chord-to-curve error:
// the convex hull lies in the EPS capsule of the chord; projection is continuous.
function flatten(d: string): Point[] {
  const tokens: string[] = [];
  const scanner = /\s*([MLCAZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gy;
  let offset = 0;
  while (offset < d.length) {
    if (d.slice(offset).trim() === "") break;
    scanner.lastIndex = offset;
    const match = scanner.exec(d);
    if (match === null) throw new Error("Invalid path token");
    tokens.push(required(match[1])); offset = scanner.lastIndex;
  }
  let i = 0;
  const take = () => at(tokens, i++);
  const number = () => {
    const token = take();
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(token)) throw new Error("Expected number");
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Nonfinite number");
    return value;
  };
  const point = (): Point => [number(), number()];
  if (take() !== "M") throw new Error("Expected initial M");
  const start = point(), result: Point[] = [start];
  let current = start, closed = false;
  function line(end: Point) {
    const origin = current, count = Math.max(1, Math.ceil(norm(sub(end, origin)) / H));
    for (let j = 1; j <= count; j++) result.push(lerp(origin, end, j / count));
    current = end;
  }
  function cubic(a: Point, b: Point, c: Point, end: Point) {
    if (Math.max(pointDistance(b, [a, end]), pointDistance(c, [a, end])) <= EPS) { line(end); return; }
    const ab = lerp(a, b, .5), bc = lerp(b, c, .5), ce = lerp(c, end, .5);
    const abc = lerp(ab, bc, .5), bce = lerp(bc, ce, .5), mid = lerp(abc, bce, .5);
    cubic(a, ab, abc, mid); cubic(mid, bce, ce, end);
  }
  while (i < tokens.length) {
    const command = take();
    if (command === "Z") { line(start); closed = true; break; }
    if (command === "L") line(point());
    else if (command === "C") { const a = point(), b = point(), end = point(); cubic(current, a, b, end); }
    else if (command === "A") {
      let rx = number(), ry = number();
      const phi = number() * Math.PI / 180;
      const flag = () => { const t = take(); if (t !== "0" && t !== "1") throw new Error("Invalid arc flag"); return Number(t); };
      const large = flag(), sweep = flag(), end = point();
      if (rx < 0 || ry < 0) throw new Error("Negative radius");
      if (norm(sub(current, end)) === 0) continue;
      if (rx === 0 || ry === 0) { line(end); continue; }
      const co = Math.cos(phi), si = Math.sin(phi), half = mul(sub(current, end), .5);
      const x = co * half[0] + si * half[1], y = -si * half[0] + co * half[1];
      const correction = Math.max(1, Math.hypot(x / rx, y / ry)); rx *= correction; ry *= correction;
      const q = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0,
        (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
      const cx = q * rx * y / ry, cy = -q * ry * x / rx;
      const center = add(lerp(current, end, .5), [co * cx - si * cy, si * cx + co * cy]);
      const a: Point = [(x - cx) / rx, (y - cy) / ry], b: Point = [(-x - cx) / rx, (-y - cy) / ry];
      const theta = Math.atan2(a[1], a[0]);
      let delta = Math.atan2(cross(a, b), dot(a, b));
      if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
      if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
      const radius = Math.max(rx, ry);
      const step = Math.min(Math.PI, 2 * Math.acos(Math.max(-1, 1 - EPS / radius)), H / radius);
      const count = Math.ceil(Math.abs(delta) / step);
      for (let j = 1; j <= count; j++) {
        const t = theta + delta * j / count;
        line(j === count ? end : add(center, [co * rx * Math.cos(t) - si * ry * Math.sin(t), si * rx * Math.cos(t) + co * ry * Math.sin(t)]));
      }
    } else throw new Error("Unexpected command or extra parameters");
  }
  if (!closed || i !== tokens.length || result.length < 3 || result.every(p => norm(sub(p, start)) === 0)) throw new Error("Expected closed nonempty contour");
  return result;
}

const BAND: Edge = [[5.4, 15], [9, 18.6]];
// Split against the capsule of BAND. Collect intersections with both end circles
// and both offset lines, then classify intervals; retain both exterior pieces.
function outside(edge: Edge, band: Edge = BAND, radius = 1.2 - EPS): Edge[] {
  const [a, b] = edge, v = sub(b, a), axis = sub(band[1], band[0]);
  const length = norm(axis), u = mul(axis, 1 / length), n: Point = [-u[1], u[0]];
  const cuts = [0, 1];
  const insert = (t: number) => { if (t > 0 && t < 1) cuts.push(t); };
  for (const center of band) {
    const w = sub(a, center), aa = dot(v, v), bb = 2 * dot(w, v), cc = dot(w, w) - radius * radius;
    const disc = bb * bb - 4 * aa * cc;
    if (aa > 0 && disc >= 0) { insert((-bb - Math.sqrt(disc)) / (2 * aa)); insert((-bb + Math.sqrt(disc)) / (2 * aa)); }
  }
  const vn = dot(v, n);
  if (vn !== 0) for (const sign of [-1, 1]) insert((sign * radius - dot(sub(a, band[0]), n)) / vn);
  cuts.sort((x, y) => x - y);
  return cuts.slice(1).flatMap((t, i) => {
    const s = at(cuts, i);
    return t > s && pointDistance(lerp(a, b, (s + t) / 2), band) > radius
      ? [[lerp(a, b, s), lerp(a, b, t)] as Edge] : [];
  });
}
function directed(points: readonly Point[], target: readonly Edge[]): number {
  return Math.max(...points.map(p => Math.min(...target.map(e => pointDistance(p, e)))));
}
const reflect = (p: Point): Point => [24 - p[1], 24 - p[0]];
const span = (points: readonly Point[], axis: Point) => {
  const values = points.map(p => dot(p, axis)); return Math.max(...values) - Math.min(...values);
};
function ssrContours(): Point[][] {
  const html = renderToStaticMarkup(createElement(NavIcon, { name: "games" }));
  const body = required(html.match(/^<svg\b[^>]*>(.*)<\/svg>$/)?.[1]);
  const paths = [...body.matchAll(/<path d="([^"]+)"><\/path>/g)];
  expect(paths).toHaveLength(4);
  expect(paths.map(p => p[0]).join("")).toBe(body);
  expect(required(at(paths, 0)[1])).toBe("M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z");
  return paths.map(p => flatten(required(p[1])));
}

describe("NAV1b SSR shuttlecock geometry", () => {
  it("satisfies reflection, clearance and envelope gates A3–A5", () => {
    const contours = ssrContours();
    for (const contour of contours) for (const [a, b] of edges(contour)) expect(norm(sub(a, b))).toBeLessThanOrEqual(H + 1e-10);
    for (const [i, j] of [[1, 3], [0, 0], [2, 2]]) {
      if (i === undefined || j === undefined) throw new Error("Missing pair");
      const a = at(contours, i).map(reflect), b = at(contours, j);
      expect(Math.max(directed(a, edges(b)), directed(b, edges(a))) + H / 2 + 2 * EPS).toBeLessThanOrEqual(.6);
    }
    const feathers = contours.slice(1).map(c => edges(c).flatMap(e => outside(e)));
    for (const feather of feathers) expect(feather.length).toBeGreaterThan(0);
    for (const [a, b] of [[0, 1], [1, 2]]) {
      if (a === undefined || b === undefined) throw new Error("Missing pair");
      let distance = Infinity;
      for (const e of at(feathers, a)) for (const f of at(feathers, b)) distance = Math.min(distance, edgeDistance(e, f));
      expect(distance - 2 * EPS).toBeGreaterThanOrEqual(2.6);
    }
    const all = contours.flat();
    for (const p of all) for (const value of p) {
      expect(value).toBeGreaterThanOrEqual(1.5 + EPS); expect(value).toBeLessThanOrEqual(22.5 - EPS);
    }
    for (const axis of [[1, 0], [0, 1]] as const) expect(span(all, axis)).toBeGreaterThanOrEqual(14 + 2 * EPS);
    const u: Point = [Math.SQRT1_2, -Math.SQRT1_2], head = at(contours, 0);
    expect(span(at(contours, 2), u) - 2 * EPS).toBeGreaterThanOrEqual(2.5 * (span(head, u) + 2 * EPS));
    const mean = mul(head.slice(0, -1).reduce<Point>((a, b) => add(a, b), [0, 0]), 1 / (head.length - 1));
    expect(mean[0]).toBeLessThan(9); expect(mean[1]).toBeGreaterThan(15);
    const tips: Point[] = [[12.6, 3], [18.8, 5.2], [21, 11.4]];
    for (let i = 0; i < 3; i++) {
      const contour = at(contours, i + 1), tip = contour.reduce((a, b) => dot(a, u) > dot(b, u) ? a : b);
      const expected = at(tips, i);
      expect(Math.abs(tip[0] - expected[0])).toBeLessThanOrEqual(.6); expect(Math.abs(tip[1] - expected[1])).toBeLessThanOrEqual(.6);
      const angle = (-65 + 20 * i) * Math.PI / 180, normal: Point = [-Math.sin(angle), Math.cos(angle)];
      expect(span(contour, normal)).toBeGreaterThanOrEqual(2.6 + 2 * EPS);
      expect(span(contour, normal)).toBeLessThanOrEqual(3 - 2 * EPS);
    }
  });

  it("fully consumes explicit M/L/C/A/Z and rejects invalid syntax", () => {
    for (const d of ["", "M0 0 Z", "M0 0 L0 0 Z", "M0 0 L1 1", "M0 0 1 1 Z", "M0 0 M1 1 Z", "M0 0 L1 Z", "M0 0 LNaN 1 Z", "M0 0 LInfinity 1 Z", "M0 0 L1e999 1 Z", "M0 0 A1 1 0 2 0 1 1 Z", "M0 0 A1 1 0 0 -1 1 1 Z", "M0 0 A1 1 0 0.0 1 1 1 Z", "M0 0 L1 1 Z junk", "M0 0 L1 1 Z L2 2", "M0 0 L1 1 2 Z", "M0 0 H2 Z"]) expect(() => flatten(d), d).toThrow();
    const line = flatten("M0 0 L1 0 L1 1 Z");
    expect(at(line, 20)).toEqual([1, 0]); expect(at(line, line.length - 1)).toEqual([0, 0]);
    expect(flatten("M0 0 A0 2 0 0 1 1 0 L1 1 Z")).toEqual(line);
    expect(flatten("M0 0 A2 2 30 1 0 0 0 L1 0 L1 1 Z")).toEqual(line);
  });

  it("bounds a bowed cubic against its independent analytic parabola in both directions", () => {
    // Bezier (0,0),(0,4),(4,4),(4,0): x=12t²-8t³, y=12t(1-t).
    const curve = flatten("M0 0 C0 4 4 4 4 0 L0 0 Z");
    const curved = curve.slice(0, curve.findIndex(p => p[0] === 4 && p[1] === 0) + 1);
    const analytic = Array.from({ length: 10001 }, (_, i): Point => { const t = i / 10000; return [12 * t * t - 8 * t * t * t, 12 * t * (1 - t)]; });
    expect(directed(curved, edges(analytic))).toBeLessThanOrEqual(EPS);
    expect(directed(analytic, edges(curved))).toBeLessThanOrEqual(EPS);
    expect(Math.max(...curved.map(p => p[1]))).toBe(3);
  });

  it("bounds a rotated radius-corrected ellipse against an independent analytic reference", () => {
    // Radii 1,.5 must scale by 2; actual ellipse rx=2,ry=1 rotated 45°.
    const k = Math.SQRT1_2;
    const curve = flatten(`M${2*k} ${2*k} A1 .5 45 0 1 ${-2*k} ${-2*k} L${2*k} ${2*k} Z`);
    const endIndex = curve.findIndex(p => p[0] === -2*k && p[1] === -2*k);
    const arc = curve.slice(0, endIndex + 1);
    const analytic = Array.from({ length: 10001 }, (_, i): Point => {
      const t = Math.PI * i / 10000; return [k * (2 * Math.cos(t) - Math.sin(t)), k * (2 * Math.cos(t) + Math.sin(t))];
    });
    expect(directed(arc, edges(analytic))).toBeLessThanOrEqual(EPS);
    expect(directed(analytic, edges(arc))).toBeLessThanOrEqual(EPS);
  });

  it("detects crossing and overlapping segments and preserves both exterior cut pieces", () => {
    expect(edgeDistance([[0, 0], [4, 4]], [[0, 4], [4, 0]])).toBe(0);
    expect(edgeDistance([[0, 0], [4, 0]], [[2, 0], [6, 0]])).toBe(0);
    expect(edgeDistance([[0, 0], [1, 0]], [[2, 0], [4, 0]])).toBe(1);
    const pieces = outside([[-4, 0], [4, 0]], [[-1, 0], [1, 0]], 1);
    expect(pieces).toEqual([[[-4, 0], [-2, 0]], [[2, 0], [4, 0]]]);
    expect(outside([[0, -4], [0, 4]], [[-1, 0], [1, 0]], 1)).toEqual([[[0, -4], [0, -1]], [[0, 1], [0, 4]]]);
    const diagonal = outside([[-4, -4], [4, 4]], [[-1, 0], [1, 0]], 1);
    expect(diagonal).toEqual([[[-4, -4], [-1, -1]], [[1, 1], [4, 4]]]);
  });
});
