import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import { AdminService, type AdminActor } from "../admin/admin.service";
import { appendAudit } from "../admin/admin-db";
import { conflict, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import { AvatarService } from "../profiles/avatar.service";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { ContentModerationService } from "../moderation/moderation.service";
import {
  VENUE_GALLERY_MAX,
  mapAdminGalleryItem,
  type GalleryEvidence,
  type VenueGalleryItemRow,
  type VenueGalleryReceipt,
} from "./venue-gallery";

type ScopeRow = { version: number; count: number };

/**
 * Shared main→cover projection (credit reset trigger repair + live-key GC).
 * Used by admin gallery mutations and the trusted gallery batch CLI — same semantics.
 */
export async function projectVenueMainCover(c: PoolClient, venueId: string): Promise<void> {
  const main = (await c.query<VenueGalleryItemRow>(
    `SELECT * FROM venue_gallery_items WHERE venue_id=$1 AND active AND is_main LIMIT 1`,
    [venueId],
  )).rows[0];
  if (!main) {
    await c.query(
      `UPDATE venues SET cover_key=NULL, cover_moderation_approval_id=NULL, cover_actor_id=NULL,
        cover_credit_kind=NULL, cover_credit_text=NULL, cover_credit_url=NULL, updated_at=now()
       WHERE id=$1`,
      [venueId],
    );
    return;
  }
  // Key/approval/uploader first: 0037 clear_stale_venue_cover_credit clears credit when
  // cover_key changes and credit columns look unchanged. Reapply real main credit in a
  // second UPDATE in this same transaction (no extra version bump, no external calls).
  await c.query(
    `UPDATE venues SET cover_key=$2, cover_moderation_approval_id=$3, cover_actor_id=$4, updated_at=now()
     WHERE id=$1`,
    [venueId, main.storage_key, main.moderation_approval_id, main.actor_id],
  );
  await c.query(
    `UPDATE venues SET cover_credit_kind=$2, cover_credit_text=$3, cover_credit_url=$4, updated_at=now()
     WHERE id=$1`,
    [venueId, main.credit_kind, main.credit_text, main.credit_url],
  );
  await c.query(
    `DELETE FROM avatar_media_gc WHERE storage_key IN (
       SELECT storage_key FROM venue_gallery_items WHERE venue_id=$1 AND active
     )`,
    [venueId],
  );
}

@Injectable()
export class VenueGalleryService {
  private processing = 0;
  constructor(
    private readonly admin: AdminService,
    private readonly media: AvatarService,
    private readonly moderation: ContentModerationService,
  ) {}

  private async scope(c: PoolClient, actor: AdminActor, id: string): Promise<ScopeRow> {
    const user = await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [actor.principal.user_id]);
    if (!user.rowCount) throw notFound("VENUE_NOT_FOUND", "Площадка недоступна для редактирования");
    const row = (await c.query<{ version: number; count: string }>(
      `SELECT v.version, (SELECT count(*)::text FROM venue_gallery_items g WHERE g.venue_id=v.id AND g.active) AS count
       FROM venues v
       WHERE v.id=$1 AND (v.created_by_user_id=$2 OR $3::boolean)
         AND v.lifecycle_state IN ('unverified','verified') FOR UPDATE`,
      [id, actor.principal.user_id, actor.roles.includes("superadmin")],
    )).rows[0];
    if (!row) throw notFound("VENUE_NOT_FOUND", "Площадка недоступна для редактирования");
    await c.query("SELECT id FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position FOR UPDATE", [id]);
    return { version: row.version, count: Number(row.count) };
  }

  private async listItems(c: PoolClient, venueId: string): Promise<VenueGalleryItemRow[]> {
    return (await c.query<VenueGalleryItemRow>(
      `SELECT g.*, ('/v1/media/venue-covers/' || g.storage_key) AS uploaded_url
       FROM venue_gallery_items g
       WHERE g.venue_id=$1 AND g.active
       ORDER BY g.position ASC`,
      [venueId],
    )).rows;
  }

  private receipt(version: number, items: VenueGalleryItemRow[]): VenueGalleryReceipt {
    return { version, items: items.map(mapAdminGalleryItem) };
  }

  /**
   * Project active main onto venues.cover_*. cover_actor_id is always the media
   * uploader (main.actor_id); callers may still pass an editor id for compatibility
   * but it must not rewrite the stored uploader. Cover-key triggers may enqueue the
   * previous projected key — clear GC for keys that remain live in the gallery.
   */
  async syncMainCover(c: PoolClient, venueId: string, _actorUserId: string | null): Promise<void> {
    await projectVenueMainCover(c, venueId);
  }

  private async renumber(c: PoolClient, venueId: string): Promise<VenueGalleryItemRow[]> {
    const items = await this.listItems(c, venueId);
    await this.applyOrderedPositions(c, venueId, items.map((item) => item.id));
    return this.listItems(c, venueId);
  }

  /**
   * Reassign active positions to 0..n-1 without violating CHECK (position < 8)
   * or unique (venue_id, position) WHERE active. Temporary deactivation frees the
   * partial unique index; undo GC enqueue so still-live storage keys are not collected.
   */
  private async applyOrderedPositions(c: PoolClient, venueId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    if (orderedIds.length > VENUE_GALLERY_MAX) {
      throw conflict("VENUE_GALLERY_FULL", "У площадки уже максимум 8 изображений.");
    }
    const keys = (await c.query<{ storage_key: string }>(
      `SELECT storage_key FROM venue_gallery_items
       WHERE venue_id=$1 AND id = ANY($2::uuid[])`,
      [venueId, orderedIds],
    )).rows.map((row) => row.storage_key);
    await c.query(
      `UPDATE venue_gallery_items SET active=false, updated_at=now()
       WHERE venue_id=$1 AND id = ANY($2::uuid[]) AND active`,
      [venueId, orderedIds],
    );
    for (let i = 0; i < orderedIds.length; i++) {
      await c.query(
        `UPDATE venue_gallery_items SET position=$2, active=true, updated_at=now() WHERE id=$1`,
        [orderedIds[i], i],
      );
    }
    if (keys.length > 0) {
      await c.query("DELETE FROM avatar_media_gc WHERE storage_key = ANY($1::text[])", [keys]);
    }
  }

  async get(request: FastifyRequest, id: string): Promise<VenueGalleryReceipt> {
    return this.admin.privilegedRead(request, "venue.manage", async (c, a) => {
      const row = await this.scope(c, a, id);
      const items = await this.listItems(c, id);
      await appendAudit(c, {
        actor: a, action: "venue.gallery_read", targetType: "venue", targetId: id,
        permission: "venue.manage", reason: "operations_read",
      });
      return this.receipt(row.version, items);
    });
  }

  async add(request: FastifyRequest, replayKey: string | undefined, id: string, expectedVersion: number,
    upload: { body: unknown; mime: string }, evidence: GalleryEvidence) {
    return this.mutateUpload(request, replayKey, id, expectedVersion, "add", upload, evidence);
  }

  async replace(request: FastifyRequest, replayKey: string | undefined, id: string, itemId: string,
    expectedVersion: number, upload: { body: unknown; mime: string }, evidence: GalleryEvidence) {
    return this.mutateUpload(request, replayKey, id, expectedVersion, "replace", upload, evidence, itemId);
  }

  private async mutateUpload(
    request: FastifyRequest,
    replayKey: string | undefined,
    id: string,
    expectedVersion: number,
    action: "add" | "replace",
    upload: { body: unknown; mime: string },
    evidence: GalleryEvidence,
    itemId?: string,
  ) {
    const authority = await this.admin.privilegedMutationPreflight(request, "venue.manage", async (c, a) => {
      const row = await this.scope(c, a, id);
      return { venueVersion: row.version, userId: a.principal.user_id, version: a.principal.version, sessionId: a.sessionId };
    });
    const original = Buffer.isBuffer(upload.body) ? Buffer.from(upload.body) : null;
    if (!original) throw unprocessable("GALLERY_IMAGE_REQUIRED", "Нужно изображение площадки");
    const input = {
      id, itemId: itemId ?? null, expectedVersion, action,
      mime: upload.mime, sha256: createHash("sha256").update(original).digest("hex"),
      evidence,
    };
    const replay = await this.admin.privilegedReplay<VenueGalleryReceipt>(
      request, replayKey, "venue.manage", `venue.gallery.${action}`, input,
      async (c, a) => { await this.scope(c, a, id); },
    );
    if (replay) return replay;
    if (authority.venueVersion !== expectedVersion) {
      throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
    }
    if (this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
    this.processing++;
    let key: string | undefined;
    try {
      const sanitized = await sanitizeAvatar(original, upload.mime, "cover");
      const approval = await this.moderation.approveImage(authority.userId, sanitized, "cover");
      key = `${randomBytes(32).toString("hex")}.png`;
      const staged = await this.media.stage(key, sanitized);
      return await this.admin.privilegedCommand(
        request, replayKey, "venue.manage", true, `venue.gallery.${action}`, input,
        async (c, a, keyHash) => {
          if (a.principal.version !== authority.version || a.sessionId !== authority.sessionId
            || a.principal.user_id !== authority.userId) {
            throw conflict("VENUE_AUTHORITY_CHANGED", "Права изменились. Обновите данные.");
          }
          await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
          const row = await this.scope(c, a, id);
          if (row.version !== expectedVersion) {
            throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
          }
          const bytes = await this.media.verifyStage(c, key!, staged);
          const approvalId = await this.moderation.bindImage(c, approval, bytes, "cover");
          if (action === "add") {
            if (row.count >= VENUE_GALLERY_MAX) {
              throw conflict("VENUE_GALLERY_FULL", "У площадки уже максимум 8 изображений.");
            }
            const position = row.count;
            const isMain = row.count === 0;
            await c.query(
              `INSERT INTO venue_gallery_items(
                 venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
                 credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [id, position, isMain, key, approvalId, authority.userId,
                evidence.creditKind, evidence.creditText, evidence.creditUrl,
                evidence.sourceUrl ?? null, evidence.sourceAuthor ?? null,
                evidence.permissionBasis, evidence.sourceFingerprint ?? null],
            );
          } else {
            const existing = (await c.query<VenueGalleryItemRow>(
              `SELECT * FROM venue_gallery_items WHERE id=$1 AND venue_id=$2 AND active FOR UPDATE`,
              [itemId, id],
            )).rows[0];
            if (!existing) throw notFound("GALLERY_ITEM_NOT_FOUND", "Изображение площадки не найдено");
            await c.query(
              `UPDATE venue_gallery_items SET storage_key=$2, moderation_approval_id=$3, actor_id=$4,
                 credit_kind=$5, credit_text=$6, credit_url=$7, source_url=$8, source_author=$9,
                 permission_basis=$10, source_fingerprint=$11, updated_at=now()
               WHERE id=$1`,
              [existing.id, key, approvalId, authority.userId,
                evidence.creditKind, evidence.creditText, evidence.creditUrl,
                evidence.sourceUrl ?? null, evidence.sourceAuthor ?? null,
                evidence.permissionBasis, evidence.sourceFingerprint ?? null],
            );
          }
          await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1", [key]);
          await this.syncMainCover(c, id, authority.userId);
          const updated = (await c.query<{ version: number }>(
            `UPDATE venues SET version=version+1, updated_at=now() WHERE id=$1 RETURNING version`,
            [id],
          )).rows[0]!;
          const items = await this.listItems(c, id);
          const auditId = await appendAudit(c, {
            actor: a, action: `venue.gallery_${action}`, targetType: "venue", targetId: id,
            permission: "venue.manage", reason: "venue_gallery", keyHash,
            before: { version: row.version }, after: { version: updated.version, action, itemId: itemId ?? null },
          });
          await c.query(
            "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,$3,$4,$5)",
            [id, updated.version, "gallery", a.principalId, auditId],
          );
          return this.receipt(updated.version, items);
        },
        async (c, a) => { await this.scope(c, a, id); },
      );
    } finally {
      if (key) await this.media.releaseStage(key);
      this.processing--;
    }
  }

  async remove(request: FastifyRequest, replayKey: string | undefined, id: string, itemId: string,
    expectedVersion: number) {
    const input = { id, itemId, expectedVersion, action: "remove" as const };
    const authority = await this.admin.privilegedMutationPreflight(request, "venue.manage", async (c, a) => {
      const row = await this.scope(c, a, id);
      return { venueVersion: row.version, userId: a.principal.user_id, version: a.principal.version, sessionId: a.sessionId };
    });
    const replay = await this.admin.privilegedReplay<VenueGalleryReceipt>(
      request, replayKey, "venue.manage", "venue.gallery.remove", input,
      async (c, a) => { await this.scope(c, a, id); },
    );
    if (replay) return replay;
    if (authority.venueVersion !== expectedVersion) {
      throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
    }
    return this.admin.privilegedCommand(
      request, replayKey, "venue.manage", true, "venue.gallery.remove", input,
      async (c, a, keyHash) => {
        if (a.principal.version !== authority.version || a.sessionId !== authority.sessionId
          || a.principal.user_id !== authority.userId) {
          throw conflict("VENUE_AUTHORITY_CHANGED", "Права изменились. Обновите данные.");
        }
        await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
        const row = await this.scope(c, a, id);
        if (row.version !== expectedVersion) {
          throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
        }
        const existing = (await c.query<VenueGalleryItemRow>(
          `SELECT * FROM venue_gallery_items WHERE id=$1 AND venue_id=$2 AND active FOR UPDATE`,
          [itemId, id],
        )).rows[0];
        if (!existing) throw notFound("GALLERY_ITEM_NOT_FOUND", "Изображение площадки не найдено");
        await c.query(
          `UPDATE venue_gallery_items SET active=false, is_main=false, updated_at=now() WHERE id=$1`,
          [existing.id],
        );
        const remaining = await this.renumber(c, id);
        if (existing.is_main && remaining[0]) {
          await c.query(
            `UPDATE venue_gallery_items SET is_main=true, updated_at=now() WHERE id=$1`,
            [remaining[0].id],
          );
        }
        await this.syncMainCover(c, id, null);
        const updated = (await c.query<{ version: number }>(
          `UPDATE venues SET version=version+1, updated_at=now() WHERE id=$1 RETURNING version`,
          [id],
        )).rows[0]!;
        const items = await this.listItems(c, id);
        const auditId = await appendAudit(c, {
          actor: a, action: "venue.gallery_remove", targetType: "venue", targetId: id,
          permission: "venue.manage", reason: "venue_gallery", keyHash,
          before: { version: row.version }, after: { version: updated.version, itemId },
        });
        await c.query(
          "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'gallery',$3,$4)",
          [id, updated.version, a.principalId, auditId],
        );
        return this.receipt(updated.version, items);
      },
      async (c, a) => { await this.scope(c, a, id); },
    );
  }

  async reorder(request: FastifyRequest, replayKey: string | undefined, id: string,
    expectedVersion: number, orderedIds: string[]) {
    const input = { id, expectedVersion, action: "reorder" as const, orderedIds };
    const authority = await this.admin.privilegedMutationPreflight(request, "venue.manage", async (c, a) => {
      const row = await this.scope(c, a, id);
      return { venueVersion: row.version, userId: a.principal.user_id, version: a.principal.version, sessionId: a.sessionId };
    });
    const replay = await this.admin.privilegedReplay<VenueGalleryReceipt>(
      request, replayKey, "venue.manage", "venue.gallery.reorder", input,
      async (c, a) => { await this.scope(c, a, id); },
    );
    if (replay) return replay;
    if (authority.venueVersion !== expectedVersion) {
      throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
    }
    return this.admin.privilegedCommand(
      request, replayKey, "venue.manage", true, "venue.gallery.reorder", input,
      async (c, a, keyHash) => {
        if (a.principal.version !== authority.version || a.sessionId !== authority.sessionId
          || a.principal.user_id !== authority.userId) {
          throw conflict("VENUE_AUTHORITY_CHANGED", "Права изменились. Обновите данные.");
        }
        await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
        const row = await this.scope(c, a, id);
        if (row.version !== expectedVersion) {
          throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
        }
        const items = await this.listItems(c, id);
        if (items.length !== orderedIds.length
          || new Set(items.map((item) => item.id)).size !== orderedIds.length
          || orderedIds.some((itemId) => !items.some((item) => item.id === itemId))) {
          throw conflict("VENUE_GALLERY_ORDER_CONFLICT", "Состав галереи изменился. Обновите данные.");
        }
        await this.applyOrderedPositions(c, id, orderedIds);
        await this.syncMainCover(c, id, null);
        const updated = (await c.query<{ version: number }>(
          `UPDATE venues SET version=version+1, updated_at=now() WHERE id=$1 RETURNING version`,
          [id],
        )).rows[0]!;
        const next = await this.listItems(c, id);
        const auditId = await appendAudit(c, {
          actor: a, action: "venue.gallery_reorder", targetType: "venue", targetId: id,
          permission: "venue.manage", reason: "venue_gallery", keyHash,
          before: { version: row.version }, after: { version: updated.version, orderedIds },
        });
        await c.query(
          "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'gallery',$3,$4)",
          [id, updated.version, a.principalId, auditId],
        );
        return this.receipt(updated.version, next);
      },
      async (c, a) => { await this.scope(c, a, id); },
    );
  }

  async setMain(request: FastifyRequest, replayKey: string | undefined, id: string, itemId: string,
    expectedVersion: number) {
    const input = { id, itemId, expectedVersion, action: "set_main" as const };
    const authority = await this.admin.privilegedMutationPreflight(request, "venue.manage", async (c, a) => {
      const row = await this.scope(c, a, id);
      return { venueVersion: row.version, userId: a.principal.user_id, version: a.principal.version, sessionId: a.sessionId };
    });
    const replay = await this.admin.privilegedReplay<VenueGalleryReceipt>(
      request, replayKey, "venue.manage", "venue.gallery.set_main", input,
      async (c, a) => { await this.scope(c, a, id); },
    );
    if (replay) return replay;
    if (authority.venueVersion !== expectedVersion) {
      throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
    }
    return this.admin.privilegedCommand(
      request, replayKey, "venue.manage", true, "venue.gallery.set_main", input,
      async (c, a, keyHash) => {
        if (a.principal.version !== authority.version || a.sessionId !== authority.sessionId
          || a.principal.user_id !== authority.userId) {
          throw conflict("VENUE_AUTHORITY_CHANGED", "Права изменились. Обновите данные.");
        }
        await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
        const row = await this.scope(c, a, id);
        if (row.version !== expectedVersion) {
          throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
        }
        const existing = (await c.query<VenueGalleryItemRow>(
          `SELECT * FROM venue_gallery_items WHERE id=$1 AND venue_id=$2 AND active FOR UPDATE`,
          [itemId, id],
        )).rows[0];
        if (!existing) throw notFound("GALLERY_ITEM_NOT_FOUND", "Изображение площадки не найдено");
        await c.query(
          `UPDATE venue_gallery_items SET is_main=false, updated_at=now() WHERE venue_id=$1 AND active AND is_main`,
          [id],
        );
        await c.query(
          `UPDATE venue_gallery_items SET is_main=true, updated_at=now() WHERE id=$1`,
          [existing.id],
        );
        // Keep main as position 0 for stable public/main projection.
        const items = await this.listItems(c, id);
        const ordered = [existing.id, ...items.filter((item) => item.id !== existing.id).map((item) => item.id)];
        await this.applyOrderedPositions(c, id, ordered);
        await this.syncMainCover(c, id, authority.userId);
        const updated = (await c.query<{ version: number }>(
          `UPDATE venues SET version=version+1, updated_at=now() WHERE id=$1 RETURNING version`,
          [id],
        )).rows[0]!;
        const next = await this.listItems(c, id);
        const auditId = await appendAudit(c, {
          actor: a, action: "venue.gallery_set_main", targetType: "venue", targetId: id,
          permission: "venue.manage", reason: "venue_gallery", keyHash,
          before: { version: row.version }, after: { version: updated.version, itemId },
        });
        await c.query(
          "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'gallery',$3,$4)",
          [id, updated.version, a.principalId, auditId],
        );
        return this.receipt(updated.version, next);
      },
      async (c, a) => { await this.scope(c, a, id); },
    );
  }

  /** Legacy cover mutate must keep gallery main/cover atomic. */
  async syncLegacyCoverReplace(c: PoolClient, venueId: string, storageKey: string, approvalId: string,
    actorId: string, evidence?: GalleryEvidence | null): Promise<void> {
    const main = (await c.query<VenueGalleryItemRow>(
      `SELECT * FROM venue_gallery_items WHERE venue_id=$1 AND active AND is_main FOR UPDATE`,
      [venueId],
    )).rows[0];
    const creditKind = evidence?.creditKind ?? "illustration";
    const creditText = evidence?.creditText ?? "Иллюстрация";
    const creditUrl = evidence?.creditUrl ?? null;
    const permissionBasis = evidence?.permissionBasis ?? "legacy_preserved_unknown";
    if (main) {
      await c.query(
        `UPDATE venue_gallery_items SET storage_key=$2, moderation_approval_id=$3, actor_id=$4,
           credit_kind=$5, credit_text=$6, credit_url=$7, source_url=$8, source_author=$9,
           permission_basis=$10, source_fingerprint=$11, updated_at=now()
         WHERE id=$1`,
        [main.id, storageKey, approvalId, actorId, creditKind, creditText, creditUrl,
          evidence?.sourceUrl ?? null, evidence?.sourceAuthor ?? null, permissionBasis,
          evidence?.sourceFingerprint ?? null],
      );
    } else {
      const existing = await this.listItems(c, venueId);
      if (existing.length >= VENUE_GALLERY_MAX) {
        throw conflict("VENUE_GALLERY_FULL", "У площадки уже максимум 8 изображений.");
      }
      await c.query(
        `UPDATE venue_gallery_items SET is_main=false, updated_at=now() WHERE venue_id=$1 AND active AND is_main`,
        [venueId],
      );
      // Insert into a free in-range slot (0..7); then promote to position 0 via applyOrderedPositions.
      const inserted = (await c.query<{ id: string }>(
        `INSERT INTO venue_gallery_items(
           venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
           credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
         ) VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [venueId, existing.length, storageKey, approvalId, actorId, creditKind, creditText, creditUrl,
          evidence?.sourceUrl ?? null, evidence?.sourceAuthor ?? null, permissionBasis,
          evidence?.sourceFingerprint ?? null],
      )).rows[0]!;
      const ordered = [inserted.id, ...existing.map((item) => item.id)];
      await this.applyOrderedPositions(c, venueId, ordered);
    }
  }

  async syncLegacyCoverRemove(c: PoolClient, venueId: string): Promise<void> {
    const main = (await c.query<VenueGalleryItemRow>(
      `SELECT * FROM venue_gallery_items WHERE venue_id=$1 AND active AND is_main FOR UPDATE`,
      [venueId],
    )).rows[0];
    if (!main) return;
    await c.query(
      `UPDATE venue_gallery_items SET active=false, is_main=false, updated_at=now() WHERE id=$1`,
      [main.id],
    );
    const remaining = await this.renumber(c, venueId);
    if (remaining[0]) {
      await c.query(`UPDATE venue_gallery_items SET is_main=true, updated_at=now() WHERE id=$1`, [remaining[0].id]);
    }
    await this.syncMainCover(c, venueId, null);
  }
}
