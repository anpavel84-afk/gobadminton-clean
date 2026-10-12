import { OwnedGameSummaryPage } from "../../../components/consumer/pages/OwnedGameSummaryPage";

export default async function Page({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <OwnedGameSummaryPage gameId={gameId} />;
}
