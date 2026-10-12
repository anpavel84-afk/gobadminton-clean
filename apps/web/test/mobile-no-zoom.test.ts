import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { viewport } from "../src/app/layout";

vi.mock("next/font/google", () => ({ Onest: () => ({ variable: "font-onest", className: "onest" }) }));
vi.mock("../src/components/consumer/ViewportLock", () => ({ ViewportLock: () => null }));

describe("mobile/PWA no-zoom contract", () => {
  it("disables pinch, double-tap, and manual viewport zoom", () => {
    expect(viewport.maximumScale).toBe(1);
    expect(viewport.minimumScale).toBe(1);
    expect(viewport.userScalable).toBe(false);
  });

  it("floors mobile form and button type at 16px with pan-only touch", () => {
    const css = readFileSync(new URL("../src/styles/mobile-controls.css", import.meta.url), "utf8");
    expect(css).toContain("touch-action: pan-x pan-y");
    expect(css).toContain("font-size: 16px !important");
    expect(css).toContain("min-height: 44px !important");
    expect(css).toContain("input, select, textarea, button, .gb-c23-btn");
  });
});
