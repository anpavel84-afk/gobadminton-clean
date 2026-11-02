import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin Cases · private peer review report source UI", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/components/Cases.tsx"),
    "utf8",
  );

  it("wires assigned review-reports source read and clears sensitive payload", () => {
    expect(source).toContain("review-reports/");
    expect(source).toContain("Открыть источник отзыва");
    expect(source).toContain("setReviewSource(null)");
    expect(source).toContain("game_review");
    expect(source).toContain("Текст");
    expect(source).toContain("Версия");
    expect(source).not.toContain("JSON.stringify(reviewSource)");
    expect(source).toMatch(/401,403,404/);
    expect(source).toContain("if(!fresh)");
  });
});
