"use client";

import { useEffect, useRef } from "react";

/** V001 map return capsule, using the existing map-return primitive. */
export function GamesMapBackButton({ onClick }: { onClick: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    // Preserve dialog/overlay focus and pointer-driven returns to an existing map.
    if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
    button.current?.focus({ preventScroll: true });
  }, []);
  return <button ref={button} type="button" className="gb-map-return gb-games-map-back" aria-label="К списку игр" onClick={onClick}>
    <span aria-hidden="true">←</span>К списку
  </button>;
}
