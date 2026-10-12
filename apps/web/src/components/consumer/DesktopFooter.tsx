import Link from "next/link";
import { ConsumerLogo } from "./Logo";

const groups = [
  { title: "Продукт", items: [
    { label: "Игры", href: "/games" }, { label: "Игроки", href: "/players" }, { label: "Мои игры", href: "/my-games" },
  ] },
  { title: "Сервис", items: [{ label: "О сервисе", href: "/about" }, { label: "Помощь", href: "/help" }, { label: "Контакты" }] },
  { title: "Документы", items: [{ label: "Пользовательское соглашение", href: "/legal/terms" }, { label: "Политика конфиденциальности", href: "/legal/privacy" }, { label: "Правила сервиса", href: "/legal/rules" }] },
  { title: "Оператор", items: [{ label: "Реквизиты" }, { label: "Информация об операторе" }] },
] satisfies { title: string; items: { label: string; href?: string }[] }[];

/** SiteFooter / DesktopFooter. Unaccepted destinations remain noninteractive. */
export function DesktopFooter() {
  return (
    <footer className="gb-site-footer">
      <div className="gb-site-footer-main">
        <div className="gb-site-footer-brand">
          <Link href="/games" aria-label="GoBadminton — Игры" className="gb-brand-link"><ConsumerLogo /></Link>
          <p>Люди. Игра. Больше хороших дней.</p>
          <img src="/brand/footer-shape.svg" alt="" aria-hidden="true" />
        </div>
        {groups.map((group) => (
          <div className="gb-site-footer-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>{group.items.map((item) => (
              <li key={item.label}>{"href" in item && item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-disabled="true">{item.label}</span>}</li>
            ))}</ul>
          </div>
        ))}
      </div>
      <div className="gb-site-footer-bottom"><span>© 2026 GoBadminton. Все права защищены.</span><span>Game first.</span></div>
    </footer>
  );
}
