import type { RootNavItem } from "./nav-items";

const assets = { games: "games", players: "players", mine: "my-games", profile: "profile", messages: "messages" };

export function NavIcon({ name }: { name: RootNavItem["icon"] }) {
  if (name === "messages") return <MessageGlyph />;
  return <img className="gb-nav-icon" src={`/brand/${assets[name]}.svg`} alt="" aria-hidden="true" />;
}

export function MessageGlyph() {
  return <span className="gb-message-glyph" aria-hidden="true" />;
}
