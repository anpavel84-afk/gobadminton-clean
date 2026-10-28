import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../src/lib/consumer-types";
import {
  hideGameRecommendationPath,
  isRecommendableGame,
  listGameRecommendations,
  recommendableFriends,
  recommendationsUiEnabled,
  resetRecommendationPendingForTests,
  sendGameRecommendationPath,
  withdrawGameRecommendationPath,
} from "../src/lib/game-recommendations";
import { GameRecommendationButton } from "../src/components/consumer/games/GameRecommendationButton";
import { GameRecommendationsSection } from "../src/components/consumer/games/GameRecommendationsSection";
import { GameShare } from "../src/components/consumer/games/GameShare";

vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn(), startAuth: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";

const friend: FriendshipView = {
  friendshipId: "11111111-1111-4111-8111-111111111111",
  relationship: "friends",
  version: "1",
  request: null,
  peer: {
    publicPlayerId: "22222222-2222-4222-8222-222222222222",
    displayName: "Анна К.",
    avatar: { uploadedUrl: null, providerUrl: null },
  },
  capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: true },
};

const me = { id: "actor", csrfToken: "csrf-token" } as Me;

beforeEach(() => {
  vi.clearAllMocks();
  resetRecommendationPendingForTests();
});

describe("FR-3B recommendation types and gates", () => {
  it("honours gameRecommendations:false and only accepted friends with ids", () => {
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: false, gameAttention: false, socialPush: false,
    })).toBe(false);
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: true, gameAttention: false, socialPush: false,
    })).toBe(true);
    expect(recommendableFriends([{ ...friend, relationship: "outgoing_pending" }])).toEqual([]);
    expect(recommendableFriends([{ ...friend, friendshipId: null }])).toEqual([]);
    expect(recommendableFriends([{ ...friend, peer: null }])).toEqual([]);
    expect(recommendableFriends([friend])).toEqual([{
      friendshipId: friend.friendshipId!,
      publicPlayerId: friend.peer!.publicPlayerId,
      displayName: "Анна К.",
    }]);
  });

  it("allows full public future games and rejects private/cancelled/past", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(isRecommendableGame({ status: "published", visibility: "public", startsAt: future })).toBe(true);
    expect(isRecommendableGame({ status: "cancelled", visibility: "public", startsAt: future })).toBe(false);
    expect(isRecommendableGame({ status: "published", visibility: "unlisted", startsAt: future })).toBe(false);
    expect(isRecommendableGame({ status: "published", visibility: "public", startsAt: past })).toBe(false);
    expect(isRecommendableGame({ status: "draft", visibility: "public", startsAt: future })).toBe(false);
  });

  it("uses exact FR-3A paths and list query encoding", async () => {
    expect(sendGameRecommendationPath("g1")).toBe("/v1/games/g1/recommendations");
    expect(hideGameRecommendationPath("r1")).toBe("/v1/me/game-recommendations/r1/hide");
    expect(withdrawGameRecommendationPath("r1")).toBe("/v1/me/game-recommendations/r1/withdraw");
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null, asOf: "2026-10-28T00:00:00.000Z" },
    });
    await listGameRecommendations("sent", "opaque&view=received");
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      "/v1/me/game-recommendations?view=sent&limit=20&cursor=opaque%26view%3Dreceived",
    );
  });

  it("keeps recommend CTA separate from external share without fake invitation copy", () => {
    const html = renderToStaticMarkup(
      <>
        <GameShare gameId="g1" />
        <GameRecommendationButton gameId="g1" me={me} eligible />
      </>,
    );
    expect(html).toContain("Посоветовать другу");
    expect(html).toContain('aria-label="Поделиться игрой"');
    expect(html).not.toContain("Приглашение отправлено");
    expect(html).not.toContain("Место зарезервировано");
  });

  it("omits recommend control when the game is not eligible", () => {
    expect(renderToStaticMarkup(<GameRecommendationButton gameId="g1" me={me} eligible={false} />)).toBe("");
  });

  it("My Games section copy never claims a reserved seat or formal invitation", () => {
    const html = renderToStaticMarkup(<GameRecommendationsSection me={me} />);
    expect(html).toContain("Вам советуют игру");
    expect(html).toContain("не резервирует место");
    expect(html).not.toContain("Место подтверждено");
    expect(html).not.toContain("Приглашение принято");
    expect(html).not.toContain("Поддельный успех");
    expect(html).not.toContain("на сервере");
  });

  it("guest with parent onLogin does not mount a second AuthChooser locally", () => {
    const html = renderToStaticMarkup(
      <GameRecommendationButton gameId="g1" me={null} eligible onLogin={() => undefined} />,
    );
    expect(html).toContain("Посоветовать другу");
    expect(html).not.toContain("profile-dialog");
    expect(html).not.toContain("Войти");
  });
});
