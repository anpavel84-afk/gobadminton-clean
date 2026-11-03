import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("#394 role reputation consumer UI — targeted source checks", () => {
  it("panel/dialog/composer use server handles and never hardcode DEMO 15/20 counts", () => {
    const panel = read("src/components/consumer/games/RoleReputationPanel.tsx");
    const dialog = read("src/components/consumer/games/RoleReviewsDialog.tsx");
    const composer = read("src/components/consumer/games/RoleReviewComposer.tsx");
    const css = read("src/styles/role-reputation.css");
    expect(panel).toContain("getRoleReputation");
    expect(panel).toContain("getGameRoleReputation");
    expect(panel).toContain("publishedReviewCount");
    expect(panel).toContain("heldGamesCount");
    expect(panel).not.toContain("DEMO");
    expect(panel).not.toMatch(/=\s*15\b/);
    expect(panel).not.toMatch(/=\s*20\b/);
    expect(dialog).toContain("publishedRevision");
    expect(dialog).toContain("reportRoleReview");
    expect(dialog).toContain("unknownKeys");
    expect(dialog).toContain("gb-private-expired");
    expect(dialog).toContain("ожидает разбора");
    expect(composer).toContain("getOwnRoleReviewEligibility");
    expect(composer).toContain("consentProjectionHash");
    expect(composer).toContain("setConsent(false)");
    expect(composer).toContain("Организатору лично");
    expect(composer).toContain("audience === \"personal\"");
    expect(composer).not.toContain("компании");
    expect(css).toContain("min-height: 44px");
  });

  it("discovery batches summaries and binds trainer filter without nested link controls", () => {
    const discovery = read("src/components/consumer/pages/GamesDiscoveryPage.tsx");
    const card = read("src/components/consumer/discovery/DiscoveryGameCard.tsx");
    const client = read("src/lib/api-client.ts");
    expect(discovery).toContain("listRoleReputationSummaries");
    expect(discovery).toContain("trainerRoleHandle");
    expect(discovery).toContain("trainer");
    expect(card).toContain("RoleReputationCardActions");
    expect(card).toContain("reputation");
    expect(client).toContain("/v1/role-reputation-summaries");
    expect(client).toContain("trainerRoleHandle");
  });

  it("game detail and public profile expose role panels before join / without inventing skill rating", () => {
    const terms = read("src/components/consumer/games/GameDetailComposition.tsx");
    const profile = read("src/components/consumer/players/PublicPlayerProfile.tsx");
    const feedback = read("src/components/consumer/games/GameFeedbackPanel.tsx");
    expect(terms).toContain("RoleReputationPanel");
    expect(terms).toContain('role="organization"');
    expect(terms).toContain('role="training"');
    expect(profile).toContain("RoleReputationPanel");
    expect(profile).toContain("publicPlayerId");
    expect(feedback).toContain("Организатору лично");
    expect(feedback).toContain("Отправить организатору лично");
    expect(feedback).toContain("не отзыв организации-компании");
  });

  it("own history and UNKNOWN latches stay scope-bound without localStorage credentials", () => {
    const history = read("src/components/consumer/games/RoleReviewsHistory.tsx");
    const composer = read("src/components/consumer/games/RoleReviewComposer.tsx");
    expect(history).toContain("listOwnRoleReviews");
    expect(history).toContain("receiptToken");
    expect(history).toContain("gb-private-expired");
    expect(history).not.toContain("localStorage");
    expect(composer).not.toContain("localStorage");
    expect(composer).not.toContain("document.cookie");
  });
});
