"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createContext, useContext, type ReactNode } from "react";
import { RadarStatusAffordance } from "./radar/RadarSessionProvider";
import { ConsumerLogo } from "./Logo";
import { MessageGlyph, NavIcon } from "./NavIcon";
import { foregroundUpdates, privateActor } from "../../lib/foreground-updates";
import { apiFetch, getMe } from "../../lib/api-client";
import { inboxCount } from "../../lib/inbox-presentation";
import type { InboxCounts } from "../../lib/messaging-types";
import { headerAvatarUrls, useHeaderIdentity } from "../../lib/header-identity";
import { initialsFromName } from "../../lib/player-presentation";
import { DESKTOP_NAV_ITEMS, MOBILE_NAV_ITEMS, type ConsumerNavActive } from "./nav-items";

export type { ConsumerNavActive } from "./nav-items";

const InboxCountContext = createContext(0);

export function InboxCountProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true, sequence = 0, dispose: (() => void) | undefined;
    async function session() {
      const current = ++sequence;
      dispose?.(); setCount(0);
      const me = await getMe();
      if (!live || current !== sequence) return;
      if (!me.ok) { foregroundUpdates.clear(); return; }
      foregroundUpdates.session(privateActor(me.data));
      dispose = foregroundUpdates.subscribe<InboxCounts>("counts", 15000, ({ signal }) => apiFetch("/v1/me/inbox/counts", { signal }), r => setCount(r.ok ? inboxCount(r.data) : 0));
    }
    const expired = () => { ++sequence; dispose?.(); setCount(0); };
    void session();
    window.addEventListener("gb-session-changed", session); window.addEventListener("gb-private-expired", expired);
    return () => { live = false; ++sequence; dispose?.(); window.removeEventListener("gb-session-changed", session); window.removeEventListener("gb-private-expired", expired); };
  }, []);
  return <InboxCountContext.Provider value={count}>{children}</InboxCountContext.Provider>;
}

export function RootNav({ active }: { active: ConsumerNavActive }) {
  const count = useContext(InboxCountContext);
  return (
    <nav className="gb-bottom-nav" aria-label="Основная навигация">
      {MOBILE_NAV_ITEMS.map(item => {
        const link = <Link href={item.href} aria-current={active === item.id ? "page" : undefined}>
          <NavIcon name={item.icon} />{item.id === "messages" && <InboxBadge count={count} />}<span>{item.label}</span>
        </Link>;
        return item.id === "messages" ? <div key={item.id} className="gb-mobile-messages"><RadarStatusAffordance />{link}</div> : <div key={item.id} className="gb-mobile-tab">{link}</div>;
      })}
    </nav>
  );
}

export function InboxBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <b className="gb-message-count" aria-label={`${count} требуют внимания`}>{count > 99 ? "99+" : count}</b>;
}

// LS-06 named counts: requests/attention and unread threads are disjoint.
function MessagesAction() {
  const pathname = usePathname();
  const count = useContext(InboxCountContext);
  return <Link href="/messages" className="gb-header-message" aria-label="Сообщения"
    aria-current={pathname === "/messages" || pathname.startsWith("/messages/") ? "page" : undefined}><MessageGlyph /><InboxBadge count={count} /></Link>;
}

function ProfileAction() {
  const { identity, imageGeneration } = useHeaderIdentity(usePathname());
  const name = identity?.name || "Профиль";
  return (
    <Link href="/profile" className="gb-header-profile" aria-label={identity ? `Профиль: ${name}` : "Профиль"}>
      <HeaderAvatar key={imageGeneration} identity={identity} />
      <span className="gb-header-profile-label" title={identity?.name}>{name}</span>
    </Link>
  );
}

function HeaderAvatar({ identity }: { identity: ReturnType<typeof useHeaderIdentity>["identity"] }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const image = headerAvatarUrls(identity?.avatar).find(url => !failedUrls.includes(url));
  return <span className="gb-header-avatar" aria-hidden="true">{image
    ? <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrls(previous => previous.includes(image) ? previous : [...previous, image])} />
    : identity?.name ? initialsFromName(identity.name) : "?"}</span>;
}

export function DesktopNav({ active }: { active: ConsumerNavActive }) {
  const pathname = usePathname();
  // A route change discards the previous disclosure, including browser Back/Forward.
  return <HeaderNavigation key={pathname} active={active} />;
}

function HeaderNavigation({ active }: { active: ConsumerNavActive }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => { setMenuOpen(false); triggerRef.current?.focus(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setMenuOpen(false);
    };
    const compact = window.matchMedia("(min-width: 721px) and (max-width: 1050px)");
    const onResize = () => { if (!compact.matches) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    compact.addEventListener("change", onResize);
    menuRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
      compact.removeEventListener("change", onResize);
    };
  }, [menuOpen]);

  return (
    <header className="gb-topbar">
      <div className="gb-topbar-inner">
        <Link href="/games" aria-label="GoBadminton — Игры" className="gb-brand-link"><ConsumerLogo /></Link>
        <nav className="gb-desktop-nav" aria-label="Разделы">
          {DESKTOP_NAV_ITEMS.map((item) => (
            <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
        <div className="gb-topbar-actions">
          <RadarStatusAffordance /><MessagesAction /><ProfileAction />
          <button ref={triggerRef} type="button" className="gb-menu-trigger" aria-expanded={menuOpen}
            aria-controls={menuId} onClick={() => setMenuOpen((open) => !open)}>
            Меню <b aria-hidden="true">{menuOpen ? "×" : "≡"}</b>
          </button>
        </div>
        {menuOpen && (
          <nav ref={menuRef} id={menuId} className="gb-compact-menu" aria-label="Меню разделов">
            {DESKTOP_NAV_ITEMS.map((item) => (
              <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}
                onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }}>{item.label}</Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
