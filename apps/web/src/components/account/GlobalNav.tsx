import Link from "next/link";
import { Logo } from "./Logo";
import styles from "./GlobalNav.module.css";

export type GlobalNavActive = "find" | "games" | "profile" | "none";

export type GlobalNavProps = {
  active: GlobalNavActive;
  /** Hide global account navigation (e.g. deletion request accepted). */
  hidden?: boolean;
};

const mobileItems: Array<{ id: GlobalNavActive; href: string; label: string }> = [
  { id: "find", href: "/account/find", label: "Найти" },
  { id: "games", href: "/account/games", label: "Мои игры" },
  { id: "profile", href: "/account", label: "Профиль" },
];

const desktopItems: Array<{ id: GlobalNavActive; href: string; label: string }> = [
  { id: "find", href: "/account/find", label: "Найти игру" },
  { id: "games", href: "/account/games", label: "Мои игры" },
  { id: "profile", href: "/account", label: "Профиль" },
];

export function GlobalNav({ active, hidden = false }: GlobalNavProps) {
  if (hidden) {
    return (
      <header className={styles["gb-desktop-nav"]} data-nav="neutral">
        <Logo size="md" />
      </header>
    );
  }

  return (
    <>
      <nav className={styles["gb-mobile-nav"]} aria-label="Глобальная навигация">
        {mobileItems.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={[
              styles["gb-mobile-nav__item"],
              active === item.id ? styles["gb-mobile-nav__item--active"] : null,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={active === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <header className={styles["gb-desktop-nav"]}>
        <Link href="/account" aria-label="GoBadminton — профиль">
          <Logo size="md" />
        </Link>
        <nav className={styles["gb-desktop-nav__links"]} aria-label="Глобальная навигация">
          {desktopItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={[
                styles["gb-desktop-nav__item"],
                active === item.id ? styles["gb-desktop-nav__item--active"] : null,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={active === item.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
