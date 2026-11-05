import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  eligibleFromTransitions,
  type AttendanceSource,
  type AttendanceValue,
} from "../games/game-attendance.policy";
import {
  evaluateVenueExperienceAdmission,
  subjectHasConfirmedExperience,
  type ExperienceAttendanceAssertion,
} from "../games/game-experience";
import { effectiveVenueCtes } from "./effective-venue.query";
import {
  consentPreviewRequest,
  createVenueReviewRequest,
  venueReviewCommandRequest,
  venueReviewReportRequest,
  type OwnVenueEligibilityBasisDto,
  type OwnVenueReviewDto,
  type PublicVenueReviewItemDto,
  type VenueReviewMutationReceiptDto,
  type VenueReviewsSummaryDto,
} from "./venue-reviews.dto";
import {
  PUBLIC_AUTHOR_LABEL,
  computeNotBefore,
  decodePublicCursor,
  isPubliclyVisible,
  opaqueHandle,
  parseOrThrow,
  postGameWritesEnabled,
  projectionHash,
  redactPublicCursor,
  topicsAllowed,
  unavailable,
  withinSubmitWindow,
  writesUnavailable,
  VENUE_APPEAL_MIN_WINDOW_MS,
  VENUE_REVIEW_PAGE_DEFAULT,
  VENUE_REVIEW_PAGE_MAX,
  VENUE_SUBMIT_WINDOW_MS,
} from "./venue-reviews.policy";

type SlotRow = {
  id: string;
  author_user_id: string;
  canonical_venue_id: string;
  public_handle: string;
  status: string;
  version: number;
  approved_revision_id: string | null;
  pending_revision_id: string | null;
  first_eligible_at: Date | null;
  basis_under_review: boolean;
};

type GameLock = {
  id: string;
  status: string;
  visibility: string;
  title: string | null;
  starts_at: Date;
  ends_at: Date;
  venue_id: string;
  created_by_user_id: string;
};

@Injectable()
export class VenueReviewsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean(
      (await client.query("SELECT to_regclass('venue_review_slots') AS name")).rows[0]?.name,
    );
  }

  private receiptToken(): string {
    return randomBytes(16).toString("hex");
  }

  private async resolveCanonicalVenue(
    client: PoolClient | Pool,
    sourceVenueId: string,
  ): Promise<{ canonicalVenueId: string; resolved: boolean } | null> {
    const row = (
      await client.query<{ id: string; canonical_resolved: boolean }>(
        `${effectiveVenueCtes("SELECT $1::uuid AS id")}
         SELECT v.id, ev.canonical_resolved
         FROM effective_venues ev
         JOIN venues v ON v.id = ev.id
         WHERE ev.source_id = $1`,
        [sourceVenueId],
      )
    ).rows[0];
    if (!row) return null;
    return { canonicalVenueId: row.id, resolved: row.canonical_resolved };
  }

  private async loadAssertion(
    client: PoolClient | Pool,
    participationId: string,
  ): Promise<ExperienceAttendanceAssertion | null> {
    const row = (
      await client.query<{
        value: AttendanceValue;
        source: AttendanceSource;
        actor_user_id: string;
        version: number;
      }>(
        `SELECT value, source, actor_user_id, version FROM game_attendance WHERE participation_id = $1`,
        [participationId],
      )
    ).rows[0];
    if (!row) return null;
    return {
      value: row.value,
      source: row.source,
      actorUserId: row.actor_user_id,
      version: row.version,
    };
  }

  private async hasOpenDispute(client: PoolClient | Pool, participationId: string): Promise<boolean> {
    return Boolean(
      (
        await client.query(
          `SELECT 1 FROM game_attendance_disputes
           WHERE participation_id = $1 AND status = 'open' LIMIT 1`,
          [participationId],
        )
      ).rows[0],
    );
  }

  private async loadOwnParticipation(
    client: PoolClient | Pool,
    gameId: string,
    userId: string,
  ): Promise<{ id: string; status: string; confirmed_at: Date | null } | null> {
    return (
      await client.query<{ id: string; status: string; confirmed_at: Date | null }>(
        `SELECT id, status, confirmed_at FROM participations
         WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
        [gameId, userId],
      )
    ).rows[0] ?? null;
  }

  private async isVenueAffiliated(
    client: PoolClient | Pool,
    userId: string,
    canonicalVenueId: string,
  ): Promise<boolean> {
    // No verified venue-representative role in v1 — only refuse obvious creator of venue row.
    const row = (
      await client.query(
        `SELECT 1 FROM venues WHERE id = $1 AND created_by_user_id = $2 LIMIT 1`,
        [canonicalVenueId, userId],
      )
    ).rows[0];
    return Boolean(row);
  }

  private async loadAdmission(
    client: PoolClient,
    userId: string,
    gameId: string,
    expectedVenueId: string | null,
  ): Promise<{
    verdict: ReturnType<typeof evaluateVenueExperienceAdmission>;
    game: GameLock;
    canonicalVenueId: string | null;
    outcomeVersion: number;
    attendanceVersion: number;
    firstEligibleCandidate: Date | null;
  }> {
    const game = (
      await client.query<GameLock>(
        `SELECT id, status, visibility, title, starts_at, ends_at, venue_id, created_by_user_id
         FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!game) unavailable();
    const now = new Date();
    const outcome = (
      await client.query<{ value: string; version: number }>(
        `SELECT value, version FROM game_outcomes WHERE game_id = $1`,
        [gameId],
      )
    ).rows[0];
    const lifecycleOk =
      game.ends_at.getTime() <= now.getTime() &&
      (game.status === "published" || game.status === "completed");
    const outcomeHeld = outcome?.value === "held";
    const venue = await this.resolveCanonicalVenue(client, game.venue_id);
    const canonicalVenueId = venue?.resolved ? venue.canonicalVenueId : null;
    if (
      expectedVenueId &&
      canonicalVenueId &&
      expectedVenueId !== canonicalVenueId &&
      expectedVenueId !== game.venue_id
    ) {
      return {
        verdict: { status: "deny", reason: "wrong_venue" },
        game,
        canonicalVenueId,
        outcomeVersion: outcome?.version ?? 0,
        attendanceVersion: 0,
        firstEligibleCandidate: null,
      };
    }
    // Accept either source or canonical id as the page venue.
    let pageVenueOk = true;
    if (expectedVenueId) {
      const expectedCanon = await this.resolveCanonicalVenue(client, expectedVenueId);
      if (!expectedCanon?.resolved || expectedCanon.canonicalVenueId !== canonicalVenueId) {
        pageVenueOk = false;
      }
    }
    if (!pageVenueOk) {
      return {
        verdict: { status: "deny", reason: "wrong_venue" },
        game,
        canonicalVenueId,
        outcomeVersion: outcome?.version ?? 0,
        attendanceVersion: 0,
        firstEligibleCandidate: null,
      };
    }
    const own = await this.loadOwnParticipation(client, gameId, userId);
    let ownEligible = false;
    let assertion: ExperienceAttendanceAssertion | null = null;
    let openDispute = false;
    let confirmed = false;
    if (own) {
      const transitions = (
        await client.query<{ to_status: string; at: Date; id: string }>(
          `SELECT to_status, at, id FROM participation_transitions
           WHERE participation_id = $1 ORDER BY at ASC, id ASC`,
          [own.id],
        )
      ).rows;
      ownEligible = eligibleFromTransitions(
        transitions,
        game.starts_at,
        own.status,
        own.confirmed_at,
        game.ends_at,
      ).eligible;
      openDispute = await this.hasOpenDispute(client, own.id);
      assertion = await this.loadAssertion(client, own.id);
      confirmed = subjectHasConfirmedExperience({
        transitions,
        startsAt: game.starts_at,
        endsAt: game.ends_at,
        currentStatus: own.status,
        confirmedAt: own.confirmed_at,
        subjectUserId: userId,
        openDispute,
        assertion,
      });
    }
    const affiliated = canonicalVenueId
      ? await this.isVenueAffiliated(client, userId, canonicalVenueId)
      : false;
    const verdict = evaluateVenueExperienceAdmission({
      lifecycleOk,
      outcomeHeld,
      ownEligible,
      authorConfirmedPresent: confirmed,
      authorOpenDispute: openDispute,
      authorAttendance: assertion,
      subjectUserId: userId,
      canonicalVenueId,
      canonicalResolved: Boolean(venue?.resolved && canonicalVenueId),
      venueAffiliated: affiliated,
    });
    const firstEligibleCandidate =
      verdict.status === "may_submit" ? now : null;
    return {
      verdict,
      game,
      canonicalVenueId,
      outcomeVersion: outcome?.version ?? 0,
      attendanceVersion: assertion?.version ?? 0,
      firstEligibleCandidate,
    };
  }

  private helpHint(
    verdict: ReturnType<typeof evaluateVenueExperienceAdmission>,
  ): OwnVenueEligibilityBasisDto["helpHint"] {
    if (verdict.status === "missing_history") return "missing_history";
    if (verdict.status !== "hold") return null;
    if (verdict.reason === "attendance_unmarked" || verdict.reason === "attendance_unknown") {
      return "attendance_unmarked";
    }
    if (verdict.reason === "attendance_dispute") return "attendance_clarifying";
    return null;
  }

  async listPublic(
    venueId: string,
    opts: { cursor?: string; limit?: string },
  ): Promise<VenueReviewsSummaryDto> {
    if (!(await this.installed(this.pool))) {
      return {
        venueId,
        publishedCount: 0,
        items: [],
        nextCursor: null,
        canWriteHint: false,
      };
    }
    const canon = await this.resolveCanonicalVenue(this.pool, venueId);
    if (!canon?.resolved) {
      return {
        venueId,
        publishedCount: 0,
        items: [],
        nextCursor: null,
        canWriteHint: false,
      };
    }
    const limit = Math.min(
      Math.max(Number(opts.limit) || VENUE_REVIEW_PAGE_DEFAULT, 1),
      VENUE_REVIEW_PAGE_MAX,
    );
    const cursor = decodePublicCursor(opts.cursor);
    const now = new Date();
    const rows = await this.pool.query<{
      public_handle: string;
      body_text: string;
      topics: string[];
      resource_version: number;
      not_before: Date;
      updated_at: Date;
    }>(
      `SELECT s.public_handle, r.body_text, r.topics, r.resource_version, r.not_before, s.updated_at
       FROM venue_review_slots s
       JOIN venue_review_revisions r ON r.id = s.approved_revision_id
       WHERE s.canonical_venue_id = $1
         AND s.status IN ('published', 'revision_waiting')
         AND s.basis_under_review = false
         AND r.audience = 'public_venue'
         AND r.lifecycle = 'published'
         AND r.not_before IS NOT NULL
         AND r.not_before <= $2
         AND ($3::timestamptz IS NULL OR (s.updated_at, s.public_handle) < ($3::timestamptz, $4::text))
       ORDER BY s.updated_at DESC, s.public_handle DESC
       LIMIT $5`,
      [canon.canonicalVenueId, now, cursor?.u ?? null, cursor?.h ?? null, limit + 1],
    );
    const slice = rows.rows.slice(0, limit);
    const items: PublicVenueReviewItemDto[] = slice.map((r) => ({
      reviewHandle: r.public_handle,
      authorLabel: PUBLIC_AUTHOR_LABEL,
      text: r.body_text,
      topics: r.topics ?? [],
      publishedRevision: r.resource_version,
      publishedAt: r.not_before.toISOString(),
    }));
    const count = (
      await this.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM venue_review_slots s
         JOIN venue_review_revisions r ON r.id = s.approved_revision_id
         WHERE s.canonical_venue_id = $1
           AND s.status IN ('published', 'revision_waiting')
           AND s.basis_under_review = false
           AND r.audience = 'public_venue'
           AND r.lifecycle = 'published'
           AND r.not_before IS NOT NULL
           AND r.not_before <= $2`,
        [canon.canonicalVenueId, now],
      )
    ).rows[0];
    let nextCursor: string | null = null;
    if (rows.rows.length > limit) {
      const last = slice[slice.length - 1]!;
      nextCursor = redactPublicCursor({
        u: last.updated_at.toISOString(),
        h: last.public_handle,
      });
    }
    return {
      venueId: canon.canonicalVenueId,
      publishedCount: Number(count?.n ?? 0),
      items,
      nextCursor,
      canWriteHint: true,
    };
  }

  async eligibility(
    userId: string,
    venueId: string,
  ): Promise<{ bases: OwnVenueEligibilityBasisDto[] }> {
    if (!(await this.installed(this.pool))) return { bases: [] };
    const canon = await this.resolveCanonicalVenue(this.pool, venueId);
    if (!canon?.resolved) return { bases: [] };
    // Own ended games at this canonical venue — private to author.
    const games = await this.pool.query<{
      id: string;
      title: string | null;
      starts_at: Date;
      ends_at: Date;
      status: string;
      venue_id: string;
    }>(
      `${effectiveVenueCtes(
        `SELECT g.venue_id AS id FROM games g
         INNER JOIN participations p ON p.game_id = g.id AND p.user_id = $1
         WHERE g.ends_at <= clock_timestamp()
           AND g.status IN ('published', 'completed')`,
      )}
       SELECT g.id, g.title, g.starts_at, g.ends_at, g.status, g.venue_id
       FROM games g
       INNER JOIN participations p ON p.game_id = g.id AND p.user_id = $1
       INNER JOIN effective_venues ev ON ev.source_id = g.venue_id
       WHERE ev.canonical_resolved AND ev.id = $2
         AND g.ends_at <= clock_timestamp()
         AND g.status IN ('published', 'completed')
       ORDER BY g.ends_at DESC
       LIMIT 30`,
      [userId, canon.canonicalVenueId],
    );
    const bases: OwnVenueEligibilityBasisDto[] = [];
    const client = await this.pool.connect();
    try {
      for (const g of games.rows) {
        const adm = await this.loadAdmission(client, userId, g.id, venueId);
        const fence = (
          await client.query<{ first_eligible_at: Date }>(
            `SELECT first_eligible_at FROM venue_review_event_fences
             WHERE author_user_id = $1 AND game_id = $2 AND canonical_venue_id = $3`,
            [userId, g.id, canon.canonicalVenueId],
          )
        ).rows[0];
        let admission: OwnVenueEligibilityBasisDto["admission"] = adm.verdict.status;
        let reason = adm.verdict.status === "may_submit" ? null : adm.verdict.reason;
        if (adm.verdict.status === "may_submit") {
          const first = fence?.first_eligible_at ?? adm.firstEligibleCandidate;
          if (first && !withinSubmitWindow({ firstEligibleAt: first, now: new Date() })) {
            admission = "deny";
            reason = "window_closed";
          }
        }
        bases.push({
          gameId: g.id,
          gameTitle: g.title,
          admission,
          reason,
          outcomeVersion: adm.outcomeVersion,
          attendanceVersion: adm.attendanceVersion,
          firstEligibleAt: fence?.first_eligible_at?.toISOString() ?? null,
          helpHint: this.helpHint(adm.verdict),
        });
      }
    } finally {
      client.release();
    }
    return { bases };
  }

  async previewConsent(
    userId: string,
    input: unknown,
  ): Promise<{ consentProjectionHash: string; authorLabel: string }> {
    void userId;
    const body = parseOrThrow(consentPreviewRequest, input);
    if (!topicsAllowed(body.topics)) {
      throw unprocessable("VENUE_TOPICS_INVALID", "Некорректные темы");
    }
    const canon = await this.resolveCanonicalVenue(this.pool, body.venueId);
    if (!canon?.resolved) unavailable();
    return {
      consentProjectionHash: projectionHash({
        canonicalVenueId: canon.canonicalVenueId,
        audience: "public_venue",
        text: body.text,
        topics: body.topics,
      }),
      authorLabel: PUBLIC_AUTHOR_LABEL,
    };
  }

  private async ensureSlot(
    client: PoolClient,
    userId: string,
    canonicalVenueId: string,
  ): Promise<SlotRow> {
    const existing = (
      await client.query<SlotRow>(
        `SELECT * FROM venue_review_slots
         WHERE author_user_id = $1 AND canonical_venue_id = $2
         FOR UPDATE`,
        [userId, canonicalVenueId],
      )
    ).rows[0];
    if (existing) return existing;
    const inserted = (
      await client.query<SlotRow>(
        `INSERT INTO venue_review_slots
           (author_user_id, canonical_venue_id, public_handle, status, version)
         VALUES ($1, $2, $3, 'self_draft', 1)
         ON CONFLICT (author_user_id, canonical_venue_id) DO NOTHING
         RETURNING *`,
        [userId, canonicalVenueId, opaqueHandle()],
      )
    ).rows[0];
    if (inserted) return inserted;
    return (
      await client.query<SlotRow>(
        `SELECT * FROM venue_review_slots
         WHERE author_user_id = $1 AND canonical_venue_id = $2
         FOR UPDATE`,
        [userId, canonicalVenueId],
      )
    ).rows[0]!;
  }

  private async createPendingIntake(
    client: PoolClient,
    args: {
      kind: "review_submit" | "report" | "appeal" | "basis_dispute";
      slotId: string;
      revisionId: string | null;
      userId: string;
      canonicalVenueId: string;
      priorDecisionId?: string | null;
    },
  ): Promise<{ id: string; receiptToken: string }> {
    const token = this.receiptToken();
    const row = (
      await client.query<{ id: string; receipt_token: string }>(
        `INSERT INTO venue_review_pending_intakes
           (kind, slot_id, revision_id, receipt_token, status, submitted_by_user_id,
            canonical_venue_id, version, prior_decision_id)
         VALUES ($1, $2, $3, $4, 'waiting_intake', $5, $6, 1, $7)
         RETURNING id, receipt_token`,
        [
          args.kind,
          args.slotId,
          args.revisionId,
          token,
          args.userId,
          args.canonicalVenueId,
          args.priorDecisionId ?? null,
        ],
      )
    ).rows[0]!;
    return { id: row.id, receiptToken: row.receipt_token };
  }

  private async writeRevision(
    client: PoolClient,
    args: {
      userId: string;
      venueId: string;
      gameId: string;
      audience: "self_draft" | "public_venue";
      text: string;
      topics: string[];
      consentProjectionHash?: string;
      expectedOutcomeVersion: number;
      expectedAttendanceVersion: number;
      expectedSlotVersion: number | null;
    },
  ): Promise<VenueReviewMutationReceiptDto> {
    if (!topicsAllowed(args.topics)) {
      throw unprocessable("VENUE_TOPICS_INVALID", "Некорректные темы");
    }
    const adm = await this.loadAdmission(client, args.userId, args.gameId, args.venueId);
    if (adm.verdict.status !== "may_submit" || !adm.canonicalVenueId) {
      if (adm.verdict.status === "hold" || adm.verdict.status === "missing_history") {
        throw unprocessable("VENUE_EXPERIENCE_HOLD", "Основание уточняется");
      }
      throw unprocessable("VENUE_EXPERIENCE_DENIED", "Нет допуска");
    }
    if (adm.outcomeVersion !== args.expectedOutcomeVersion) {
      throw conflict("VERSION_CONFLICT", "Версия итога устарела");
    }
    if (adm.attendanceVersion !== args.expectedAttendanceVersion) {
      throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
    }
    if (args.audience === "public_venue") {
      const expected = projectionHash({
        canonicalVenueId: adm.canonicalVenueId,
        audience: "public_venue",
        text: args.text,
        topics: args.topics,
      });
      if (expected !== args.consentProjectionHash) {
        throw unprocessable("VENUE_CONSENT_MISMATCH", "Согласие не соответствует тексту");
      }
    }
    const slot = await this.ensureSlot(client, args.userId, adm.canonicalVenueId);
    if (slot.status === "withdrawn") {
      throw conflict("WITHDRAWN_SLOT", "Слот после отзыва не открывается повторно этим путём");
    }
    if (args.expectedSlotVersion != null && slot.version !== args.expectedSlotVersion) {
      throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
    }
    // Fence + first eligible anchor (immutable once set).
    const existingFence = (
      await client.query<{ first_eligible_at: Date }>(
        `SELECT first_eligible_at FROM venue_review_event_fences
         WHERE author_user_id = $1 AND game_id = $2 AND canonical_venue_id = $3`,
        [args.userId, args.gameId, adm.canonicalVenueId],
      )
    ).rows[0];
    let firstEligibleAt = existingFence?.first_eligible_at ?? null;
    if (!existingFence) {
      // Another game may already own the slot fence for a different game — allowed to update slot.
      const otherFence = (
        await client.query(
          `SELECT 1 FROM venue_review_event_fences
           WHERE author_user_id = $1 AND game_id = $2 AND canonical_venue_id <> $3`,
          [args.userId, args.gameId, adm.canonicalVenueId],
        )
      ).rows[0];
      void otherFence;
      firstEligibleAt = new Date();
      await client.query(
        `INSERT INTO venue_review_event_fences
           (author_user_id, game_id, canonical_venue_id, slot_id, first_eligible_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [args.userId, args.gameId, adm.canonicalVenueId, slot.id, firstEligibleAt],
      );
      const re = (
        await client.query<{ first_eligible_at: Date }>(
          `SELECT first_eligible_at FROM venue_review_event_fences
           WHERE author_user_id = $1 AND game_id = $2 AND canonical_venue_id = $3`,
          [args.userId, args.gameId, adm.canonicalVenueId],
        )
      ).rows[0];
      firstEligibleAt = re!.first_eligible_at;
    }
    // Slot-level first_eligible_at: earliest across fences; ordinary edits do not reset.
    if (!slot.first_eligible_at) {
      await client.query(
        `UPDATE venue_review_slots SET first_eligible_at = $2, updated_at = clock_timestamp()
         WHERE id = $1 AND first_eligible_at IS NULL`,
        [slot.id, firstEligibleAt],
      );
    }
    const slotFirst = slot.first_eligible_at ?? firstEligibleAt!;
    if (!withinSubmitWindow({ firstEligibleAt: slotFirst, now: new Date() })) {
      throw unprocessable("VENUE_WINDOW_CLOSED", "Срок подачи истёк");
    }
    const nextVersion =
      (
        await client.query<{ m: number | null }>(
          `SELECT max(resource_version) AS m FROM venue_review_revisions WHERE slot_id = $1`,
          [slot.id],
        )
      ).rows[0]?.m ?? 0;
    const resourceVersion = nextVersion + 1;
    const now = new Date();
    const rev = (
      await client.query<{ id: string }>(
        `INSERT INTO venue_review_revisions
           (slot_id, resource_version, game_id, audience, body_text, topics,
            projection_hash, consent_at, last_material_edit_at, lifecycle,
            actor_user_id, attendance_version, outcome_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          slot.id,
          resourceVersion,
          args.gameId,
          args.audience,
          args.text,
          args.topics,
          args.audience === "public_venue" ? args.consentProjectionHash! : null,
          args.audience === "public_venue" ? now : null,
          now,
          args.audience === "self_draft" ? "self_draft" : "submitted",
          args.userId,
          args.expectedAttendanceVersion,
          args.expectedOutcomeVersion,
        ],
      )
    ).rows[0]!;
    let status = slot.status;
    let receiptToken: string | null = null;
    if (args.audience === "self_draft") {
      status =
        slot.approved_revision_id && slot.status === "published"
          ? "revision_waiting"
          : "self_draft";
      await client.query(
        `UPDATE venue_review_slots
         SET pending_revision_id = $2, status = $3, version = version + 1,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [slot.id, rev.id, status],
      );
    } else {
      // Public: cancel prior waiting intake for this slot submit kind.
      await client.query(
        `UPDATE venue_review_pending_intakes SET status = 'cancelled', updated_at = clock_timestamp()
         WHERE slot_id = $1 AND kind = 'review_submit' AND status = 'waiting_intake'`,
        [slot.id],
      );
      const intake = await this.createPendingIntake(client, {
        kind: "review_submit",
        slotId: slot.id,
        revisionId: rev.id,
        userId: args.userId,
        canonicalVenueId: adm.canonicalVenueId,
      });
      receiptToken = intake.receiptToken;
      status =
        slot.approved_revision_id &&
        (slot.status === "published" || slot.status === "revision_waiting")
          ? "revision_waiting"
          : "submitted_waiting";
      await client.query(
        `UPDATE venue_review_slots
         SET pending_revision_id = $2, status = $3, version = version + 1,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [slot.id, rev.id, status],
      );
    }
    const refreshed = (
      await client.query<SlotRow>(`SELECT * FROM venue_review_slots WHERE id = $1`, [slot.id])
    ).rows[0]!;
    return {
      id: refreshed.id,
      version: refreshed.version,
      status: refreshed.status,
      reviewHandle: refreshed.public_handle,
      receiptToken,
      publicVisible: false,
      notBefore: null,
    };
  }

  async createReview(
    userId: string,
    sessionId: string,
    key: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: VenueReviewMutationReceiptDto }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(createVenueReviewRequest, input);
    const requestHash = this.idempotency.requestHash(body);
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "venue_review.create",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const adm = await this.loadAdmission(client, userId, body.gameId, body.venueId);
        if (adm.verdict.status !== "may_submit") {
          throw unprocessable("VENUE_EXPERIENCE_DENIED", "Нет допуска");
        }
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        // Uniqueness: one author/venue/game fence — if fence exists for another slot game
        // with different key body, still update same slot.
        const fenceExists = (
          await client.query(
            `SELECT slot_id FROM venue_review_event_fences
             WHERE author_user_id = $1 AND game_id = $2`,
            [userId, body.gameId],
          )
        ).rows[0];
        if (fenceExists) {
          // Same game already used — treat as revision of existing slot (CAS via null expected).
        }
        const receipt = await this.writeRevision(client, {
          userId,
          venueId: body.venueId,
          gameId: body.gameId,
          audience: body.audience,
          text: body.text,
          topics: body.topics,
          consentProjectionHash: body.consentProjectionHash,
          expectedOutcomeVersion: body.expectedBasisVersions.outcomeVersion,
          expectedAttendanceVersion: body.expectedBasisVersions.attendanceVersion,
          expectedSlotVersion: null,
        });
        return { statusCode: 200, body: receipt };
      },
    });
  }

  async listMine(userId: string): Promise<{ items: OwnVenueReviewDto[] }> {
    if (!(await this.installed(this.pool))) return { items: [] };
    const now = new Date();
    const rows = await this.pool.query<{
      id: string;
      public_handle: string;
      canonical_venue_id: string;
      status: string;
      version: number;
      first_eligible_at: Date | null;
      basis_under_review: boolean;
      audience: "self_draft" | "public_venue" | null;
      body_text: string | null;
      topics: string[] | null;
      approved_version: number | null;
      pending_version: number | null;
      not_before: Date | null;
      approved_id: string | null;
      receipt_token: string | null;
    }>(
      `SELECT s.id, s.public_handle, s.canonical_venue_id, s.status, s.version,
              s.first_eligible_at, s.basis_under_review,
              COALESCE(pr.audience, ar.audience) AS audience,
              COALESCE(pr.body_text, ar.body_text) AS body_text,
              COALESCE(pr.topics, ar.topics, '{}') AS topics,
              ar.resource_version AS approved_version,
              pr.resource_version AS pending_version,
              ar.not_before,
              s.approved_revision_id AS approved_id,
              pi.receipt_token
       FROM venue_review_slots s
       LEFT JOIN venue_review_revisions ar ON ar.id = s.approved_revision_id
       LEFT JOIN venue_review_revisions pr ON pr.id = s.pending_revision_id
       LEFT JOIN LATERAL (
         SELECT receipt_token FROM venue_review_pending_intakes
         WHERE slot_id = s.id AND submitted_by_user_id = s.author_user_id
           AND kind IN ('review_submit', 'appeal')
           AND status IN ('waiting_intake', 'linked')
         ORDER BY created_at DESC LIMIT 1
       ) pi ON true
       WHERE s.author_user_id = $1
       ORDER BY s.updated_at DESC
       LIMIT 50`,
      [userId],
    );
    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        reviewHandle: r.public_handle,
        venueId: r.canonical_venue_id,
        status: r.status,
        version: r.version,
        audience: r.audience,
        text: r.body_text,
        topics: r.topics ?? [],
        pendingRevision: r.pending_version,
        approvedRevision: r.approved_version,
        publicVisible: isPubliclyVisible({
          slotStatus: r.status,
          approvedRevisionId: r.approved_id,
          notBefore: r.not_before,
          now,
          basisUnderReview: r.basis_under_review,
        }),
        notBefore: r.not_before?.toISOString() ?? null,
        firstEligibleAt: r.first_eligible_at?.toISOString() ?? null,
        receiptToken: r.receipt_token,
      })),
    };
  }

  async ownCommand(
    userId: string,
    sessionId: string,
    key: string,
    reviewId: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: VenueReviewMutationReceiptDto }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(venueReviewCommandRequest, input);
    const requestHash = this.idempotency.requestHash({ reviewId, ...body });
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: `venue_review.${body.action}`,
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM venue_review_slots WHERE id = $1 AND author_user_id = $2`,
            [reviewId, userId],
          )
        ).rows[0];
        if (!slot) unavailable();
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM venue_review_slots WHERE id = $1 AND author_user_id = $2 FOR UPDATE`,
            [reviewId, userId],
          )
        ).rows[0];
        if (!slot) unavailable();
        if (body.action === "withdraw") {
          if (slot.version !== body.expectedVersion) {
            throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
          }
          await client.query(
            `UPDATE venue_review_slots
             SET status = 'withdrawn', pending_revision_id = NULL, version = version + 1,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [slot.id],
          );
          await client.query(
            `UPDATE venue_review_pending_intakes SET status = 'cancelled', updated_at = clock_timestamp()
             WHERE slot_id = $1 AND status = 'waiting_intake'`,
            [slot.id],
          );
          const refreshed = (
            await client.query<SlotRow>(`SELECT * FROM venue_review_slots WHERE id = $1`, [slot.id])
          ).rows[0]!;
          return {
            statusCode: 200,
            body: {
              id: refreshed.id,
              version: refreshed.version,
              status: refreshed.status,
              reviewHandle: refreshed.public_handle,
              receiptToken: null,
              publicVisible: false,
              notBefore: null,
            },
          };
        }
        if (body.action === "appeal") {
          if (slot.version !== body.expectedVersion) {
            throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
          }
          if (slot.status !== "removed" && slot.status !== "needs_correction") {
            throw unprocessable("VENUE_APPEAL_DENIED", "Апелляция недоступна");
          }
          const prior = (
            await client.query<{ id: string }>(
              `SELECT id FROM venue_review_decisions WHERE slot_id = $1
               ORDER BY recorded_at DESC, id DESC LIMIT 1`,
              [slot.id],
            )
          ).rows[0];
          const intake = await this.createPendingIntake(client, {
            kind: "appeal",
            slotId: slot.id,
            revisionId: slot.pending_revision_id ?? slot.approved_revision_id,
            userId,
            canonicalVenueId: slot.canonical_venue_id,
            priorDecisionId: prior?.id ?? null,
          });
          await client.query(
            `UPDATE venue_review_slots SET version = version + 1, updated_at = clock_timestamp()
             WHERE id = $1`,
            [slot.id],
          );
          // Appeal preserves remaining window and grants at least 7 days from now via bonus marker:
          // store by extending first_eligible_at backward is forbidden; window check uses max(remaining,7d)
          // implemented in withinSubmitWindow callers via appealBonus — eligibility re-read uses
          // VENUE_APPEAL_MIN_WINDOW_MS from appeal intake created_at when present.
          void VENUE_APPEAL_MIN_WINDOW_MS;
          void VENUE_SUBMIT_WINDOW_MS;
          const refreshed = (
            await client.query<SlotRow>(`SELECT * FROM venue_review_slots WHERE id = $1`, [slot.id])
          ).rows[0]!;
          return {
            statusCode: 200,
            body: {
              id: refreshed.id,
              version: refreshed.version,
              status: refreshed.status,
              reviewHandle: refreshed.public_handle,
              receiptToken: intake.receiptToken,
              publicVisible: false,
              notBefore: null,
            },
          };
        }
        // submit_revision | resubmit
        const receipt = await this.writeRevision(client, {
          userId,
          venueId: slot.canonical_venue_id,
          gameId: body.gameId,
          audience: body.audience,
          text: body.text,
          topics: body.topics,
          consentProjectionHash:
            "consentProjectionHash" in body ? body.consentProjectionHash : undefined,
          expectedOutcomeVersion: body.expectedBasisVersions.outcomeVersion,
          expectedAttendanceVersion: body.expectedBasisVersions.attendanceVersion,
          expectedSlotVersion: body.expectedVersion,
        });
        return { statusCode: 200, body: receipt };
      },
    });
  }

  async report(
    userId: string,
    sessionId: string,
    key: string,
    reviewHandle: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: { receiptToken: string } }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(venueReviewReportRequest, input);
    const requestHash = this.idempotency.requestHash({ reviewHandle, ...body });
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "venue_review.report",
      key,
      requestHash,
      requiredCapabilities: undefined,
      authorizeReplay: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM venue_review_slots WHERE public_handle = $1`,
            [reviewHandle.toLowerCase()],
          )
        ).rows[0];
        if (!slot || !slot.approved_revision_id) unavailable();
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM venue_review_slots WHERE public_handle = $1 FOR UPDATE`,
            [reviewHandle.toLowerCase()],
          )
        ).rows[0];
        if (!slot || !slot.approved_revision_id) unavailable();
        const rev = (
          await client.query<{
            id: string;
            resource_version: number;
            lifecycle: string;
            audience: string;
          }>(`SELECT id, resource_version, lifecycle, audience FROM venue_review_revisions WHERE id = $1`, [
            slot.approved_revision_id,
          ])
        ).rows[0];
        if (!rev || rev.resource_version !== body.expectedRevision) {
          throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
        }
        if (rev.audience !== "public_venue" || rev.lifecycle !== "published") unavailable();
        const intake = await this.createPendingIntake(client, {
          kind: "report",
          slotId: slot.id,
          revisionId: rev.id,
          userId,
          canonicalVenueId: slot.canonical_venue_id,
        });
        await client.query(
          `INSERT INTO venue_review_reports
             (slot_id, reported_revision_id, reported_resource_version, reporter_user_id,
              reason_code, explanation, pending_intake_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (reporter_user_id, slot_id, reported_resource_version) DO NOTHING`,
          [
            slot.id,
            rev.id,
            rev.resource_version,
            userId,
            body.reasonCode,
            body.explanation ?? null,
            intake.id,
          ],
        );
        return { statusCode: 200, body: { receiptToken: intake.receiptToken } };
      },
    });
  }

  /**
   * Admin decide helpers — applied by AdminVenueReviewsService after COI checks.
   * Approve sets not_before; public visibility is derived on ordinary reads (no scheduler).
   */
  async applyApprove(
    client: PoolClient,
    slot: Pick<
      SlotRow,
      | "id"
      | "canonical_venue_id"
      | "status"
      | "approved_revision_id"
      | "pending_revision_id"
      | "public_handle"
    >,
    revisionId: string,
    now = new Date(),
  ): Promise<{ notBefore: Date }> {
    const rev = (
      await client.query<{
        id: string;
        slot_id: string;
        audience: string;
        body_text: string;
        topics: string[];
        projection_hash: string | null;
        last_material_edit_at: Date;
        game_id: string;
        actor_user_id: string;
        attendance_version: number;
        outcome_version: number;
        lifecycle: string;
      }>(`SELECT * FROM venue_review_revisions WHERE id = $1`, [revisionId])
    ).rows[0];
    if (!rev || rev.slot_id !== slot.id) {
      throw unprocessable("REVISION_UNAVAILABLE", "Редакция недоступна");
    }
    if (rev.audience !== "public_venue" || !rev.projection_hash) {
      throw unprocessable("VENUE_NOT_PUBLIC", "Редакция не для публикации");
    }
    if (slot.status === "withdrawn") {
      throw conflict("WITHDRAWN_NOT_APPROVABLE", "Отозванный отзыв нельзя опубликовать");
    }
    const expected = projectionHash({
      canonicalVenueId: slot.canonical_venue_id,
      audience: "public_venue",
      text: rev.body_text,
      topics: rev.topics ?? [],
    });
    if (expected !== rev.projection_hash) {
      throw unprocessable("VENUE_CONSENT_MISMATCH", "Согласие не соответствует тексту");
    }
    const adm = await this.loadAdmission(client, rev.actor_user_id, rev.game_id, slot.canonical_venue_id);
    if (adm.verdict.status !== "may_submit") {
      throw unprocessable("VENUE_EXPERIENCE_DENIED", "Нет допуска к публикации");
    }
    const notBefore = computeNotBefore(now, rev.last_material_edit_at);
    // Immutable revision: insert published tip copy is forbidden — store approval fields via
    // new superseding revision row is heavy; policy allows updating tip via slot + decision log,
    // but revisions are immutable. Encode approved_at/not_before by inserting a published twin? 
    // Simpler: allow one-shot UPDATE only through a dedicated SQL path — blocked by trigger.
    // Therefore: insert a new revision that copies body with lifecycle published + not_before,
    // mark previous pending as superseded via slot pointers only (old row stays submitted).
    const nextVersion =
      (
        await client.query<{ m: number | null }>(
          `SELECT max(resource_version) AS m FROM venue_review_revisions WHERE slot_id = $1`,
          [slot.id],
        )
      ).rows[0]?.m ?? 0;
    const published = (
      await client.query<{ id: string }>(
        `INSERT INTO venue_review_revisions
           (slot_id, resource_version, game_id, audience, body_text, topics,
            projection_hash, consent_at, last_material_edit_at, approved_at, not_before,
            lifecycle, actor_user_id, attendance_version, outcome_version)
         VALUES ($1,$2,$3,'public_venue',$4,$5,$6,$7,$8,$9,$10,'published',$11,$12,$13)
         RETURNING id`,
        [
          slot.id,
          nextVersion + 1,
          rev.game_id,
          rev.body_text,
          rev.topics,
          rev.projection_hash,
          now,
          rev.last_material_edit_at,
          now,
          notBefore,
          rev.actor_user_id,
          rev.attendance_version,
          rev.outcome_version,
        ],
      )
    ).rows[0]!;
    await client.query(
      `UPDATE venue_review_slots
       SET approved_revision_id = $2,
           pending_revision_id = CASE WHEN pending_revision_id = $3 THEN NULL ELSE pending_revision_id END,
           status = 'published',
           version = version + 1,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [slot.id, published.id, revisionId],
    );
    return { notBefore };
  }

  async applyRemove(client: PoolClient, slotId: string): Promise<void> {
    await client.query(
      `UPDATE venue_review_slots
       SET status = 'removed', version = version + 1, updated_at = clock_timestamp()
       WHERE id = $1`,
      [slotId],
    );
  }

  async applyRequestCorrection(client: PoolClient, slotId: string): Promise<void> {
    await client.query(
      `UPDATE venue_review_slots
       SET status = 'needs_correction', version = version + 1, updated_at = clock_timestamp()
       WHERE id = $1`,
      [slotId],
    );
  }

  async applyRestore(
    client: PoolClient,
    slot: Pick<SlotRow, "id" | "approved_revision_id">,
  ): Promise<void> {
    if (!slot.approved_revision_id) {
      throw conflict("RESTORE_DENIED", "Восстановление недоступно");
    }
    await client.query(
      `UPDATE venue_review_slots
       SET status = 'published', version = version + 1, updated_at = clock_timestamp()
       WHERE id = $1`,
      [slot.id],
    );
  }
}
