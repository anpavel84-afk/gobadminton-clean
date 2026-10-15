import { Avatar } from "./players/ProfileComposition";
import Link from "next/link";
import type { Game, ParticipationStatus } from "../../lib/consumer-types";
import {
  formatGameWhen,
  formatSeats,
  isTrainerLed,
  levelFormatLine,
  participationChipKind,
  participationLabel,
  settlementTerms,
} from "../../lib/game-presentation";

export type GameCardProps = {
  game: Game;
  href?: string;
  ownStatus?: ParticipationStatus | null;
  publicationChip?: boolean;
  requestAttentionCount?: number | null;
};

export function GameCard({
  game,
  href = `/games/${game.id}`,
  ownStatus = null,
  publicationChip = false,
  requestAttentionCount = null,
}: GameCardProps) {
  const trainer = isTrainerLed(game);
  const seatsTone = game.availablePlaces <= 0 || game.status === "cancelled" ? "full" : "open";
  return (
    <Link
      href={href}
      className={`gb-c23-card${trainer ? " gb-c23-card--trainer" : ""}`}
      data-activity={game.activityKind}
    >
      <div className="gb-c23-card__media" aria-hidden="true" />
      <div className="gb-c23-card__body">
        <p className="gb-c23-card__when">{formatGameWhen(game)}</p>
        <p className="gb-c23-card__seats" data-tone={seatsTone}>
          {formatSeats(game)}
        </p>
        <h2 className="gb-c23-card__venue">{game.venue.name}</h2>
        <p className="gb-c23-card__meta">{game.venue.address}</p>
        <p className="gb-c23-card__meta">{levelFormatLine(game)}</p>
        <div className="gb-discovery-host"><Avatar className="gb-discovery-avatar" name={game.organizer.displayName} avatar={game.organizer.avatar} /><span>{game.organizer.displayName}</span></div>
        <div className="gb-c23-card__row">
          {trainer ? <span className="gb-c23-chip gb-c23-chip--trainer">С тренером</span> : null}
          {ownStatus ? (
            <span className={`gb-c23-chip gb-c23-chip--${participationChipKind(ownStatus)}`}>
              {participationLabel(ownStatus)}
            </span>
          ) : null}
          {publicationChip ? (
            <span className="gb-c23-chip">
              {game.status === "published"
                ? "Опубликовано"
                : game.status === "draft"
                  ? "Черновик"
                  : game.status}
            </span>
          ) : null}
          {typeof requestAttentionCount === "number" && requestAttentionCount > 0 ? (
            <span className="gb-c23-chip gb-c23-chip--attention">
              {requestAttentionCount} заявок ждут ответа
            </span>
          ) : null}
        </div>
        <p className="gb-c23-card__meta" style={{ marginTop: 10 }}>
          {settlementTerms(game.settlement)}
        </p>
      </div>
    </Link>
  );
}
