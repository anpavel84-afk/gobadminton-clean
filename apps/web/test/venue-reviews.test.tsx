import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../src/components/consumer/venues");

describe("venue reviews UI contracts", () => {
  it("defaults audience to self_draft and requires unchecked public consent", () => {
    const composer = readFileSync(path.join(root, "VenueReviewComposer.tsx"), "utf8");
    expect(composer).toMatch(/useState<VenueAudience>\("self_draft"\)/);
    expect(composer).toMatch(/setConsent\(false\)/);
    expect(composer).toMatch(/consentProjectionHash/);
    expect(composer).toMatch(/Не удалось подтвердить отправку/);
    expect(composer).toMatch(/Участник игры/);
  });

  it("VenuePage hosts experience panel instead of closed placeholder-only composer", () => {
    const page = readFileSync(path.join(root, "VenuePage.tsx"), "utf8");
    expect(page).toMatch(/VenueReviewsPanel/);
    expect(page).not.toMatch(/напишите комментарий/i);
  });
});
