"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Measure chrome rather than assuming header/nav heights; visualViewport follows browser bars. */
export function GamesMapViewport({ children, fullscreen = false }: { children: ReactNode; fullscreen?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const shell = element.closest(".gb-app-shell");
    const nav = shell?.querySelector(".gb-bottom-nav");
    const action = shell?.querySelector(".gb-games-view-action");
    let request = 0;
    const measure = () => {
      if (fullscreen) {
        element.style.height = `${viewport?.height ?? window.innerHeight}px`;
        element.style.top = `${viewport?.offsetTop ?? 0}px`;
        element.style.left = `${viewport?.offsetLeft ?? 0}px`;
        element.style.width = `${viewport?.width ?? window.innerWidth}px`;
        return;
      }
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const navBox = nav?.getBoundingClientRect();
      const navBottom = navBox && navBox.height > 0 ? Math.min(bottom, navBox.top) : bottom;
      const actionBox = action?.getBoundingClientRect();
      const usableBottom = actionBox && actionBox.height > 0 ? Math.min(navBottom, actionBox.top) : navBottom;
      const height = Math.max(0, usableBottom - element.getBoundingClientRect().top);
      element.style.height = `${height}px`;
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    // Observe controls/header/nav, not the frame whose height we write.
    if (element.parentElement) for (const sibling of element.parentElement.children) if (sibling !== element) observer.observe(sibling);
    const header = shell?.querySelector(".gb-topbar");
    if (header) observer.observe(header);
    if (nav) observer.observe(nav);
    if (action) observer.observe(action);
    window.scrollTo(0, 0);
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("gb-games-action-layout", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(request); observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("gb-games-action-layout", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [fullscreen]);
  return <div ref={frame} className={`gb-games-map-viewport${fullscreen ? " gb-fullscreen-map-viewport" : ""}`}>{children}</div>;
}
