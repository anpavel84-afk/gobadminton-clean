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
    '<path d="M6.7 16.1 11.2 4.4c.7-1.8 2.0-2.3 3.2-1.7 1.3.7 1.5 2.1.7 3.5L9.0 18.2"></path>',
    '<path d="M8.8 17.2 16.5 6.4c1-1.3 2.3-1.6 3.2-.7 1 .9.8 2.2-.4 3.3l-8.1 9.7"></path>',
    '<path d="m10.7 19 8.5-8.3c1.4-1.3 2.8-1.2 3.4-.1.7 1.1.4 2.3-1 3.2l-8.2 6.5"></path>',
    '<path d="M3.8 18.4c.6-1.2 2.0-1.5 3-.6l2.9 2.3c1 .8 1 2.1 0 3-1 .8-2.3.7-3.2-.2l-2.4-2.5c-.6-.6-.8-1.4-.3-2Z"></path>',
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
  it("renders four ordered accessible links and exact decorative SVGs without a provider", () => {
    const html = renderToStaticMarkup(createElement(RootNav, { active: "players" }));
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
      expect(attributes.includes('aria-current="page"')).toBe(tab.href === "/players");
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
