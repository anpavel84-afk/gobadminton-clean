import type { ReactNode } from "react";
import Link from "next/link";
import buttonStyles from "./Button.module.css";

type LinkButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
};

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className,
}: LinkButtonProps) {
  const classes = [
    buttonStyles["gb-btn"],
    buttonStyles[`gb-btn--${variant}`],
    buttonStyles["gb-btn--block"],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
