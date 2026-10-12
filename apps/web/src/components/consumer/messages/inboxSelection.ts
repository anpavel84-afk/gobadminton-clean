type InboxTarget = { id: string; kind: "dm" | "request" | "invitation" | "game" };

export function inboxSelection(
  params: Pick<URLSearchParams, "get" | "has">,
  rows: readonly InboxTarget[],
  splitPane: boolean,
) {
  const conversationId = params.get("conversation"), invitationId = params.get("invitation"), gameId = params.get("game");
  // Explicit routes always win, including first-contact and unavailable targets.
  if (["conversation", "invitation", "game", "to"].some(key => params.has(key))) return { conversationId, invitationId, gameId };
  const first = splitPane ? rows[0] : undefined;
  return {
    conversationId: first && first.kind !== "invitation" && first.kind !== "game" ? first.id : null,
    gameId: first?.kind === "game" ? first.id : null,
    invitationId: first?.kind === "invitation" ? first.id : null,
  };
}
