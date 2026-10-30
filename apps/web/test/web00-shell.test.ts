import { describe, expect, it } from "vitest";

async function readSource(...parts: string[]): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.join(__dirname, ...parts), "utf8");
}

describe("WEB-00 frozen production shell", () => {
  it("keeps WEB94 mobile IA separate from desktop primary and header actions", async () => {
    const items = await readSource("../src/components/consumer/nav-items.ts");
    const nav = await readSource("../src/components/consumer/RootNav.tsx");
    expect(items).toContain('export const DESKTOP_NAV_ITEMS');
    expect(items).toContain('export const MOBILE_NAV_ITEMS');
    expect(items).toContain('label: "Сообщения"');
    expect(nav).toContain('<ProfileAction />');
    expect(nav).toContain('href="/profile"');
    expect(nav).toContain('href="/messages"');
    expect(nav).toContain("Меню");
    expect(nav).not.toContain('label: "Профиль"');
  });

  it("uses frozen navigation breakpoints 720 / 1050 instead of 900", async () => {
    const css = await readSource("../src/styles/foundation.css");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("@media (max-width: 1050px)");
    expect(css).toContain("grid-template-columns: repeat(4, 1fr)");
    expect(css).toContain("width: 220px");
  });

  it("exposes explicit page/local/focused shell modes", async () => {
    const shell = await readSource("../src/components/consumer/ConsumerShell.tsx");
    expect(shell).toContain('"page" | "root" | "local" | "focused"');
    expect(shell).toContain('data-shell-mode={surface}');
  });

  it("keeps /players fail-closed honesty without Radar fabrication", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/PlayersDirectoryPage.tsx",
    );
    const route = await readSource("../src/app/players/page.tsx");
    expect(route).toContain("PlayersDirectoryPage");
    expect(page).toContain('data-surface="players-directory"');
    expect(page).toContain("Каталог игроков сейчас недоступен");
    expect(page).toContain("isSocialDirectoryDisabled");
    // Truthful confirmedOn-gated ON/OFF copy is allowed; fabricated radar fields are not.
    expect(page).not.toMatch(/displaySlot|proximityBand/);
    expect(page).not.toMatch(/fake player|fixture players/i);
    expect(page).toMatch(/view\.confirmedOn\s*\?\s*[\s\S]*?Radar включён[\s\S]*?:\s*[\s\S]*?Radar выключен/);
  });

  it("keeps Button frozen variants with compatibility aliases", async () => {
    const button = await readSource("../src/components/consumer/Button.tsx");
    expect(button).toContain('"primary"');
    expect(button).toContain('"dark"');
    expect(button).toContain('"outline"');
    expect(button).toContain('"ghost"');
    expect(button).toContain('if (variant === "secondary") return "outline"');
    expect(button).toContain('if (variant === "quiet") return "ghost"');
  });

  it("delivers Onest 400/500/600/700 through next/font", async () => {
    const layout = await readSource("../src/app/layout.tsx");
    expect(layout).toContain('weight: ["400", "500", "600", "700"]');
    expect(layout).not.toContain('"800"');
  });

  it("uses frozen content max and bottom-nav clearance", async () => {
    const tokens = await readSource("../src/styles/consumer-tokens.css");
    expect(tokens).toContain("--gb-content-max: min(1380px, calc(100% - 64px))");
    expect(tokens).toContain("--gb-bottom-nav-height: 76px");
    expect(tokens).toContain("--gb-shadow-elevated: 0 18px 50px rgba(19, 34, 26, 0.09)");
  });
});
