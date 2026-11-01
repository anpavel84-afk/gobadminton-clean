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

/** Bounded open disputes from the current roster page + own attendance — no full-DB fetch. */
export function listOpenAttendanceDisputes(results: GameResults | null | undefined): Array<{
  disputeId: string;
  contextId: string;
  displayName: string;
  version: number;
  challengedVersion: number;
  value: AttendanceRecord["value"];
  source: "own" | "roster";
}> {
  if (!results?.attendance) return [];
  const out: Array<{
    disputeId: string;
    contextId: string;
    displayName: string;
    version: number;
    challengedVersion: number;
    value: AttendanceRecord["value"];
    source: "own" | "roster";
  }> = [];
  const seen = new Set<string>();
  const my = results.attendance.myAttendance;
  if (my?.dispute?.status === "open") {
    seen.add(my.dispute.id);
    out.push({
      disputeId: my.dispute.id,
      contextId: my.contextId,
      displayName: my.displayName,
      version: my.dispute.version,
      challengedVersion: my.dispute.challengedVersion,
      value: my.value,
      source: "own",
    });
  }
  for (const row of results.attendance.roster ?? []) {
    if (row.dispute?.status !== "open" || seen.has(row.dispute.id)) continue;
    seen.add(row.dispute.id);
    out.push({
      disputeId: row.dispute.id,
      contextId: row.contextId,
      displayName: row.displayName,
      version: row.dispute.version,
      challengedVersion: row.dispute.challengedVersion,
      value: row.value,
      source: "roster",
    });
  }
  return out;
}

/** Default pick: own open dispute, else first open on the current roster page. */
export function defaultOpenDisputeId(results: GameResults | null | undefined): string | null {
  const open = listOpenAttendanceDisputes(results);
  const own = open.find((item) => item.source === "own");
  return own?.disputeId ?? open[0]?.disputeId ?? null;
}
