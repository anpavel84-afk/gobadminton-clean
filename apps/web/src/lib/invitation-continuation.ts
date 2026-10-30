import { venueCreatePath } from "./games-venue-map";

/** Resume an explicit player → game invitation after the creator publishes a game.
 * A public player UUID is the only carried value: never credentials, proof, or a URL.
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Instant fields the invitation chooser shares with server publish/start/deadline gates. */
export type InvitationEligibilityGame = {
  status: string;
  startsAt: string;
  applicationDeadlineAt: string;
};

/**
 * Managed game may be offered for a new invitation only while published, with
 * parseable instants, a strictly future startsAt, and a deadline that has not
 * passed (aligned with invitations.service: now > deadline / now >= start).
 */
export function isGameOpenForInvitation(game: InvitationEligibilityGame, now = Date.now()): boolean {
  return invitationEligibilityBlockReason(game, now) === null;
}

/** Why a game must not be offered or mutated; null means currently open. */
export function invitationEligibilityBlockReason(
  game: InvitationEligibilityGame,
  now = Date.now(),
): "unpublished" | "started" | "deadline" | "invalid" | null {
  const startsAt = Date.parse(game.startsAt);
  const deadlineAt = Date.parse(game.applicationDeadlineAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(deadlineAt)) return "invalid";
  if (game.status !== "published") return "unpublished";
  if (now >= startsAt) return "started";
  if (now > deadlineAt) return "deadline";
  return null;
}

export function invitationEligibilityNotice(
  reason: Exclude<ReturnType<typeof invitationEligibilityBlockReason>, null>,
): string {
  switch (reason) {
    case "unpublished":
      return "Игра больше не опубликована. Обновите список.";
    case "started":
      return "Игра уже началась. Обновите список.";
    case "deadline":
      return "Запись на игру закрыта. Обновите список.";
    case "invalid":
      return "У игры некорректные даты. Обновите список.";
  }
}

/** Earliest instant when any currently-open game would stop being invite-eligible. */
export function nextInvitationEligibilityBoundary(
  games: InvitationEligibilityGame[],
  now = Date.now(),
): number | null {
  let next: number | null = null;
  for (const game of games) {
    if (!isGameOpenForInvitation(game, now)) continue;
    const startsAt = Date.parse(game.startsAt);
    const deadlineAt = Date.parse(game.applicationDeadlineAt);
    for (const at of [startsAt, deadlineAt + 1]) {
      if (Number.isFinite(at) && at > now) next = next == null ? at : Math.min(next, at);
    }
  }
  return next;
}

export function createGameForInvitePath(playerId: string): string {
  return uuid.test(playerId)
    ? `/games/create?invitePlayer=${encodeURIComponent(playerId.toLowerCase())}`
    : "/games/create";
}

export function pendingInviteeFromSearch(search: string): string | null {
  const items = new URLSearchParams(search).getAll("invitePlayer");
  return items.length === 1 && uuid.test(items[0] ?? "")
    ? items[0]!.toLowerCase() : null;
}

/** Authentication/profile-city setup must retain the validated player target.
 * The venue helper deliberately filters unrelated query parameters, so rebuild
 * the minimal safe path with only the previously validated UUID.
 */
export function inviteGameAuthReturnPath(search: string, initialVenueId?: string): string {
  const base = venueCreatePath(initialVenueId === undefined
    ? search : new URLSearchParams({ venueId: initialVenueId }).toString());
  const target = pendingInviteeFromSearch(search);
  if (!target) return base;
  const url = new URL(base, "https://gobadminton.invalid");
  url.searchParams.set("invitePlayer", target);
  return url.pathname + url.search;
}

/** Keep an explicit invite action if a contact already has a conversation. */
export function conversationWithInvitePath(conversationId: string, invite: boolean): string {
  return `/messages?conversation=${encodeURIComponent(conversationId)}${invite ? "&action=invite" : ""}`;
}
