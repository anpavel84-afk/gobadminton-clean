/**
 * Explicit visual fixture/demo adapters for frozen Player Cabinet states.
 * These are NOT live account data and do NOT enable P-01–P-07 commands.
 */

import type { GameItem } from "../components/account/Games";
import type { ProviderState } from "../components/account/ProviderCard";

export type DemoProfile = {
  name: string;
  summary: string;
  selfDeclaredBadge: string;
  organizerAccess: boolean;
};

export type DemoProviders = {
  vk: ProviderState;
  yandex: ProviderState;
  notice?: { title: string; body: string; tone: "conflict" | "info" | "danger" | "neutral" };
};

export type DemoSession = {
  kind: "current" | "other";
  deviceLabel: string;
  activityLabel: string;
};

export type DemoGamesBundle = {
  upcoming: GameItem[];
  awaiting: GameItem[];
  history: GameItem[];
  cancelledNotice?: { title: string; body: string };
  awaitingIntro?: string;
  historyDisclaimer?: string;
};

export const demoProfileNormal: DemoProfile = {
  name: "Анна Петрова",
  summary: "Москва · Средний",
  selfDeclaredBadge: "Уровень указан самостоятельно",
  organizerAccess: false,
};

export const demoProfileOrganizer: DemoProfile = {
  ...demoProfileNormal,
  organizerAccess: true,
};

export const demoProvidersSingle: DemoProviders = {
  vk: "connected",
  yandex: "notConnected",
};

export const demoProvidersBoth: DemoProviders = {
  vk: "connected",
  yandex: "connected",
};

export const demoProvidersUnavailable: DemoProviders = {
  vk: "connected",
  yandex: "unavailable",
  notice: {
    tone: "conflict",
    title: "Яндекс временно недоступен",
    body: "Подключение сейчас недоступно. Существующая связь и сессия не удаляются из-за сбоя провайдера.",
  },
};

export const demoSessionsAll: DemoSession[] = [
  {
    kind: "current",
    deviceLabel: "Chrome · Windows",
    activityLabel: "Активна сейчас",
  },
  {
    kind: "other",
    deviceLabel: "Safari · iPhone",
    activityLabel: "Была активна вчера",
  },
];

export const demoSessionsCurrentOnly: DemoSession[] = [
  {
    kind: "current",
    deviceLabel: "Chrome · Windows",
    activityLabel: "Активна сейчас",
  },
];

export const demoGames: DemoGamesBundle = {
  upcoming: [
    {
      id: "g1",
      when: "Сб, 4 окт · 19:00",
      venue: "Badminton Club North",
      format: "Микст · Средний",
      ownStatus: "confirmed",
    },
    {
      id: "g2",
      when: "Вс, 5 окт · 11:00",
      venue: "Олимпийский",
      format: "Парный · Начальный",
      ownStatus: "pending",
    },
  ],
  awaiting: [
    {
      id: "g3",
      when: "Пн, 6 окт · 20:00",
      venue: "Smash Arena",
      format: "Одиночный · Средний",
      ownStatus: "pending",
    },
  ],
  history: [
    {
      id: "h1",
      when: "Пт, 26 сен · 18:00",
      venue: "Court House",
      format: "Микст · Средний",
      ownStatus: "rejected",
    },
    {
      id: "h2",
      when: "Чт, 25 сен · 19:30",
      venue: "Badminton Club North",
      format: "Парный · Средний",
      ownStatus: "withdrawn",
    },
    {
      id: "h3",
      when: "Ср, 24 сен · 12:00",
      venue: "City Hall Courts",
      format: "Микст · Начальный",
      ownStatus: "cancelled",
    },
    {
      id: "h4",
      when: "Вт, 23 сен · 21:00",
      venue: "Smash Arena",
      format: "Одиночный · Средний",
      ownStatus: "expired",
    },
  ],
  cancelledNotice: {
    title: "Игра отменена",
    body: "Организатор отменил игру 7 октября. Карточка остаётся в ближайших до обновления списка.",
  },
  awaitingIntro: "Заявка отправлена — место ещё не подтверждено.",
  historyDisclaimer:
    "История показывает исход заявки. Статус не подтверждает, что игра состоялась или что вы присутствовали.",
};

/** Gates that remain disabled in this UI slice. */
export const DISABLED_P_GATES = [
  "P-01",
  "P-02",
  "P-03",
  "P-04",
  "P-05",
  "P-06",
  "P-07",
] as const;

export function assertNoMutationHandlers(element: {
  getAttribute: (name: string) => string | null;
}): boolean {
  const gated = element.getAttribute("data-gated");
  return gated != null && DISABLED_P_GATES.includes(gated as (typeof DISABLED_P_GATES)[number]);
}
