"use client";
import { useEffect, useRef, useState } from "react";
import { GameCover } from "../games/GameCover";
import { Avatar } from "../players/ProfileComposition";
/* Current venue-approved derivative in the canonical media slot. */
import { GameShare } from "../games/GameShare";
import Link from "next/link";
import type { Game } from "../../../lib/consumer-types";
import { formatSeats, isTrainerLed, settlementTerms } from "../../../lib/game-presentation";
import { discoveryFormat, discoveryGameWhen } from "../../../lib/discovery-presentation";
import { DiscoveryIcon } from "./DiscoveryComposition";

/** Desktop feed: keep max-square media fill; stack when content outgrows the square column.
 * Once stacked for a content/width identity, latch until width or content identity meaningfully changes —
 * do not unstack merely because stacked content became shorter than the row media budget. */
function useFeedCardLayout() {
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"row" | "stacked">("row");
  const latchRef = useRef<{ width: number; identity: string } | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    const content = contentRef.current;
    if (!card || !content || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const contentIdentity = () => {
      const text = (content.textContent ?? "").replace(/\s+/g, " ").trim();
      return `${text.length}:${text.slice(0, 96)}`;
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 720px)").matches) {
          latchRef.current = null;
          setLayout("row");
          return;
        }
        const width = Math.round(card.clientWidth);
        const identity = contentIdentity();
        const mediaBudget = Math.min(300, Math.max(210, Math.floor(width * 0.36)));
        const latch = latchRef.current;
        const widthChanged = !latch || Math.abs(latch.width - width) >= 24;
        const contentChanged = !latch || latch.identity !== identity;
        if (latch && !widthChanged && !contentChanged) {
          setLayout("stacked");
          return;
        }
        if (content.scrollHeight > mediaBudget + 8) {
          latchRef.current = { width, identity };
          setLayout("stacked");
          return;
        }
        latchRef.current = null;
        setLayout("row");
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(content);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return { cardRef, contentRef, layout };
}

export function DiscoveryGameCard({ game }: { game: Game }) {
  const trainer = isTrainerLed(game);
  const host = game.organizer.displayName;
  const when = discoveryGameWhen(game);
  const format = discoveryFormat(game.formatKey);
  const { cardRef, contentRef, layout } = useFeedCardLayout();
  const trainerMarker =
    trainer && game.trainer
      ? `С тренером. Тренер · самостоятельно указано: ${game.trainer.displayName}`
      : trainer
        ? "С тренером"
        : "Обычная игра";
  return <article ref={cardRef} className="gb-discovery-card" data-activity={game.activityKind} data-layout={layout}>
    <div className="gb-discovery-card__image">
      <GameCover game={game} />
      <span className="gb-discovery-type" title={trainer && game.trainer ? `Тренер · самостоятельно указано: ${game.trainer.displayName}` : undefined} aria-label={trainerMarker}>{trainer ? "С тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-discovery-card__content" ref={contentRef}>
      <div className="gb-discovery-card__topline"><span>{when.day}</span><span className="gb-discovery-spots" data-full={game.availablePlaces <= 0 || game.status !== "published"}>{formatSeats(game)}</span></div>
      <time className="gb-discovery-card__time" dateTime={game.startsAt}>{when.time}</time>
      <h3><Link href={`/games/${game.id}`}>{game.title}</Link></h3>
      <p className="gb-discovery-venue">{game.venue.name}</p>
      <p className="gb-discovery-address"><DiscoveryIcon name="pin" />{game.venue.address}</p>
      <div className="gb-discovery-meta"><span>Уровень: {game.levelRule.allowedLevelIds.join(", ")}</span>{format && <span>{format}</span>}</div>
      <p className="gb-discovery-terms">{settlementTerms(game.settlement)}</p>
      <div className="gb-discovery-host">
        <Avatar className="gb-discovery-avatar" name={host} avatar={game.organizer.avatar} />
        <span><small>Организатор</small><strong>{host}</strong></span>
        <div className="gb-discovery-card__actions"><Link className="gb-c23-btn gb-c23-btn--outline" href={`/games/${game.id}`} aria-label={`Подробнее: ${game.title}`}><span>Подробнее</span><DiscoveryIcon name="arrow" /></Link><GameShare gameId={game.id} /></div>
      </div>
    </div>
  </article>;
}
