import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { notFound } from "../auth/problem";
import { appendAudit } from "./admin-db";
import { AdminService } from "./admin.service";
import type { PilotMetricsResponse } from "./pilot-metrics.dto";
import type { PilotMetricsQuery } from "./pilot-metrics.query";
import {
  PILOT_DEMO_ISSUER_NAMESPACE,
  PILOT_DEMO_UUID_SQL,
  PILOT_FORMULAS_RU,
  rateOrNull,
} from "./pilot-metrics.policy";

type AggRow = {
  games_due: number;
  games_published: number;
  games_cancelled: number;
  games_draft: number;
  games_demo: number;
  held: number;
  not_held: number;
  unknown_outcome: number;
  applications: number;
  confirmations: number;
  status_pending: number;
  status_confirmed: number;
  status_withdrawn: number;
  status_rejected: number;
  status_removed: number;
  status_expired: number;
  attempt_withdrawn: number;
  attempt_rejected: number;
  attempt_removed: number;
  attempt_expired: number;
  attendance_present: number;
  attendance_absent: number;
  attendance_unknown: number;
  attendance_eligible: number;
  users_one_present: number;
  users_repeat_present: number;
  organizers_published: number;
  organizers_held: number;
  organizers_repeat: number;
  legacy_without_proof: number;
  as_of: Date;
};

@Injectable()
export class PilotMetricsService {
  constructor(private readonly admin: AdminService) {}

  enabled() {
    this.admin.enabled();
  }

  async summary(
    request: FastifyRequest,
    query: PilotMetricsQuery,
  ): Promise<PilotMetricsResponse> {
    this.enabled();
    return this.admin.privilegedRead(request, "pilot.read", async (client, actor) => {
      const cities = (
        await client.query<{ id: string; name_ru: string }>(
          `SELECT id, name_ru FROM cities ORDER BY name_ru ASC, id ASC`,
        )
      ).rows.map((row) => ({ id: row.id, nameRu: row.name_ru }));

      if (!query.cityId) {
        const empty = emptyAggregates(query);
        await appendAudit(client, {
          actor,
          action: "admin.pilot_metrics_read",
          targetType: "pilot_metrics",
          targetId: "00000000-0000-4000-8000-000000000000",
          permission: "pilot.read",
          reason: "operations_read",
          after: { catalogueOnly: true },
        });
        return {
          ...empty,
          city: null,
          cities,
          coverage: {
            ...empty.coverage,
            notes: ["Выберите город каталога, чтобы построить сводку."],
            sufficient: false,
          },
        };
      }

      const city = (
        await client.query<{ id: string; name_ru: string }>(
          `SELECT id, name_ru FROM cities WHERE id = $1`,
          [query.cityId],
        )
      ).rows[0];
      if (!city) throw notFound("CITY_NOT_FOUND", "Город не найден");

      const agg = await this.aggregate(client, {
        cityId: query.cityId,
        from: query.from,
        to: query.to,
      });
      const notes: string[] = [];
      if (agg.legacy_without_proof > 0) {
        notes.push(
          `Есть ${agg.legacy_without_proof} участий без доказуемых границ попытки в transitions — показаны как coverage/unknown, факты прошлого не выдуманы.`,
        );
      }
      if (agg.games_due === 0) {
        notes.push("В выбранном окне нет подходящих игр (не demo/draft) — данных недостаточно для пилотной сводки.");
      }
      if (agg.unknown_outcome > 0) {
        notes.push(
          `У ${agg.unknown_outcome} игр нет явного исхода held/not_held; они не входят в held rate.`,
        );
      }
      notes.push(
        "Неразмеченные ручные тестовые записи без provenance нельзя автоматически классифицировать как demo или реальные.",
      );

      const response: PilotMetricsResponse = {
        city: { id: city.id, nameRu: city.name_ru },
        window: {
          from: query.from.toISOString(),
          to: query.to.toISOString(),
        },
        asOf: agg.as_of.toISOString(),
        formulas: { ...PILOT_FORMULAS_RU },
        exclusionPolicy: {
          demoUuidNamespace: "d0f0xxxx-0000-4000-8000-xxxxxxxxxxxx",
          demoIssuerNamespace: PILOT_DEMO_ISSUER_NAMESPACE,
          draftExcluded: true,
          cancellationsDisclosedSeparately: true,
          unmarkedManualTestLimitation:
            "Записи без зарезервированного demo UUID/issuer не исключаются угадыванием по имени, bio или домену почты.",
        },
        coverage: {
          sufficient: agg.games_due > 0 && agg.legacy_without_proof === 0,
          notes,
          participationsWithoutAttemptProof: agg.legacy_without_proof,
          gamesDueInWindow: agg.games_due,
        },
        games: {
          dueInWindow: agg.games_due,
          publishedEligible: agg.games_published,
          cancelledDisclosed: agg.games_cancelled,
          draftExcluded: agg.games_draft,
          demoExcluded: agg.games_demo,
          held: agg.held,
          notHeld: agg.not_held,
          unknownOutcome: agg.unknown_outcome,
          heldRate: rateOrNull(agg.held, agg.held + agg.not_held),
        },
        applications: {
          count: agg.applications,
          confirmations: agg.confirmations,
          confirmationRate: rateOrNull(agg.confirmations, agg.applications),
          currentStatus: {
            pending: agg.status_pending,
            confirmed: agg.status_confirmed,
            withdrawn: agg.status_withdrawn,
            rejected: agg.status_rejected,
            removed: agg.status_removed,
            expired: agg.status_expired,
          },
          withdrawnAttempts: agg.attempt_withdrawn,
          rejectedAttempts: agg.attempt_rejected,
          removedAttempts: agg.attempt_removed,
          expiredAttempts: agg.attempt_expired,
        },
        attendance: {
          present: agg.attendance_present,
          absent: agg.attendance_absent,
          unknown: agg.attendance_unknown,
          eligibleOnHeldGames: agg.attendance_eligible,
        },
        repeatAttendance: {
          usersWithAtLeastOnePresent: agg.users_one_present,
          usersWithRepeatPresent: agg.users_repeat_present,
          rate: rateOrNull(agg.users_repeat_present, agg.users_one_present),
        },
        organizers: {
          withEligiblePublishedGames: agg.organizers_published,
          withHeldGames: agg.organizers_held,
          withRepeatEligibleGames: agg.organizers_repeat,
        },
        cities,
      };

      await appendAudit(client, {
        actor,
        action: "admin.pilot_metrics_read",
        targetType: "city",
        targetId: city.id,
        permission: "pilot.read",
        reason: "operations_read",
        after: {
          windowFrom: response.window.from,
          windowTo: response.window.to,
          gamesDue: response.games.dueInWindow,
        },
      });
      return response;
    });
  }

  private async aggregate(
    client: PoolClient,
    query: { cityId: string; from: Date; to: Date },
  ): Promise<AggRow> {
    const demoRe = PILOT_DEMO_UUID_SQL;
    const demoIssuer = PILOT_DEMO_ISSUER_NAMESPACE;
    const result = await client.query<AggRow>(
      `
      WITH snap AS (
        SELECT clock_timestamp() AS as_of
      ),
      demo_user AS (
        SELECT u.id
        FROM users u
        WHERE u.id::text ~* $4
           OR EXISTS (
             SELECT 1 FROM external_identities ei
             WHERE ei.user_id = u.id AND ei.issuer_namespace = $5
           )
      ),
      window_games_all AS (
        SELECT g.id, g.status, g.created_by_user_id, g.starts_at, v.id AS venue_id
        FROM games g
        JOIN venues v ON v.id = g.venue_id
        CROSS JOIN snap
        WHERE v.city_id = $1::uuid
          AND g.starts_at >= $2::timestamptz
          AND g.starts_at < $3::timestamptz
      ),
      demo_games AS (
        SELECT id FROM window_games_all g
        WHERE g.id::text ~* $4
           OR g.venue_id::text ~* $4
           OR g.created_by_user_id::text ~* $4
           OR g.created_by_user_id IN (SELECT id FROM demo_user)
      ),
      cohort AS (
        SELECT g.*
        FROM window_games_all g
        WHERE g.id NOT IN (SELECT id FROM demo_games)
          AND g.status <> 'draft'
      ),
      eligible AS (
        SELECT * FROM cohort WHERE status IN ('published', 'completed')
      ),
      outcomes AS (
        SELECT c.id,
               CASE
                 WHEN o.value = 'held' THEN 'held'
                 WHEN o.value = 'not_held' THEN 'not_held'
                 ELSE 'unknown'
               END AS outcome
        FROM cohort c
        LEFT JOIN game_outcomes o ON o.game_id = c.id
        WHERE c.status <> 'cancelled'
      ),
      real_parts AS (
        SELECT p.id, p.game_id, p.user_id, p.status, p.attempt_number, p.version
        FROM participations p
        JOIN cohort c ON c.id = p.game_id
        WHERE p.user_id::text !~* $4
          AND p.user_id NOT IN (SELECT id FROM demo_user)
          AND p.id::text !~* $4
      ),
      attempt_apps AS (
        SELECT pt.id AS transition_id
        FROM participation_transitions pt
        JOIN real_parts p ON p.id = pt.participation_id
        WHERE pt.to_status = 'pending'
          AND (pt.from_status IS NULL OR pt.from_status IN ('withdrawn', 'rejected', 'removed', 'expired'))
      ),
      attempt_confirms AS (
        SELECT pt.id AS transition_id
        FROM participation_transitions pt
        JOIN real_parts p ON p.id = pt.participation_id
        WHERE pt.to_status = 'confirmed'
          AND pt.from_status = 'pending'
      ),
      attempt_terminal AS (
        SELECT pt.id AS transition_id, pt.to_status,
               row_number() OVER (
                 PARTITION BY pt.participation_id, pt.aggregate_version
                 ORDER BY pt.at DESC, pt.id DESC
               ) AS rn
        FROM participation_transitions pt
        JOIN real_parts p ON p.id = pt.participation_id
        WHERE pt.to_status IN ('withdrawn', 'rejected', 'removed', 'expired')
      ),
      legacy AS (
        SELECT p.id
        FROM real_parts p
        WHERE NOT EXISTS (
          SELECT 1 FROM participation_transitions pt WHERE pt.participation_id = p.id
        )
      ),
      held_games AS (
        SELECT id FROM outcomes WHERE outcome = 'held'
      ),
      eligible_attendance AS (
        SELECT ga.user_id, ga.game_id, ga.value
        FROM game_attendance ga
        JOIN held_games h ON h.id = ga.game_id
        JOIN real_parts p ON p.id = ga.participation_id AND p.status = 'confirmed'
        WHERE ga.user_id::text !~* $4
          AND ga.user_id NOT IN (SELECT id FROM demo_user)
      ),
      present_by_user AS (
        SELECT user_id, count(DISTINCT game_id)::int AS held_present_games
        FROM eligible_attendance
        WHERE value = 'present'
        GROUP BY user_id
      ),
      org_base AS (
        SELECT e.created_by_user_id AS organizer_id, e.id AS game_id,
               EXISTS (SELECT 1 FROM held_games h WHERE h.id = e.id) AS is_held
        FROM eligible e
        WHERE e.created_by_user_id IS NOT NULL
          AND e.created_by_user_id::text !~* $4
          AND e.created_by_user_id NOT IN (SELECT id FROM demo_user)
      )
      SELECT
        (SELECT count(*)::int FROM cohort) AS games_due,
        (SELECT count(*)::int FROM eligible) AS games_published,
        (SELECT count(*)::int FROM cohort WHERE status = 'cancelled') AS games_cancelled,
        (SELECT count(*)::int FROM window_games_all WHERE status = 'draft' AND id NOT IN (SELECT id FROM demo_games)) AS games_draft,
        (SELECT count(*)::int FROM demo_games) AS games_demo,
        (SELECT count(*)::int FROM outcomes WHERE outcome = 'held') AS held,
        (SELECT count(*)::int FROM outcomes WHERE outcome = 'not_held') AS not_held,
        (SELECT count(*)::int FROM outcomes WHERE outcome = 'unknown') AS unknown_outcome,
        (SELECT count(*)::int FROM attempt_apps) AS applications,
        (SELECT count(*)::int FROM attempt_confirms) AS confirmations,
        (SELECT count(*)::int FROM real_parts WHERE status = 'pending') AS status_pending,
        (SELECT count(*)::int FROM real_parts WHERE status = 'confirmed') AS status_confirmed,
        (SELECT count(*)::int FROM real_parts WHERE status = 'withdrawn') AS status_withdrawn,
        (SELECT count(*)::int FROM real_parts WHERE status = 'rejected') AS status_rejected,
        (SELECT count(*)::int FROM real_parts WHERE status = 'removed') AS status_removed,
        (SELECT count(*)::int FROM real_parts WHERE status = 'expired') AS status_expired,
        (SELECT count(*)::int FROM attempt_terminal WHERE rn = 1 AND to_status = 'withdrawn') AS attempt_withdrawn,
        (SELECT count(*)::int FROM attempt_terminal WHERE rn = 1 AND to_status = 'rejected') AS attempt_rejected,
        (SELECT count(*)::int FROM attempt_terminal WHERE rn = 1 AND to_status = 'removed') AS attempt_removed,
        (SELECT count(*)::int FROM attempt_terminal WHERE rn = 1 AND to_status = 'expired') AS attempt_expired,
        (SELECT count(*)::int FROM eligible_attendance WHERE value = 'present') AS attendance_present,
        (SELECT count(*)::int FROM eligible_attendance WHERE value = 'absent') AS attendance_absent,
        (SELECT count(*)::int FROM eligible_attendance WHERE value = 'unknown') AS attendance_unknown,
        (SELECT count(*)::int FROM eligible_attendance) AS attendance_eligible,
        (SELECT count(*)::int FROM present_by_user) AS users_one_present,
        (SELECT count(*)::int FROM present_by_user WHERE held_present_games >= 2) AS users_repeat_present,
        (SELECT count(DISTINCT organizer_id)::int FROM org_base) AS organizers_published,
        (SELECT count(DISTINCT organizer_id)::int FROM org_base WHERE is_held) AS organizers_held,
        (SELECT count(*)::int FROM (
           SELECT organizer_id FROM org_base GROUP BY organizer_id HAVING count(*) >= 2
         ) r) AS organizers_repeat,
        (SELECT count(*)::int FROM legacy) AS legacy_without_proof,
        (SELECT as_of FROM snap) AS as_of
      `,
      [query.cityId, query.from.toISOString(), query.to.toISOString(), demoRe, demoIssuer],
    );
    return result.rows[0]!;
  }
}

function emptyAggregates(query: PilotMetricsQuery): Omit<PilotMetricsResponse, "city" | "cities"> {
  return {
    window: { from: query.from.toISOString(), to: query.to.toISOString() },
    asOf: new Date().toISOString(),
    formulas: { ...PILOT_FORMULAS_RU },
    exclusionPolicy: {
      demoUuidNamespace: "d0f0xxxx-0000-4000-8000-xxxxxxxxxxxx",
      demoIssuerNamespace: PILOT_DEMO_ISSUER_NAMESPACE,
      draftExcluded: true,
      cancellationsDisclosedSeparately: true,
      unmarkedManualTestLimitation:
        "Записи без зарезервированного demo UUID/issuer не исключаются угадыванием по имени, bio или домену почты.",
    },
    coverage: {
      sufficient: false,
      notes: [],
      participationsWithoutAttemptProof: 0,
      gamesDueInWindow: 0,
    },
    games: {
      dueInWindow: 0,
      publishedEligible: 0,
      cancelledDisclosed: 0,
      draftExcluded: 0,
      demoExcluded: 0,
      held: 0,
      notHeld: 0,
      unknownOutcome: 0,
      heldRate: null,
    },
    applications: {
      count: 0,
      confirmations: 0,
      confirmationRate: null,
      currentStatus: {
        pending: 0,
        confirmed: 0,
        withdrawn: 0,
        rejected: 0,
        removed: 0,
        expired: 0,
      },
      withdrawnAttempts: 0,
      rejectedAttempts: 0,
      removedAttempts: 0,
      expiredAttempts: 0,
    },
    attendance: { present: 0, absent: 0, unknown: 0, eligibleOnHeldGames: 0 },
    repeatAttendance: {
      usersWithAtLeastOnePresent: 0,
      usersWithRepeatPresent: 0,
      rate: null,
    },
    organizers: {
      withEligiblePublishedGames: 0,
      withHeldGames: 0,
      withRepeatEligibleGames: 0,
    },
  };
}
