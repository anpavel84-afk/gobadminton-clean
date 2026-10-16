"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Measure chrome rather than assuming header/nav heights; visualViewport follows browser bars. */
export function GamesMapViewport({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const shell = element.closest(".gb-app-shell");
    const nav = shell?.querySelector(".gb-bottom-nav");
    let request = 0;
    const measure = () => {
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const navBox = nav?.getBoundingClientRect();
      const usableBottom = navBox && navBox.height > 0 ? Math.min(bottom, navBox.top) : bottom;
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
    window.scrollTo(0, 0);
    measure();
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(request); observer.disconnect();
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, []);
  return <div ref={frame} className="gb-games-map-viewport">{children}</div>;
}
