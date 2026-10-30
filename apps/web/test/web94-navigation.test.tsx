import { createElement, type AnchorHTMLAttributes } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_NAV_ITEMS, MOBILE_NAV_ITEMS } from "../src/components/consumer/nav-items";
import { InboxBadge, RootNav } from "../src/components/consumer/RootNav";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

describe("WEB94 responsive consumer navigation", () => {
  it("keeps the four mobile sections and desktop primary sections separate", () => {
    expect(MOBILE_NAV_ITEMS.map(item => [item.label, item.href])).toEqual([
      ["Игры", "/games"], ["Игроки", "/players"], ["Мои игры", "/my-games"], ["Сообщения", "/messages"],
    ]);
    expect(DESKTOP_NAV_ITEMS.map(item => item.label)).toEqual(["Игры", "Игроки", "Мои игры"]);
    expect(DESKTOP_NAV_ITEMS.some(item => item.id === "profile" || item.id === "messages")).toBe(false);
  });

  it("marks Messages active in the bottom navigation and never adds a Profile tab", () => {
    const html = renderToStaticMarkup(createElement(RootNav, { active: "messages" }));
    expect(html).toContain('href="/messages" aria-current="page"');
    expect(html).toContain("Сообщения");
    expect(html).not.toContain("Профиль");
    expect((html.match(/<a\b/g) ?? [])).toHaveLength(4);
  });

  it("preserves unread count semantics and the capped display", () => {
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 7 }))).toContain('aria-label="7 требуют внимания">7</b>');
    expect(renderToStaticMarkup(createElement(InboxBadge, { count: 142 }))).toContain('aria-label="142 требуют внимания">99+</b>');
  });

  it("keeps the canonical 720px split, four-column mobile layout and safe-area padding", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/foundation.css"), "utf8");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("grid-template-columns: repeat(4, 1fr)");
    expect(css).toContain("env(safe-area-inset-bottom, 0px)");
    expect(css).toContain("env(safe-area-inset-left, 0px)");
    expect(css).toContain("env(safe-area-inset-right, 0px)");
  });

  it("reserves bottom navigation space for a selected mobile conversation", () => {
    const messagesCss = readFileSync(resolve(process.cwd(), "src/styles/messages.css"), "utf8");
    const foundationCss = readFileSync(resolve(process.cwd(), "src/styles/foundation.css"), "utf8");
    const mobileMessages = messagesCss.slice(messagesCss.indexOf("@media (max-width: 720px)"));

    expect(foundationCss).toContain(".gb-app-shell--focused { height: 100dvh;");
    expect(foundationCss).toContain(".gb-shell-content--focused { width: 100%; min-height: 0; flex: 1;");
    expect(mobileMessages).toContain(".gb-shell-content--focused .fr4.messages-page");
    expect(mobileMessages).toContain("padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));");
    expect(mobileMessages).toMatch(/\.gb-shell-content--focused \.fr4\.messages-page \{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*margin:\s*0;/s);
    expect(mobileMessages).toContain(".fr4.show-conversation .conversation-panel { display: flex; flex: 1; min-height: 0; }");
    expect(messagesCss).not.toContain(".fr4.messages-page.show-conversation { margin-bottom: calc(76px + env(safe-area-inset-bottom)); }");
  });
});
