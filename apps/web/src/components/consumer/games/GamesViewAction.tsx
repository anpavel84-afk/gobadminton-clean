"use client";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../Button";
import { FoldedMapGlyph } from "../NavIcon";
import "../../../styles/radar-geographic.css";

type GamesViewActionProps = {
  view: "list" | "map";
  /** Games list toggle; omit when using `href` (e.g. players Radar map entry). */
  onClick?: () => void;
  href?: string;
  /** Defaults preserve games feed copy. */
  labelFull?: string;
  labelShort?: string;
  className?: string;
  "aria-label"?: string;
};

/** A bounded action above the existing navigation, outside the map's gesture surface. */
export function GamesViewAction({
  view,
  onClick,
  href,
  labelFull = "Все игры на карте",
  labelShort = "На карте",
  className,
  "aria-label": ariaLabel,
}: GamesViewActionProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const nav = element?.closest(".gb-app-shell")?.querySelector(".gb-bottom-nav");
    if (!element || !nav) return;
    const viewport = window.visualViewport;
    const measure = () => {
      // RootNav stays in the DOM on desktop but .gb-bottom-nav is display:none above 720px;
      // measuring a hidden nav yields top:0 and would override sticky bottom:24px.
      const navDisplayed = window.getComputedStyle(nav).display !== "none";
      if (!navDisplayed) {
        element.style.bottom = "";
        window.dispatchEvent(new Event("gb-games-action-layout"));
        return;
      }
      const bottom = Math.min(nav.getBoundingClientRect().top, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
      element.style.bottom = `${Math.max(0, window.innerHeight - bottom)}px`;
      window.dispatchEvent(new Event("gb-games-action-layout"));
    };
    const observer = new ResizeObserver(measure); observer.observe(nav); observer.observe(element);
    measure(); window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure); viewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      element.style.bottom = "";
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [view]);
  if (view === "map") return null;
  const label = ariaLabel ?? labelFull;
  const classes = ["gb-games-view-action", "gb-games-view-action--feed", className].filter(Boolean).join(" ");
  const glyph = (
    <>
      <span className="gb-map-entry-tile"><FoldedMapGlyph /></span>
      <span className="gb-map-cta-label gb-map-cta-label--full">{labelFull}</span>
      <span className="gb-map-cta-label gb-map-cta-label--short">{labelShort}</span>
    </>
  );
  return <div ref={ref} className={classes} {...(className?.includes("gb-players-map-cta") ? { "data-radar-map-cta": "true" } : {})}>
    {href
      ? <Button className="gb-map-desktop-entry" variant="dark" href={href} aria-label={label}>{glyph}</Button>
      : <Button className="gb-map-desktop-entry" variant="dark" onClick={onClick} aria-label={label}>{glyph}</Button>}
  </div>;
}
