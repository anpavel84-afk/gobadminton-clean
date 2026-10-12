import { ConsumerShell } from "../ConsumerShell";

/**
 * Fail-closed / unavailable presentation for social directory.
 * WEB-02 primary route uses PlayersDirectoryPage; this remains a reusable shell
 * for honest gated copy when directory exposure is denied.
 */
export function PlayersGatedPage() {
  return (
    <ConsumerShell active="players" title="Игроки">
      <section className="gb-c23-sheet gb-players-gated" data-state="unavailable" data-gated="players">
        <p className="gb-players-gated__eyebrow">Игровое сообщество</p>
        <h2>Каталог игроков сейчас недоступен</h2>
        <p>Сейчас поиск игроков недоступен. Попробуйте вернуться позже.</p>
      </section>
    </ConsumerShell>
  );
}
