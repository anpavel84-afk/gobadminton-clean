"use client";

import { useId } from "react";
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
import "../../styles/level-guide.css";

export type LevelGuideSurface = "profile" | "discovery";

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
}: LevelGuideProps) {
  const uid = useId();
  const selectId = `${uid}-select`;
  const helpId = `${uid}-help`;
  const skills = levelGuideSkills();
  const controlValue = levelGuideControlValue(value);
  const selectedSkill = value.kind === "ntrp" ? levelGuideSkillFor(value.levelId) : null;
  const showPreserved = shouldOfferPreservedLevel(preservedLevel);
  const preservedLabel = preservedLevel ? formatPreservedLevelChoiceLabel(preservedLevel) : "";

  function pick(nextControl: string) {
    if (disabled) return;
    onChange(levelGuideChoiceFromControlValue(nextControl, showPreserved ? preservedLevel : null));
  }

  return (
    <section
      className="gb-level-guide"
      data-surface={surface}
      data-level-guide="true"
      aria-labelledby={labelledBy ?? `${uid}-title`}
    >
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
            : "Фильтр не активен. Выбор не подставляется из профиля автоматически."}
        </p>
      )}

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
