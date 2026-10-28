"use client";
import { useEffect, useState, type ReactNode } from "react";
import "../../../styles/venue-popup.css";
import "../../../styles/desktop-overlays.css";

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
    // Prefer standard listeners; keep legacy addListener where fixtures/browsers only expose that.
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    if (typeof media.addListener === "function") {
      media.addListener(sync);
      return () => media.removeListener(sync);
    }
  }, []);
  return desktop;
}

/**
 * Narrow right-rail shell for desktop map selection.
 * Width and create-dim are CSS-driven from the embedded VenueSheet data-view.
 * Does not replace VenuePopup gestures on smaller viewports.
 * When retainHost is set, the aside stays mounted (layout-transparent) so inner
 * content identity survives the desktop breakpoint instead of remounting.
 */
export function DesktopMapInspector({
  open,
  label,
  onDismiss,
  children,
  retainHost = false,
}: {
  open: boolean;
  label?: string;
  /** Dim click / explicit dismiss closes the selection (clean map). */
  onDismiss: () => void;
  children: ReactNode;
  /** Keep a transparent host across mobile so sheet/create state is not remounted. */
  retainHost?: boolean;
}) {
  if (!open && !retainHost) return null;
  return <>
    {open ? <div className="gb-desktop-map-inspector-dim" aria-hidden="true" onClick={onDismiss} /> : null}
    <aside
      className={open ? "gb-desktop-map-inspector" : "gb-venue-popup-host"}
      role={open ? "dialog" : undefined}
      aria-modal={open ? false : undefined}
      aria-label={open ? label : undefined}
      data-desktop-inspector={open ? "true" : undefined}
    >
      {children}
    </aside>
  </>;
}
