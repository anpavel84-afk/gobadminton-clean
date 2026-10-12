import { describe, expect, it } from "vitest";
import {
  DISABLED_P_GATES,
  assertNoMutationHandlers,
  demoGames,
  demoProvidersBoth,
} from "../src/fixtures/demo-states";

async function readSource(...parts: string[]): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.join(__dirname, ...parts), "utf8");
}

describe("Player Cabinet frozen UI gates", () => {
  it("lists all P-01–P-07 gates as disabled", () => {
    expect([...DISABLED_P_GATES]).toEqual([
      "P-01",
      "P-02",
      "P-03",
      "P-04",
      "P-05",
      "P-06",
      "P-07",
    ]);
  });

  it("recognizes gated controls and rejects ungated mutation affordances", () => {
    expect(
      assertNoMutationHandlers({
        getAttribute: (name) => (name === "data-gated" ? "P-04" : null),
      }),
    ).toBe(true);

    expect(
      assertNoMutationHandlers({
        getAttribute: () => null,
      }),
    ).toBe(false);
  });

  it("keeps pending and confirmed as distinct own-status fixtures", () => {
    const statuses = new Set(demoGames.upcoming.map((g) => g.ownStatus));
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("confirmed")).toBe(true);
    expect(statuses.has("pending") && statuses.has("confirmed")).toBe(true);
  });

  it("exposes provider visual states without inventing linkage success", () => {
    expect(demoProvidersBoth.vk).toBe("connected");
    expect(demoProvidersBoth.yandex).toBe("connected");
  });

  it("keeps historical provider fixtures gated and routes consumers to canonical settings", async () => {
    const provider = await readSource("../src/components/account/ProviderCard.tsx");
    expect(provider).toContain('gated = "P-04"');
    for (const route of ["providers", "sessions", "deletion"]) {
      const page = await readSource(`../src/app/account/${route}/page.tsx`);
      expect(page).toContain('redirect("/profile/settings")');
      expect(page).not.toMatch(/demo-states|AccountShell/);
    }
  });
});

describe("Frozen layout constants", () => {
  it("matches Design Director fit thresholds", async () => {
    const tokens = await readSource("../src/styles/tokens.css");
    expect(tokens).toContain("--gb-content-max: 1180px");
    expect(tokens).toContain("--gb-sidebar-width: 240px");
    expect(tokens).toContain("--gb-sidebar-gap: 36px");
    expect(tokens).toContain("--gb-main-min-with-sidebar: 600px");
    expect(tokens).toContain("--gb-profile-pair-min: 904px");
    expect(tokens).toContain("--gb-provider-pair-min: 732px");
    expect(tokens).toContain("--gb-form-max: 600px");
    expect(tokens).toContain("--gb-target-min: 44px");
    expect(tokens).toContain("--gb-focus-ring: #f4f7ef");
  });

  it("applies border-box normalization and focus-visible ring (D-04/D-06)", async () => {
    const css = await readSource("../src/styles/account.css");
    expect(css).toContain("box-sizing: border-box");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid var(--gb-focus-ring)");
    expect(css).toContain("outline-offset: 0");
    expect(css).toContain("scroll-margin-block");
  });

  it("keeps My Games tabs horizontally scrollable one-row (D-03)", async () => {
    const css = await readSource("../src/components/account/Games.module.css");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).toContain("min-height: 44px");
  });
});
