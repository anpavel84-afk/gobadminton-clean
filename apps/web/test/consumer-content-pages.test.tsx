import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EditorialPage, LegalPage } from "../src/components/consumer/content/ContentPages";
import { CURRENT_APPLICATION_VERSION } from "../src/lib/releases";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/about" }));

describe("content pages reading footer", () => {
  it("keeps editorial/legal reading layout and does not emit a PROD /releases link on SSR", () => {
    const about = renderToStaticMarkup(createElement(EditorialPage));
    expect(about).toContain("О GoBadminton");
    expect(about).toContain("mobile-reading-footer");
    expect(about).toContain('href="/games"');
    expect(about).toContain('href="/legal"');
    expect(about).toContain('href="/help"');
    expect(about).not.toContain('href="/releases"');
    expect(about).toContain(CURRENT_APPLICATION_VERSION);

    const legal = renderToStaticMarkup(createElement(LegalPage, { document: "terms" }));
    expect(legal).toContain("Пользовательское соглашение");
    expect(legal).toContain("Не опубликовано");
    expect(legal).not.toContain('href="/releases"');
  });
});
