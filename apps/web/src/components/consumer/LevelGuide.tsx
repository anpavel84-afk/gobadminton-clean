"use client";

import { useId } from "react";
import {
  LEVEL_GUIDE_DISCLAIMER,
  LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE,
  LEVEL_GUIDE_DONT_KNOW,
  isNtrpHalfstepId,
  isPilotLevelId,
  levelGuideSkillFor,
  levelGuideSkills,
} from "../../lib/level-guide";
import { PILOT_LEVEL_OPTIONS } from "../../lib/player-presentation";
import "../../styles/level-guide.css";

export type LevelGuideSurface = "profile" | "discovery";

export type LevelGuideProps = {
  surface: LevelGuideSurface;
  /** Controlled levelId; empty string = none / «Не знаю». */
  value: string;
  onChange: (levelId: string) => void;
  disabled?: boolean;
  /** Profile: keep unknown/custom existing scale value visible until user changes it. */
  preservedOption?: { levelId: string; label: string } | null;
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
  preservedOption = null,
  labelledBy,
}: LevelGuideProps) {
  const uid = useId();
  const selectId = `${uid}-select`;
  const helpId = `${uid}-help`;
  const skills = levelGuideSkills();
  const selectedSkill = value ? levelGuideSkillFor(value) : null;
  const showPreserved =
    Boolean(preservedOption?.levelId)
    && !isPilotLevelId(preservedOption!.levelId)
    && !isNtrpHalfstepId(preservedOption!.levelId);

  function pick(next: string) {
    if (disabled) return;
    onChange(next);
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
          value={value}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => pick(event.target.value)}
        >
          <option value={LEVEL_GUIDE_DONT_KNOW}>
            {surface === "profile" ? "Не знаю / не указывать" : "Без фильтра по уровню"}
          </option>
          {showPreserved && preservedOption ? (
            <option value={preservedOption.levelId}>{preservedOption.label}</option>
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
          data-active={value === LEVEL_GUIDE_DONT_KNOW ? "true" : undefined}
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
      ) : value && showPreserved && preservedOption && preservedOption.levelId === value ? (
        <p className="gb-level-guide__selected" role="status">
          Сохранённый уровень: <strong>{preservedOption.label}</strong> (другая шкала — без автозамены)
        </p>
      ) : value && isPilotLevelId(value) ? (
        <p className="gb-level-guide__selected" role="status">
          Краткий уровень: <strong>{PILOT_LEVEL_OPTIONS.find((o) => o.levelId === value)?.label ?? value}</strong>
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
              <li key={skill.levelId} data-current={value === skill.levelId ? "true" : undefined}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(skill.levelId)}
                  aria-pressed={value === skill.levelId}
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
