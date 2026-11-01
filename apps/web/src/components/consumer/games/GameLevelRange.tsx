"use client";

import { useId, useState } from "react";
import {
  NTRP_LEVEL_MAX,
  NTRP_LEVEL_MIN,
  NTRP_LEVEL_STEP,
  applyNtrpLevelBoundChange,
  formatNtrpLevelDisplay,
  formatNtrpLevelSummary,
  ntrpLevelSelectedFillStyle,
  parseNtrpLevelRange,
} from "../../../lib/game-level-range";

export type GameLevelRangeProps = {
  value: string;
  onChange: (levelIds: string) => void;
  disabled?: boolean;
};

/**
 * Two native range controls on one shared visual track (global NTRP 1..7).
 * От/До stay separately focusable; crossing clamps to the other endpoint.
 */
export function GameLevelRange({ value, onChange, disabled = false }: GameLevelRangeProps) {
  const uid = useId();
  const lowerId = `${uid}-lower`;
  const upperId = `${uid}-upper`;
  const summaryId = `${uid}-summary`;
  const { lower, upper } = parseNtrpLevelRange(value);
  const fill = ntrpLevelSelectedFillStyle(lower, upper);
  const [activeBound, setActiveBound] = useState<"lower" | "upper" | null>(null);
  const equalBounds = lower === upper;

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
      <div className="gb-game-level-range__bounds" aria-hidden="true">
        <span className="gb-game-level-range__bound">
          <span className="gb-game-level-range__label">От</span>
          <span className="gb-game-level-range__value">{formatNtrpLevelDisplay(lower)}</span>
        </span>
        <span className="gb-game-level-range__bound">
          <span className="gb-game-level-range__label">До</span>
          <span className="gb-game-level-range__value">{formatNtrpLevelDisplay(upper)}</span>
        </span>
      </div>
      <div
        className={
          equalBounds
            ? "gb-game-level-range__control gb-game-level-range__control--equal"
            : "gb-game-level-range__control"
        }
        data-active-bound={activeBound ?? undefined}
      >
        <div className="gb-game-level-range__rail" aria-hidden="true" />
        <div
          className="gb-game-level-range__fill"
          aria-hidden="true"
          style={{ left: fill.left, width: fill.width }}
        />
        <label className="gb-game-level-range__sr-only" htmlFor={lowerId}>
          От
        </label>
        <input
          id={lowerId}
          className="gb-game-level-range__input gb-game-level-range__input--lower"
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
          onPointerDown={() => setActiveBound("lower")}
          onFocus={() => setActiveBound("lower")}
          onBlur={() => setActiveBound((current) => (current === "lower" ? null : current))}
          onChange={onLowerInput}
        />
        <label className="gb-game-level-range__sr-only" htmlFor={upperId}>
          До
        </label>
        <input
          id={upperId}
          className="gb-game-level-range__input gb-game-level-range__input--upper"
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
          onPointerDown={() => setActiveBound("upper")}
          onFocus={() => setActiveBound("upper")}
          onBlur={() => setActiveBound((current) => (current === "upper" ? null : current))}
          onChange={onUpperInput}
        />
      </div>
    </div>
  );
}
