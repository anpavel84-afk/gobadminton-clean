"use client";

import type { ReactNode } from "react";
import type { PlayerAvatar, SocialLevel } from "../../../lib/consumer-types";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { ProfileCover } from "./CoverEditor";
import { Avatar, Badge } from "./ProfileComposition";
import "../../../styles/players-profiles.css";

/** Fields the shared public-profile presentation can show without inventing values. */
export type PlayerProfileFields = {
  publicPlayerId: string;
  displayName: string;
  level?: SocialLevel | null;
  trainer?: boolean;
  lookingForGame?: boolean | null;
  avatar?: PlayerAvatar | null;
  bio?: string | null;
  areaKey?: string | null;
  cover?: { uploadedUrl: string | null } | null;
};

export function PlayerProfileContent({
  player,
  city,
  distance,
  actions,
  note,
  titleAs = "h1",
  className,
}: {
  player: PlayerProfileFields;
  city?: string;
  /** Radar-only optional metadata; omit on the ordinary public page. */
  distance?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  titleAs?: "h1" | "h2";
  className?: string;
}) {
  const Title = titleAs;
  const levelLabel = formatSocialLevel(player.level);
  const meta = [levelLabel, city, player.areaKey].filter(Boolean).join(" · ");
  const looking = player.lookingForGame === true;
  const trainer = player.trainer === true;
  return <div className={className ? `player-profile-content ${className}` : "player-profile-content"} data-player-profile-content="">
    <section className="player-profile-hero">
      <div className="player-profile-visual">
        {player.cover?.uploadedUrl && <ProfileCover url={player.cover.uploadedUrl} />}
        <Avatar avatar={player.avatar ?? undefined} name={player.displayName} tone={trainer ? "purple" : "yellow"} />
        <img src="/canonical/bb5a8.svg" alt="" />
      </div>
      <div className="player-profile-copy">
        <div className="player-profile-status">
          {looking && <Badge>Ищу игру</Badge>}
          {trainer && <Badge trainer>Тренер</Badge>}
          {!looking && !trainer && <Badge>Игрок</Badge>}
          {distance != null && distance !== "" && <span className="player-profile-distance">{distance}</span>}
        </div>
        <Title>{player.displayName}</Title>
        {meta && <p className="player-profile-meta">{meta}</p>}
        {player.bio ? <p className="player-profile-bio">{player.bio}</p> : null}
      </div>
    </section>
    {(actions || note) ? <div className="player-profile-actionband">
      {actions ? <div className="player-profile-actions" data-surface="pp-actions">{actions}</div> : null}
      {note}
    </div> : null}
    <section className="player-profile-grid">
      <div className="player-profile-main">
        <div className="guide-panel preference-card">
          <small>Игровой профиль</small>
          <div>
            <span>Уровень<strong>{levelLabel}</strong></span>
            <span>Район / метро<strong>{player.areaKey || "Не указан"}</strong></span>
          </div>
        </div>
      </div>
      <aside className="player-profile-rail">
        {trainer ? <div className="guide-panel trainer-profile-optional"><Badge trainer>Тренер</Badge><p>Информация заполнена пользователем</p></div>
          : <div className="guide-panel first-contact-note player-profile-public-note"><span><strong>Публичный профиль</strong><p>Показаны только доступные сведения. Неуказанные данные не заменяются догадками.</p></span></div>}
      </aside>
    </section>
  </div>;
}
