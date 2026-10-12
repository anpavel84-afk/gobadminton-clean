import { Badge } from "./Badge";
import { Button } from "./Button";
import styles from "./ProviderCard.module.css";

export type ProviderId = "vk" | "yandex";
export type ProviderState = "connected" | "notConnected" | "unavailable";

export type ProviderCardProps = {
  provider: ProviderId;
  state: ProviderState;
};

const labels: Record<ProviderId, string> = {
  vk: "VK",
  yandex: "Яндекс",
};

export function ProviderCard({ provider, state }: ProviderCardProps) {
  const name = labels[provider];

  let badgeTone: "confirmed" | "subtle" | "conflict" = "subtle";
  let badgeText = "Не подключён";
  let actionLabel = `Подключить ${name}`;
  let actionVariant: "primary" | "secondary" = "primary";
  let gated: string | null = "P-04";

  if (state === "connected") {
    badgeTone = "confirmed";
    badgeText = "Подключён";
    actionLabel = `Отключить ${name}`;
    actionVariant = "secondary";
    gated = "P-04";
  } else if (state === "unavailable") {
    badgeTone = "conflict";
    badgeText = "Временно недоступен";
    actionLabel = "Сейчас недоступно";
    actionVariant = "secondary";
    gated = "P-04";
  }

  return (
    <article className={styles["gb-provider"]} data-provider={provider} data-state={state}>
      <div className={styles["gb-provider__identity"]}>{name}</div>
      <Badge tone={badgeTone}>{badgeText}</Badge>
      <div className={styles["gb-provider__actions"]}>
        <Button variant={actionVariant} gated={gated} widthClass="block">
          {actionLabel}
        </Button>
      </div>
    </article>
  );
}
