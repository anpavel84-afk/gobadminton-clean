import {
  DEMO_ISSUER_NAMESPACE,
  isDemoUuid,
} from "../database/demo-ids";

/** Reserved synthetic / DEV-QA identity space — never count as real pilot facts. */
export const PILOT_DEMO_UUID_SQL =
  `^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$`;

export const PILOT_DEMO_ISSUER_NAMESPACE = DEMO_ISSUER_NAMESPACE;

export const PILOT_MAX_WINDOW_DAYS = 365;
export const PILOT_DEFAULT_WINDOW_DAYS = 30;

export const PILOT_FORMULAS_RU = {
  applications:
    "Заявки: число различных committed-попыток (игра, пользователь, attempt). Каждая запись перехода в pending (первая или повтор после withdrawn/rejected/removed/expired) — одна заявка. Повтор того же HTTP/outbox не создаёт новый переход и не увеличивает счётчик. Текущее число строк participations не используется.",
  confirmations:
    "Подтверждения: число переходов в confirmed по зафиксированным попыткам той же когорты игр. Отдельно от текущего распределения статусов.",
  confirmationRate:
    "Доля подтверждений: подтверждённые попытки / валидные заявки той же когорты. При нулевом знаменателе — null.",
  heldRate:
    "Доля состоявшихся: held / (held + not_held) только по явным текущим game_outcomes. Прошедшее starts_at/ends_at само по себе не означает held. Отдельно считается unknown (нет явного исхода).",
  attendance:
    "Посещаемость: только явные present/absent/unknown по подтверждённым/eligible участиям на играх с исходом held. Не выводится из конца времени или факта подтверждения.",
  repeatAttendance:
    "Повторное участие: число различных реальных пользователей с ≥2 различными held-играми и явной отметкой present / число различных пользователей с ≥1 такой игрой в окне.",
  organizers:
    "Активность организаторов: только агрегаты — организаторы (created_by_user_id) с подходящими опубликованными играми / с held / с повторными (≥2) подходящими играми в окне. Без рейтингов, идентификаторов и коммерческих KPI.",
  window:
    "Окно [from, to) в UTC по starts_at игры; город — текущий city_id площадки. Максимум 365 суток; по умолчанию последние 30 суток.",
  exclusions:
    "Исключаются DEMO/синтетика по зарезервированному UUID-пространству d0f0xxxx-0000-4000-8000-… и issuer demo:synthetic:foundation-v001; draft и отменённые игры не входят в рабочие когорты и раскрываются отдельно. Неклассифицированные ручные тестовые данные без provenance нельзя магически отделить.",
} as const;

export function isPilotDemoIdentity(id: string | null | undefined): boolean {
  return typeof id === "string" && isDemoUuid(id);
}

export function rateOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function assertNoPiiKeys(value: unknown, path = "$"): string[] {
  const banned =
    /^(email|phone|.*contact.*|displayName|display_name|organizerId|organizer_id|userId|user_id|principalId|preciseLocation|bio|token|cookie)$/i;
  const hits: string[] = [];
  if (value == null || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...assertNoPiiKeys(item, `${path}[${i}]`)));
    return hits;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (banned.test(key) && !/^(cityId|city)$/i.test(key)) {
      hits.push(`${path}.${key}`);
    }
    hits.push(...assertNoPiiKeys(child, `${path}.${key}`));
  }
  return hits;
}
