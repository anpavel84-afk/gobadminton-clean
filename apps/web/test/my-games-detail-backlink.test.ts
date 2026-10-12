import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentDir = path.resolve(
  __dirname,
  "../src/components/consumer/pages",
);

describe("Owner breadcrumb correction · My Games managed detail", () => {
  it("uses the same ghost breadcrumb family as the normal Game detail", async () => {
    const [owned, gameDetail] = await Promise.all([
      readFile(path.join(componentDir, "OwnedGameSummaryPage.tsx"), "utf8"),
      readFile(path.join(componentDir, "GameDetailPage.tsx"), "utf8"),
    ]);

    expect(gameDetail).toContain(
      '<Button variant="ghost" className="gb-game-back" href="/games">',
    );
    expect(owned).toContain(
      '<Button variant="ghost" className="gb-game-back" href="/my-games?tab=created">',
    );
    expect(owned).toContain("← Мои игры");
    expect(owned).not.toContain('className="gb-c23-back"');
    expect(owned).not.toContain("← Назад");
    expect(owned).not.toContain("useRouter");
  });

  it("retains My Games navigation and applicant management behavior", async () => {
    const owned = await readFile(
      path.join(componentDir, "OwnedGameSummaryPage.tsx"),
      "utf8",
    );
    expect(owned).toContain('active="my-games"');
    expect(owned).toContain('href="/my-games?tab=created"');
    expect(owned).toContain("<ManagerApplicants");
    expect(owned).toContain("onAction={(action, item, reason)");
  });
});
