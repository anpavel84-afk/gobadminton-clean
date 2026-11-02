import type {
  AttendanceRecord,
  AttendanceValue,
  GameResults,
  GameReview,
  MeGameResultsPage,
  PeerReviewRating,
  ReviewKind,
} from "./consumer-types";

export type ResultsSection = "attendance" | "clarification" | "feedback";

export type MeGameResultsItem = MeGameResultsPage["items"][number];

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

/** Validated results tab from URL; unknown/untrusted values fall back to attendance. */
export function parseResultsSection(raw: string | null | undefined): ResultsSection {
  if (raw === "feedback" || raw === "clarification" || raw === "attendance") return raw;
  return "attendance";
}

export function resultsPath(gameId: string, section?: ResultsSection): string {
  const base = `/my-games/${gameId}/results`;
  if (!section || section === "attendance") return base;
  return `${base}?section=${section}`;
}

/** History-surface peer rating labels (distinct from create-form titles). */
export function peerReviewHistoryLabel(rating: PeerReviewRating | null | undefined): string {
  if (rating === "play_again") return "Сыграл бы снова";
  if (rating === "neutral") return "Нейтрально";
  if (rating === "difficulties") return "Были трудности";
  return "—";
}

export function reviewKindLabel(kind: ReviewKind): string {
  if (kind === "peer") return "Отзыв игроку";
  if (kind === "organization") return "Отзыв организации";
  return "Тренировочный отзыв";
}

export function reviewAudienceLabel(direction: GameReview["direction"]): string {
  return direction === "sent" ? "Отправленные" : "Полученные";
}

/** Own private history rows not already covered by ordinary participation/managed cards. */
export function ownResultsNotCoveredByGames(
  items: MeGameResultsItem[],
  coveredGameIds: ReadonlySet<string>,
): MeGameResultsItem[] {
  const seen = new Set<string>();
  const out: MeGameResultsItem[] = [];
  for (const item of items) {
    if (coveredGameIds.has(item.gameId) || seen.has(item.gameId)) continue;
    seen.add(item.gameId);
    out.push(item);
  }
  return out;
}

export function findOwnResultForGame(
  items: MeGameResultsItem[],
  gameId: string,
): MeGameResultsItem | undefined {
  return items.find((item) => item.gameId === gameId);
}

export function ownResultPendingNotice(item: MeGameResultsItem): boolean {
  return Boolean(item.notice && !item.notice.acknowledgedAt);
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
