import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger";

export type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  /** Visual-only; does not run a mutation (P-gates). */
  gated?: string | null;
  authHeight?: boolean;
  widthClass?: "block" | "narrow" | "w270" | "w320" | "w354" | "w552";
} & ButtonHTMLAttributes<HTMLButtonElement>;

const widthMap = {
  block: styles["gb-btn--block"],
  narrow: styles["gb-btn--narrow"],
  w270: styles["gb-btn--w-270"],
  w320: styles["gb-btn--w-320"],
  w354: styles["gb-btn--w-354"],
  w552: styles["gb-btn--w-552"],
} as const;

export function Button({
  children,
  variant = "primary",
  gated = null,
  authHeight = false,
  widthClass = "block",
  className,
  disabled,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  const isGated = Boolean(gated);
  const classes = [
    styles["gb-btn"],
    styles[`gb-btn--${variant}`],
    authHeight ? styles["gb-btn--auth"] : null,
    widthMap[widthClass],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || isGated}
      aria-disabled={disabled || isGated ? true : undefined}
      data-gated={gated ?? undefined}
      onClick={isGated ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
