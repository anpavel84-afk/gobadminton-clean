import { createElement } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelGuide } from "../src/components/consumer/LevelGuide";
import {
  filterGamesBySelectedNtrpLevel,
  resolveProfileLevelForSave,
} from "../src/lib/level-guide";
import type { LevelRule, SocialLevel } from "../src/lib/consumer-types";

const here = path.dirname(fileURLToPath(import.meta.url));

async function readSource(rel: string) {
  return readFile(path.join(here, rel), "utf8");
}

describe("level-guide #458 page wiring", () => {
  it("ProfilePage uses LevelGuide + resolveProfileLevelForSave and keeps CSRF/expectedVersion Save", async () => {
    const profile = await readSource("../src/components/consumer/pages/ProfilePage.tsx");
    expect(profile).toContain("LevelGuide");
    expect(profile).toContain('surface="profile"');
    expect(profile).toContain("resolveProfileLevelForSave(levelId, social.level)");
    expect(profile).toContain("patchMySocialProfile");
    expect(profile).toContain("expectedVersion: social.version");
    expect(profile).toContain("me.csrfToken");
    expect(profile).not.toContain("pilotSocialLevel(levelId)");
    expect(profile).toContain("Сохранить");
  });

  it("GamesDiscoveryPage derives displayed list and keeps raw loadMore path + map honesty", async () => {
    const page = await readSource("../src/components/consumer/pages/GamesDiscoveryPage.tsx");
    expect(page).toContain("LevelGuide");
    expect(page).toContain('surface="discovery"');
    expect(page).toContain("filterGamesBySelectedNtrpLevel");
    expect(page).toContain("displayedItems");
    expect(page).toContain("levelFilter");
    expect(page).toContain('data-map-filter-honesty="level"');
    expect(page).toContain("LEVEL_GUIDE_MAP_HONESTY");
    expect(page).toContain("loadMore");
    expect(page).toContain("feed.nextCursor");
    expect(page).toContain("из ${items.length} загруженных");
    // No auto-filter from profile social level.
    expect(page).not.toMatch(/setLevelFilter\(social|getMySocialProfile\(\).*levelFilter|levelFilter.*profile\.level/s);
  });

  it("opening help markup does not embed fetch/patch calls", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "profile",
        value: "",
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("<details");
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|patchMySocialProfile/);
  });
});

describe("level-guide save / filter invariants", () => {
  it("does not mutate without explicit profile Save helper result", () => {
    const existing: SocialLevel = {
      scaleId: "ntrp",
      scaleVersion: 1,
      levelId: "2.5",
      provenance: "self_declared",
    };
    // Draft «Не знаю» only — helper returns null; page must still call Save to persist.
    expect(resolveProfileLevelForSave("", existing)).toBeNull();
    // Unchanged id keeps object identity for no-op Save.
    expect(resolveProfileLevelForSave("2.5", existing)).toBe(existing);
  });

  it("filters only exact ntrp membership for discovery raw pages", () => {
    const page = [
      { id: "in", levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["1.0", "1.5"] } satisfies LevelRule },
      { id: "out", levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["7.0"] } satisfies LevelRule },
    ];
    expect(filterGamesBySelectedNtrpLevel(page, "1.0").map((g) => g.id)).toEqual(["in"]);
    expect(filterGamesBySelectedNtrpLevel(page, "").map((g) => g.id)).toEqual(["in", "out"]);
  });
});
