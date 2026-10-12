import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("durable Radar compose default", () => {
  it("sets SOCIAL_RADAR_ENABLED default 1 in source compose without requiring a live apply", () => {
    const compose = readFileSync(
      path.resolve(__dirname, "../../../../infra/compose/docker-compose.yml"),
      "utf8",
    );
    const example = readFileSync(
      path.resolve(__dirname, "../../../../infra/compose/.env.example"),
      "utf8",
    );
    expect(compose).toMatch(/SOCIAL_RADAR_ENABLED:\s*\$\{SOCIAL_RADAR_ENABLED:-1\}/);
    expect(compose).not.toMatch(/SOCIAL_RADAR_ENABLED:\s*\$\{SOCIAL_RADAR_ENABLED:-0\}/);
    expect(example).toContain("SOCIAL_RADAR_ENABLED=1");
  });
});
