"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** One DOM action surface: desktop rail → DR-08 mobile bar. Reserve its actual height. */
export function GameActionBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const surface = element?.closest<HTMLElement>(".gb-games-detail, .gb-game-preview");
    if (!element || !surface) return;
    const observer = new ResizeObserver(() => surface.style.setProperty("--gb-game-action-height", `${element.getBoundingClientRect().height + 24}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="gb-game-action" role="region" aria-label="Действия игры" aria-live="polite">{children}</div>;
}
