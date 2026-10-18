"use client";

/** V001 map return capsule, using the existing map-return primitive. */
export function GamesMapBackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="gb-map-return gb-games-map-back" aria-label="К списку игр" onClick={onClick}>
    <span aria-hidden="true">←</span>К списку
  </button>;
}
