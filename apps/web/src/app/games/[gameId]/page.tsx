import { GameDetailPage } from "../../../components/consumer/pages/GameDetailPage";

export default async function Page({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameDetailPage gameId={gameId} />;
}
