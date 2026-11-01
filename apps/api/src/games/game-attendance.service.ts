import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  acknowledgeAttendanceRequest,
  assertAttendanceLifecycle,
  bulkPresentRequest,
  canRecordAttendanceHint,
  decodeMeResultsCursor,
  decodeRosterCursor,
  disputeAttendanceRequest,
  eligibleFromTransitions,
  emptyAttendanceActions,
  emptyAttendanceSlice,
  encodeMeResultsCursor,
  encodeRosterCursor,
  helpDisputeRequest,
  parse,
  parseContextId,
  parseLimit,
  postGameWritesEnabled,
  putAttendanceRequest,
  respondDisputeRequest,
  summarizeRoster,
  unavailable,
  unknownAttendanceRecord,
  withdrawDisputeRequest,
  writesUnavailable,
  ATTENDANCE_HISTORY_DEFAULT_LIMIT,
  ATTENDANCE_HISTORY_MAX_LIMIT,
  ATTENDANCE_ME_RESULTS_DEFAULT_LIMIT,
  ATTENDANCE_ME_RESULTS_MAX_LIMIT,
  ATTENDANCE_ROSTER_DEFAULT_LIMIT,
  ATTENDANCE_ROSTER_MAX_LIMIT,
  type AttendanceAllowedActions,
  type AttendanceDisputeHelpProgress,
  type AttendanceDisputeHistoryAction,
  type AttendanceDisputeStatus,
  type AttendanceDisputeView,
  type AttendanceRecordView,
  type AttendanceRow,
  type AttendanceSource,
  type AttendanceValue,
  type EligibleContext,
  type GameAttendanceSlice,
  type MeGameResultsPage,
} from "./game-attendance.policy";
import type { LockedGameRow } from "./game-outcomes.policy";
import { parseGameId } from "./game-outcomes.policy";

type AccessRole = "manager" | "participant" | "none";

type ParticipationLockRow = {
  id: string;
  game_id: string;
  user_id: string;
  status: string;
  confirmed_at: Date | null;
};

@Injectable()
export class GameAttendanceService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean((await client.query("SELECT to_regclass('game_attendance') AS name")).rows[0]?.name);
  }

  private async pg2Installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean(
      (await client.query("SELECT to_regclass('game_attendance_dispute_responses') AS name")).rows[0]?.name,
    );
  }

  private async lockGame(client: PoolClient, gameId: string): Promise<LockedGameRow> {
    const row = (
      await client.query<LockedGameRow>(
        `SELECT id, status, version, ends_at FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    return row;
  }

  private async assertCurrentManager(client: PoolClient, gameId: string, userId: string): Promise<void> {
    const result = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM game_managers WHERE game_id = $1 AND user_id = $2 FOR UPDATE`,
      [gameId, userId],
    );
    const membership = result.rows[0];
    if (
      !membership ||
      membership.status !== "active" ||
      (membership.role !== "owner" && membership.role !== "manager")
    ) {
      unavailable();
    }
  }

  /**
   * Manager (active), current confirmed participant, or own historical post-game
   * context via frozen as-of-start eligibility / durable own attendance or notice.
   * Does not grant manager roster or foreign participation rights.
   */
  async resolveAccessRole(
    client: PoolClient | Pool,
    gameId: string,
    userId: string,
  ): Promise<AccessRole> {
    const manager = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'manager')
       LIMIT 1`,
      [gameId, userId],
    );
    if (manager.rows[0]) return "manager";
    const participant = await client.query<{
      id: string;
      status: string;
      confirmed_at: Date | null;
    }>(
      `SELECT id, status, confirmed_at FROM participations
       WHERE game_id = $1 AND user_id = $2
       LIMIT 1`,
      [gameId, userId],
    );
    const own = participant.rows[0];
    if (!own) return "none";
    if (own.status === "confirmed") return "participant";

    const durable = await client.query(
      `SELECT 1 FROM game_attendance WHERE participation_id = $1
       UNION ALL
       SELECT 1 FROM game_attendance_notices WHERE participation_id = $1
       LIMIT 1`,
      [own.id],
    );
    if (durable.rows[0]) return "participant";

    const bounds = (
      await client.query<{ starts_at: Date; ends_at: Date }>(
        `SELECT starts_at, ends_at FROM games WHERE id = $1`,
        [gameId],
      )
    ).rows[0];
    if (!bounds?.starts_at || !bounds.ends_at) return "none";
    const transitions = await client.query<{ to_status: string; at: Date; id: string }>(
      `SELECT to_status, at, id FROM participation_transitions
       WHERE participation_id = $1 ORDER BY at ASC, id ASC`,
      [own.id],
    );
    const verdict = eligibleFromTransitions(
      transitions.rows,
      bounds.starts_at,
      own.status,
      own.confirmed_at,
      bounds.ends_at,
    );
    return verdict.eligible ? "participant" : "none";
  }

  private async accessRole(client: PoolClient | Pool, gameId: string, userId: string): Promise<AccessRole> {
    return this.resolveAccessRole(client, gameId, userId);
  }

  private async displayName(client: PoolClient | Pool, userId: string): Promise<string> {
    const row = (
      await client.query<{ display_name: string }>(
        `SELECT COALESCE(NULLIF(TRIM(p.display_name), ''), NULLIF(TRIM(u.display_name), ''), 'Игрок') AS display_name
         FROM users u
         LEFT JOIN player_social_profiles p ON p.user_id = u.id
         WHERE u.id = $1`,
        [userId],
      )
    ).rows[0];
    return row?.display_name ?? "Игрок";
  }

  private async loadEligibleContexts(
    client: PoolClient | Pool,
    gameId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<EligibleContext[]> {
    const parts = await client.query<{
      id: string;
      user_id: string;
      status: string;
      confirmed_at: Date | null;
      display_name: string;
    }>(
      `SELECT p.id, p.user_id, p.status, p.confirmed_at,
              COALESCE(NULLIF(TRIM(sp.display_name), ''), NULLIF(TRIM(u.display_name), ''), 'Игрок') AS display_name
       FROM participations p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN player_social_profiles sp ON sp.user_id = p.user_id
       WHERE p.game_id = $1`,
      [gameId],
    );
    const eligible: EligibleContext[] = [];
    for (const part of parts.rows) {
      const transitions = await client.query<{ to_status: string; at: Date; id: string }>(
        `SELECT to_status, at, id
         FROM participation_transitions
         WHERE participation_id = $1
         ORDER BY at ASC, id ASC`,
        [part.id],
      );
      const verdict = eligibleFromTransitions(
        transitions.rows,
        startsAt,
        part.status,
        part.confirmed_at,
        endsAt,
      );
      if (!verdict.eligible || !verdict.proof) continue;
      eligible.push({
        participationId: part.id,
        userId: part.user_id,
        displayName: part.display_name,
        eligibleProof: verdict.proof,
      });
    }
    eligible.sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, "ru");
      return byName !== 0 ? byName : a.participationId.localeCompare(b.participationId);
    });
    return eligible;
  }

  private async readAttendance(
    client: PoolClient | Pool,
    participationId: string,
  ): Promise<AttendanceRow | null> {
    return (
      await client.query<AttendanceRow>(
        `SELECT * FROM game_attendance WHERE participation_id = $1`,
        [participationId],
      )
    ).rows[0] ?? null;
  }

  private async readOpenDispute(
    client: PoolClient | Pool,
    participationId: string,
  ): Promise<{ id: string; status: "open"; challenged_version: number; version: number } | null> {
    return (
      await client.query<{ id: string; status: "open"; challenged_version: number; version: number }>(
        `SELECT id, status, challenged_version, version
         FROM game_attendance_disputes
         WHERE participation_id = $1 AND status = 'open'
         LIMIT 1`,
        [participationId],
      )
    ).rows[0] ?? null;
  }

  private async readAcknowledgedVersion(
    client: PoolClient | Pool,
    participationId: string,
    currentVersion: number,
  ): Promise<number | null> {
    if (currentVersion < 1) return null;
    const row = (
      await client.query<{ attendance_version: number }>(
        `SELECT attendance_version
         FROM game_attendance_notices
         WHERE participation_id = $1
           AND attendance_version = $2
           AND acknowledged_at IS NOT NULL
         LIMIT 1`,
        [participationId, currentVersion],
      )
    ).rows[0];
    return row?.attendance_version ?? null;
  }

  private async projectRecord(
    client: PoolClient | Pool,
    context: EligibleContext,
    role: AccessRole,
    viewerId: string,
    writesEnabled: boolean,
    canManagerWrite: boolean,
  ): Promise<AttendanceRecordView> {
    const row = await this.readAttendance(client, context.participationId);
    const dispute = await this.readOpenDispute(client, context.participationId);
    const pg2 = await this.pg2Installed(client);
    const knownFact = !!row && row.value !== "unknown";
    const acknowledgedVersion =
      knownFact && row
        ? await this.readAcknowledgedVersion(client, context.participationId, row.version)
        : null;
    const isOwn = context.userId === viewerId;
    const actorDisplay = row ? await this.displayName(client, row.actor_user_id) : null;
    const actions: AttendanceAllowedActions = {
      canSetAttendance: canManagerWrite,
      canAcknowledge:
        writesEnabled &&
        isOwn &&
        knownFact &&
        !!row &&
        acknowledgedVersion !== row.version,
      canDispute: writesEnabled && isOwn && knownFact && !!row && !dispute,
      canWithdrawDispute: writesEnabled && isOwn && !!dispute,
      canRespondDispute: writesEnabled && pg2 && role === "manager" && !!dispute,
      canRequestHelp: writesEnabled && pg2 && isOwn && !!dispute,
    };
    if (!row) {
      return unknownAttendanceRecord(context.participationId, context.displayName, {
        ...emptyAttendanceActions(),
        canSetAttendance: canManagerWrite,
      });
    }
    return {
      contextId: context.participationId,
      value: row.value,
      version: row.version,
      late: row.late,
      assertion: {
        actorDisplay,
        source: row.source,
        at: row.updated_at.toISOString(),
      },
      acknowledgedVersion,
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            challengedVersion: dispute.challenged_version,
            version: dispute.version,
          }
        : null,
      displayName: context.displayName,
      allowedActions: actions,
    };
  }

  async enrichResults(
    client: PoolClient | Pool,
    gameId: string,
    userId: string,
    role: AccessRole,
    game: LockedGameRow & { starts_at?: Date },
    now: Date,
    rosterQuery: { rosterLimit?: string; rosterCursor?: string } = {},
  ): Promise<GameAttendanceSlice> {
    const installed = await this.installed(client);
    const writesEnabled = postGameWritesEnabled(this.env) && installed;
    const canRecord = canRecordAttendanceHint(this.env, role, game, now, installed);
    if (!installed) return emptyAttendanceSlice(false, false, false);
    if (role === "none") unavailable();

    const bounds = (
      await client.query<{ starts_at: Date; ends_at: Date }>(
        `SELECT starts_at, ends_at FROM games WHERE id = $1`,
        [gameId],
      )
    ).rows[0];
    if (!bounds?.starts_at || !bounds.ends_at) unavailable();

    const eligible = await this.loadEligibleContexts(client, gameId, bounds.starts_at, bounds.ends_at);
    let own = eligible.find((row) => row.userId === userId) ?? null;
    // Own durable attendance/notice after removal: project personal record without
    // inventing manager roster membership when not in eligible markable set.
    if (!own && role === "participant") {
      const part = (
        await client.query<{ id: string; display_name: string }>(
          `SELECT p.id,
                  COALESCE(NULLIF(TRIM(sp.display_name), ''), NULLIF(TRIM(u.display_name), ''), 'Игрок') AS display_name
           FROM participations p
           JOIN users u ON u.id = p.user_id
           LEFT JOIN player_social_profiles sp ON sp.user_id = p.user_id
           WHERE p.game_id = $1 AND p.user_id = $2
           LIMIT 1`,
          [gameId, userId],
        )
      ).rows[0];
      if (part) {
        const durable = await client.query(
          `SELECT 1 FROM game_attendance WHERE participation_id = $1
           UNION ALL
           SELECT 1 FROM game_attendance_notices WHERE participation_id = $1
           LIMIT 1`,
          [part.id],
        );
        if (durable.rows[0]) {
          own = {
            participationId: part.id,
            userId,
            displayName: part.display_name,
            eligibleProof: "transition_as_of_start",
          };
        }
      }
    }

    if (role === "participant") {
      const myAttendance = own
        ? await this.projectRecord(client, own, role, userId, writesEnabled, false)
        : null;
      return {
        installed: true,
        writesEnabled,
        myAttendance,
        roster: null,
        rosterNextCursor: null,
        summary: null,
        allowedActions: { canRecordAttendance: false, canBulkPresent: false },
      };
    }

    const limit = parseLimit(
      rosterQuery.rosterLimit,
      ATTENDANCE_ROSTER_DEFAULT_LIMIT,
      ATTENDANCE_ROSTER_MAX_LIMIT,
    );
    const cursor = decodeRosterCursor(rosterQuery.rosterCursor);
    let filtered = eligible;
    if (cursor) {
      filtered = eligible.filter((row) => {
        const byName = row.displayName.localeCompare(cursor.displayName, "ru");
        if (byName > 0) return true;
        if (byName < 0) return false;
        return row.participationId > cursor.contextId;
      });
    }
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const records: AttendanceRecordView[] = [];
    for (const context of page) {
      records.push(await this.projectRecord(client, context, role, userId, writesEnabled, canRecord));
    }
    const allRecords: AttendanceRecordView[] = [];
    for (const context of eligible) {
      allRecords.push(await this.projectRecord(client, context, role, userId, writesEnabled, canRecord));
    }
    const last = page[page.length - 1];
    return {
      installed: true,
      writesEnabled,
      myAttendance: own
        ? await this.projectRecord(client, own, role, userId, writesEnabled, canRecord)
        : null,
      roster: records,
      rosterNextCursor: hasMore && last ? encodeRosterCursor(last.displayName, last.participationId) : null,
      summary: summarizeRoster(allRecords),
      allowedActions: {
        canRecordAttendance: canRecord,
        canBulkPresent: canRecord,
      },
    };
  }

  private resolveSource(
    actorId: string,
    participantUserId: string,
    forced?: AttendanceSource,
  ): AttendanceSource {
    if (forced) return forced;
    return actorId === participantUserId ? "self_attested" : "manager_explicit";
  }

  private async writeAssertion(
    client: PoolClient,
    args: {
      gameId: string;
      participation: ParticipationLockRow;
      actorId: string;
      expectedVersion: number;
      value: AttendanceValue;
      late: boolean;
      correctionReason: string | null;
      now: Date;
      source?: AttendanceSource;
    },
  ): Promise<AttendanceRow> {
    const existing = (
      await client.query<AttendanceRow>(
        `SELECT * FROM game_attendance WHERE participation_id = $1 FOR UPDATE`,
        [args.participation.id],
      )
    ).rows[0] ?? null;
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== args.expectedVersion) {
      throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
    }
    if (args.value === "unknown" && currentVersion < 1) {
      throw conflict("ATTENDANCE_UNKNOWN_INITIAL", "Неизвестное нельзя записать как первую отметку");
    }
    // Open dispute is retained across manager corrections (PG-2 closes only via
    // party acknowledge or scoped reviewer resolution).
    await this.readOpenDispute(client, args.participation.id);
    const nextVersion = currentVersion + 1;
    const late = args.value === "present" ? args.late : false;
    const source = this.resolveSource(args.actorId, args.participation.user_id, args.source);
    const actorDisplay = await this.displayName(client, args.actorId);
    if (!existing) {
      await client.query(
        `INSERT INTO game_attendance
           (participation_id, game_id, user_id, value, version, late, source, actor_user_id,
            correction_reason, recorded_at, updated_at)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$9)`,
        [
          args.participation.id,
          args.gameId,
          args.participation.user_id,
          args.value,
          late,
          source,
          args.actorId,
          args.correctionReason,
          args.now,
        ],
      );
    } else {
      await client.query(
        `UPDATE game_attendance
         SET value = $2,
             version = $3,
             late = $4,
             source = $5,
             actor_user_id = $6,
             correction_reason = $7,
             updated_at = $8
         WHERE participation_id = $1`,
        [
          args.participation.id,
          args.value,
          nextVersion,
          late,
          source,
          args.actorId,
          args.correctionReason,
          args.now,
        ],
      );
    }
    await client.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason, reason, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        args.participation.id,
        args.gameId,
        args.participation.user_id,
        nextVersion,
        args.actorId,
        source,
        existing?.value ?? null,
        args.value,
        existing ? existing.late : null,
        late,
        existing?.correction_reason ?? null,
        args.correctionReason,
        nextVersion === 1 ? null : args.correctionReason,
        args.now,
      ],
    );
    await client.query(
      `INSERT INTO game_attendance_notices
         (participation_id, game_id, user_id, attendance_version, value, late, source,
          actor_user_id, actor_display, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        args.participation.id,
        args.gameId,
        args.participation.user_id,
        nextVersion,
        args.value,
        late,
        source,
        args.actorId,
        actorDisplay,
        args.now,
      ],
    );
    return (await this.readAttendance(client, args.participation.id))!;
  }

  private async lockEligibleParticipation(
    client: PoolClient,
    gameId: string,
    contextId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<ParticipationLockRow> {
    const row = (
      await client.query<ParticipationLockRow>(
        `SELECT id, game_id, user_id, status, confirmed_at
         FROM participations
         WHERE id = $1 AND game_id = $2
         FOR UPDATE`,
        [contextId, gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    const transitions = await client.query<{ to_status: string; at: Date; id: string }>(
      `SELECT to_status, at, id FROM participation_transitions
       WHERE participation_id = $1 ORDER BY at ASC, id ASC`,
      [row.id],
    );
    const verdict = eligibleFromTransitions(
      transitions.rows,
      startsAt,
      row.status,
      row.confirmed_at,
      endsAt,
    );
    if (!verdict.eligible) {
      throw conflict("ATTENDANCE_CONTEXT_INELIGIBLE", "Контекст не входит в подтверждённый состав на момент игры");
    }
    return row;
  }

  async putAttendance(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    contextIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceRecordView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const body = parse(putAttendanceRequest, input);
    const value = body.value;
    const late = body.late === true;
    const requestHash = this.idempotency.requestHash({
      gameId,
      contextId,
      expectedVersion: body.expectedVersion,
      value,
      late,
      correctionReason: body.correctionReason ?? null,
    });
    return this.mutations.runIdempotent<AttendanceRecordView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.put",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        // Lock order: Actor → Game → manager → participation → attendance.
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertAttendanceLifecycle(locked, now);
        const startsAt = (
          await client.query<{ starts_at: Date }>(`SELECT starts_at FROM games WHERE id = $1`, [gameId])
        ).rows[0]!.starts_at;
        const participation = await this.lockEligibleParticipation(
          client,
          gameId,
          contextId,
          startsAt,
          locked.ends_at,
        );
        await this.writeAssertion(client, {
          gameId,
          participation,
          actorId: userId,
          expectedVersion: body.expectedVersion,
          value,
          late,
          correctionReason: body.correctionReason ?? null,
          now,
        });
        const displayName = await this.displayName(client, participation.user_id);
        const view = await this.projectRecord(
          client,
          {
            participationId: participation.id,
            userId: participation.user_id,
            displayName,
            eligibleProof: "current_confirmed",
          },
          "manager",
          userId,
          true,
          true,
        );
        return { statusCode: 200, body: view };
      },
    });
  }

  async bulkPresent(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: { items: AttendanceRecordView[] } }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const body = parse(bulkPresentRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      items: body.items,
      confirmedExactSelection: true,
    });
    return this.mutations.runIdempotent<{ items: AttendanceRecordView[] }>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.bulk_present",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertAttendanceLifecycle(locked, now);
        const startsAt = (
          await client.query<{ starts_at: Date }>(`SELECT starts_at FROM games WHERE id = $1`, [gameId])
        ).rows[0]!.starts_at;
        const ordered = [...body.items].sort((a, b) => a.contextId.localeCompare(b.contextId));
        const items: AttendanceRecordView[] = [];
        for (const item of ordered) {
          const participation = await this.lockEligibleParticipation(
            client,
            gameId,
            item.contextId,
            startsAt,
            locked.ends_at,
          );
          await this.writeAssertion(client, {
            gameId,
            participation,
            actorId: userId,
            expectedVersion: item.expectedVersion,
            value: "present",
            late: false,
            correctionReason: item.expectedVersion > 0 ? "Массовая отметка «пришли»" : null,
            now,
          });
          const displayName = await this.displayName(client, participation.user_id);
          items.push(
            await this.projectRecord(
              client,
              {
                participationId: participation.id,
                userId: participation.user_id,
                displayName,
                eligibleProof: "current_confirmed",
              },
              "manager",
              userId,
              true,
              true,
            ),
          );
        }
        return { statusCode: 200, body: { items } };
      },
    });
  }

  async acknowledge(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    contextIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceRecordView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const body = parse(acknowledgeAttendanceRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      contextId,
      attendanceVersion: body.attendanceVersion,
      resolvingDisputeId: body.resolvingDisputeId ?? null,
      expectedDisputeVersion: body.expectedDisputeVersion ?? null,
    });
    return this.mutations.runIdempotent<AttendanceRecordView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.acknowledge",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockOwnContext(client, gameId, contextId, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const participation = await this.lockOwnContext(client, gameId, contextId, userId);
        const attendance = (
          await client.query<AttendanceRow>(
            `SELECT * FROM game_attendance WHERE participation_id = $1 FOR UPDATE`,
            [participation.id],
          )
        ).rows[0];
        if (!attendance || attendance.version !== body.attendanceVersion) {
          throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
        }
        if (attendance.value === "unknown") {
          throw conflict("ATTENDANCE_UNKNOWN_NO_ACK", "Неизвестную отметку нельзя подтвердить");
        }
        const notice = (
          await client.query<{ id: string; acknowledged_at: Date | null; value: AttendanceValue }>(
            `SELECT id, acknowledged_at, value FROM game_attendance_notices
             WHERE participation_id = $1 AND attendance_version = $2
             FOR UPDATE`,
            [participation.id, body.attendanceVersion],
          )
        ).rows[0];
        if (!notice) unavailable();
        if (notice.value === "unknown") {
          throw conflict("ATTENDANCE_UNKNOWN_NO_ACK", "Неизвестную отметку нельзя подтвердить");
        }
        if (!notice.acknowledged_at) {
          await client.query(
            `UPDATE game_attendance_notices
             SET acknowledged_at = clock_timestamp()
             WHERE id = $1 AND acknowledged_at IS NULL`,
            [notice.id],
          );
        }
        if (body.resolvingDisputeId && body.expectedDisputeVersion !== undefined) {
          const dispute = (
            await client.query<{
              id: string;
              version: number;
              status: string;
              participation_id: string;
              user_id: string;
            }>(
              `SELECT id, version, status, participation_id, user_id
               FROM game_attendance_disputes WHERE id = $1 FOR UPDATE`,
              [body.resolvingDisputeId],
            )
          ).rows[0];
          if (
            !dispute ||
            dispute.user_id !== userId ||
            dispute.participation_id !== participation.id
          ) {
            unavailable();
          }
          if (dispute.status === "resolved") {
            // Idempotent same-key path may replay; already resolved is fine when versions match.
          } else if (dispute.status !== "open") {
            throw conflict("DISPUTE_NOT_OPEN", "Возражение уже закрыто");
          } else if (dispute.version !== body.expectedDisputeVersion) {
            throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
          } else {
            const nextVersion = dispute.version + 1;
            await client.query(
              `UPDATE game_attendance_disputes
               SET status = 'resolved',
                   version = $2,
                   resolved_at = clock_timestamp(),
                   resolution_kind = 'party_acknowledged',
                   help_progress = CASE
                     WHEN help_progress IS NULL THEN NULL
                     ELSE 'resolved'
                   END,
                   updated_at = clock_timestamp()
               WHERE id = $1`,
              [dispute.id, nextVersion],
            );
            await client.query(
              `INSERT INTO game_attendance_dispute_revisions
                 (dispute_id, resource_version, actor_user_id, action, explanation)
               VALUES ($1, $2, $3, 'party_acknowledged', $4)`,
              [dispute.id, nextVersion, userId, "Участник подтвердил текущую отметку"],
            );
          }
        }
        const displayName = await this.displayName(client, participation.user_id);
        const view = await this.projectRecord(
          client,
          {
            participationId: participation.id,
            userId: participation.user_id,
            displayName,
            eligibleProof: "current_confirmed",
          },
          "participant",
          userId,
          true,
          false,
        );
        return { statusCode: 200, body: view };
      },
    });
  }

  async dispute(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    contextIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceDisputeView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const body = parse(disputeAttendanceRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      contextId,
      attendanceVersion: body.attendanceVersion,
      explanation: body.explanation,
    });
    return this.mutations.runIdempotent<AttendanceDisputeView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.dispute",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockOwnContext(client, gameId, contextId, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const participation = await this.lockOwnContext(client, gameId, contextId, userId);
        const attendance = (
          await client.query<AttendanceRow>(
            `SELECT * FROM game_attendance WHERE participation_id = $1 FOR UPDATE`,
            [participation.id],
          )
        ).rows[0];
        if (!attendance) {
          throw conflict("ATTENDANCE_MISSING", "Нет отметки для возражения");
        }
        if (attendance.version !== body.attendanceVersion) {
          throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
        }
        const open = await this.readOpenDispute(client, participation.id);
        if (open) {
          throw conflict("DISPUTE_ALREADY_OPEN", "Уже есть открытое возражение");
        }
        const inserted = (
          await client.query<{ id: string; created_at: Date; updated_at: Date; version: number }>(
            `INSERT INTO game_attendance_disputes
               (participation_id, game_id, user_id, challenged_version, explanation, status, version)
             VALUES ($1,$2,$3,$4,$5,'open',1)
             RETURNING id, created_at, updated_at, version`,
            [participation.id, gameId, userId, body.attendanceVersion, body.explanation],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1, 1, $2, 'opened', $3)`,
          [inserted.id, userId, body.explanation],
        );
        return {
          statusCode: 201,
          body: await this.projectDispute(client, inserted.id, userId),
        };
      },
    });
  }

  async withdrawDispute(
    userId: string,
    sessionId: string,
    key: string,
    disputeIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceDisputeView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const disputeId = parseContextId(disputeIdRaw);
    const body = parse(withdrawDisputeRequest, input);
    const requestHash = this.idempotency.requestHash({
      disputeId,
      expectedVersion: body.expectedVersion,
      reason: body.reason ?? null,
    });
    return this.mutations.runIdempotent<AttendanceDisputeView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.dispute.withdraw",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const row = await this.lockOwnDispute(client, disputeId, userId);
        if (row.status !== "open" && row.status !== "withdrawn") unavailable();
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const row = await this.lockOwnDispute(client, disputeId, userId);
        if (row.status === "withdrawn") {
          return { statusCode: 200, body: await this.projectDispute(client, disputeId, userId) };
        }
        if (row.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
        }
        const nextVersion = row.version + 1;
        await client.query(
          `UPDATE game_attendance_disputes
           SET status = 'withdrawn',
               version = $2,
               withdrawn_at = clock_timestamp(),
               withdraw_reason = $3,
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [disputeId, nextVersion, body.reason ?? null],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1, $2, $3, 'withdrawn', $4)`,
          [disputeId, nextVersion, userId, body.reason ?? null],
        );
        return { statusCode: 200, body: await this.projectDispute(client, disputeId, userId) };
      },
    });
  }

  async respondDispute(
    userId: string,
    sessionId: string,
    key: string,
    disputeIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceDisputeView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const disputeId = parseContextId(disputeIdRaw);
    const body = parse(respondDisputeRequest, input);
    const requestHash = this.idempotency.requestHash({
      disputeId,
      expectedVersion: body.expectedVersion,
      explanation: body.explanation,
      correction: body.correction ?? null,
    });
    return this.mutations.runIdempotent<AttendanceDisputeView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.dispute.respond",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client)) || !(await this.pg2Installed(client))) writesUnavailable();
        const row = await this.lockManagerDispute(client, disputeId, userId);
        if (row.status !== "open" && row.status !== "resolved" && row.status !== "withdrawn") {
          unavailable();
        }
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client)) || !(await this.pg2Installed(client))) writesUnavailable();
        const row = await this.lockManagerDispute(client, disputeId, userId);
        if (row.status !== "open") {
          throw conflict("DISPUTE_NOT_OPEN", "Возражение уже закрыто");
        }
        if (row.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
        }
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        let correctedAttendanceVersion: number | null = null;
        let action: AttendanceDisputeHistoryAction = "manager_responded";
        if (body.correction) {
          const participation = (
            await client.query<ParticipationLockRow>(
              `SELECT id, game_id, user_id, status, confirmed_at
               FROM participations WHERE id = $1 FOR UPDATE`,
              [row.participation_id],
            )
          ).rows[0];
          if (!participation) unavailable();
          const written = await this.writeAssertion(client, {
            gameId: row.game_id,
            participation,
            actorId: userId,
            expectedVersion: body.correction.expectedAttendanceVersion,
            value: body.correction.value,
            late: body.correction.late === true,
            correctionReason: body.correction.correctionReason,
            now,
          });
          correctedAttendanceVersion = written.version;
          action = "manager_corrected";
        }
        const nextVersion = row.version + 1;
        await client.query(
          `UPDATE game_attendance_disputes
           SET version = $2,
               latest_manager_response = $3,
               updated_at = clock_timestamp()
           WHERE id = $1 AND status = 'open'`,
          [disputeId, nextVersion, body.explanation],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1, $2, $3, $4, $5)`,
          [disputeId, nextVersion, userId, action, body.explanation],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_responses
             (dispute_id, dispute_version, actor_user_id, explanation, corrected_attendance_version, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [disputeId, nextVersion, userId, body.explanation, correctedAttendanceVersion, now],
        );
        // Response/correction never unilaterally closes the objection.
        return { statusCode: 200, body: await this.projectDispute(client, disputeId, userId) };
      },
    });
  }

  async requestDisputeHelp(
    userId: string,
    sessionId: string,
    key: string,
    disputeIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: AttendanceDisputeView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const disputeId = parseContextId(disputeIdRaw);
    const body = parse(helpDisputeRequest, input);
    const requestHash = this.idempotency.requestHash({
      disputeId,
      expectedVersion: body.expectedVersion,
      explanation: body.explanation,
    });
    return this.mutations.runIdempotent<AttendanceDisputeView>({
      actorId: userId,
      sessionId,
      operation: "games.attendance.dispute.help",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client)) || !(await this.pg2Installed(client))) writesUnavailable();
        await this.lockOwnDispute(client, disputeId, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client)) || !(await this.pg2Installed(client))) writesUnavailable();
        const row = await this.lockOwnDispute(client, disputeId, userId);
        if (row.status !== "open") {
          throw conflict("DISPUTE_NOT_OPEN", "Возражение уже закрыто");
        }
        if (row.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
        }
        const nextVersion = row.version + 1;
        await client.query(
          `UPDATE game_attendance_disputes
           SET version = $2,
               help_requested_at = COALESCE(help_requested_at, clock_timestamp()),
               help_progress = COALESCE(help_progress, 'requested'),
               updated_at = clock_timestamp()
           WHERE id = $1 AND status = 'open'`,
          [disputeId, nextVersion],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1, $2, $3, 'help_requested', $4)`,
          [disputeId, nextVersion, userId, body.explanation],
        );
        // Escalation is a progress record — not an abuse report and not staff assignment.
        return { statusCode: 200, body: await this.projectDispute(client, disputeId, userId) };
      },
    });
  }

  async getDispute(disputeIdRaw: string, userId: string): Promise<AttendanceDisputeView> {
    const disputeId = parseContextId(disputeIdRaw);
    const client = await this.pool.connect();
    try {
      if (!(await this.installed(client))) unavailable();
      const row = (
        await client.query<{
          id: string;
          game_id: string;
          participation_id: string;
          user_id: string;
          status: string;
        }>(
          `SELECT id, game_id, participation_id, user_id, status
           FROM game_attendance_disputes WHERE id = $1`,
          [disputeId],
        )
      ).rows[0];
      if (!row) unavailable();
      const role = await this.accessRole(client, row.game_id, userId);
      if (row.user_id !== userId && role !== "manager") unavailable();
      return this.projectDispute(client, disputeId, userId);
    } finally {
      client.release();
    }
  }

  async listMeGameResults(
    userId: string,
    query: { limit?: string; cursor?: string } = {},
  ): Promise<MeGameResultsPage> {
    const limit = parseLimit(
      query.limit,
      ATTENDANCE_ME_RESULTS_DEFAULT_LIMIT,
      ATTENDANCE_ME_RESULTS_MAX_LIMIT,
    );
    const cursor = decodeMeResultsCursor(query.cursor);
    const client = await this.pool.connect();
    try {
      if (!(await this.installed(client))) return { items: [], nextCursor: null };
      const params: unknown[] = [userId];
      let cursorSql = "";
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        cursorSql = `AND (n.created_at, n.id) < ($2::timestamptz, $3::uuid)`;
      }
      params.push(limit + 1);
      const rows = await client.query<{
        notice_id: string;
        participation_id: string;
        game_id: string;
        attendance_version: number;
        value: AttendanceValue;
        late: boolean;
        source: AttendanceSource;
        actor_display: string;
        created_at: Date;
        acknowledged_at: Date | null;
        game_title: string | null;
        ends_at: Date | null;
      }>(
        `SELECT n.id AS notice_id, n.participation_id, n.game_id, n.attendance_version, n.value, n.late,
                n.source, n.actor_display, n.created_at, n.acknowledged_at,
                g.title AS game_title, g.ends_at
         FROM game_attendance_notices n
         JOIN games g ON g.id = n.game_id
         WHERE n.user_id = $1
           ${cursorSql}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT $${params.length}`,
        params,
      );
      const page = rows.rows.slice(0, limit);
      const items = [];
      for (const row of page) {
        const displayName = await this.displayName(client, userId);
        const record = await this.projectRecord(
          client,
          {
            participationId: row.participation_id,
            userId,
            displayName,
            eligibleProof: "current_confirmed",
          },
          "participant",
          userId,
          postGameWritesEnabled(this.env),
          false,
        );
        items.push({
          gameId: row.game_id,
          contextId: row.participation_id,
          gameTitle: row.game_title,
          endsAt: row.ends_at?.toISOString() ?? null,
          attendance: record,
          notice: {
            id: row.notice_id,
            attendanceVersion: row.attendance_version,
            value: row.value,
            late: row.late,
            source: row.source,
            actorDisplay: row.actor_display,
            createdAt: row.created_at.toISOString(),
            acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
          },
        });
      }
      const last = page[page.length - 1];
      return {
        items,
        nextCursor:
          rows.rows.length > limit && last
            ? encodeMeResultsCursor(last.created_at.toISOString(), last.notice_id)
            : null,
      };
    } finally {
      client.release();
    }
  }

  async listAttendanceHistory(
    gameIdRaw: string,
    contextIdRaw: string,
    userId: string,
    query: { limit?: string } = {},
  ) {
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const limit = parseLimit(query.limit, ATTENDANCE_HISTORY_DEFAULT_LIMIT, ATTENDANCE_HISTORY_MAX_LIMIT);
    const client = await this.pool.connect();
    try {
      if (!(await this.installed(client))) unavailable();
      const part = (
        await client.query<{ id: string; user_id: string; game_id: string }>(
          `SELECT id, user_id, game_id FROM participations WHERE id = $1 AND game_id = $2`,
          [contextId, gameId],
        )
      ).rows[0];
      if (!part) unavailable();
      const role = await this.accessRole(client, gameId, userId);
      if (part.user_id !== userId && role !== "manager") unavailable();
      const rows = await client.query<{
        resource_version: number;
        before_value: AttendanceValue | null;
        after_value: AttendanceValue;
        before_late: boolean | null;
        after_late: boolean;
        reason: string | null;
        source: AttendanceSource;
        recorded_at: Date;
        actor_user_id: string;
      }>(
        `SELECT resource_version, before_value, after_value, before_late, after_late, reason, source,
                recorded_at, actor_user_id
         FROM game_attendance_revisions
         WHERE participation_id = $1
         ORDER BY resource_version DESC
         LIMIT $2`,
        [contextId, limit],
      );
      const items = [];
      for (const row of [...rows.rows].reverse()) {
        items.push({
          version: row.resource_version,
          before: row.before_value
            ? { value: row.before_value, late: row.before_late === true }
            : null,
          after: { value: row.after_value, late: row.after_late },
          reason: row.reason,
          source: row.source,
          recordedAt: row.recorded_at.toISOString(),
          actorDisplay: await this.displayName(client, row.actor_user_id),
        });
      }
      return { items };
    } finally {
      client.release();
    }
  }

  private async lockOwnContext(
    client: PoolClient,
    gameId: string,
    contextId: string,
    userId: string,
  ): Promise<ParticipationLockRow> {
    await this.lockGame(client, gameId);
    const row = (
      await client.query<ParticipationLockRow>(
        `SELECT id, game_id, user_id, status, confirmed_at
         FROM participations
         WHERE id = $1 AND game_id = $2
         FOR UPDATE`,
        [contextId, gameId],
      )
    ).rows[0];
    if (!row || row.user_id !== userId) unavailable();
    return row;
  }

  private async lockOwnDispute(
    client: PoolClient,
    disputeId: string,
    userId: string,
  ): Promise<{ id: string; version: number; status: string; game_id: string; participation_id: string }> {
    const row = (
      await client.query<{
        id: string;
        version: number;
        status: string;
        game_id: string;
        participation_id: string;
        user_id: string;
      }>(`SELECT * FROM game_attendance_disputes WHERE id = $1 FOR UPDATE`, [disputeId])
    ).rows[0];
    if (!row || row.user_id !== userId) unavailable();
    // Lock order: ActorFence → Game → participation → dispute (already locked).
    await this.lockGame(client, row.game_id);
    await client.query(`SELECT id FROM participations WHERE id = $1 FOR UPDATE`, [row.participation_id]);
    return row;
  }

  private async lockManagerDispute(
    client: PoolClient,
    disputeId: string,
    managerUserId: string,
  ): Promise<{
    id: string;
    version: number;
    status: string;
    game_id: string;
    participation_id: string;
    user_id: string;
  }> {
    const row = (
      await client.query<{
        id: string;
        version: number;
        status: string;
        game_id: string;
        participation_id: string;
        user_id: string;
      }>(`SELECT * FROM game_attendance_disputes WHERE id = $1 FOR UPDATE`, [disputeId])
    ).rows[0];
    if (!row) unavailable();
    await this.lockGame(client, row.game_id);
    await this.assertCurrentManager(client, row.game_id, managerUserId);
    await client.query(`SELECT id FROM participations WHERE id = $1 FOR UPDATE`, [row.participation_id]);
    return row;
  }

  private async projectDispute(
    client: PoolClient | Pool,
    disputeId: string,
    viewerId: string,
  ): Promise<AttendanceDisputeView> {
    const pg2 = await this.pg2Installed(client);
    const row = (
      await client.query<{
        id: string;
        game_id: string;
        participation_id: string;
        user_id: string;
        challenged_version: number;
        explanation: string;
        status: AttendanceDisputeStatus;
        version: number;
        created_at: Date;
        updated_at: Date;
        withdrawn_at: Date | null;
        withdraw_reason: string | null;
        resolved_at: Date | null;
        resolution_kind: string | null;
        latest_manager_response: string | null;
        help_progress: AttendanceDisputeHelpProgress | null;
      }>(
        pg2
          ? `SELECT id, game_id, participation_id, user_id, challenged_version, explanation, status,
                    version, created_at, updated_at, withdrawn_at, withdraw_reason,
                    resolved_at, resolution_kind, latest_manager_response, help_progress
             FROM game_attendance_disputes WHERE id = $1`
          : `SELECT id, game_id, participation_id, user_id, challenged_version, explanation, status,
                    version, created_at, updated_at, withdrawn_at, withdraw_reason,
                    NULL::timestamptz AS resolved_at, NULL::text AS resolution_kind,
                    NULL::text AS latest_manager_response, NULL::text AS help_progress
             FROM game_attendance_disputes WHERE id = $1`,
        [disputeId],
      )
    ).rows[0];
    if (!row) unavailable();
    const history = await client.query<{
      resource_version: number;
      action: AttendanceDisputeHistoryAction;
      explanation: string | null;
      recorded_at: Date;
    }>(
      `SELECT resource_version, action, explanation, recorded_at
       FROM game_attendance_dispute_revisions
       WHERE dispute_id = $1
       ORDER BY resource_version ASC`,
      [disputeId],
    );
    const challenged = (
      await client.query<{
        resource_version: number;
        after_value: AttendanceValue;
        after_late: boolean;
        source: AttendanceSource;
        recorded_at: Date;
        actor_user_id: string;
      }>(
        `SELECT resource_version, after_value, after_late, source, recorded_at, actor_user_id
         FROM game_attendance_revisions
         WHERE participation_id = $1 AND resource_version = $2
         LIMIT 1`,
        [row.participation_id, row.challenged_version],
      )
    ).rows[0];
    const current = await this.readAttendance(client, row.participation_id);
    const role = await this.accessRole(client, row.game_id, viewerId);
    const writes = postGameWritesEnabled(this.env);
    const isOwn = row.user_id === viewerId;
    const caseLink = pg2
      ? (
          await client.query<{ case_id: string }>(
            `SELECT case_id FROM game_attendance_dispute_case_links WHERE dispute_id = $1`,
            [disputeId],
          )
        ).rows[0]
      : undefined;
    return {
      id: row.id,
      gameId: row.game_id,
      contextId: row.participation_id,
      status: row.status,
      challengedVersion: row.challenged_version,
      explanation: row.explanation,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
      withdrawReason: row.withdraw_reason,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolutionKind: row.resolution_kind,
      latestManagerResponse: row.latest_manager_response,
      helpProgress: row.help_progress,
      caseProgress: {
        linked: Boolean(caseLink),
        status: row.help_progress,
      },
      challengedAssertion: challenged
        ? {
            version: challenged.resource_version,
            value: challenged.after_value,
            late: challenged.after_late,
            source: challenged.source,
            actorDisplay: await this.displayName(client, challenged.actor_user_id),
            recordedAt: challenged.recorded_at.toISOString(),
          }
        : null,
      currentAssertion: {
        value: current?.value ?? "unknown",
        version: current?.version ?? 0,
        late: current?.late ?? false,
        assertion: {
          actorDisplay: current ? await this.displayName(client, current.actor_user_id) : null,
          source: current?.source ?? null,
          at: current?.updated_at.toISOString() ?? null,
        },
      },
      history: history.rows.map((item) => ({
        version: item.resource_version,
        action: item.action,
        explanation: item.explanation,
        recordedAt: item.recorded_at.toISOString(),
      })),
      allowedActions: {
        canWithdraw: writes && isOwn && row.status === "open",
        canRespond: writes && pg2 && role === "manager" && row.status === "open",
        canRequestHelp: writes && pg2 && isOwn && row.status === "open",
        canAcknowledgeCurrent:
          writes &&
          isOwn &&
          row.status === "open" &&
          !!current &&
          current.value !== "unknown",
      },
    };
  }
}
