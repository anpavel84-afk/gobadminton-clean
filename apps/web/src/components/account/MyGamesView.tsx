"use client";

import { useMemo, useState } from "react";
import { AccountShell } from "./AccountShell";
import { GamesList, GamesViewTabs, type GamesViewId } from "./Games";
import { LinkButton } from "./LinkButton";
import { Notice } from "./Notice";
import { demoGames } from "../../fixtures/demo-states";

export function MyGamesView({
  initialView = "upcoming",
  forceEmpty = false,
}: {
  initialView?: GamesViewId;
  forceEmpty?: boolean;
}) {
  const [view, setView] = useState<GamesViewId>(initialView);

  const items = useMemo(() => {
    if (forceEmpty) return [];
    if (view === "awaiting") return demoGames.awaiting;
    if (view === "history") return demoGames.history;
    return demoGames.upcoming;
  }, [view, forceEmpty]);

  return (
    <AccountShell title="Мои игры" globalActive="games" localActive="games">
      <GamesViewTabs active={view} onChange={setView} />

      {view === "awaiting" && demoGames.awaitingIntro ? (
        <p className="gb-type-body" style={{ color: "var(--gb-text-secondary)" }}>
          {demoGames.awaitingIntro}
        </p>
      ) : null}

      {view === "history" && demoGames.historyDisclaimer ? (
        <Notice tone="neutral" title="О истории" body={demoGames.historyDisclaimer} />
      ) : null}

      {view === "upcoming" && demoGames.cancelledNotice ? (
        <Notice
          tone="danger"
          title={demoGames.cancelledNotice.title}
          body={demoGames.cancelledNotice.body}
        />
      ) : null}

      {items.length === 0 ? (
        <div className="gb-stack gb-stack--md">
          <Notice
            tone="neutral"
            title="Нет заявок, ожидающих решения"
            body="Пуст только выбранный вид. Это не означает, что в аккаунте нет игр."
          />
          <LinkButton href="/account/games" variant="secondary">
            К ближайшим играм
          </LinkButton>
        </div>
      ) : (
        <GamesList items={items} />
      )}

      <p className="gb-gated-note">
        Визуальная композиция My Games. pending ≠ confirmed; статусы не означают оплату или
        присутствие.
      </p>
    </AccountShell>
  );
}
