"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CloseButton } from "../CloseButton";
import { Button } from "../Button";
import { Toggle } from "../players/ProfileComposition";
import {
  DEFAULT_MAP_LAYER_FILTERS,
  mapLayerFiltersActive,
  mapLayerFiltersChipLabel,
  sameMapLayerFilters,
  type MapLayerFiltersState,
  type VenueLayerMode,
} from "../../../lib/map-layer-filters";
import "../../../styles/radar-geographic.css";
import "../../../styles/discovery.css";

type MapLayerFiltersContextValue = {
  applied: MapLayerFiltersState;
  setApplied: (next: MapLayerFiltersState) => void;
  resetApplied: () => void;
};

const MapLayerFiltersContext = createContext<MapLayerFiltersContextValue | null>(null);

export function MapLayerFiltersProvider({ children }: { children: ReactNode }) {
  const [applied, setAppliedState] = useState<MapLayerFiltersState>(DEFAULT_MAP_LAYER_FILTERS);
  const setApplied = useCallback((next: MapLayerFiltersState) => {
    setAppliedState(previous => sameMapLayerFilters(previous, next) ? previous : next);
  }, []);
  const resetApplied = useCallback(() => setAppliedState(DEFAULT_MAP_LAYER_FILTERS), []);
  const value = useMemo(() => ({ applied, setApplied, resetApplied }), [applied, setApplied, resetApplied]);
  return <MapLayerFiltersContext.Provider value={value}>{children}</MapLayerFiltersContext.Provider>;
}

export function useMapLayerFilters(): MapLayerFiltersContextValue {
  const value = useContext(MapLayerFiltersContext);
  if (!value) {
    return {
      applied: DEFAULT_MAP_LAYER_FILTERS,
      setApplied: () => {},
      resetApplied: () => {},
    };
  }
  return value;
}

function SlidersGlyph() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 8h10M18 8h2M14 6v4M4 16h4M12 16h8M10 14v4" />
  </svg>;
}

/** Filter action, lavender chip and BottomSheet near map return controls. */
export function MapLayerFiltersControls() {
  const { applied, setApplied, resetApplied } = useMapLayerFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MapLayerFiltersState>(applied);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const titleId = useId();
  const active = mapLayerFiltersActive(applied);

  useEffect(() => {
    if (!open) return;
    setDraft(applied);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFirst = window.requestAnimationFrame(() => {
      sheet.current?.querySelector<HTMLElement>("button, [role=switch], [tabindex]:not([tabindex='-1'])")?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.body.style.overflow = previous;
    };
  }, [open, applied]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  function closeSheet() {
    setOpen(false);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    });
  }

  function onSheetKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
      return;
    }
    if (event.key !== "Tab" || !sheet.current) return;
    const controls = [...sheet.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [role=switch]:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(node => !node.closest("[hidden]") && node.getClientRects().length > 0);
    if (controls.length < 2) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setVenueMode(mode: VenueLayerMode) {
    setDraft(previous => previous.venueMode === mode ? previous : { ...previous, venueMode: mode });
  }

  function applyDraft() {
    setApplied(draft);
    closeSheet();
  }

  function resetDraft() {
    setDraft(DEFAULT_MAP_LAYER_FILTERS);
  }

  return <>
    <div className="gb-map-filters-cluster" aria-label="Фильтры карты">
      <button
        ref={trigger}
        type="button"
        className="gb-map-filters-action"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "gb-map-filters-sheet" : undefined}
        onClick={() => setOpen(true)}
      >
        <SlidersGlyph />
        <span>Фильтры</span>
      </button>
      {active && <div className="gb-map-filters-chip" role="status">
        <span className="gb-map-filters-chip__label">{mapLayerFiltersChipLabel(applied)}</span>
        <button
          type="button"
          className="gb-map-filters-chip__clear"
          aria-label="Сбросить фильтры"
          onClick={resetApplied}
        >
          <span aria-hidden="true">×</span>
        </button>
        <button type="button" className="gb-map-filters-chip__reset" onClick={resetApplied}>
          ↻ Сбросить фильтры
        </button>
      </div>}
    </div>
    {open && <div
      className="gb-map-filters-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) closeSheet(); }}
    >
      <section
        ref={sheet}
        id="gb-map-filters-sheet"
        className="gb-map-filters-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onSheetKeyDown}
      >
        <header className="gb-map-filters-sheet__header">
          <i className="gb-map-filters-sheet__handle" aria-hidden="true" />
          <h2 id={titleId}>Фильтры карты</h2>
          <CloseButton aria-label="Закрыть фильтры карты" onClick={closeSheet} />
        </header>
        <div className="gb-map-filters-sheet__body">
          <fieldset className="gb-map-filters-section">
            <legend>Площадки</legend>
            <div className="gb-map-filters-options" role="radiogroup" aria-label="Площадки">
              <button
                type="button"
                className="gb-discovery-chip"
                role="radio"
                aria-checked={draft.venueMode === "all"}
                aria-pressed={draft.venueMode === "all"}
                onClick={() => setVenueMode("all")}
              >
                Все площадки
              </button>
              <button
                type="button"
                className="gb-discovery-chip"
                role="radio"
                aria-checked={draft.venueMode === "with_games"}
                aria-pressed={draft.venueMode === "with_games"}
                onClick={() => setVenueMode("with_games")}
              >
                Только с играми
              </button>
            </div>
          </fieldset>
          <fieldset className="gb-map-filters-section">
            <legend>Радар игроков</legend>
            <Toggle
              label="Показывать игроков рядом"
              helper="Только отображение. Не включает Radar и не меняет согласие на геопозицию."
              on={draft.showPlayersNearby}
              onClick={() => setDraft(previous => ({ ...previous, showPlayersNearby: !previous.showPlayersNearby }))}
            />
          </fieldset>
        </div>
        <footer className="gb-map-filters-sheet__footer">
          <Button variant="outline" onClick={resetDraft}>Сбросить всё</Button>
          <Button onClick={applyDraft}>Применить</Button>
        </footer>
      </section>
    </div>}
  </>;
}
