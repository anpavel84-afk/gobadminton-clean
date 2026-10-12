import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = path.resolve(__dirname, "../src/components/consumer/pages/CreateGamePage.tsx");
const cssPath = path.resolve(__dirname, "../src/styles/games.css");

describe("Create Game: responsive headings on cards", () => {
  it("renders the four headings as accessible sections, not fieldset legends", async () => {
    const text = await readFile(pagePath, "utf8");
    const headings = ["Основное", "Место и время", "Для кого", "Условия участия"];
    for (const [index, heading] of headings.entries()) {
      expect(text).toContain(
        `<section className="gb-game-form-group" aria-labelledby="gb-create-game-section-${index + 1}"><h2 id="gb-create-game-section-${index + 1}" className="gb-game-form-group-title">${heading}</h2>`,
      );
    }
    expect((text.match(/<section className="gb-game-form-group"/g) ?? []).length).toBe(4);
    expect((text.match(/<\/div><\/section>/g) ?? []).length).toBe(4);
    expect(text).not.toContain('<fieldset className="gb-game-form-group">');
    expect(text).not.toContain("<legend>");
  });

  it("keeps desktop headings in normal flow and floats labels only on mobile", async () => {
    const css = await readFile(cssPath, "utf8");
    expect(css).toContain(".gb-game-form-group > .gb-game-form-group-title");
    expect(css).toContain("margin: 0 0 18px");
    expect(css).toContain("position: absolute;");
    expect(css).toContain("top: -12px;");
    expect(css).toContain("background: var(--c23-canvas, #f5f6f2);");
    expect(css).not.toContain(".gb-game-form-group legend");
  });
});
