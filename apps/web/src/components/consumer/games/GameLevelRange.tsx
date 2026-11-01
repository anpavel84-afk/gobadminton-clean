"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  NTRP_LEVEL_MAX,
  NTRP_LEVEL_MIN,
  NTRP_LEVEL_STEP,
  applyNtrpLevelBoundChange,
  formatNtrpLevelDisplay,
  formatNtrpLevelSummary,
  ntrpLevelAriaValueMax,
  ntrpLevelAriaValueMin,
  ntrpLevelSelectedFillStyle,
  ntrpLevelValueFromTrackClientX,
  parseNtrpLevelRange,
  resolveNtrpLevelPointerBound,
} from "../../../lib/game-level-range";

export type GameLevelRangeProps = {
  value: string;
  onChange: (levelIds: string) => void;
  disabled?: boolean;
};

type DragState = {
  pointerId: number;
  bound: "lower" | "upper";
  startX: number;
  startY: number;
  captured: boolean;
};

/**
 * Two native range controls on one shared visual track (global NTRP 1..7).
 * От/До stay separately focusable; crossing clamps to the other endpoint.
 * Pointer/touch hit-testing picks either overlapped thumb without prior keyboard focus.
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
  const controlRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const valueRef = useRef({ lower, upper, serialized: value });
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  valueRef.current = { lower, upper, serialized: value };
  disabledRef.current = disabled;
  onChangeRef.current = onChange;

  function clearDrag(control: HTMLDivElement | null) {
    const drag = dragRef.current;
    if (!drag) return;
    if (control?.hasPointerCapture?.(drag.pointerId)) {
      try {
        control.releasePointerCapture(drag.pointerId);
      } catch {
        /* already released */
      }
    }
    dragRef.current = null;
  }

  function applyPointerValue(clientX: number, bound: "lower" | "upper") {
    const control = controlRef.current;
    if (!control) return;
    const rect = control.getBoundingClientRect();
    const raw = ntrpLevelValueFromTrackClientX(clientX, rect.left, rect.width);
    const current = valueRef.current;
    const next = applyNtrpLevelBoundChange(bound, raw, current.lower, current.upper);
    if (!next || next.serialized === current.serialized) return;
    valueRef.current = { lower: next.lower, upper: next.upper, serialized: next.serialized };
    onChangeRef.current(next.serialized);
  }

  function refineBoundForEqual(
    drag: DragState,
    directionDx: number,
    trackLeft: number,
    trackWidth: number,
  ) {
    const current = valueRef.current;
    if (current.lower !== current.upper) return drag.bound;
    const refined = resolveNtrpLevelPointerBound(
      drag.startX,
      trackLeft,
      trackWidth,
      current.lower,
      current.upper,
      { directionDx },
    );
    if (refined && refined !== drag.bound) {
      drag.bound = refined;
      setActiveBound(refined);
    }
    return drag.bound;
  }

  function onControlPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabledRef.current || !event.isPrimary || event.button !== 0) return;
    const control = controlRef.current;
    if (!control) return;
    const rect = control.getBoundingClientRect();
    const bound = resolveNtrpLevelPointerBound(
      event.clientX,
      rect.left,
      rect.width,
      valueRef.current.lower,
      valueRef.current.upper,
    );
    if (!bound) return;

    dragRef.current = {
      pointerId: event.pointerId,
      bound,
      startX: event.clientX,
      startY: event.clientY,
      captured: false,
    };
    setActiveBound(bound);

    // Mouse/pen: capture immediately. Touch waits for horizontal intent so pan-y can scroll.
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      try {
        control.setPointerCapture(event.pointerId);
        dragRef.current.captured = true;
      } catch {
        dragRef.current.captured = false;
      }
      applyPointerValue(event.clientX, bound);
    }
  }

  function onControlPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabledRef.current) return;
    const control = controlRef.current;
    if (!control) return;
    const rect = control.getBoundingClientRect();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.captured) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        dragRef.current = null;
        setActiveBound(null);
        return;
      }
      if (Math.abs(dx) < 4) return;
      refineBoundForEqual(drag, dx, rect.left, rect.width);
      try {
        control.setPointerCapture(event.pointerId);
        drag.captured = true;
      } catch {
        return;
      }
    } else if (valueRef.current.lower === valueRef.current.upper && dx !== 0) {
      refineBoundForEqual(drag, dx, rect.left, rect.width);
    }

    applyPointerValue(event.clientX, drag.bound);
  }

  function onControlPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    clearDrag(controlRef.current);
  }

  function onControlPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    clearDrag(controlRef.current);
    setActiveBound(null);
  }

  function onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  }

  useEffect(() => {
    return () => {
      clearDrag(controlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    clearDrag(controlRef.current);
    setActiveBound(null);
  }, [disabled]);

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
        ref={controlRef}
        className={[
          "gb-game-level-range__control",
          equalBounds ? "gb-game-level-range__control--equal" : "",
          disabled ? "gb-game-level-range__control--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-active-bound={activeBound ?? undefined}
        onPointerDown={onControlPointerDown}
        onPointerMove={onControlPointerMove}
        onPointerUp={onControlPointerUp}
        onPointerCancel={onControlPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
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
          aria-valuemin={ntrpLevelAriaValueMin("lower", lower, upper)}
          aria-valuemax={ntrpLevelAriaValueMax("lower", lower, upper)}
          aria-valuenow={lower}
          aria-valuetext={formatNtrpLevelDisplay(lower)}
          aria-label="Нижний уровень"
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
          aria-valuemin={ntrpLevelAriaValueMin("upper", lower, upper)}
          aria-valuemax={ntrpLevelAriaValueMax("upper", lower, upper)}
          aria-valuenow={upper}
          aria-valuetext={formatNtrpLevelDisplay(upper)}
          aria-label="Верхний уровень"
          onFocus={() => setActiveBound("upper")}
          onBlur={() => setActiveBound((current) => (current === "upper" ? null : current))}
          onChange={onUpperInput}
        />
      </div>
    </div>
  );
}
