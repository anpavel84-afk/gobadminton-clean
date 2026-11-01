"use client";

import { ConsumerShell } from "../ConsumerShell";
import { GameResultsComposition } from "../games/GameResultsComposition";

export function GameResultsPage({ gameId }: { gameId: string }) {
  return (
    <ConsumerShell active="my-games" title="Участники / Итоги" hideHeading>
      <GameResultsComposition gameId={gameId} />
    </ConsumerShell>
  );
}
