"use client";
import type { ReactNode, Ref } from "react";
import { CloseButton, type CloseButtonProps } from "./CloseButton";
import "../../styles/desktop-overlays.css";

export type DesktopOverlayBack = {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
};

export type DesktopOverlayHeaderProps = {
  title: ReactNode;
  titleId?: string;
  /** Small uppercase type label when there is no Back control. */
  kicker?: string;
  back?: DesktopOverlayBack;
  onClose: () => void;
  closeRef?: Ref<HTMLButtonElement>;
  closeLabel?: CloseButtonProps["aria-label"];
  /** Optional second title line; long legal text still belongs in body. */
  subtitle?: ReactNode;
  className?: string;
};

/**
 * Thin presentational desktop overlay chrome: independent control row (Back/kicker + X),
 * then title. Caller owns dismiss guards; CloseButton SVG/ref contract is unchanged.
 */
export function DesktopOverlayHeader({
  title,
  titleId,
  kicker,
  back,
  onClose,
  closeRef,
  closeLabel = "Закрыть",
  subtitle,
  className,
}: DesktopOverlayHeaderProps) {
  return (
    <header className={`gb-desktop-overlay-header${className ? ` ${className}` : ""}`}>
      <div className="gb-desktop-overlay-header__chrome">
        {back ? (
          <button
            type="button"
            className="gb-desktop-overlay-header__back"
            aria-label={back.ariaLabel ?? back.label}
            onClick={back.onClick}
          >
            <span aria-hidden="true">←</span>
            <span className="gb-desktop-overlay-header__back-label">{back.label}</span>
          </button>
        ) : kicker ? (
          <small className="gb-desktop-overlay-header__kicker">{kicker}</small>
        ) : (
          <span className="gb-desktop-overlay-header__chrome-spacer" aria-hidden="true" />
        )}
        <CloseButton
          ref={closeRef}
          className="gb-desktop-overlay-header__close"
          aria-label={closeLabel}
          onClick={onClose}
        />
      </div>
      <div className="gb-desktop-overlay-header__titles">
        <h2 id={titleId} className="gb-desktop-overlay-header__title">{title}</h2>
        {subtitle ? <p className="gb-desktop-overlay-header__subtitle">{subtitle}</p> : null}
      </div>
    </header>
  );
}
