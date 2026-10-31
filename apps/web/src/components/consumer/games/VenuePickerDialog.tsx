"use client";
import { CloseButton } from "../CloseButton";

import { VenueGallery } from "../venues/VenueGallery";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent } from "react";
import type { VenueSummary } from "../../../lib/consumer-types";
import { filterVenueOptions, sortVenueOptions } from "../../../lib/venue-picker-utils";

type Props = {
  venues: VenueSummary[];
  selectedId: string;
  status: "loading" | "ready" | "error";
  onSelect: (venue: VenueSummary) => void;
  onClose: () => void;
  onRetry: () => void;
};

/** Trusted API projection length, capped at Gallery's existing 8-item bound. */
function galleryItemCount(venue: VenueSummary): number {
  const items = venue.profile?.gallery?.items;
  if (!Array.isArray(items)) return 0;
  return Math.min(items.length, 8);
}

/** Compact, keyboard-accessible search sheet; fullscreen on a phone. */
export function VenuePickerDialog({ venues, selectedId, status, onSelect, onClose, onRetry }: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const sorted = useMemo(() => sortVenueOptions(venues), [venues]);
  const visible = useMemo(() => filterVenueOptions(sorted, query), [sorted, query]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = oldOverflow; };
  }, []);

  function onDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const controls = [...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(el => {
      const sealed = el.closest("details:not([open])");
      if (!sealed) return true;
      // Collapsed expander: only its summary stays in the tab cycle (nav lives inside).
      const summary = sealed.querySelector(":scope > summary");
      return Boolean(summary && (el === summary || summary.contains(el)));
    });
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  return createPortal(
    <div
      className="gb-venue-picker-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        className="gb-venue-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gb-venue-picker-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="gb-venue-picker-header">
          <div>
            <h2 id="gb-venue-picker-title">Выберите площадку</h2>
            <p>Все площадки выбранного города и области</p>
          </div>
          <CloseButton aria-label="Закрыть выбор площадки" onClick={onClose} />
        </header>
        <div className="gb-venue-picker-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            aria-label="Поиск площадки"
            placeholder="Название или адрес"
            value={query}
            onChange={event => setQuery(event.target.value)}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        <p className="gb-venue-picker-count" aria-live="polite">
          {status === "loading" ? "Загружаем полный каталог…" :
            status === "error" ? "Не удалось загрузить все площадки" :
            query ? `Найдено: ${visible.length} из ${sorted.length}` : `Площадок: ${sorted.length} · по алфавиту`}
        </p>
        <div className="gb-venue-picker-scroll" role="group" aria-label="Список площадок">
          {status === "error" ? (
            <div className="gb-venue-picker-empty" role="alert">
              <p>Не удалось получить полный список. Проверьте соединение.</p>
              <button type="button" onClick={onRetry}>Повторить загрузку</button>
            </div>
          ) : status === "loading" ? (
            <p className="gb-venue-picker-empty" role="status">Подождите, загружаем площадки…</p>
          ) : visible.length ? visible.map(venue => {
            const photos = galleryItemCount(venue);
            return (
              <div key={venue.id} className="gb-venue-picker-option-block">
                <button
                  type="button"
                  className="gb-venue-picker-option"
                  aria-pressed={selectedId === venue.id}
                  onClick={() => onSelect(venue)}
                >
                  {/* Compact gallery has no nav buttons; horizontal swipe is click-suppressed so it does not select. */}
                  <VenueGallery venue={venue} size="compact" showCredit={false} className="gb-venue-cover--thumb" />
                  <span className="gb-venue-picker-option-copy">
                    <span className="gb-venue-picker-option-name">{venue.name}</span>
                    <span className="gb-venue-picker-option-address">{venue.address}</span>
                  </span>
                  {selectedId === venue.id && <span className="gb-venue-picker-check" aria-hidden="true">✓</span>}
                </button>
                {photos >= 2 ? (
                  <details className="gb-venue-picker-photos">
                    <summary tabIndex={0} className="gb-venue-picker-photos__summary">
                      Фото · {photos}
                    </summary>
                    <div className="gb-venue-picker-photos__body">
                      {/* Sibling sheet gallery: arrows, counter, focused arrow keys — outside the select button. */}
                      <VenueGallery venue={venue} size="sheet" showCredit />
                    </div>
                  </details>
                ) : null}
              </div>
            );
          }) : (
            <div className="gb-venue-picker-empty" role="status">
              {query ? "По вашему запросу ничего не найдено." : "Площадок пока нет."}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
