import styles from "./Logo.module.css";

export type LogoProps = {
  size?: "sm" | "md";
  title?: string;
};

/** Canonical GoBadminton brand asset shared with the consumer shell. */
export function Logo({ size = "md", title = "GoBadminton" }: LogoProps) {
  const className = [
    styles["gb-logo"],
    size === "sm" ? styles["gb-logo--sm"] : styles["gb-logo--md"],
  ].join(" ");

  return (
    <span className={className}>
      <img src="/brand/go-badminton.svg" alt={title} width={1280} height={728} />
    </span>
  );
}
