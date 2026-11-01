import Link from "next/link";
import { GameCover } from "./GameCover";
import { GameShare } from "./GameShare";
import { Avatar } from "../players/ProfileComposition";
import type { ReactNode } from "react";
import type { Game, ParticipationStatus } from "../../../lib/consumer-types";
import { discoveryGameWhen, discoveryFormat } from "../../../lib/discovery-presentation";
import { capacityStatusLabel, participationLabel, settlementTerms } from "../../../lib/game-presentation";
import { Button } from "../Button";

export function GameStatusBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className="gb-game-status" data-tone={tone}>{children}</span>;
}

/** Existing TrainerDetail / MediaBlock composition with the current venue cover/default. */
export function GameHero({ game, preview = false, localPreview }: { game: Game; preview?: boolean; localPreview?: string }) {
  const when = discoveryGameWhen(game);
  const trainer = game.activityKind === "trainer_led";
  const format = discoveryFormat(game.formatKey);
  return <section className="gb-game-hero" data-activity={game.activityKind}>
    <div className="gb-game-hero__image">
      {preview && localPreview?.startsWith("blob:") ? <span className="gb-venue-cover"><img src={localPreview} alt="Предпросмотр фото игры" /></span> : <GameCover game={game} />}
    </div>
    <div className="gb-game-hero__copy">
      <span className="gb-game-ribbon" data-trainer={trainer}>{trainer ? "С тренером" : "Обычная игра"}</span>
      <h1>{game.title}</h1>
      <p className="gb-game-eyebrow">{preview ? "Предпросмотр игры" : <>{capacityStatusLabel(game)} · {game.venue.name}</>}</p>
      {trainer && game.trainingDescription && <p className="gb-game-intro">{game.trainingDescription}</p>}
      <dl className="gb-game-schedule">
        <div><dt>Когда</dt><dd>{when.day}</dd></div>
        <div><dt>Время площадки</dt><dd>{when.time}</dd></div>
        <div><dt>Место</dt><dd>{game.venue.name}</dd></div>
        <div><dt>Уровень и формат</dt><dd>{game.levelRule.allowedLevelIds.join(", ")}{format && <> · {format}</>}</dd></div>
      </dl>
      <small className="gb-game-timezone">Время площадки</small>
    </div>
  </section>;
}

export function GameTerms({ game, showCapacity = true, onVenueClick }: { game: Game; showCapacity?: boolean; onVenueClick?: () => void }) {
  const trainer = game.activityKind === "trainer_led";
  return <div className="gb-game-content">
    {trainer && game.trainer && <section className="gb-game-coach" aria-label="Тренер">
      <span className="gb-game-avatar" aria-hidden="true">{game.trainer.displayName.slice(0, 2)}</span>
      <div><small>Тренер · самостоятельно указано</small><h2>{game.trainer.displayName}</h2></div>
    </section>}
    <section className="gb-game-section">
      <span className="gb-game-kicker">Встречаемся на корте</span><h2>Место и организатор</h2>
      <dl className="gb-game-facts">
        <div><dt>Площадка</dt><dd>{onVenueClick ? <button type="button" onClick={onVenueClick}>{game.venue.name}</button> : <Link href={`/venues/${game.venue.id}`}>{game.venue.name}</Link>}<small>{game.venue.address}</small></dd></div>
        <div><dt>Организует</dt><dd><span className="gb-game-identity"><Avatar className="gb-discovery-avatar" name={game.organizer.displayName} avatar={game.organizer.avatar} /><span>{game.organizer.displayName}</span></span><small>{game.organizer.publicContact}</small></dd></div>
        {showCapacity && <div><dt>Состав</dt><dd>До {game.capacity} игроков<small>Подтверждено: {game.confirmedCount} · Занято вне сервиса: {game.externalReservedCount}</small></dd></div>}
      </dl>
    </section>
    <section className="gb-game-section gb-game-conditions">
      <h2>Условия участия</h2>
      <p>{settlementTerms(game.settlement)}</p>
      {trainer && <p>Условия аренды площадки уточняйте у организатора.</p>}
      <p>Организатор рассмотрит заявку. Место — после одобрения.</p>
    </section>
  </div>;
}

export function PersonalGameCard({
  game,
  ownStatus,
  owned = false,
  managementRelation = null,
}: {
  game: Game;
  ownStatus?: ParticipationStatus;
  owned?: boolean;
  /** Honest created-by-me vs managed-by-me label from server management projection. */
  managementRelation?: string | null;
}) {
  const when = discoveryGameWhen(game);
  const format = discoveryFormat(game.formatKey);
  const tone = game.status === "cancelled" ? "cancelled" : owned ? game.status : ownStatus ?? "published";
  const label = game.status === "cancelled" ? "Игра отменена" : owned
    ? ({ draft: "Черновик", published: "Опубликовано", cancelled: "Игра отменена", completed: "Завершена" }[game.status])
    : ownStatus ? participationLabel(ownStatus) : capacityStatusLabel(game);
  const levels = game.levelRule.allowedLevelIds.join(", ");
  const levelLabel = owned ? levels : (levels ? `Уровни ${levels}` : "");
  const meta = [levelLabel, format, capacityStatusLabel(game)].filter(Boolean).join(" · ");
  const terms = settlementTerms(game.settlement);
  return <article className="gb-personal-card" data-tone={tone} data-management={managementRelation ?? undefined}>
    <div className="gb-personal-card__media">
      <GameCover game={game} />
      <span className="gb-game-type" data-trainer={game.activityKind === "trainer_led"}>{game.activityKind === "trainer_led" ? "С тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-personal-card__main">
      <div className="gb-personal-card__body">
        <div className="gb-personal-card__topline"><strong>{when.day} · {when.time}</strong><GameStatusBadge tone={tone}>{label}</GameStatusBadge></div>
        {tone === "pending" && <small className="gb-personal-card__hint">Ждём решения организатора. Место пока не подтверждено.</small>}
        {tone === "draft" && <small className="gb-personal-card__hint">Ещё не опубликована</small>}
        {managementRelation ? <small className="gb-personal-card__hint" data-field="management-relation">{managementRelation}</small> : null}
        <h3>{game.title}</h3>
        <p className="gb-personal-card__venue">{game.venue.name}</p>
        {game.venue.address ? <p className="gb-personal-card__address">{game.venue.address}</p> : null}
        {meta ? <small className="gb-personal-card__meta">{meta}</small> : null}
        {terms ? <small className="gb-personal-card__terms">{terms}</small> : null}
      </div>
      <div className="gb-personal-card__footer">
        <div className="gb-game-identity gb-personal-card__organizer"><Avatar className="gb-discovery-avatar" name={game.organizer.displayName} avatar={game.organizer.avatar} /><span><small>Организатор</small><strong>{game.organizer.displayName}</strong></span></div>
        <div className="gb-personal-card__action">
          {owned ? (
            <>
              <Button variant={tone === "draft" ? "dark" : "outline"} href={`/my-games/${game.id}`}>{game.status === "draft" ? "Продолжить" : "Управление"} →</Button>
              {game.status === "completed" || game.status === "cancelled" || game.status === "published" ? (
                <Button variant="outline" href={`/my-games/${game.id}/results`}>Участники / Итоги</Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="outline" href={`/games/${game.id}`}>Подробнее →</Button>
              {ownStatus === "confirmed" ? (
                <Button variant="outline" href={`/my-games/${game.id}/results`}>Участники / Итоги</Button>
              ) : null}
              <GameShare gameId={game.id} label="Поделиться" />
            </>
          )}
        </div>
      </div>
    </div>
  </article>;
}
