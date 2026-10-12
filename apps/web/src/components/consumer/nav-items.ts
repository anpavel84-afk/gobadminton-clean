export type ConsumerNavActive = "games" | "players" | "my-games" | "messages" | "profile" | "none";

export type RootNavItem = {
  id: Exclude<ConsumerNavActive, "none">;
  href: string;
  label: string;
  icon: "games" | "players" | "mine" | "profile" | "messages";
};

/** Canonical primary sections shared by the desktop and compact menus. */
export const DESKTOP_NAV_ITEMS: RootNavItem[] = [
  { id: "games", href: "/games", label: "Игры", icon: "games" },
  { id: "players", href: "/players", label: "Игроки", icon: "players" },
  { id: "my-games", href: "/my-games", label: "Мои игры", icon: "mine" },
];

/** Mobile bottom navigation follows the WEB94 owner decision. */
export const MOBILE_NAV_ITEMS: RootNavItem[] = [
  ...DESKTOP_NAV_ITEMS,
  { id: "messages", href: "/messages", label: "Сообщения", icon: "messages" },
];
