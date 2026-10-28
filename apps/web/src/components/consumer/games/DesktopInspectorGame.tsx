"use client";

import { useId, useState } from "react";
import type { Game } from "../../../lib/consumer-types";
import { discoveryFormat, discoveryGameWhen } from "../../../lib/discovery-presentation";
import { capacityStatusLabel, settlementTerms } from "../../../lib/game-presentation";
import { GameCover } from "./GameCover";
import { VenueGameActions } from "./VenueGameActions";

/** Compact desktop-map game presentation (~450px). Does not reuse full-page GameHero. */
export function DesktopInspectorGame({
  game,
  onVenueClick,
}: {
  game: Game;
  onVenueClick?: () => void;
}) {
  const when = discoveryGameWhen(game);
  const trainer = game.activityKind === "trainer_led";
  const typeLabel = trainer ? "С тренером" : "Обычная игра";
  const levels = game.levelRule.allowedLevelIds.join(", ");
  const format = discoveryFormat(game.formatKey);
  const subtitle = [typeLabel, levels || null, format].filter(Boolean).join(" · ");
  const description = typeof game.trainingDescription === "string" ? game.trainingDescription.trim() : "";
  const terms = settlementTerms(game.settlement).trim();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const longDescription = description.length > 160;
  const preview = longDescription ? `${description.slice(0, 140).trimEnd()}…` : description;

  return (
    <div className="gb-desktop-inspector-game" data-view="game">
      <div className="gb-desktop-inspector-game__body">
        <section className="gb-desktop-inspector-game__snapshot" aria-label="Кратко об игре">
          <div className="gb-desktop-inspector-game__media">
            <GameCover game={game} className="gb-desktop-inspector-game__cover" />
            <span className="gb-desktop-inspector-game__date">{when.day}</span>
          </div>
          <div className="gb-desktop-inspector-game__snapshot-copy">
            <p className="gb-desktop-inspector-game__time">{when.time}</p>
            <h3 className="gb-desktop-inspector-game__title">{game.title}</h3>
            {subtitle ? <p className="gb-desktop-inspector-game__subtitle">{subtitle}</p> : null}
          </div>
        </section>

        <ul className="gb-desktop-inspector-game__facts">
          <li>
            <span className="gb-desktop-inspector-game__fact-label">Тип игры</span>
            <span>{typeLabel}</span>
          </li>
          {levels ? (
            <li>
              <span className="gb-desktop-inspector-game__fact-label">Уровень</span>
              <span>{levels}</span>
            </li>
          ) : null}
          <li>
            <span className="gb-desktop-inspector-game__fact-label">Организатор</span>
            <span>{game.organizer.displayName}</span>
          </li>
          {trainer && game.trainer ? (
            <li>
              <span className="gb-desktop-inspector-game__fact-label">Тренер · самостоятельно указано</span>
              <span>{game.trainer.displayName}</span>
            </li>
          ) : null}
          <li>
            <span className="gb-desktop-inspector-game__fact-label">Места</span>
            <span>{capacityStatusLabel(game)}</span>
          </li>
          <li>
            <span className="gb-desktop-inspector-game__fact-label">Место</span>
            <span className="gb-desktop-inspector-game__place">
              {onVenueClick ? (
                <button type="button" onClick={onVenueClick}>{game.venue.name}</button>
              ) : (
                game.venue.name
              )}
              <small>{game.venue.address}</small>
            </span>
          </li>
          {terms || trainer ? (
            <li>
              <span className="gb-desktop-inspector-game__fact-label">Условия</span>
              <span>
                {terms ? <span>{terms}</span> : null}
                {trainer ? (
                  <small>Условия аренды площадки уточняйте у организатора.</small>
                ) : null}
              </span>
            </li>
          ) : null}
        </ul>

        {description ? (
          <section className="gb-desktop-inspector-game__description" aria-label="Описание">
            <h4>Описание</h4>
            <p id={detailsId} data-expanded={longDescription ? (open ? "true" : "false") : undefined}>
              {longDescription && !open ? preview : description}
            </p>
            {longDescription ? (
              <button
                type="button"
                className="gb-desktop-inspector-game__more"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen(value => !value)}
              >
                {open ? "Свернуть" : "Подробнее"}
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="gb-desktop-inspector-game__actions">
        <VenueGameActions key={game.id} gameId={game.id} />
      </div>
    </div>
  );
}
