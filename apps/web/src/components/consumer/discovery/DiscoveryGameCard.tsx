"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { GameCover } from "../games/GameCover";
import { Avatar } from "../players/ProfileComposition";
/* Current venue-approved derivative in the canonical media slot. */
import { GameShare } from "../games/GameShare";
import {
  RoleReputationCardActions,
  type RoleReputationCompactView,
} from "../games/RoleReputationPanel";
import Link from "next/link";
import type { Game, GameRoleReputationCard } from "../../../lib/consumer-types";
import { formatSeats, isTrainerLed, settlementTerms } from "../../../lib/game-presentation";
import { discoveryFormat, discoveryGameWhen } from "../../../lib/discovery-presentation";
import { DiscoveryIcon } from "./DiscoveryComposition";

/** Trainer profileId and organizer.id are different namespaces.
 * No confirmed common person key exists in the allowed contract, so roles are
 * always rendered separately — never merged by id equality or displayName. */

function CardActions({ gameId, title }: { gameId: string; title: string }) {
  return (
    <div className="gb-discovery-card__actions">
      <Link
        className="gb-c23-btn gb-c23-btn--outline"
        href={`/games/${gameId}`}
        aria-label={`Подробнее: ${title}`}
      >
        <span>Подробнее</span>
        <DiscoveryIcon name="arrow" />
      </Link>
      <GameShare gameId={gameId} />
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="gb-discovery-card__disclosure-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function reviewButtonLabel(count: number): string {
  return count > 0 ? `Отзывы · ${count}` : "Отзывы";
}

export function DiscoveryGameCard({
  game,
  reputation,
}: {
  game: Game;
  /** Batched server card summary — never client-counted. */
  reputation?: GameRoleReputationCard | null;
}) {
  const trainer = isTrainerLed(game);
  const host = game.organizer.displayName;
  const when = discoveryGameWhen(game);
  const format = discoveryFormat(game.formatKey);
  const trainerMarker =
    trainer && game.trainer
      ? `С тренером. Тренер · ${game.trainer.displayName}`
      : trainer
        ? "С тренером. Профиль тренера недоступен"
        : "Обычная игра";
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  return <article className="gb-discovery-card" data-activity={game.activityKind}>
    <div className="gb-discovery-card__image">
      <GameCover game={game} />
      <span className="gb-discovery-type" title={trainer && game.trainer ? `Тренер · ${game.trainer.displayName}` : undefined} aria-label={trainerMarker}>{trainer ? "С тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-discovery-card__content">
      <div className="gb-discovery-card__topline"><span>{when.day}</span><span className="gb-discovery-spots" data-full={game.availablePlaces <= 0 || game.status !== "published"}>{formatSeats(game)}</span></div>
      <time className="gb-discovery-card__time" dateTime={game.startsAt}>{when.time}</time>
      <h3><Link href={`/games/${game.id}`}>{game.title}</Link></h3>
      <p className="gb-discovery-venue">{game.venue.name}</p>
      <p className="gb-discovery-address"><DiscoveryIcon name="pin" />{game.venue.address}</p>
      <div className="gb-discovery-meta"><span>Уровень: {game.levelRule.allowedLevelIds.join(", ")}</span>{format && <span>{format}</span>}</div>
      <p className="gb-discovery-terms">{settlementTerms(game.settlement)}</p>
      {!trainer ? (
        <>
          <div
            className="gb-discovery-host"
            data-role="organizer"
            data-organizer-id={game.organizer.id ?? undefined}
          >
            <Avatar className="gb-discovery-avatar" name={host} avatar={game.organizer.avatar} />
            <span className="gb-discovery-host__copy">
              <small>Организатор</small>
              <strong>{host}</strong>
            </span>
            <CardActions gameId={game.id} title={game.title} />
          </div>
          {reputation ? (
            <RoleReputationCardActions
              gameId={game.id}
              organization={reputation.organization}
              training={reputation.training}
              trainerName={game.trainer?.displayName}
              organizerName={host}
            />
          ) : null}
        </>
      ) : null}
    </div>
    {trainer ? (
      <RoleReputationCardActions
        gameId={game.id}
        organization={reputation?.organization}
        training={reputation?.training}
        trainerName={game.trainer?.displayName}
        organizerName={host}
        renderCompact={(view) => {
          const showDetails = expanded || view.dialogOpen;
          return (
            <TrainerPeopleBand
              game={game}
              host={host}
              view={view}
              detailsId={detailsId}
              expanded={showDetails}
              toggleRef={toggleRef}
              detailsRef={detailsRef}
              onToggle={() => {
                if (showDetails) {
                  if (view.dialogOpen) {
                    // Keep region mounted while a review modal is open so Escape
                    // can restore focus to the exact review trigger.
                    setExpanded(false);
                    return;
                  }
                  const active = document.activeElement;
                  if (active instanceof HTMLElement && detailsRef.current?.contains(active)) {
                    toggleRef.current?.focus({ preventScroll: true });
                  }
                  setExpanded(false);
                  return;
                }
                setExpanded(true);
              }}
            />
          );
        }}
      />
    ) : null}
  </article>;
}

function TrainerPeopleBand({
  game,
  host,
  view,
  detailsId,
  expanded,
  toggleRef,
  detailsRef,
  onToggle,
}: {
  game: Game;
  host: string;
  view: RoleReputationCompactView;
  detailsId: string;
  expanded: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  detailsRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
}) {
  useEffect(() => {
    if (view.dialogOpen || expanded) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && detailsRef.current?.contains(active)) {
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [view.dialogOpen, expanded, detailsRef, toggleRef]);

  return (
    <div className="gb-discovery-card__people">
      <div className="gb-discovery-card__people-summary">
        {game.trainer ? (
          <div
            className="gb-discovery-host"
            data-role="trainer"
            data-trainer-profile={game.trainer.profileId}
          >
            <Avatar className="gb-discovery-avatar" name={game.trainer.displayName} />
            <span className="gb-discovery-host__copy">
              <small>Тренер</small>
              <strong>{game.trainer.displayName}</strong>
            </span>
          </div>
        ) : (
          <div className="gb-discovery-host" data-role="trainer" data-trainer-unavailable="true">
            <span className="gb-discovery-host__copy">
              <small>Тренер</small>
              <strong>Профиль недоступен</strong>
            </span>
          </div>
        )}
        <div
          className="gb-discovery-host"
          data-role="organizer"
          data-organizer-id={game.organizer.id ?? undefined}
        >
          <Avatar className="gb-discovery-avatar" name={host} avatar={game.organizer.avatar} />
          <span className="gb-discovery-host__copy">
            <small>Организатор</small>
            <strong>{host}</strong>
          </span>
        </div>
        {/* #521 Owner footer order: TRAINER → ORGANIZER → disclosure → details/share (right edge). */}
        <button
          ref={toggleRef}
          type="button"
          className="gb-discovery-card__disclosure"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`Отзывы и история: ${game.title}`}
          onClick={onToggle}
        >
          <span>{expanded ? "Свернуть" : "Отзывы и история"}</span>
          <ChevronIcon />
        </button>
        <CardActions gameId={game.id} title={game.title} />
      </div>
      <div
        ref={detailsRef}
        className="gb-discovery-card__role-details"
        id={detailsId}
        hidden={!expanded}
      >
        <section className="gb-discovery-card__role-detail" data-role="training">
          <h4>О тренировках</h4>
          <div className="gb-discovery-card__role-actions">
            {game.trainer ? (
              <Link
                className="gb-discovery-card__text-link"
                href={`/games/${game.id}`}
                aria-label={`О тренере в игре: ${game.title}`}
              >
                О тренере в игре
              </Link>
            ) : null}
            {view.trainingTrigger ? (
              <button
                type="button"
                className="gb-c23-btn gb-c23-btn--outline gb-discovery-card__review-btn"
                aria-label={view.trainingTrigger.ariaLabel}
                onClick={view.trainingTrigger.onOpen}
              >
                {reviewButtonLabel(view.trainingTrigger.count)}
              </button>
            ) : (
              <p className="gb-discovery-card__role-note">Отзывы сейчас недоступны.</p>
            )}
          </div>
          {view.trainingTrigger && view.trainingTrigger.count === 0 ? (
            <p className="gb-discovery-card__role-note">Пока нет опубликованных отзывов.</p>
          ) : null}
          {game.trainer ? (
            <p className="gb-discovery-card__role-note">Информация о тренере указана пользователем.</p>
          ) : null}
        </section>
        <section className="gb-discovery-card__role-detail" data-role="organization">
          <h4>Об организации</h4>
          <div className="gb-discovery-card__role-actions">
            <Link
              className="gb-discovery-card__text-link"
              href={`/games/${game.id}`}
              aria-label={`Об организаторе в игре: ${game.title}`}
            >
              Об организаторе в игре
            </Link>
            {view.organizationTrigger ? (
              <button
                type="button"
                className="gb-c23-btn gb-c23-btn--outline gb-discovery-card__review-btn"
                aria-label={view.organizationTrigger.ariaLabel}
                onClick={view.organizationTrigger.onOpen}
              >
                {reviewButtonLabel(view.organizationTrigger.count)}
              </button>
            ) : (
              <p className="gb-discovery-card__role-note">Отзывы сейчас недоступны.</p>
            )}
          </div>
          {view.organizationTrigger && view.organizationTrigger.count === 0 ? (
            <p className="gb-discovery-card__role-note">Пока нет опубликованных отзывов.</p>
          ) : null}
          {view.historyLabel ? (
            <p className="gb-discovery-card__history">{view.historyLabel}</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
