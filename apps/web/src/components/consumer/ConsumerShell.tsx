import type { ReactNode } from "react";
import { DesktopNav, InboxCountProvider, RootNav, type ConsumerNavActive } from "./RootNav";
import { DesktopFooter } from "./DesktopFooter";



export type ConsumerShellMode = "page" | "root" | "local" | "focused" | "document";

export type ConsumerShellProps = {
  active: ConsumerNavActive;
  title: string;
  children: ReactNode;
  /** root aliases page; local retains the page's Back/title; focused owns its scrolling. */
  mode?: ConsumerShellMode;
  /** Page action belongs to content, outside canonical global navigation. */
  headerAction?: ReactNode;
  /** Editorial pages supply their own canonical h1. */
  hideHeading?: boolean;
  /** ContentPage uses its compact reading footer instead of mobile root tabs. */
  reading?: boolean;
  fullscreenMap?: boolean;
};

export function ConsumerShell({ active, title, children, mode = "page", headerAction, hideHeading = false, reading = false, fullscreenMap = false }: ConsumerShellProps) {
  const surface = mode === "root" ? "page" : mode;
  const focused = surface === "focused";
  const showHeading = surface === "page" || surface === "document";
  return (
    <InboxCountProvider><div className={`gb-consumer gb-app-shell gb-app-shell--${surface}${reading ? " gb-app-shell--reading" : ""}`} data-shell-mode={surface}>
      {!fullscreenMap && <a className="gb-skip-link" href="#gb-main">К содержимому</a>}
      {!fullscreenMap && <DesktopNav active={active} />}
      <main id="gb-main" tabIndex={-1} className={`gb-shell-content gb-shell-content--${surface}`} aria-label={title}>
        {showHeading && !hideHeading && <div className="gb-page-heading"><h1>{title}</h1>{headerAction}</div>}
        {children}
      </main>
      {!focused && !fullscreenMap && <DesktopFooter />}
      {!focused && !reading && !fullscreenMap && <RootNav active={active} />}
    </div></InboxCountProvider>
  );
}
