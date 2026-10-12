import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

describe("Owner P0 canonical source integration", () => {
  it("does not remove existing live share controls while restoring responsive headings", async () => {
    const css = await readFile(resolve(__dirname, "../src/styles/games.css"), "utf8");
    for (const selector of [
      ".gb-game-share__button",
      ".gb-game-share__notice",
      ".gb-game-share__url",
      ".gb-discovery-card__actions",
      ".gb-game-form-group-title",
    ]) expect(css).toContain(selector);
    expect(css).toContain("top: -12px");
  });
});
