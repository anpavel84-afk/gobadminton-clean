"use client";

import { useEffect, useState } from "react";
import { getMe } from "../../../lib/api-client";
import type { Me } from "../../../lib/consumer-types";
import { ConsumerShell } from "../ConsumerShell";
import { GameResultsComposition } from "../games/GameResultsComposition";
import { PostgameReminders } from "../games/PostgameReminders";
import "../../../styles/postgame.css";

export function GameResultsPage({ gameId }: { gameId: string }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      void getMe().then((result) => {
        if (!live) return;
        setMe(result.ok ? result.data : null);
      });
    };
    const clear = () => setMe(null);
    window.addEventListener("gb-private-expired", clear);
    window.addEventListener("gb-session-changed", load);
    load();
    return () => {
      live = false;
      window.removeEventListener("gb-private-expired", clear);
      window.removeEventListener("gb-session-changed", load);
    };
  }, []);

  return (
    <ConsumerShell active="my-games" title="Участники / Итоги" hideHeading>
      <PostgameReminders me={me} gameId={gameId} />
      <GameResultsComposition gameId={gameId} />
    </ConsumerShell>
  );
}
