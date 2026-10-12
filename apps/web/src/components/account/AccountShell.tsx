import type { ReactNode } from "react";
import { AccountSidebar, type AccountLocalNav } from "./AccountSidebar";
import { GlobalNav, type GlobalNavActive } from "./GlobalNav";
import { Logo } from "./Logo";

export type AccountShellProps = {
  title: string;
  globalActive: GlobalNavActive;
  localActive: AccountLocalNav;
  children: ReactNode;
  /** Deletion accepted/completed: no normal account nav/sidebar. */
  reducedChrome?: boolean;
  mobileContext?: string;
  showMobileNav?: boolean;
};

export function AccountShell({
  title,
  globalActive,
  localActive,
  children,
  reducedChrome = false,
  mobileContext = "Аккаунт",
  showMobileNav = true,
}: AccountShellProps) {
  if (reducedChrome) {
    return (
      <div className="gb-shell gb-shell--desktop-pad">
        <div className="gb-mobile-header">
          <Logo size="sm" />
        </div>
        <GlobalNav active="none" hidden />
        <main className="gb-account-main" id="account-main">
          <h1 className="gb-type-h1 gb-page-title-mobile">{title}</h1>
          <h1 className="gb-type-display gb-desktop-heading">{title}</h1>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="gb-shell gb-shell--desktop-pad">
      <div className="gb-mobile-header gb-mobile-only">
        <Logo size="sm" />
        <span className="gb-type-micro gb-mobile-header__context">{mobileContext}</span>
      </div>

      <div className="gb-desktop-only">
        <GlobalNav active={globalActive} />
      </div>

      <h1 className="gb-type-h1 gb-page-title-mobile gb-mobile-only">{title}</h1>
      <h1 className="gb-type-display gb-desktop-heading">{title}</h1>

      <div className="gb-account-layout">
        <AccountSidebar active={localActive} />
        <main className="gb-account-main" id="account-main">
          {children}
        </main>
      </div>

      {showMobileNav ? (
        <div className="gb-mobile-only">
          <GlobalNav active={globalActive} />
        </div>
      ) : null}
    </div>
  );
}
