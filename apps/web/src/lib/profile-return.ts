/** Accept only the private conversation route as a public-profile return target. */
export function safeProfileReturnPath(raw: string | null | undefined, fallback = "/players"): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/messages?") || raw.includes("#") || raw.includes("\\")) return fallback;
  try {
    const url = new URL(raw, "https://gobadminton.invalid");
    if (url.origin !== "https://gobadminton.invalid" || url.pathname !== "/messages") return fallback;
    const keys = [...url.searchParams.keys()];
    const conversation = url.searchParams.get("conversation");
    if (keys.length !== 1 || keys[0] !== "conversation" || !conversation || conversation.length > 256) return fallback;
    return `/messages?conversation=${encodeURIComponent(conversation)}`;
  } catch {
    return fallback;
  }
}

export function profileFromConversationPath(playerId: string, conversationId: string): string {
  const returnTo = `/messages?conversation=${encodeURIComponent(conversationId)}`;
  return `/players/${encodeURIComponent(playerId)}?returnTo=${encodeURIComponent(returnTo)}`;
}
