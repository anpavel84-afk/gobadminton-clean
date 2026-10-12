import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./MenuRow.module.css";

export type MenuRowProps = {
  title: string;
  tone?: "default" | "danger";
  href?: string;
  onClick?: () => void;
  gated?: string | null;
  trailing?: ReactNode;
};

export function MenuRow({
  title,
  tone = "default",
  href,
  onClick,
  gated = null,
  trailing,
}: MenuRowProps) {
  const className = [
    styles["gb-menu-row"],
    tone === "danger" ? styles["gb-menu-row--danger"] : null,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className={styles["gb-menu-row__label"]}>{title}</span>
      {trailing ?? <span className={styles["gb-menu-row__chevron"]} aria-hidden="true">›</span>}
    </>
  );

  if (gated) {
    return (
      <button
        type="button"
        className={className}
        disabled
        aria-disabled="true"
        data-gated={gated}
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}
