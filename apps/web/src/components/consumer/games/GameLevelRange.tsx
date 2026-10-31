"use client";

import { useId } from "react";
import {
  NTRP_LEVEL_MAX,
  NTRP_LEVEL_MIN,
  NTRP_LEVEL_STEP,
  applyNtrpLevelBoundChange,
  formatNtrpLevelDisplay,
  formatNtrpLevelSummary,
  parseNtrpLevelRange,
} from "../../../lib/game-level-range";

export type GameLevelRangeProps = {
  value: string;
  onChange: (levelIds: string) => void;
  disabled?: boolean;
};

/**
 * Two separate native range controls for desired NTRP lower/upper (inclusive).
 * Keeps От/До identity stable; clamps crossing to the other endpoint.
 */
export function GameLevelRange({ value, onChange, disabled = false }: GameLevelRangeProps) {
  const uid = useId();
  const lowerId = `${uid}-lower`;
  const upperId = `${uid}-upper`;
  const summaryId = `${uid}-summary`;
  const { lower, upper } = parseNtrpLevelRange(value);

  function onLowerInput(event: { target: { value: string } }) {
    const next = applyNtrpLevelBoundChange("lower", event.target.value, lower, upper);
    if (!next || next.serialized === value) return;
    onChange(next.serialized);
  }

  function onUpperInput(event: { target: { value: string } }) {
    const next = applyNtrpLevelBoundChange("upper", event.target.value, lower, upper);
    if (!next || next.serialized === value) return;
    onChange(next.serialized);
  }

  return (
    <div className="gb-game-level-range" role="group" aria-labelledby={summaryId}>
      <div className="gb-game-level-range__head">
        <span id={summaryId}>Уровни игроков</span>
        <output className="gb-game-level-range__summary" htmlFor={`${lowerId} ${upperId}`}>
          {formatNtrpLevelSummary(lower, upper)}
        </output>
      </div>
      <div className="gb-game-level-range__row">
        <label className="gb-game-level-range__label" htmlFor={lowerId}>
          От
        </label>
        <input
          id={lowerId}
          className="gb-game-level-range__input"
          type="range"
          min={NTRP_LEVEL_MIN}
          max={NTRP_LEVEL_MAX}
          step={NTRP_LEVEL_STEP}
          value={lower}
          disabled={disabled}
          aria-valuemin={NTRP_LEVEL_MIN}
          aria-valuemax={NTRP_LEVEL_MAX}
          aria-valuenow={lower}
          aria-valuetext={formatNtrpLevelDisplay(lower)}
          aria-label="Нижний уровень"
          onChange={onLowerInput}
        />
        <span className="gb-game-level-range__value" aria-hidden="true">
          {formatNtrpLevelDisplay(lower)}
        </span>
      </div>
      <div className="gb-game-level-range__row">
        <label className="gb-game-level-range__label" htmlFor={upperId}>
          До
        </label>
        <input
          id={upperId}
          className="gb-game-level-range__input"
          type="range"
          min={NTRP_LEVEL_MIN}
          max={NTRP_LEVEL_MAX}
          step={NTRP_LEVEL_STEP}
          value={upper}
          disabled={disabled}
          aria-valuemin={NTRP_LEVEL_MIN}
          aria-valuemax={NTRP_LEVEL_MAX}
          aria-valuenow={upper}
          aria-valuetext={formatNtrpLevelDisplay(upper)}
          aria-label="Верхний уровень"
          onChange={onUpperInput}
        />
        <span className="gb-game-level-range__value" aria-hidden="true">
          {formatNtrpLevelDisplay(upper)}
        </span>
      </div>
    </div>
  );
}
