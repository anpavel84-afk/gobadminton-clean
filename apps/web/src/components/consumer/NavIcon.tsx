import type { RootNavItem } from "./nav-items";
import { NAV_ICON_PATHS } from "./nav-icon-paths";

export function NavIcon({ name }: { name: RootNavItem["icon"] }) {
  if (name === "profile") return <img className="gb-nav-icon" src="/brand/profile.svg" alt="" aria-hidden="true" />;
  return <svg className="gb-nav-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">{NAV_ICON_PATHS[name]}</svg>;
}

export function MessageGlyph() {
  return <span className="gb-message-glyph" aria-hidden="true" />;
}

/** Native feather fan and cork, shared by both venue map entry points. */
export function shuttlecockElement() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M9 16 3 5l4-2 3 1 2-2 2 2 3-1 4 2-6 11M7 3l4 13M12 2v14M17 3l-4 13M9 16h6v3a3 3 0 0 1-6 0z");
  svg.append(path); return svg;
}

export function FoldedMapGlyph() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16" /></svg>;
}
