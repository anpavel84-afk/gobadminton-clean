import { notFound } from "next/navigation";
import { GameDetailPage } from "../../../components/consumer/pages/GameDetailPage";

/** Shape accepted by current game API (any generation; uppercase OK). Non-UUID never hits GET /v1/games/:id. */
const GAME_ID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  if (!GAME_ID_UUID.test(gameId)) notFound();
  return <GameDetailPage gameId={gameId} />;
}
