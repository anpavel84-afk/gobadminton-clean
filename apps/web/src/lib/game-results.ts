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
  return "Источник неизвестен";
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
