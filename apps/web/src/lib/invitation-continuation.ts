/** Resume an explicit player → game invitation after the creator publishes a game.
 * A public player UUID is the only carried value: never credentials, proof, or a URL.
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Keep an explicit invite action if a contact already has a conversation. */
export function conversationWithInvitePath(conversationId: string, invite: boolean): string {
  return `/messages?conversation=${encodeURIComponent(conversationId)}${invite ? "&action=invite" : ""}`;
}
