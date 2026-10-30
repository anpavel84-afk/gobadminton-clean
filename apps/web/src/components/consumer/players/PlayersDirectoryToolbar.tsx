"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { City } from "../../../lib/consumer-types";
import { RadarSwitchControl, RadarStatusControls } from "../radar/RadarControls";

type Props = {
  cities: City[];
  cityId: string;
  name: string;
  areaKey: string;
  lookingOnly: boolean;
  trainerOnly: boolean;
  onCityId: (value: string) => void;
  onName: (value: string) => void;
  onAreaKey: (value: string) => void;
  onLookingOnly: (value: boolean) => void;
  onTrainerOnly: (value: boolean) => void;
  onReset: () => void;
  /** Clears ordinary catalog pagination when filter inputs change. */
  onFilterCommit: () => void;
  notice?: string | null;
};

export function PlayersDirectoryToolbar({
  cities,
  cityId,
  name,
  areaKey,
  lookingOnly,
  trainerOnly,
  onCityId,
  onName,
  onAreaKey,
  onLookingOnly,
  onTrainerOnly,
  onReset,
  onFilterCommit,
  notice,
}: Props) {
  const popoverId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const filterCount = Number(Boolean(areaKey.trim()))
    + Number(lookingOnly)
    + Number(trainerOnly);

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFiltersOpen(false);
      openRef.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [filtersOpen]);

  function applyAndClose() {
    setFiltersOpen(false);
    openRef.current?.focus();
  }

  return (
    <section ref={rootRef} className="pb-dir-toolbar" aria-label="Поиск игроков">
      {notice && <section className="radar-notice pb-dir-toolbar__notice"><span role="status"><strong>{notice}</strong></span></section>}
      <div className="pb-dir-toolbar__row">
        <label className="pb-dir-toolbar__city">
          <img className="profile-icon" src="/discovery/pin.svg" alt="" />
          <span>
            <small>Город</small>
            <select
              aria-label="Город"
              value={cityId}
              onChange={e => { onCityId(e.target.value); onFilterCommit(); }}
            >
              <option value="">Все города</option>
              {cities.map(c => <option value={c.id} key={c.id}>{c.nameRu}</option>)}
            </select>
          </span>
        </label>
        <label className="pb-dir-toolbar__search">
          <img className="profile-icon" src="/canonical/search.svg" alt="" />
          <input
            aria-label="Найти игрока"
            type="search"
            placeholder="Найти игрока"
            value={name}
            onChange={e => { onName(e.target.value); onFilterCommit(); }}
          />
        </label>
        <button
          ref={openRef}
          type="button"
          className="pb-dir-toolbar__filters"
          aria-expanded={filtersOpen}
          aria-controls={popoverId}
          onClick={() => setFiltersOpen(open => !open)}
        >
          <span aria-hidden="true">☰</span>
          Фильтры
          {filterCount > 0 && <span className="pb-dir-toolbar__filter-count">{filterCount}</span>}
        </button>
        <div className="pb-dir-toolbar__radar">
          <RadarSwitchControl />
        </div>
      </div>
      {filtersOpen && (
        <div className="pb-dir-toolbar__popover" id={popoverId} role="dialog" aria-label="Фильтры игроков">
          <div className="pb-dir-toolbar__popover-title">
            <strong>Фильтры игроков</strong>
            <button ref={closeRef} type="button" aria-label="Закрыть фильтры" onClick={applyAndClose}>×</button>
          </div>
          <div className="pb-dir-toolbar__chips" role="group" aria-label="Тип игрока">
            <button
              type="button"
              className={!lookingOnly && !trainerOnly ? "is-selected" : undefined}
              aria-pressed={!lookingOnly && !trainerOnly}
              onClick={() => { onLookingOnly(false); onTrainerOnly(false); onFilterCommit(); }}
            >
              Все игроки
            </button>
            <button
              type="button"
              className={lookingOnly ? "is-selected" : undefined}
              aria-pressed={lookingOnly}
              onClick={() => { onLookingOnly(!lookingOnly); onFilterCommit(); }}
            >
              Ищут игру
            </button>
            <button
              type="button"
              className={trainerOnly ? "is-selected" : undefined}
              aria-pressed={trainerOnly}
              onClick={() => { onTrainerOnly(!trainerOnly); onFilterCommit(); }}
            >
              Тренеры
            </button>
          </div>
          <label className="pb-dir-toolbar__field">
            Район / метро
            <input
              aria-label="Район / метро"
              placeholder="Любой район"
              value={areaKey}
              maxLength={64}
              onChange={e => { onAreaKey(e.target.value); onFilterCommit(); }}
            />
          </label>
          <div className="pb-dir-toolbar__popover-footer">
            <button
              type="button"
              className="pb-dir-toolbar__reset"
              onClick={() => { onReset(); }}
            >
              Сбросить
            </button>
            <button type="button" className="pb-dir-toolbar__apply" onClick={applyAndClose}>
              Показать игроков
            </button>
          </div>
        </div>
      )}
      <RadarStatusControls presentation="directory-compact" />
    </section>
  );
}
