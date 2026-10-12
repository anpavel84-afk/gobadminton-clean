"use client";

import { useEffect, useRef } from "react";
import styles from "./Games.module.css";
import type { BadgeTone } from "./Badge";
import { Badge } from "./Badge";

export type GamesViewId = "upcoming" | "awaiting" | "history";

export type GamesViewTabsProps = {
  active: GamesViewId;
  onChange: (id: GamesViewId) => void;
};

const tabs: Array<{ id: GamesViewId; label: string }> = [
  { id: "upcoming", label: "Ближайшие" },
  { id: "awaiting", label: "Ожидают решения" },
  { id: "history", label: "История" },
];

export function GamesViewTabs({ active, onChange }: GamesViewTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const selected = root.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div
      ref={listRef}
      className={styles["gb-view-tabs"]}
      role="tablist"
      aria-label="Виды моих игр"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={[
            styles["gb-view-tabs__item"],
            active === tab.id ? styles["gb-view-tabs__item--active"] : null,
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type OwnStatus =
  | "confirmed"
  | "pending"
  | "rejected"
  | "withdrawn"
  | "cancelled"
  | "expired";

const statusCopy: Record<OwnStatus, { label: string; tone: BadgeTone }> = {
  confirmed: { label: "Место подтверждено", tone: "confirmed" },
  pending: { label: "Заявка отправлена", tone: "pending" },
  rejected: { label: "Заявка отклонена", tone: "danger" },
  withdrawn: { label: "Заявка отозвана", tone: "subtle" },
  cancelled: { label: "Игра отменена", tone: "danger" },
  expired: { label: "Срок заявки истёк", tone: "subtle" },
};

export type GameItem = {
  id: string;
  when: string;
  venue: string;
  format: string;
  ownStatus: OwnStatus;
};

export function GameCard({ item }: { item: GameItem }) {
  const status = statusCopy[item.ownStatus];
  return (
    <article className={styles["gb-game-card"]} data-game-id={item.id}>
      <p className={styles["gb-game-card__when"]}>{item.when}</p>
      <h3 className={styles["gb-game-card__venue"]}>{item.venue}</h3>
      <p className={styles["gb-game-card__format"]}>{item.format}</p>
      <Badge tone={status.tone}>{status.label}</Badge>
    </article>
  );
}

export function GameRow({ item }: { item: GameItem }) {
  const status = statusCopy[item.ownStatus];
  return (
    <article className={styles["gb-game-row"]} data-game-id={item.id}>
      <p className={styles["gb-game-row__when"]}>{item.when}</p>
      <div className={styles["gb-game-row__mid"]}>
        <h3 className={styles["gb-game-row__venue"]}>{item.venue}</h3>
        <p className={styles["gb-game-row__format"]}>{item.format}</p>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
    </article>
  );
}

export function GamesList({ items }: { items: GameItem[] }) {
  return (
    <div className={styles["gb-games-list"]}>
      <div className={`${styles["gb-games-list--cards"]} gb-stack gb-stack--md`}>
        {items.map((item) => (
          <GameCard key={`card-${item.id}`} item={item} />
        ))}
      </div>
      <div className={`${styles["gb-games-list--rows"]} gb-stack gb-stack--md`}>
        {items.map((item) => (
          <GameRow key={`row-${item.id}`} item={item} />
        ))}
      </div>
    </div>
  );
}
