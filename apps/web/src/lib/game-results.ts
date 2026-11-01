import type {
  AttendanceRecord,
  AttendanceValue,
  GameResults,
  MeGameResultsPage,
} from "./consumer-types";

export function attendanceLabel(value: AttendanceValue | "unknown"): string {
  if (value === "present") return "Пришёл";
  if (value === "absent") return "Не пришёл";
  return "Не отмечено";
}

export function attendanceSourceLabel(source: AttendanceRecord["assertion"]["source"]): string {
  if (source === "self_attested") return "Сами отметили";
  if (source === "manager_explicit") return "Отметил организатор";
  if (source === "case_reviewer") return "Решение по обращению";
  return "Источник неизвестен";
}

/** Compact day/month badge in game timezone; full date/time stays in context text. */
export function formatGameDateBadge(iso: string | undefined, timezone?: string): { day: string; month: string } {
  if (!iso) return { day: "—", month: "" };
  try {
    const day = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      timeZone: timezone || undefined,
    }).format(new Date(iso));
    const month = new Intl.DateTimeFormat("ru-RU", {
      month: "short",
      timeZone: timezone || undefined,
    })
      .format(new Date(iso))
      .replace(".", "")
      .toUpperCase();
    return { day, month };
  } catch {
    return { day: "—", month: "" };
  }
}

export function canOfferAttendanceWrites(results: GameResults | null | undefined): boolean {
  if (!results?.attendance) return false;
  return results.attendance.installed && results.attendance.writesEnabled;
}

export function pendingOwnNotice(page: MeGameResultsPage | null | undefined): number {
  if (!page) return 0;
  return page.items.filter((item) => item.notice && !item.notice.acknowledgedAt).length;
}

export function resultsPath(gameId: string): string {
  return `/my-games/${gameId}/results`;
}
