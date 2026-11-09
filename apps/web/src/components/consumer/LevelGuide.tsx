"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SocialLevel } from "../../lib/consumer-types";
import {
  LEVEL_GUIDE_DISCLAIMER,
  LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE,
  LEVEL_GUIDE_DONT_KNOW,
  LEVEL_GUIDE_KEEP_CONTROL,
  type LevelGuideChoice,
  formatPreservedLevelChoiceLabel,
  levelGuideChoiceFromControlValue,
  levelGuideControlValue,
  levelGuideSkillFor,
  levelGuideSkills,
  shouldOfferPreservedLevel,
} from "../../lib/level-guide";
import { PILOT_LEVEL_OPTIONS } from "../../lib/player-presentation";
import { Button } from "./Button";
import { CloseButton } from "./CloseButton";
import { DiscoveryIcon } from "./discovery/DiscoveryComposition";
import "../../styles/level-guide.css";

export type LevelGuideSurface = "profile" | "discovery";
export type LevelGuidePresentation = "default" | "compact";

export type LevelGuideProps = {
  surface: LevelGuideSurface;
  /** Typed draft choice; empty/none = «Не знаю» / no filter. */
  value: LevelGuideChoice;
  onChange: (choice: LevelGuideChoice) => void;
  disabled?: boolean;
  /** Profile: full stored SocialLevel offered as a distinct keep option when not catalog ntrp/pilot. */
  preservedLevel?: SocialLevel | null;
  /** Optional accessible name override. */
  labelledBy?: string;
  /**
   * Discovery-only compact presentation for the #458 filters dialog.
   * Default keeps profile and legacy discovery panel unchanged.
   */
  presentation?: LevelGuidePresentation;
};

/**
 * Optional Russian level help + controlled chooser for profile edit and discovery filters.
 * Opening help or browsing descriptions does not mutate the network; parent owns persistence.
 */
export function LevelGuide({
  surface,
  value,
  onChange,
  disabled = false,
  preservedLevel = null,
  labelledBy,
  presentation = "default",
}: LevelGuideProps) {
  const uid = useId();
  const selectId = `${uid}-select`;
  const helpId = `${uid}-help`;
  const skills = levelGuideSkills();
  const controlValue = levelGuideControlValue(value);
  const selectedSkill = value.kind === "ntrp" ? levelGuideSkillFor(value.levelId) : null;
  const showPreserved = shouldOfferPreservedLevel(preservedLevel);
  const preservedLabel = preservedLevel ? formatPreservedLevelChoiceLabel(preservedLevel) : "";
  const compact = surface === "discovery" && presentation === "compact";

  function pick(nextControl: string) {
    if (disabled) return;
    onChange(levelGuideChoiceFromControlValue(nextControl, showPreserved ? preservedLevel : null));
  }

  return (
    <section
      className="gb-level-guide"
      data-surface={surface}
      data-presentation={presentation}
      data-level-guide="true"
      aria-labelledby={labelledBy ?? `${uid}-title`}
    >
      {!compact ? (
        <div className="gb-level-guide__head">
          <div>
            <small className="gb-level-guide__eyebrow">
              {surface === "profile" ? "Игровой уровень" : "Подбор игры"}
            </small>
            <h3 className="gb-level-guide__title" id={labelledBy ? undefined : `${uid}-title`}>
              {surface === "profile" ? "Помощь с выбором уровня" : "Фильтр по моему уровню"}
            </h3>
          </div>
        </div>
      ) : null}

      <label className="gb-level-guide__field" htmlFor={selectId}>
        <span>{surface === "profile" ? "Ориентировочный уровень" : "Уровень для фильтра списка"}</span>
        <select
          id={selectId}
          value={controlValue}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => pick(event.target.value)}
        >
          <option value={LEVEL_GUIDE_DONT_KNOW}>
            {surface === "profile" ? "Не знаю / не указывать" : "Без фильтра по уровню"}
          </option>
          {showPreserved && preservedLevel ? (
            <option value={LEVEL_GUIDE_KEEP_CONTROL}>{preservedLabel}</option>
          ) : null}
          {surface === "profile" ? (
            <optgroup label="Кратко (как раньше)">
              {PILOT_LEVEL_OPTIONS.map((option) => (
                <option key={option.levelId} value={option.levelId}>{option.label}</option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Числовая шкала ntrp v1">
            {skills.map((skill) => (
              <option key={skill.levelId} value={skill.levelId}>
                {skill.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {!compact ? (
        <div className="gb-level-guide__actions">
          <button
            type="button"
            data-active={value.kind === "none" ? "true" : undefined}
            disabled={disabled}
            onClick={() => pick(LEVEL_GUIDE_DONT_KNOW)}
          >
            {surface === "profile" ? "Не знаю" : "Сбросить фильтр"}
          </button>
        </div>
      ) : null}

      {selectedSkill ? (
        <p className="gb-level-guide__selected" role="status">
          Выбрано: <strong>{selectedSkill.label}</strong> — {selectedSkill.summary}
        </p>
      ) : value.kind === "keep" && showPreserved && preservedLevel ? (
        <p className="gb-level-guide__selected" role="status">
          Сохранённый уровень: <strong>{preservedLabel}</strong> (другая шкала — без автозамены)
        </p>
      ) : value.kind === "pilot" ? (
        <p className="gb-level-guide__selected" role="status">
          Краткий уровень: <strong>{PILOT_LEVEL_OPTIONS.find((o) => o.levelId === value.levelId)?.label ?? value.levelId}</strong>
        </p>
      ) : (
        <p className="gb-level-guide__hint" role="status">
          {surface === "profile"
            ? "Можно пропустить — уровень сохранится только после «Сохранить»."
            : compact
              ? "Фильтр не активен. Выбор уровня — по желанию."
              : "Фильтр не активен. Выбор не подставляется из профиля автоматически."}
        </p>
      )}

      {compact ? (
        <p className="gb-level-guide__hint" data-compact-scope="true">
          Только загруженные игры · ntrp v1. Другие шкалы не считаются совместимыми.
        </p>
      ) : null}

      <details className="gb-level-guide__help">
        <summary>Что означают уровни</summary>
        <div className="gb-level-guide__panel" id={helpId}>
          <p className="gb-level-guide__disclaimer">{LEVEL_GUIDE_DISCLAIMER}</p>
          {surface === "discovery" ? (
            <p className="gb-level-guide__hint">{LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE}</p>
          ) : null}
          <ul className="gb-level-guide__list">
            {skills.map((skill) => (
              <li key={skill.levelId} data-current={value.kind === "ntrp" && value.levelId === skill.levelId ? "true" : undefined}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(skill.levelId)}
                  aria-pressed={value.kind === "ntrp" && value.levelId === skill.levelId}
                >
                  <strong>{skill.label}</strong>
                  <span>{skill.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

export type DiscoveryLevelFiltersProps = {
  cityName: string;
  dayLabel: string;
  activityLabel: string;
  levelFilter: string;
  onLevelFilterChange: (levelId: string) => void;
};

/**
 * #458 compact discovery filters: one 44px icon trigger + Guide480 / mobile bottom sheet.
 * Controlled `levelFilter` stays on the page; dialog mount/close does not reset it.
 */
export function DiscoveryLevelFilters({
  cityName,
  dayLabel,
  activityLabel,
  levelFilter,
  onLevelFilterChange,
}: DiscoveryLevelFiltersProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const titleId = useId();
  const dialogId = useId();
  const activeDescId = useId();
  const levelActive = Boolean(levelFilter);
  const levelLabel = levelActive ? (levelGuideSkillFor(levelFilter)?.label ?? levelFilter) : "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog.showModal === "function" && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        /* already open / unsupported */
      }
    }
    const focusFrame = requestAnimationFrame(() => {
      dialog.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) {
        try {
          dialog.close();
        } catch {
          /* ignore */
        }
      }
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus({ preventScroll: true });
      }
    };
  }, [open]);

  function closeFilters() {
    setOpen(false);
  }

  function resetLevel() {
    onLevelFilterChange("");
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="gb-discovery-filters-trigger"
        aria-label="Фильтры"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-describedby={levelActive ? activeDescId : undefined}
        data-active={levelActive ? "true" : undefined}
        onClick={() => setOpen(true)}
      >
        <DiscoveryIcon name="filter" />
      </button>
      {levelActive ? (
        <span id={activeDescId} className="gb-discovery-filters-trigger__desc" hidden>
          {`Уровень ${levelLabel}`}
        </span>
      ) : null}
      {open ? (
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="gb-discovery-filters-dialog"
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            closeFilters();
          }}
          onPointerDown={(event) => {
            backdropPointerDown.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && backdropPointerDown.current) closeFilters();
            backdropPointerDown.current = false;
          }}
        >
          <header className="gb-discovery-filters-dialog__header">
            <div className="gb-discovery-filters-dialog__chrome">
              <CloseButton aria-label="Закрыть фильтры" onClick={closeFilters} />
            </div>
            <h2 id={titleId}>Фильтры</h2>
            <p className="gb-discovery-filters-dialog__summary">
              {cityName} · {dayLabel} · {activityLabel}
            </p>
          </header>
          <div className="gb-discovery-filters-dialog__body">
            <LevelGuide
              surface="discovery"
              presentation="compact"
              labelledBy={titleId}
              value={levelFilter ? { kind: "ntrp", levelId: levelFilter } : { kind: "none" }}
              onChange={(choice) => onLevelFilterChange(choice.kind === "ntrp" ? choice.levelId : "")}
            />
          </div>
          <footer className="gb-discovery-filters-dialog__footer">
            <button
              type="button"
              className="gb-discovery-filters-dialog__reset"
              disabled={!levelActive}
              onClick={resetLevel}
            >
              Сбросить уровень
            </button>
            <Button type="button" variant="dark" onClick={closeFilters}>
              К списку
            </Button>
          </footer>
        </dialog>
      ) : null}
    </>
  );
}
