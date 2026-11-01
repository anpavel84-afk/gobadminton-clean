import { GameResultsPage } from "../../../../components/consumer/pages/GameResultsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameResultsPage gameId={gameId} />;
}
