import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { conflict, forbidden } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { publicModerationSql, readModeration } from "../game-moderation/projection";
import {
  ContentModerationService,
  type TextBatchApproval,
} from "../moderation/moderation.service";
import {
  emptyAvatar,
  safeUploadedAvatar,
} from "../profiles/avatar-presentation";
import {
  safePublicDisplayName,
  SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
} from "../profiles/social-profile-defaults";
import { unrestrictedSql } from "../restrictions/policy";
import { PairFenceService } from "../safety/pair-fence.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  type CommentAuthorView,
  type CommentPage,
  type CommentView,
  type CreateCommentRequest,
  type DeleteCommentRequest,
  type EntityCommentKind,
  type UpdateCommentRequest,
  createCommentRequest,
  decodeCursor,
  deleteCommentRequest,
  encodeCursor,
  genericAuthor,
  normalizeCommentText,
  parse,
  parseCommentId,
  parseEntityId,
  parseLimit,
  parseOrder,
  unavailable,
  updateCommentRequest,
} from "./comments.policy";

type CommentRow = {
  id: string;
  entity_kind: EntityCommentKind;
  entity_id: string;
  parent_comment_id: string | null;
  author_user_id: string;
  body: string | null;
  version: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  reply_count?: string | number | null;
  author_blocked?: boolean | null;
  author_public_player_id?: string | null;
  author_display_name?: string | null;
  author_directory_visible?: boolean | null;
  author_social_eligible?: boolean | null;
  author_status?: string | null;
  author_avatar_key?: string | null;
  author_provider_url?: string | null;
  author_public_ok?: boolean | null;
};

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly pairs: PairFenceService,
    private readonly moderation: ContentModerationService,
  ) {}

  async list(
    kind: EntityCommentKind,
    entityIdRaw: string,
    viewerId: string | null,
    query: {
      cursor?: string;
      limit?: string;
      order?: string;
      parentCommentId?: string;
    },
  ): Promise<CommentPage> {
    const entityId = parseEntityId(entityIdRaw);
    const limit = parseLimit(query.limit);
    const order = parseOrder(query.order);
    const parentCommentId = query.parentCommentId
      ? parseCommentId(query.parentCommentId)
      : null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await this.lockAndAssertPublicParent(client, kind, entityId);
        // Broad VENUE public list closed pending postgame eligibility (#394 Owner 02.11):
        // verify public parent + normal params, never project legacy venue rows/counts/replies.
        if (kind === "venue") {
          if (query.cursor) {
            decodeCursor(query.cursor, {
              entityKind: kind,
              entityId,
              parentCommentId,
              order,
            });
          }
          await client.query("COMMIT");
          return {
            entityKind: kind,
            entityId,
            parentCommentId,
            items: [],
            nextCursor: null,
            visibleCount: 0,
            canCreate: false,
          };
        }
        if (parentCommentId) {
          await this.assertRootParent(client, kind, entityId, parentCommentId);
        }
        const cursor = query.cursor
          ? decodeCursor(query.cursor, {
            entityKind: kind,
            entityId,
            parentCommentId,
            order,
          })
          : null;

        const listParams: unknown[] = viewerId
          ? [kind, entityId, viewerId]
          : [kind, entityId];
        let listParentSql = "c.parent_comment_id IS NULL";
        if (parentCommentId) {
          listParams.push(parentCommentId);
          listParentSql = `c.parent_comment_id = $${listParams.length}`;
        }
        let listCursorSql = "";
        if (cursor) {
          listParams.push(new Date(cursor.createdAt), cursor.id);
          const a = listParams.length - 1;
          const b = listParams.length;
          listCursorSql = order === "asc"
            ? `AND (c.created_at, c.id) > ($${a}::timestamptz, $${b}::uuid)`
            : `AND (c.created_at, c.id) < ($${a}::timestamptz, $${b}::uuid)`;
        }
        listParams.push(limit + 1);
        const limitParam = `$${listParams.length}`;
        const blockExclude = viewerId
          ? `AND NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = $3::uuid AND b.blocked_user_id = c.author_user_id)
                  OR (b.blocked_user_id = $3::uuid AND b.blocker_user_id = c.author_user_id)
             )`
          : "";
        const replyBlockExclude = viewerId
          ? `AND NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = $3::uuid AND b.blocked_user_id = r.author_user_id)
                  OR (b.blocked_user_id = $3::uuid AND b.blocker_user_id = r.author_user_id)
             )`
          : "";

        const rows = (
          await client.query<CommentRow>(
            `SELECT c.*,
                    (
                      SELECT COUNT(*)::int FROM entity_comments r
                      WHERE r.parent_comment_id = c.id
                        AND r.entity_kind = c.entity_kind
                        AND r.entity_id = c.entity_id
                        ${replyBlockExclude}
                    ) AS reply_count,
                    FALSE AS author_blocked,
                    p.public_player_id AS author_public_player_id,
                    p.display_name AS author_display_name,
                    p.directory_visible AS author_directory_visible,
                    p.social_eligible AS author_social_eligible,
                    p.avatar_key AS author_avatar_key,
                    u.status AS author_status,
                    (
                      SELECT e.avatar_url FROM external_identities e
                      WHERE e.user_id = c.author_user_id
                        AND e.provider_key IN ('vk','yandex')
                        AND e.avatar_url IS NOT NULL
                      ORDER BY e.created_at, e.id LIMIT 1
                    ) AS author_provider_url,
                    (
                      u.status = 'active'
                      AND COALESCE(p.directory_visible, false)
                      AND COALESCE(p.social_eligible, false)
                      AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "c.author_user_id", ["account.access", "profile.public", "social.directory"])}
                    ) AS author_public_ok
             FROM entity_comments c
             LEFT JOIN player_social_profiles p ON p.user_id = c.author_user_id
             LEFT JOIN users u ON u.id = c.author_user_id
             WHERE c.entity_kind = $1
               AND c.entity_id = $2
               AND ${listParentSql}
               ${listCursorSql}
               ${blockExclude}
             ORDER BY c.created_at ${order === "asc" ? "ASC" : "DESC"}, c.id ${order === "asc" ? "ASC" : "DESC"}
             LIMIT ${limitParam}`,
            listParams,
          )
        ).rows;

        const countParams: unknown[] = [kind, entityId];
        let countParentSql = "c.parent_comment_id IS NULL";
        if (viewerId) countParams.push(viewerId);
        if (parentCommentId) {
          countParams.push(parentCommentId);
          countParentSql = `c.parent_comment_id = $${countParams.length}`;
        }
        // Visible count for this list scope (roots or one reply thread).
        const countRow = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM entity_comments c
           WHERE c.entity_kind = $1
             AND c.entity_id = $2
             AND ${countParentSql}
             AND c.deleted_at IS NULL
             ${viewerId ? `AND NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.blocker_user_id = $3::uuid AND b.blocked_user_id = c.author_user_id)
                  OR (b.blocked_user_id = $3::uuid AND b.blocker_user_id = c.author_user_id)
             )` : ""}`,
          countParams,
        );

        // Also include visible replies in root-page total when listing roots.
        let visibleCount = Number(countRow.rows[0]?.n ?? 0);
        if (!parentCommentId) {
          const totalParams: unknown[] = [kind, entityId];
          if (viewerId) totalParams.push(viewerId);
          const total = await client.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
             FROM entity_comments c
             WHERE c.entity_kind = $1
               AND c.entity_id = $2
               AND c.deleted_at IS NULL
               ${viewerId ? `AND NOT EXISTS (
                 SELECT 1 FROM user_blocks b
                 WHERE (b.blocker_user_id = $3::uuid AND b.blocked_user_id = c.author_user_id)
                    OR (b.blocked_user_id = $3::uuid AND b.blocker_user_id = c.author_user_id)
               )` : ""}`,
            totalParams,
          );
          visibleCount = Number(total.rows[0]?.n ?? 0);
        }

        const canCreate = await this.resolveCanCreate(client, kind, entityId, viewerId);
        await client.query("COMMIT");
        const page = rows.slice(0, limit);
        const hasMore = rows.length > limit;
        const last = page[page.length - 1];
        return {
          entityKind: kind,
          entityId,
          parentCommentId,
          items: page.map((row) => this.projectRow(row, viewerId)),
          nextCursor: hasMore && last
            ? encodeCursor({
              createdAt: last.created_at.toISOString(),
              id: last.id,
              entityKind: kind,
              entityId,
              parentCommentId,
              order,
            })
            : null,
          visibleCount,
          canCreate,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async create(
    kind: EntityCommentKind,
    entityIdRaw: string,
    actorId: string,
    sessionId: string,
    key: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: CommentView }> {
    const entityId = parseEntityId(entityIdRaw);
    const body = parse(createCommentRequest, input);
    const text = normalizeCommentText(body.text);
    const parentCommentId = body.parentCommentId ?? null;
    if (parentCommentId) parseCommentId(parentCommentId);
    const requestHash = this.idempotency.requestHash({
      kind,
      entityId,
      parentCommentId,
      text,
    });
    const receipt = {
      actorId,
      sessionId,
      operation: "comments.create",
      key,
      requestHash,
      requiredCapabilities: ["account.access", "profile.public"] as const,
      authorizeReplay: async (client: PoolClient) => {
        await this.lockAndAssertPublicParent(client, kind, entityId);
        await this.assertCanWrite(client, kind, entityId, actorId, parentCommentId);
      },
    };

    // Durable same-key claim before provider I/O; concurrent losers never approveTexts.
    return this.mutations.runWithExternalPrepare<TextBatchApproval, CommentView>({
      ...receipt,
      prepare: async () => {
        // Parent/actor/block fences before any provider I/O; no locks held across network.
        await this.authorizeWritePreflight(kind, entityId, actorId, parentCommentId);
        return this.moderation.approveTexts(actorId, [
          { surface: "comment_body", text, fieldId: "text" },
        ]);
      },
      execute: async (client, textApproval) => {
        await this.lockAndAssertPublicParent(client, kind, entityId);
        await this.assertCanWrite(client, kind, entityId, actorId, parentCommentId);
        const inserted = (
          await client.query<CommentRow>(
            `INSERT INTO entity_comments
               (entity_kind, entity_id, parent_comment_id, author_user_id, body, version)
             VALUES ($1, $2, $3, $4, $5, 1)
             RETURNING *`,
            [kind, entityId, parentCommentId, actorId, text],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO entity_comment_revisions
             (comment_id, entity_kind, entity_id, resource_version, actor_user_id, after_body, tombstone)
           VALUES ($1, $2, $3, 1, $4, $5, false)`,
          [inserted.id, kind, entityId, actorId, text],
        );
        await this.bindCommentPublication(client, textApproval, text, {
          commentId: inserted.id,
          resourceVersion: 1,
          actorUserId: actorId,
        });
        const projected = await this.loadProjected(client, inserted.id, actorId);
        return { statusCode: 201, body: projected };
      },
    });
  }

  async update(
    commentIdRaw: string,
    actorId: string,
    sessionId: string,
    key: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: CommentView }> {
    const commentId = parseCommentId(commentIdRaw);
    const body = parse(updateCommentRequest, input);
    const text = normalizeCommentText(body.text);
    const requestHash = this.idempotency.requestHash({
      commentId,
      expectedVersion: body.expectedVersion,
      text,
    });
    const receipt = {
      actorId,
      sessionId,
      operation: "comments.update",
      key,
      requestHash,
      requiredCapabilities: ["account.access", "profile.public"] as const,
      authorizeReplay: async (client: PoolClient) => {
        const row = await this.lockOwnedLiveComment(client, commentId, actorId);
        await this.lockAndAssertPublicParent(client, row.entity_kind, row.entity_id);
        this.assertBroadVenueWriteClosed(row.entity_kind);
      },
    };

    return this.mutations.runWithExternalPrepare<TextBatchApproval, CommentView>({
      ...receipt,
      prepare: async () => {
        await this.authorizeUpdatePreflight(commentId, actorId, body.expectedVersion);
        return this.moderation.approveTexts(actorId, [
          { surface: "comment_body", text, fieldId: "text" },
        ]);
      },
      execute: async (client, textApproval) => {
        const row = await this.lockOwnedLiveComment(client, commentId, actorId);
        await this.lockAndAssertPublicParent(client, row.entity_kind, row.entity_id);
        this.assertBroadVenueWriteClosed(row.entity_kind);
        if (row.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия комментария устарела");
        }
        const next = (
          await client.query<CommentRow>(
            `UPDATE entity_comments
             SET body = $2,
                 version = version + 1,
                 updated_at = clock_timestamp()
             WHERE id = $1
             RETURNING *`,
            [commentId, text],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO entity_comment_revisions
             (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
          [commentId, next.entity_kind, next.entity_id, next.version, actorId, row.body, text],
        );
        await this.bindCommentPublication(client, textApproval, text, {
          commentId,
          resourceVersion: next.version,
          actorUserId: actorId,
        });
        return { statusCode: 200, body: await this.loadProjected(client, commentId, actorId) };
      },
    });
  }

  async remove(
    commentIdRaw: string,
    actorId: string,
    sessionId: string,
    key: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: CommentView }> {
    const commentId = parseCommentId(commentIdRaw);
    const body = parse(deleteCommentRequest, input ?? {});
    const requestHash = this.idempotency.requestHash({
      commentId,
      expectedVersion: body.expectedVersion,
      op: "delete",
    });
    return this.mutations.runIdempotent<CommentView>({
      actorId,
      sessionId,
      operation: "comments.delete",
      key,
      requestHash,
      requiredCapabilities: ["account.access", "profile.public"],
      authorizeReplay: async (client) => {
        // Same-key SUCCESS delete replay: own row is already tombstoned.
        // Session/capability fences stay in MutationRunner; execute path unchanged.
        const row = await this.lockOwnedTombstonedComment(client, commentId, actorId);
        await this.lockAndAssertPublicParent(client, row.entity_kind, row.entity_id);
      },
      execute: async (client) => {
        const row = await this.lockOwnedLiveComment(client, commentId, actorId);
        await this.lockAndAssertPublicParent(client, row.entity_kind, row.entity_id);
        if (row.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия комментария устарела");
        }
        const next = (
          await client.query<CommentRow>(
            `UPDATE entity_comments
             SET body = NULL,
                 deleted_at = clock_timestamp(),
                 version = version + 1,
                 updated_at = clock_timestamp()
             WHERE id = $1
             RETURNING *`,
            [commentId],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO entity_comment_revisions
             (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, true)`,
          [commentId, next.entity_kind, next.entity_id, next.version, actorId, row.body],
        );
        return { statusCode: 200, body: await this.loadProjected(client, commentId, actorId) };
      },
    });
  }

  private async installed(client: PoolClient): Promise<boolean> {
    return Boolean((await client.query("SELECT to_regclass('entity_comments') AS name")).rows[0]?.name);
  }

  private async lockAndAssertPublicParent(
    client: PoolClient,
    kind: EntityCommentKind,
    entityId: string,
  ): Promise<void> {
    if (!(await this.installed(client))) unavailable();
    if (kind === "game") {
      // Lock order: Actor (MutationRunner) → Game → comments.
      const game = (
        await client.query<{
          id: string;
          status: string;
          visibility: string;
          created_by_user_id: string;
        }>(
          `SELECT id, status, visibility, created_by_user_id
           FROM games WHERE id = $1 FOR SHARE`,
          [entityId],
        )
      ).rows[0];
      if (!game) unavailable();
      // Re-read after any lock wait under the held fence.
      const fresh = (
        await client.query<{
          id: string;
          status: string;
          visibility: string;
        }>(
          `SELECT id, status, visibility FROM games WHERE id = $1`,
          [entityId],
        )
      ).rows[0];
      if (!fresh || fresh.status !== "published" || fresh.visibility !== "public") {
        unavailable();
      }
      if (this.env.GAME_MODERATION_INTERNAL_ENABLED) {
        const moderation = await readModeration(client, entityId);
        if (moderation.state === "taken_down") unavailable();
      }
      // Extra coherence: discovery-equivalent moderation SQL must still hold.
      const stillPublic = await client.query(
        `SELECT 1 FROM games g
         WHERE g.id = $1 AND g.status = 'published' AND g.visibility = 'public'
           AND ${publicModerationSql(this.env.GAME_MODERATION_INTERNAL_ENABLED, "g")}`,
        [entityId],
      );
      if (!stillPublic.rows[0]) unavailable();
      return;
    }

    const venue = (
      await client.query<{
        id: string;
        lifecycle_state: string;
        canonical_venue_id: string | null;
      }>(
        `SELECT id, lifecycle_state, canonical_venue_id
         FROM venues WHERE id = $1 FOR SHARE`,
        [entityId],
      )
    ).rows[0];
    if (!venue) unavailable();
    const fresh = (
      await client.query<{
        id: string;
        lifecycle_state: string;
        canonical_venue_id: string | null;
      }>(
        `SELECT id, lifecycle_state, canonical_venue_id FROM venues WHERE id = $1`,
        [entityId],
      )
    ).rows[0];
    // Stale merged/retired ids reject indistinguishably; UI resolves aliases first.
    if (
      !fresh
      || fresh.canonical_venue_id !== null
      || !["unverified", "verified"].includes(fresh.lifecycle_state)
    ) {
      unavailable();
    }
  }

  private async assertRootParent(
    client: PoolClient,
    kind: EntityCommentKind,
    entityId: string,
    parentCommentId: string,
  ): Promise<CommentRow> {
    const parent = (
      await client.query<CommentRow>(
        `SELECT * FROM entity_comments
         WHERE id = $1 AND entity_kind = $2 AND entity_id = $3
         FOR SHARE`,
        [parentCommentId, kind, entityId],
      )
    ).rows[0];
    if (!parent || parent.parent_comment_id !== null) unavailable();
    return parent;
  }

  /**
   * Broad VENUE create/reply/update remain CURRENT runtime-closed pending Owner-approved #507 I1.
   * Not a permanent product-by-design ban; #507 supersedes permanent closure of general venue discussion.
   * Owned delete/withdrawal stays on its own path and must not call this guard.
   * When #507 opens allowed venue writes, the same comment_body gate must protect them.
   */
  private assertBroadVenueWriteClosed(kind: EntityCommentKind): void {
    if (kind === "venue") {
      throw forbidden(
        "COMMENT_VENUE_WRITES_CLOSED",
        "Комментарии к площадке временно недоступны",
      );
    }
  }

  /**
   * Short authorized preflight before provider I/O. Ends before approveTexts.
   * Final execute revalidates the same fences under MutationRunner locks.
   */
  private async authorizeWritePreflight(
    kind: EntityCommentKind,
    entityId: string,
    actorId: string,
    parentCommentId: string | null,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await this.lockAndAssertPublicParent(client, kind, entityId);
        await this.assertCanWrite(client, kind, entityId, actorId, parentCommentId);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private async authorizeUpdatePreflight(
    commentId: string,
    actorId: string,
    expectedVersion: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const row = await this.lockOwnedLiveComment(client, commentId, actorId);
        await this.lockAndAssertPublicParent(client, row.entity_kind, row.entity_id);
        this.assertBroadVenueWriteClosed(row.entity_kind);
        if (row.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия комментария устарела");
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private async bindCommentPublication(
    client: PoolClient,
    approval: TextBatchApproval,
    text: string,
    meta: { commentId: string; resourceVersion: number; actorUserId: string },
  ): Promise<void> {
    await this.moderation.bindTexts(
      client,
      approval,
      [{ surface: "comment_body", text }],
      {
        entityKind: "entity_comment",
        entityId: meta.commentId,
        resourceVersion: meta.resourceVersion,
        actorUserId: meta.actorUserId,
        bindingKind: "publication",
      },
    );
  }

  /**
   * List projection of write eligibility — same capability + game-organizer block gates as create.
   * Does not invent admin policy; read stays available when false.
   * Broad VENUE create is always false while #507 I1 is pending (runtime closed, not permanent).
   */
  private async resolveCanCreate(
    client: PoolClient,
    kind: EntityCommentKind,
    entityId: string,
    viewerId: string | null,
  ): Promise<boolean> {
    if (!viewerId) return false;
    if (kind === "venue") return false;
    if (this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) {
      const allowed = await client.query(
        `SELECT 1 WHERE ${unrestrictedSql(true, "$1", ["account.access", "profile.public"])}`,
        [viewerId],
      );
      if (!allowed.rows[0]) return false;
    }
    if (kind === "game") {
      const organizer = (
        await client.query<{ created_by_user_id: string }>(
          `SELECT created_by_user_id FROM games WHERE id = $1`,
          [entityId],
        )
      ).rows[0];
      if (!organizer) return false;
      if (organizer.created_by_user_id !== viewerId) {
        if (await this.pairBlocked(client, viewerId, organizer.created_by_user_id)) {
          return false;
        }
      }
    }
    return true;
  }

  private async assertCanWrite(
    client: PoolClient,
    kind: EntityCommentKind,
    entityId: string,
    actorId: string,
    parentCommentId: string | null,
  ): Promise<void> {
    // Fail-closed for VENUE create/reply (and authorizeReplay of prior successes).
    this.assertBroadVenueWriteClosed(kind);
    if (kind === "game") {
      const organizer = (
        await client.query<{ created_by_user_id: string }>(
          `SELECT created_by_user_id FROM games WHERE id = $1`,
          [entityId],
        )
      ).rows[0];
      if (!organizer) unavailable();
      if (organizer.created_by_user_id !== actorId) {
        const blocked = await this.pairBlocked(client, actorId, organizer.created_by_user_id);
        if (blocked) {
          throw forbidden("COMMENT_PARENT_BLOCKED", "Комментарий недоступен из‑за блокировки");
        }
      }
    }
    if (parentCommentId) {
      const parent = await this.assertRootParent(client, kind, entityId, parentCommentId);
      if (parent.author_user_id !== actorId) {
        const blocked = await this.pairBlocked(client, actorId, parent.author_user_id);
        if (blocked) {
          throw forbidden("COMMENT_AUTHOR_BLOCKED", "Ответ недоступен из‑за блокировки");
        }
      }
      // Re-check on execution+replay: parent still same entity root.
      if (parent.deleted_at) {
        // Tombstoned root remains addressable for replies per contract.
      }
    }
  }

  private async pairBlocked(client: PoolClient, a: string, b: string): Promise<boolean> {
    // Ensure undirected pair ordering helpers stay aligned with Safety fencing.
    this.pairs.sortedPair(a, b);
    const exact = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [a, b],
    );
    return Boolean(exact.rows[0]);
  }

  private async lockOwnedLiveComment(
    client: PoolClient,
    commentId: string,
    actorId: string,
  ): Promise<CommentRow> {
    const row = (
      await client.query<CommentRow>(
        `SELECT * FROM entity_comments WHERE id = $1 FOR UPDATE`,
        [commentId],
      )
    ).rows[0];
    if (!row || row.author_user_id !== actorId || row.deleted_at) unavailable();
    return row;
  }

  /** Delete SUCCESS-receipt replay only: own tombstone + public parent still required. */
  private async lockOwnedTombstonedComment(
    client: PoolClient,
    commentId: string,
    actorId: string,
  ): Promise<CommentRow> {
    const row = (
      await client.query<CommentRow>(
        `SELECT * FROM entity_comments WHERE id = $1 FOR UPDATE`,
        [commentId],
      )
    ).rows[0];
    if (!row || row.author_user_id !== actorId || !row.deleted_at) unavailable();
    return row;
  }

  private async loadProjected(
    client: PoolClient,
    commentId: string,
    viewerId: string | null,
  ): Promise<CommentView> {
    const row = (
      await client.query<CommentRow>(
        `SELECT c.*,
                (
                  SELECT COUNT(*)::int FROM entity_comments r
                  WHERE r.parent_comment_id = c.id
                ) AS reply_count,
                FALSE AS author_blocked,
                p.public_player_id AS author_public_player_id,
                p.display_name AS author_display_name,
                p.directory_visible AS author_directory_visible,
                p.social_eligible AS author_social_eligible,
                p.avatar_key AS author_avatar_key,
                u.status AS author_status,
                (
                  SELECT e.avatar_url FROM external_identities e
                  WHERE e.user_id = c.author_user_id
                    AND e.provider_key IN ('vk','yandex')
                    AND e.avatar_url IS NOT NULL
                  ORDER BY e.created_at, e.id LIMIT 1
                ) AS author_provider_url,
                (
                  u.status = 'active'
                  AND COALESCE(p.directory_visible, false)
                  AND COALESCE(p.social_eligible, false)
                  AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "c.author_user_id", ["account.access", "profile.public", "social.directory"])}
                ) AS author_public_ok
         FROM entity_comments c
         LEFT JOIN player_social_profiles p ON p.user_id = c.author_user_id
         LEFT JOIN users u ON u.id = c.author_user_id
         WHERE c.id = $1`,
        [commentId],
      )
    ).rows[0];
    if (!row) unavailable();
    return this.projectRow(row, viewerId);
  }

  private projectRow(row: CommentRow, viewerId: string | null): CommentView {
    const deleted = row.deleted_at !== null;
    const author = this.projectAuthor(row);
    return {
      id: row.id,
      entityKind: row.entity_kind,
      entityId: row.entity_id,
      parentCommentId: row.parent_comment_id,
      body: deleted ? null : row.body,
      deleted,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      edited: !deleted && row.updated_at.getTime() > row.created_at.getTime() && row.version > 1,
      mine: Boolean(viewerId && viewerId === row.author_user_id),
      author: deleted && !row.author_public_ok ? genericAuthor() : author,
      replyCount: Number(row.reply_count ?? 0),
    };
  }

  private projectAuthor(row: CommentRow): CommentAuthorView {
    if (row.author_blocked) return genericAuthor();
    const publicOk = Boolean(row.author_public_ok);
    if (!publicOk) {
      return {
        publicPlayerId: null,
        displayName: SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
        avatar: emptyAvatar(),
        profilePublic: false,
      };
    }
    return {
      publicPlayerId: row.author_public_player_id ?? null,
      displayName: safePublicDisplayName(row.author_display_name),
      avatar: {
        uploadedUrl: safeUploadedAvatar(row.author_avatar_key),
        providerUrl: null,
      },
      profilePublic: true,
    };
  }
}

export type { CreateCommentRequest, UpdateCommentRequest, DeleteCommentRequest };
