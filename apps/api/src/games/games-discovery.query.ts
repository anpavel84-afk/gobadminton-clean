import { discoveryModerationSql } from "../game-moderation/projection";
import { unprocessable } from "../auth/problem";

export type DiscoveryInput = {
  cityId?: string; startsFrom?: string; startsBefore?: string;
  levelScaleId?: string; levelId?: string; activityKind?: string;
  temporalScope?: string; venueId?: string;
  /** Opaque public training role handle — not authorization; discovery gates still apply. */
  trainerRoleHandle?: string;
};
export type DiscoveryFilter = {
  cityId: string | null; startsFrom: string | null; startsBefore: string | null;
  levelScaleId: string | null; levelId: string | null;
  activityKind: "regular" | "trainer_led" | null;
  temporalScope: "all" | "upcoming"; venueId: string | null;
  trainerRoleHandle: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleHandle = /^[0-9a-f]{32}$/i;

/** Legacy omission/empty-value/date parsing stays in this adapter. */
export function normalizeDiscovery(input: DiscoveryInput): DiscoveryFilter {
  if (input.levelId && !input.levelScaleId) throw unprocessable("LEVEL_FILTER_INVALID", "levelId требует levelScaleId");
  for (const [key, code] of [["cityId", "CITY_ID_INVALID"], ["venueId", "VENUE_ID_INVALID"]] as const) {
    if (input[key] && !uuid.test(input[key])) throw unprocessable(code, `Некорректный ${key}`);
  }
  const activity = input.activityKind || null;
  if (activity !== null && activity !== "regular" && activity !== "trainer_led") throw unprocessable("ACTIVITY_KIND_INVALID", "activityKind должен быть regular или trainer_led");
  const scope = input.temporalScope ?? "all";
  if (scope !== "all" && scope !== "upcoming") throw unprocessable("TEMPORAL_SCOPE_INVALID", "Некорректный temporalScope");
  const trainer = input.trainerRoleHandle?.trim() || null;
  if (trainer && !roleHandle.test(trainer)) {
    throw unprocessable("TRAINER_ROLE_HANDLE_INVALID", "Некорректный trainerRoleHandle");
  }
  const instant = (value: string | undefined, key: string) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw unprocessable("DATETIME_INVALID", `Некорректный ${key}`);
    return date.toISOString();
  };
  return {
    cityId: input.cityId || null, venueId: input.venueId || null,
    startsFrom: instant(input.startsFrom, "startsFrom"), startsBefore: instant(input.startsBefore, "startsBefore"),
    levelScaleId: input.levelScaleId || null, levelId: input.levelId || null,
    activityKind: activity, temporalScope: scope,
    trainerRoleHandle: trainer ? trainer.toLowerCase() : null,
  };
}

/** The only public Games eligibility predicate. Pagination is applied by the list projection. */
export function eligibleGames(filter: DiscoveryFilter, moderationEnabled = false): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const where = [discoveryModerationSql(moderationEnabled),"g.status = 'published'", "g.visibility = 'public'", "g.activity_kind IS NOT NULL"];
  const add = (value: unknown, sql: (placeholder: string) => string) => {
    if (value === null) return;
    params.push(value); where.push(sql(`$${params.length}`));
  };
  add(filter.cityId, p => `v.city_id = ${p}::uuid`);
  add(filter.startsFrom, p => `g.starts_at >= ${p}::timestamptz`);
  add(filter.startsBefore, p => `g.starts_at < ${p}::timestamptz`);
  add(filter.levelScaleId, p => `g.level_scale_id = ${p}`);
  add(filter.levelId, p => `g.allowed_level_ids ? ${p}`);
  add(filter.activityKind, p => `g.activity_kind = ${p}`);
  add(filter.venueId, p => `v.id = (SELECT id FROM effective_venues WHERE source_id = ${p}::uuid)`);
  // Opaque training roleHandle narrows public trainer_led cards; never opens private games.
  // Prefer proof tip when present; otherwise read-only CLEAN fallback for pre-0054
  // trainer_led + immutable trainer_profile owner matching the same role handle.
  add(
    filter.trainerRoleHandle,
    (p) => `(
      EXISTS (
        SELECT 1 FROM game_role_proofs grp
        JOIN role_reputation_subjects rrs
          ON rrs.subject_user_id = grp.subject_user_id AND rrs.role = grp.role
        WHERE grp.game_id = g.id
          AND grp.role = 'training'
          AND rrs.public_handle = ${p}
      )
      OR (
        g.activity_kind = 'trainer_led'
        AND g.trainer_profile_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM game_role_proofs p
          WHERE p.game_id = g.id AND p.role = 'training'
        )
        AND EXISTS (
          SELECT 1 FROM trainer_profiles tp
          JOIN role_reputation_subjects rrs
            ON rrs.subject_user_id = tp.user_id AND rrs.role = 'training'
          WHERE tp.id = g.trainer_profile_id
            AND rrs.public_handle = ${p}
        )
      )
    )`,
  );
  if (filter.temporalScope === "upcoming") where.push("g.starts_at > statement_timestamp()");
  return { where: where.join(" AND "), params };
}
