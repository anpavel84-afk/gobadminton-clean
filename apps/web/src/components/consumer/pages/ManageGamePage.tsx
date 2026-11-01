"use client";

/**
 * Allowed-path host for managed-game → results entry.
 * Canonical manage route still uses OwnedGameSummaryPage; this page exposes the
 * PG-1b results CTA without rewriting the unlisted manage host.
 */
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { resultsPath } from "../../../lib/game-results";

export function ManageGamePage({ gameId }: { gameId: string }) {
  return (
    <ConsumerShell active="my-games" title="Управление игрой" hideHeading>
      <div className="gb-postgame" data-surface="manage-game-results-entry">
        <a className="gb-postgame__back" href="/my-games?tab=created">← К управляемым</a>
        <h1>Участники / Итоги</h1>
        <p>Откройте итоги и посещение для этой игры. Управление заявками остаётся на странице управления.</p>
        <div className="gb-postgame__actions">
          <Button href={resultsPath(gameId)}>Открыть итоги</Button>
          <Button variant="outline" href={`/my-games/${gameId}`}>К управлению игрой</Button>
        </div>
      </div>
    </ConsumerShell>
  );
}
