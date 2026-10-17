"use client";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../Button";
import { DiscoveryIcon } from "../discovery/DiscoveryComposition";
import { NavIcon } from "../NavIcon";

/** A bounded action above the existing navigation, outside the map's gesture surface. */
export function GamesViewAction({ view, onClick }: { view: "list" | "map"; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const nav = element?.closest(".gb-app-shell")?.querySelector(".gb-bottom-nav");
    if (!element || !nav) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const bottom = Math.min(nav.getBoundingClientRect().top, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
      element.style.bottom = `${Math.max(0, window.innerHeight - bottom)}px`;
    };
    const observer = new ResizeObserver(measure); observer.observe(nav);
    measure(); window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure); viewport?.addEventListener("scroll", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); viewport?.removeEventListener("resize", measure); viewport?.removeEventListener("scroll", measure); };
  }, []);
  return <div ref={ref} className="gb-games-view-action"><Button variant="dark" onClick={onClick}>
    {view === "list" ? <DiscoveryIcon name="pin" /> : <NavIcon name="games" />}{view === "list" ? "Карта" : "Список"}
  </Button></div>;
}
