import { PlayersDirectoryPage } from "../../components/consumer/pages/PlayersDirectoryPage";
import type { PlayerBrowseView } from "../../lib/player-browse";

/** Server-parsed `view` so first paint matches URL (stable header; no list→cards flash). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const viewRaw = params.view;
  // Next already decodes searchParams; compare the value directly (do not re-embed into `?view=`).
  const view = typeof viewRaw === "string" ? viewRaw : Array.isArray(viewRaw) ? viewRaw[0] : undefined;
  const initialBrowseView: PlayerBrowseView = view === "cards" ? "cards" : "list";
  return <PlayersDirectoryPage initialBrowseView={initialBrowseView} />;
}
