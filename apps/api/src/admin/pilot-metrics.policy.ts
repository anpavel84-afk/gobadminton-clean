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
    "Заявки: число различных committed-попыток с явной границей pending (первая или повтор после withdrawn/rejected/removed/expired) по рабочей когорте игр (не draft/не cancelled/не demo). Каждая такая граница — одна заявка. Подтверждение без pending-origin не считается заявкой. Повтор HTTP/outbox без нового перехода не увеличивает счётчик.",
  confirmations:
    "Подтверждения: число pending→confirmed, каждое сопоставленное ровно одной валидной заявке той же попытки (participation + порядок/aggregate_version). Сиротские confirmed без pending-origin не входят в числитель; покрытие помечается unknown.",
  confirmationRate:
    "Доля подтверждений: валидные подтверждённые попытки / валидные заявки той же когорты. При нулевом знаменателе или только coverage/unknown — null; rate > 1 не допускается за счёт сиротских confirm.",
  heldRate:
    "Доля состоявшихся: held / (held + not_held) только по явным текущим game_outcomes на due-играх (ends_at ≤ asOf). Прошедшее starts_at/ends_at само по себе не означает held. Unknown — только у due-игр без явного исхода; будущие опубликованные в окне заявок не становятся due/unknown.",
  attendance:
    "Посещаемость: confirmed участия на held due-играх. Явные present/absent из game_attendance; отсутствие строки отметки = unknown (не value='unknown' в CHECK 0046). Повторы present — по различным user/game.",
  repeatAttendance:
    "Повторное участие: число различных реальных пользователей с ≥2 различными held-играми и явной отметкой present / число различных пользователей с ≥1 такой игрой в окне.",
  organizers:
    "Активность организаторов: только агрегаты — организаторы (created_by_user_id) с подходящими опубликованными играми окна заявок / с held due / с повторными (≥2) подходящими играми. Без рейтингов, идентификаторов и коммерческих KPI.",
  window:
    "Окно [from, to) в UTC по starts_at игры; город — текущий city_id площадки. from/to — RFC3339 date-time с Z или numeric offset. Максимум 365 суток; по умолчанию последние 30 суток. publishedEligible — опубликованные/completed в окне; dueInWindow — среди них с ends_at ≤ asOf.",
  exclusions:
    "Исключаются DEMO/синтетика по зарезервированному UUID-пространству d0f0xxxx-0000-4000-8000-… и issuer demo:synthetic:foundation-v001; draft исключены из рабочих когорт. Cancelled раскрываются отдельно (cancelledDisclosed) и не входят в заявки/статусы/исходы/посещаемость. Неклассифицированные ручные тестовые данные без provenance нельзя магически отделить.",
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
