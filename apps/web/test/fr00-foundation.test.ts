import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConsumerShell } from "../src/components/consumer/ConsumerShell";
import { Button } from "../src/components/consumer/Button";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/games" }));

function render(mode: "page" | "local" | "focused" | "document") {
  return renderToStaticMarkup(createElement(ConsumerShell, { mode, active: "games", title: "Игры", children: "Содержание" }));
}

describe("FR-00 production composition", () => {
  it("renders branded ordinary/local/document shells with real roots and footer", () => {
    for (const mode of ["page", "local", "document"] as const) {
      const html = render(mode);
      expect(html).toContain('<main id="gb-main"');
      expect(html).toContain('src="/brand/go-badminton.svg"');
      expect(html).toContain('class="gb-site-footer"');
      expect(html).toContain('class="gb-bottom-nav"');
      for (const href of ["/games", "/players", "/my-games", "/profile"]) expect(html).toContain(`href="${href}"`);
      expect(html).not.toContain('href="#"');
      for (const href of ["/about", "/help", "/legal/terms", "/legal/privacy", "/legal/rules"]) expect(html).toContain(`href="${href}"`);
      expect(html).not.toMatch(/Данные оператора|MVP|GET \/|authority|IR-/);
    }
  });
  it("focused mode retains global context and suppresses footer and bottom nav", () => {
    const html = render("focused");
    expect(html).toContain('class="gb-topbar"');
    expect(html).toContain('gb-shell-content--focused');
    expect(html).not.toContain('class="gb-site-footer"');
    expect(html).not.toContain('class="gb-bottom-nav"');
  });
  it("preserves native form and accessibility props while loading prevents activation", () => {
    const html = renderToStaticMarkup(createElement(Button, { children: "Сохранить", type: "submit", form: "profile", name: "save", "aria-describedby": "help", loading: true }));
    expect(html).toContain('type="submit"');
    expect(html).toContain('form="profile"');
    expect(html).toContain('aria-describedby="help"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('loading="');
    const disabledLink = renderToStaticMarkup(createElement(Button, { children: "Далее", href: "/games", disabled: true }));
    expect(disabledLink).not.toContain('href=');
    expect(disabledLink).toContain('aria-disabled="true"');
  });
});
