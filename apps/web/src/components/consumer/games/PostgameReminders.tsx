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
export function usePostgameReminders(me: Me | null, gameId?: string) {
  const [items, setItems] = useState<PostgameReminder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const owner = useRef<{ id: string; generation: number } | null>(null);

  useEffect(() => {
    if (!me) {
      epoch.current += 1;
      setItems([]);
      setError(null);
      setBusyId(null);
      return;
    }
    setItems([]);
    setError(null);
    setBusyId(null);
    setLoading(true);
    let live = true;
    let releaseView: (() => void) | undefined;
    const request = ++epoch.current;
    const generation = privateViews.currentGeneration;
    owner.current = { id: me.id, generation };
    releaseView = privateViews.retain(generation);
    if (!releaseView) return;

    void listPostgameReminders(20).then((result) => {
      if (!live || request !== epoch.current) return;
      if (generation !== privateViews.currentGeneration) return;
      setLoading(false);
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
      owner.current = null;
      epoch.current += 1;
      setItems([]);
      setBusyId(null);
      setError(null);
      setLoading(false);
      releaseView?.();
      releaseView = undefined;
    };
    const onSession = onExpire;
    window.addEventListener("gb-private-expired", onExpire);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      live = false;
      epoch.current += 1;
      releaseView?.();
      window.removeEventListener("gb-private-expired", onExpire);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, [gameId, me?.id, me?.csrfToken, reload]);

  async function onLater(item: PostgameReminder) {
    if (!me || busyId || !item.allowedActions.canLater || owner.current?.id !== me.id || owner.current.generation !== privateViews.currentGeneration || !privateViews.hasView(privateViews.currentGeneration)) return;
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

  const owned = me && owner.current?.id === me.id && owner.current.generation === privateViews.currentGeneration;
  return { items: owned ? items : [], busyId, error: owned ? error : null, loading, onLater, retry: () => setReload((n) => n + 1) };
}

/** Supplied actions let My Games attach the single loaded reminder source to its game. */
export function PostgameReminderActions({ item, busy, onLater }: {
  item: PostgameReminder;
  busy: boolean;
  onLater: (item: PostgameReminder) => void;
}) {
  return <div className="gb-my-game-subline" data-surface="postgame-reminder" data-reminder-id={item.id}>
    <div><strong>Подведите итоги</strong><p>Укажите исход игры и посещение.</p></div>
    <div className="profile-form-actions">
      {item.allowedActions.canOpenResults ? <Button href={reminderResultsHref(item)}>Подвести итоги</Button> : null}
      {item.allowedActions.canLater ? <Button variant="outline" disabled={busy} onClick={() => onLater(item)}>Позже</Button> : null}
    </div>
  </div>;
}

export function PostgameReminders({ me, gameId }: Props) {
  const reminders = usePostgameReminders(me, gameId);
  if (!me) return null;
  if (reminders.error) return <div className="gb-game-feedback" role="status">
    <p>{reminders.error}</p><Button variant="outline" onClick={reminders.retry}>Обновить напоминания</Button>
  </div>;
  if (!reminders.items.length) return null;
  return <section className="gb-postgame-reminders" data-surface="postgame-reminders" aria-label="Напоминания подвести итоги">
    <h2>Подведите итоги игры</h2>
    <p>После окончания игры укажите, состоялась ли она и кто пришёл. Напоминание сохраняется здесь и не меняет исход само.</p>
    <ul>{reminders.items.map((item) => <li key={item.id}>
      <span className="gb-postgame-reminders__title">{item.gameTitle ?? "Игра"}</span>
      <PostgameReminderActions item={item} busy={Boolean(reminders.busyId)} onLater={(row) => void reminders.onLater(row)} />
    </li>)}</ul>
  </section>;
}
