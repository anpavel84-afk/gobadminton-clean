import type { FriendshipView, SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import type { Game } from "./consumer-types";
import { apiFetch } from "./api-client";

/** Wire types from accepted FR-3A OpenAPI / GamesService.recommendationSummary — not guessed. */
export type GameRecommendationGame = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type GameRecommendationPeer = {
  publicPlayerId: string;
  displayName: string;
};

export type GameRecommendation = {
  id: string;
  version: number;
  state: "active" | "withdrawn";
  createdAt: string;
  expiresAt: string;
  game: GameRecommendationGame;
  peer: GameRecommendationPeer;
};

export type GameRecommendationList = {
  items: GameRecommendation[];
  nextCursor: string | null;
  asOf: string;
};

export type GameRecommendationReceipt = {
  id: string;
  version: number;
  outcome: "sent" | "hidden" | "withdrawn";
};

export type GameRecommendationView = "received" | "sent";

export type RecommendableFriend = {
  friendshipId: string;
  publicPlayerId: string;
  displayName: string;
};

/** Product UI stays off while server keeps gameRecommendations:false (FR-3A). Do not override. */
export function recommendationsUiEnabled(capabilities: SocialCapabilities | null | undefined): boolean {
  return Boolean(capabilities?.gameRecommendations);
}

/**
 * Detail eligibility aligned with recommendationSummary: published public upcoming.
 * Full / deadline-closed games remain recommendable; cancelled/past/private are not.
 */
export function isRecommendableGame(game: Pick<Game, "status" | "visibility" | "startsAt">, now = Date.now()): boolean {
  if (game.status !== "published" || game.visibility !== "public") return false;
  const starts = Date.parse(game.startsAt);
  return Number.isFinite(starts) && starts > now;
}

/** Accepted friends with a server friendship id and visible peer only. */
export function recommendableFriends(items: FriendshipView[]): RecommendableFriend[] {
  const out: RecommendableFriend[] = [];
  for (const view of items) {
    if (view.relationship !== "friends" || !view.friendshipId || !view.peer) continue;
    out.push({
      friendshipId: view.friendshipId,
      publicPlayerId: view.peer.publicPlayerId,
      displayName: view.peer.displayName,
    });
  }
  return out;
}

export function listGameRecommendations(view: GameRecommendationView, cursor: string | null = null, limit = 20) {
  const query = new URLSearchParams({ view, limit: String(Math.min(20, Math.max(1, limit))) });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<GameRecommendationList>(`/v1/me/game-recommendations?${query}`);
}

export function sendGameRecommendationPath(gameId: string) {
  return `/v1/games/${encodeURIComponent(gameId)}/recommendations`;
}

export function hideGameRecommendationPath(id: string) {
  return `/v1/me/game-recommendations/${encodeURIComponent(id)}/hide`;
}

export function withdrawGameRecommendationPath(id: string) {
  return `/v1/me/game-recommendations/${encodeURIComponent(id)}/withdraw`;
}

export function formatRecommendationWhen(game: GameRecommendationGame, locale = "ru-RU"): string {
  const start = new Date(game.startsAt);
  return new Intl.DateTimeFormat(locale, {
    timeZone: game.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
}
