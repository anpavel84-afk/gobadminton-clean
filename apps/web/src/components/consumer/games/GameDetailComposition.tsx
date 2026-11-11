import Link from "next/link";
import { GameCover } from "./GameCover";
import { GameShare } from "./GameShare";
import { Avatar } from "../players/ProfileComposition";
import type { ReactNode } from "react";
import type { Game, MeGameResultsPage, ParticipationStatus } from "../../../lib/consumer-types";
import { discoveryGameWhen, discoveryFormat } from "../../../lib/discovery-presentation";
import { capacityStatusLabel, participationLabel, settlementTerms } from "../../../lib/game-presentation";
import {
  attendanceLabel,
  attendanceSourceLabel,
  formatGameDateBadge,
  ownResultPendingNotice,
  resultsPath,
} from "../../../lib/game-results";
import { Button } from "../Button";
import { RoleReputationPanel } from "./RoleReputationPanel";

type OwnResultsItem = MeGameResultsPage["items"][number];

/**
 * Compact own-history row from /me/game-results when public getGame is missing.
 * Shows only server-proven title/date/own mark/provenance/notice — never invents venue/opponent.
 */
export function OwnResultsHistoryCard({ item, embedded = false }: { item: OwnResultsItem; embedded?: boolean }) {
  const Tag = embedded ? "div" : "article";
  const badge = formatGameDateBadge(item.endsAt ?? undefined);
  const pending = ownResultPendingNotice(item);
  const source = item.attendance.assertion.source
    ? attendanceSourceLabel(item.attendance.assertion.source)
    : null;
  return (
    <Tag
      className="gb-postgame-history-entry"
      data-surface="own-results-history"
      data-game-id={embedded ? undefined : item.gameId}
      data-context-id={item.contextId}
    >
      <div className="gb-postgame__date" aria-hidden>
        <strong>{badge.day}</strong>
        <span>{badge.month}</span>
      </div>
      <div className="gb-postgame-history-entry__body">
        {!embedded ? <h3>{item.gameTitle ?? "Игра"}</h3> : null}
        <small>{item.endsAt ? `${new Date(item.endsAt).toLocaleString("ru-RU")} · ваше местное время` : "Дата недоступна"}</small>
        <p>
          Ваша отметка: {attendanceLabel(item.attendance.value)}
          {item.attendance.late ? " · опоздание" : ""}
          {source ? ` · ${source}` : ""}
          {` · v${item.attendance.version}`}
        </p>
        {pending ? (
          <span className="gb-postgame__pill" data-tone="wait">
            Ждёт вашего ответа
          </span>
        ) : null}
        {!item.gameTitle ? (
          <small className="gb-personal-card__hint">Название с публичной карточки недоступно — показаны ваши итоги.</small>
        ) : null}
      </div>
      <div className="gb-postgame-history-entry__action">
        <Button variant="outline" href={resultsPath(item.gameId, item.attendance.dispute?.status === "open" ? "clarification" : undefined)}>
          {item.attendance.dispute?.status === "open" ? "Уточнение открыто →" : "Участники / Итоги →"}
        </Button>
      </div>
    </Tag>
  );
}

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

export function GameTerms({
  game,
  showCapacity = true,
  onVenueClick,
  csrfToken = null,
  onLogin,
}: {
  game: Game;
  showCapacity?: boolean;
  onVenueClick?: () => void;
  csrfToken?: string | null;
  onLogin?: () => void;
}) {
  const trainer = game.activityKind === "trainer_led";
  return <div className="gb-game-content">
    {trainer && game.trainer && <section className="gb-game-coach" aria-label="Тренер">
      <span className="gb-game-avatar" aria-hidden="true">{game.trainer.displayName.slice(0, 2)}</span>
      <div><small>Тренер · самостоятельно указано</small><h2>{game.trainer.displayName}</h2></div>
      <RoleReputationPanel role="training" gameId={game.id} csrfToken={csrfToken} onLogin={onLogin} />
    </section>}
    <section className="gb-game-section">
      <span className="gb-game-kicker">Встречаемся на корте</span><h2>Место и организатор</h2>
      <dl className="gb-game-facts">
        <div><dt>Площадка</dt><dd>{onVenueClick ? <button type="button" onClick={onVenueClick}>{game.venue.name}</button> : <Link href={`/venues/${game.venue.id}`}>{game.venue.name}</Link>}<small>{game.venue.address}</small></dd></div>
        <div><dt>Организует</dt><dd><span className="gb-game-identity"><Avatar className="gb-discovery-avatar" name={game.organizer.displayName} avatar={game.organizer.avatar} /><span>{game.organizer.displayName}</span></span><small>{game.organizer.publicContact}</small></dd></div>
        {showCapacity && <div><dt>Состав</dt><dd>До {game.capacity} игроков<small>Подтверждено: {game.confirmedCount} · Занято вне сервиса: {game.externalReservedCount}</small></dd></div>}
      </dl>
      <RoleReputationPanel role="organization" gameId={game.id} csrfToken={csrfToken} onLogin={onLogin} />
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
  compact = false, ownStatuses = [], children, returnPath, cardId,
}: {
  game: Game;
  ownStatus?: ParticipationStatus;
  owned?: boolean;
  /** Honest created-by-me vs managed-by-me label from server management projection. */
  managementRelation?: string | null;
  compact?: boolean;
  ownStatuses?: ParticipationStatus[];
  children?: ReactNode;
  returnPath?: string;
  cardId?: string;
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
  if (compact) {
    const badge = formatGameDateBadge(game.startsAt, game.timezone);
    const statuses = [...new Set(ownStatuses)];
    const managementHref = `/my-games/${encodeURIComponent(game.id)}${returnPath ? `?from=${encodeURIComponent(returnPath)}` : ""}`;
    const live = game.status === "published" && Date.parse(game.startsAt) <= Date.now() && Date.parse(game.endsAt) > Date.now();
    return <article id={cardId} tabIndex={-1} className="gb-my-game-card" data-game-id={game.id} data-management={managementRelation ?? undefined}>
      <div className="gb-my-game-date" aria-hidden="true"><strong>{badge.day}</strong><span>{badge.month}</span></div>
      <div className="gb-my-game-body">
        <p className="gb-my-game-when">{when.day} · {when.time} · время площадки</p>
        <h3><Link href={owned ? managementHref : `/games/${encodeURIComponent(game.id)}`}>{game.title}</Link></h3>
        <p>{game.venue.name}</p>{meta ? <small>{meta}</small> : null}
        <div className="gb-my-game-badges">
          {managementRelation ? <GameStatusBadge tone="subtle">{managementRelation}</GameStatusBadge> : null}
          {owned || game.status === "cancelled" || game.status === "completed" ? <GameStatusBadge tone={game.status}>{({ draft: "Черновик", published: "Опубликовано", cancelled: "Игра отменена", completed: "Завершена" }[game.status])}</GameStatusBadge> : null}
          {statuses.map((status) => <GameStatusBadge key={status} tone={status}>{participationLabel(status)}</GameStatusBadge>)}
          {live ? <GameStatusBadge tone="confirmed">Идёт сейчас</GameStatusBadge> : null}
        </div>
        {statuses.includes("pending") ? <p>Заявка на рассмотрении. Организатор ещё не подтвердил место.</p> : null}
      </div>
      <div className="gb-my-game-actions">
        <Button variant="outline" href={owned ? managementHref : `/games/${encodeURIComponent(game.id)}`}>{owned ? game.status === "draft" ? "Продолжить" : "Управление →" : "Открыть игру →"}</Button>
        {(owned && game.status !== "draft") || statuses.includes("confirmed") ? <Button variant="ghost" href={resultsPath(game.id)}>Участники / Итоги</Button> : null}
      </div>
      <div className="gb-my-game-extras">{children}</div>
    </article>;
  }
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
