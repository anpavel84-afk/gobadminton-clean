import { PlayersDirectoryPage } from "../../components/consumer/pages/PlayersDirectoryPage";
import { parseBrowseView, type PlayerBrowseView } from "../../lib/player-browse";

/** Server-parsed `view` so first paint matches URL (stable header; no list→cards flash). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const viewRaw = params.view;
  const view = typeof viewRaw === "string" ? viewRaw : Array.isArray(viewRaw) ? viewRaw[0] : undefined;
  const initialBrowseView: PlayerBrowseView = parseBrowseView(view ? `?view=${view}` : "");
  return <PlayersDirectoryPage initialBrowseView={initialBrowseView} />;
}
