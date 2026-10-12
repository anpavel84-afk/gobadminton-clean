import Link from "next/link";
import styles from "./AccountSidebar.module.css";

export type AccountLocalNav =
  | "profile"
  | "games"
  | "providers"
  | "sessions"
  | "help"
  | "deletion";

export type AccountSidebarProps = {
  active: AccountLocalNav;
};

const items: Array<{ id: AccountLocalNav; href: string; label: string }> = [
  { id: "profile", href: "/account", label: "Профиль" },
  { id: "games", href: "/account/games", label: "Мои игры" },
  { id: "providers", href: "/account/providers", label: "Способы входа" },
  { id: "sessions", href: "/account/sessions", label: "Сессии" },
  { id: "help", href: "/account/help", label: "Помощь и документы" },
];

export function AccountSidebar({ active }: AccountSidebarProps) {
  return (
    <nav className="gb-account-sidebar" aria-label="Локальная навигация аккаунта">
      <p className={styles["gb-sidebar-title"]}>Аккаунт</p>
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={[
            styles["gb-sidebar-link"],
            active === item.id ? styles["gb-sidebar-link--active"] : null,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={active === item.id ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
