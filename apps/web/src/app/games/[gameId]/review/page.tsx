import { ParticipationReviewPage } from "../../../../components/consumer/pages/ParticipationReviewPage";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const { gameId } = await params;
  const { intent } = await searchParams;
  return (
    <ParticipationReviewPage
      gameId={gameId}
      intent={intent === "refuse" ? "refuse" : "withdraw"}
    />
  );
}
