"use client";
import { GameCover } from "../games/GameCover";
import { Avatar } from "../players/ProfileComposition";
/* Current venue-approved derivative in the canonical media slot. */
import { GameShare } from "../games/GameShare";
import { RoleReputationCardActions } from "../games/RoleReputationPanel";
import Link from "next/link";
import type { Game, GameRoleReputationCard } from "../../../lib/consumer-types";
import { formatSeats, isTrainerLed, settlementTerms } from "../../../lib/game-presentation";
import { discoveryFormat, discoveryGameWhen } from "../../../lib/discovery-presentation";
import { DiscoveryIcon } from "./DiscoveryComposition";

/** Trainer profileId and organizer.id are different namespaces.
 * No confirmed common person key exists in the allowed contract, so roles are
 * always rendered separately — never merged by id equality or displayName. */

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
      ? `С тренером. Тренер · самостоятельно указано: ${game.trainer.displayName}`
      : trainer
        ? "С тренером. Профиль тренера недоступен"
        : "Обычная игра";
  return <article className="gb-discovery-card" data-activity={game.activityKind}>
    <div className="gb-discovery-card__image">
      <GameCover game={game} />
      <span className="gb-discovery-type" title={trainer && game.trainer ? `Тренер · самостоятельно указано: ${game.trainer.displayName}` : undefined} aria-label={trainerMarker}>{trainer ? "С тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-discovery-card__content">
      <div className="gb-discovery-card__topline"><span>{when.day}</span><span className="gb-discovery-spots" data-full={game.availablePlaces <= 0 || game.status !== "published"}>{formatSeats(game)}</span></div>
      <time className="gb-discovery-card__time" dateTime={game.startsAt}>{when.time}</time>
      <h3><Link href={`/games/${game.id}`}>{game.title}</Link></h3>
      <p className="gb-discovery-venue">{game.venue.name}</p>
      <p className="gb-discovery-address"><DiscoveryIcon name="pin" />{game.venue.address}</p>
      <div className="gb-discovery-meta"><span>Уровень: {game.levelRule.allowedLevelIds.join(", ")}</span>{format && <span>{format}</span>}</div>
      <p className="gb-discovery-terms">{settlementTerms(game.settlement)}</p>
      {trainer && game.trainer ? (
        <div className="gb-discovery-host" data-role="trainer" data-trainer-profile={game.trainer.profileId}>
          <Avatar className="gb-discovery-avatar" name={game.trainer.displayName} />
          <span><small>Тренер · самостоятельно указано</small><strong>{game.trainer.displayName}</strong></span>
        </div>
      ) : null}
      {trainer && !game.trainer ? (
        <div className="gb-discovery-host" data-role="trainer" data-trainer-unavailable="true">
          <span><small>Тренер</small><strong>Профиль недоступен</strong></span>
        </div>
      ) : null}
      <div
        className="gb-discovery-host"
        data-role="organizer"
        data-organizer-id={game.organizer.id ?? undefined}
      >
        <Avatar className="gb-discovery-avatar" name={host} avatar={game.organizer.avatar} />
        <span>
          <small>Организатор</small>
          <strong>{host}</strong>
        </span>
        <div className="gb-discovery-card__actions"><Link className="gb-c23-btn gb-c23-btn--outline" href={`/games/${game.id}`} aria-label={`Подробнее: ${game.title}`}><span>Подробнее</span><DiscoveryIcon name="arrow" /></Link><GameShare gameId={game.id} /></div>
      </div>
      {reputation ? (
        <RoleReputationCardActions
          gameId={game.id}
          organization={reputation.organization}
          training={reputation.training}
          trainerName={game.trainer?.displayName}
        />
      ) : null}
    </div>
  </article>;
}
