"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import "../../../styles/fullscreen-map.css";

/** Shared map surface owns the viewport; list chrome is unmounted, never covered. */
export function FullscreenMap({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const frame = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const measure = () => {
      element.style.height = `${viewport?.height ?? window.innerHeight}px`;
      element.style.width = `${viewport?.width ?? window.innerWidth}px`;
      element.style.top = `${viewport?.offsetTop ?? 0}px`;
      element.style.left = `${viewport?.offsetLeft ?? 0}px`;
    };
    measure(); back.current?.focus({ preventScroll: true });
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure); viewport?.addEventListener("scroll", measure);
    return () => { window.removeEventListener("resize", measure); viewport?.removeEventListener("resize", measure); viewport?.removeEventListener("scroll", measure); };
  }, []);
  return <main ref={frame} id="gb-main" className="gb-consumer gb-fullscreen-map" aria-label="Игры и площадки на карте" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) onBack(); }}>
    {children}<button ref={back} type="button" className="gb-map-back" onClick={onBack}><span aria-hidden="true">←</span>К списку</button>
  </main>;
}
