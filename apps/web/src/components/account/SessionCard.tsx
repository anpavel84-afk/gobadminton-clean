import { Badge } from "./Badge";
import styles from "./SessionCard.module.css";

export type SessionKind = "current" | "other";

export type SessionCardProps = {
  kind: SessionKind;
  deviceLabel: string;
  activityLabel: string;
};

export function SessionCard({ kind, deviceLabel, activityLabel }: SessionCardProps) {
  return (
    <article className={styles["gb-session"]} data-session={kind}>
      <Badge tone={kind === "current" ? "confirmed" : "subtle"}>
        {kind === "current" ? "Это устройство" : "Другое устройство"}
      </Badge>
      <p className={styles["gb-session__device"]}>{deviceLabel}</p>
      <p className={styles["gb-session__activity"]}>{activityLabel}</p>
    </article>
  );
}
