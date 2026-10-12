import styles from "./Badge.module.css";

export type BadgeTone =
  | "subtle"
  | "brand"
  | "pending"
  | "confirmed"
  | "danger"
  | "info"
  | "conflict";

export type BadgeProps = {
  children: string;
  tone?: BadgeTone;
};

export function Badge({ children, tone = "subtle" }: BadgeProps) {
  return (
    <span className={`${styles["gb-badge"]} ${styles[`gb-badge--${tone}`]}`}>
      {children}
    </span>
  );
}
