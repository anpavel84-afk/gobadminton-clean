import Link from "next/link";
import { GameCover } from "./GameCover";
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
  return <section className="gb-game-hero" data-activity={game.activityKind}>
    <div className="gb-game-hero__image">
      {preview && localPreview?.startsWith("blob:") ? <span className="gb-venue-cover"><img src={localPreview} alt="Предпросмотр фото игры" /></span> : <GameCover game={game} />}
      <span className="gb-game-ribbon" data-trainer={trainer}>{trainer ? "Тренировка с тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-game-hero__copy">
      <span className="gb-game-eyebrow">{preview ? "Предпросмотр игры" : capacityStatusLabel(game)}</span>
      <h1>{game.title}</h1>
      {trainer && game.trainingDescription && <p className="gb-game-intro">{game.trainingDescription}</p>}
      <dl className="gb-game-schedule">
        <div><dt>Дата</dt><dd>{when.day}</dd></div>
        <div><dt>Время</dt><dd>{when.time}</dd></div>
        <div><dt>Место</dt><dd>{game.venue.name}</dd></div>
        <div><dt>Уровень · формат</dt><dd>{game.levelRule.allowedLevelIds.join(", ")}{discoveryFormat(game.formatKey) && <> · {discoveryFormat(game.formatKey)}</>}</dd></div>
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
  const tone = game.status === "cancelled" ? "cancelled" : owned ? game.status : ownStatus ?? "published";
  const label = game.status === "cancelled" ? "Игра отменена" : owned
    ? ({ draft: "Черновик", published: "Опубликовано", cancelled: "Игра отменена", completed: "Завершена" }[game.status])
    : ownStatus ? participationLabel(ownStatus) : capacityStatusLabel(game);
  return <article className="gb-personal-card" data-tone={tone} data-management={managementRelation ?? undefined}>
    <div className="gb-personal-card__status"><GameStatusBadge tone={tone}>{label}</GameStatusBadge>
      {tone === "pending" && <small>Ждём решения организатора. Место пока не подтверждено.</small>}
      {tone === "draft" && <small>Ещё не опубликована</small>}
      {managementRelation ? <small data-field="management-relation">{managementRelation}</small> : null}
    </div>
    <div className="gb-personal-card__body">
      <span className="gb-game-type" data-trainer={game.activityKind === "trainer_led"}>{game.activityKind === "trainer_led" ? "С тренером" : "Обычная игра"}</span>
      <GameCover game={game} /><h3>{game.title}</h3><strong>{when.day} · {when.time}</strong>
      <p>{game.venue.name}</p>
      <small>{game.levelRule.allowedLevelIds.join(", ")} · {capacityStatusLabel(game)}</small>
      {/* STYLE_GUIDE_GAP #15: kit IdentityRow inside the canonical card body; no footer/divider. */}
      <div className="gb-game-identity gb-personal-card__organizer"><Avatar className="gb-discovery-avatar" name={game.organizer.displayName} avatar={game.organizer.avatar} /><span><small>Организатор</small><strong>{game.organizer.displayName}</strong></span></div>
    </div>
    <div className="gb-personal-card__action"><Button variant={tone === "draft" ? "dark" : "outline"} href={owned ? `/my-games/${game.id}` : `/games/${game.id}`}>{owned ? (game.status === "draft" ? "Продолжить" : "Управление") : "Открыть игру"} →</Button></div>
  </article>;
}
