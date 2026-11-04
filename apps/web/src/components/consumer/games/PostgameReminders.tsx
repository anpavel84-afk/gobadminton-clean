"use client";

import { useEffect, useRef, useState } from "react";
import {
  laterPostgameReminder,
  listPostgameReminders,
  reminderResultsHref,
} from "../../../lib/game-reminders";
import type { Me, PostgameReminder } from "../../../lib/consumer-types";
import { privateViews } from "../../../lib/private-view";
import { Button } from "../Button";

type Props = {
  me: Me | null;
  /** Optional single-game filter for results screen. */
  gameId?: string;
};

/**
 * Compact in-app organizer notices. Reuses My Games / Results routes —
 * no new Postgame flow and no ConsumerShell hook.
 */
export function PostgameReminders({ me, gameId }: Props) {
  const [items, setItems] = useState<PostgameReminder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    if (!me) {
      epoch.current += 1;
      setItems([]);
      setError(null);
      setBusyId(null);
      return;
    }
    let live = true;
    let releaseView: (() => void) | undefined;
    const request = ++epoch.current;
    const generation = privateViews.currentGeneration;
    releaseView = privateViews.retain(generation);
    if (!releaseView) return;

    void listPostgameReminders(20).then((result) => {
      if (!live || request !== epoch.current) return;
      if (generation !== privateViews.currentGeneration) return;
      if (!result.ok) {
        if (result.status === 401) {
          setItems([]);
          return;
        }
        setError("Не удалось загрузить напоминания");
        return;
      }
      const next = result.data.items.filter((item) =>
        gameId ? item.gameId === gameId : true,
      );
      setItems(next);
      setError(null);
    });

    const onExpire = () => {
      epoch.current += 1;
      setItems([]);
      setBusyId(null);
      setError(null);
      releaseView?.();
      releaseView = undefined;
    };
    const onSession = () => {
      epoch.current += 1;
      setItems([]);
    };
    window.addEventListener("gb-private-expired", onExpire);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      live = false;
      epoch.current += 1;
      releaseView?.();
      window.removeEventListener("gb-private-expired", onExpire);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, [me, gameId, me?.id, me?.csrfToken]);

  async function onLater(item: PostgameReminder) {
    if (!me || busyId || !item.allowedActions.canLater) return;
    const request = epoch.current;
    const generation = privateViews.currentGeneration;
    setBusyId(item.id);
    setError(null);
    const result = await laterPostgameReminder(item.id, item.version, me.csrfToken);
    if (request !== epoch.current || generation !== privateViews.currentGeneration) return;
    setBusyId(null);
    if (!result.ok) {
      if (result.status === 401) {
        setItems([]);
        return;
      }
      setError("Не удалось отложить напоминание");
      return;
    }
    const next = result.data.items.filter((row) => (gameId ? row.gameId === gameId : true));
    setItems(next);
  }

  if (!me || items.length === 0) return null;

  return (
    <section
      className="gb-postgame-reminders"
      data-surface="postgame-reminders"
      aria-label="Напоминания подвести итоги"
    >
      <h2>Подведите итоги игры</h2>
      <p>
        После окончания игры укажите, состоялась ли она и кто пришёл. Напоминание
        сохраняется здесь и не меняет исход само.
      </p>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item.id}>
            <span className="gb-postgame-reminders__title">
              {item.gameTitle ?? "Игра"}
            </span>
            <div className="gb-postgame-reminders__actions">
              <Button variant="primary" href={reminderResultsHref(item)}>
                Подвести итоги
              </Button>
              {item.allowedActions.canLater ? (
                <Button
                  variant="outline"
                  disabled={busyId === item.id}
                  onClick={() => void onLater(item)}
                >
                  Позже
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="gb-game-helper">{error}</p> : null}
    </section>
  );
}
