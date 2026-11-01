"use client";

/**
 * Allowed-path participant entry toward PG-1b results.
 * Discoverability also remains on MyGames history notices and PersonalGameCard.
 */
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { resultsPath } from "../../../lib/game-results";

export function MyGameDetailPage({ gameId }: { gameId: string }) {
  return (
    <ConsumerShell active="my-games" title="Моя игра" hideHeading>
      <div className="gb-postgame" data-surface="my-game-results-entry">
        <a className="gb-postgame__back" href="/my-games">← К моим играм</a>
        <h1>Участники / Итоги</h1>
        <p>Собственная отметка, уведомление и запрос исправления доступны в итогах игры.</p>
        <Button href={resultsPath(gameId)}>Открыть итоги</Button>
      </div>
    </ConsumerShell>
  );
}
