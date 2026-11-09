import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const discovery = readFileSync(new URL("../src/styles/discovery.css", import.meta.url), "utf8");
const games = readFileSync(new URL("../src/styles/games.css", import.meta.url), "utf8");
const consumer = readFileSync(new URL("../src/styles/consumer.css", import.meta.url), "utf8");

describe("FB01 mobile card footer and profile dialog close control", () => {
  it("keeps organizer identity and both normal-size actions in one row at phone widths", () => {
    // #521 D2: copy lives under role button as `.gb-discovery-host__copy`, not nth-child(2) span.
    expect(discovery).toMatch(/\.gb-discovery-host__copy\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 0/);
    // Shared CardActions CTA (ordinary + trainer): flex:none beside host/people copy.
    expect(discovery).toMatch(/\.gb-consumer\s+\.gb-discovery-card__actions\s+\.gb-c23-btn\s*\{[^}]*flex:\s*none/);
    // ≤720: same 44px icon-only arrow for ordinary and trainer.
    expect(discovery).toMatch(/\.gb-consumer\s+\.gb-discovery-card__actions\s+\.gb-c23-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
    expect(games).toMatch(/@media\s*\(max-width:\s*500px\)\s*\{\s*\.gb-discovery-host\s*\{\s*flex-wrap:\s*nowrap/);
    expect(games).toMatch(/\.gb-discovery-card__actions\s*\{[^}]*width:\s*auto/);
    expect(games).toMatch(/\.gb-game-share__button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  });

  it("makes the profile dialog close button a centered 44px circle with normal hit area", () => {
    expect(consumer).toMatch(/button\.gb-close-button\.gb-close-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*padding:\s*0;[^}]*border-radius:\s*50%/);
  });
});
