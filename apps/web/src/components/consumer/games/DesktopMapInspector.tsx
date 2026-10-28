"use client";
import { useEffect, useState, type ReactNode } from "react";
import "../../../styles/venue-popup.css";

/** Owner #365 desktop map inspector: composition starts at 1024px. */
export const DESKTOP_MAP_INSPECTOR_MQ = "(min-width: 1024px)";

/** Client-only media match; first paint is false until the effect runs. */
export function useDesktopMapInspector(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_MAP_INSPECTOR_MQ);
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/**
 * Narrow right-rail shell for desktop map selection.
 * Width and create-dim are CSS-driven from the embedded VenueSheet data-view.
 * Does not replace VenuePopup gestures on smaller viewports.
 */
export function DesktopMapInspector({
  open,
  label,
  onDismiss,
  children,
}: {
  open: boolean;
  label?: string;
  /** Dim click / explicit dismiss closes the selection (clean map). */
  onDismiss: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return <>
    <div className="gb-desktop-map-inspector-dim" aria-hidden="true" onClick={onDismiss} />
    <aside
      className="gb-desktop-map-inspector"
      role="dialog"
      aria-label={label}
      data-desktop-inspector="true"
    >
      {children}
    </aside>
  </>;
}
