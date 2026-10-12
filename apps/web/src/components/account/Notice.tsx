import styles from "./Notice.module.css";

export type NoticeTone = "info" | "conflict" | "danger" | "confirmed" | "neutral";

export type NoticeProps = {
  title: string;
  body: string;
  tone?: NoticeTone;
  wide?: boolean;
};

export function Notice({ title, body, tone = "info", wide = false }: NoticeProps) {
  const className = [
    styles["gb-notice"],
    styles[`gb-notice--${tone}`],
    wide ? styles["gb-notice--wide"] : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={className} role="status">
      <p className={styles["gb-notice__title"]}>{title}</p>
      <p className={styles["gb-notice__body"]}>{body}</p>
    </aside>
  );
}
