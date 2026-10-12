/** Only the public route identifier is shared; current page queries never enter it. */
export function publicGameUrl(origin: string, gameId: string): string {
  return new URL(`/games/${encodeURIComponent(gameId)}`, new URL(origin).origin).href;
}
export type ShareEnvironment = {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};
export type GameShareResult = "shared" | "cancelled" | "fallback" | "copied" | "copy_failed";
export async function copyGameUrl(url: string, environment: ShareEnvironment): Promise<GameShareResult> {
  try {
    if (!environment.clipboard?.writeText) return "copy_failed";
    await environment.clipboard.writeText(url);
    return "copied";
  } catch { return "copy_failed"; }
}
/** Call directly from the user gesture, including standalone/PWA mode. */
export async function shareGameUrl(url: string, environment: ShareEnvironment): Promise<GameShareResult> {
  if (typeof environment.share !== "function") return copyGameUrl(url, environment);
  try { await environment.share({ url }); return "shared"; }
  catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return "cancelled";
    // A failed native share offers an explicit new gesture for clipboard permission.
    return "fallback";
  }
}
