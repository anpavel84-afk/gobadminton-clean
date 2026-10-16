import { unrestrictedSql } from "../restrictions/policy";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { AuthenticatedConsumer } from "../auth/consumer-auth.service";
import { badRequest, conflict, notFound, serviceUnavailable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { ContentModerationService, type ImageApproval } from "../moderation/moderation.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { AVATAR_KEY, sanitizeAvatar } from "./avatar-image";
import { coverForUser } from "./cover-presentation";
import { avatarForUser } from "./avatar-presentation";

@Injectable()
export class AvatarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvatarService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, @Inject(APP_ENV) private readonly env: AppEnv, private readonly mutations: MutationRunner, private readonly moderation: ContentModerationService, private readonly idempotency: IdempotencyService) {}
  async onModuleInit() {
    if (this.env.AVATAR_MEDIA_ROOT) {
      await this.cleanup().catch(() => this.logger.warn("Avatar cleanup deferred"));
      this.timer = setInterval(() => { void this.cleanup().catch(() => this.logger.warn("Avatar cleanup deferred")); }, 60_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private filename(key: string): string {
    if (!AVATAR_KEY.test(key)) throw notFound("AVATAR_UNAVAILABLE", "Фото недоступно");
    if (!this.env.AVATAR_MEDIA_ROOT) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Загрузка фото пока недоступна");
    return path.join(this.env.AVATAR_MEDIA_ROOT, key);
  }
  async mutate(actor: AuthenticatedConsumer, idempotencyKey: string, versionHeader: unknown, upload?: { body: unknown; mime: string }, slot: "avatar" | "cover" = "avatar") {
    if (typeof versionHeader !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(versionHeader)) throw badRequest("VERSION_REQUIRED", "Обновите профиль перед изменением фото");
    const expected = Number(versionHeader);
    // Slot is a server-owned enum, never a request identifier or SQL fragment.
    const column = slot === "cover" ? "cover" : "avatar";
    const presentation = async (db: Parameters<typeof avatarForUser>[0]) => slot === "cover"
      ? { cover: await coverForUser(db, actor.userId) } : { avatar: await avatarForUser(db, actor.userId) };
    // Hash the original binary request, before decoding or random storage keys.
    if (upload && Buffer.isBuffer(upload.body)) upload = { ...upload, body: Buffer.from(upload.body) };
    const receipt = {
      actorId: actor.userId, sessionId: actor.sessionId,
      // One operation scope makes PUT/DELETE reuse of the same key a conflict.
      operation: `profiles.${slot}.mutate`, key: idempotencyKey,
      requiredCapabilities: slot === "cover" && upload ? ["profile.public" as const] : [],
      requestHash: this.idempotency.requestHash({
        action: upload ? "upload" : "remove", target: actor.userId, expectedVersion: expected,
        mime: upload?.mime ?? null,
        imageSha256: upload && Buffer.isBuffer(upload.body) ? createHash("sha256").update(upload.body).digest("hex") : null,
      }),
      authorizeReplay: async () => { /* Own resource; MutationRunner fences the current actor/session. */ },
    };
    // Capture generation/version BEFORE preflight. If a concurrent same-key
    // winner commits before preflight, its receipt takes precedence over CAS.
    const snapshot = upload ? (await this.pool.query<{version: number; public_player_id: string}>(
      "SELECT version,public_player_id FROM player_social_profiles WHERE user_id=$1", [actor.userId])).rows[0] : undefined;
    const replay = await this.mutations.findReplay<{
      version: number; avatar?: Awaited<ReturnType<typeof avatarForUser>>; cover?: Awaited<ReturnType<typeof coverForUser>>;
    }>(receipt);
    if (replay) return replay.body;
    if (upload && (snapshot?.version ?? 0) !== expected) throw conflict("VERSION_CONFLICT", "Профиль изменился. Обновите данные.");
    if (upload && this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
    if (upload) this.processing++;
    let key: string | undefined;
    try {
      let approval: ImageApproval | undefined;
      let stagedBytes: Buffer | undefined;
      if (upload) {
        const sanitized = await (slot === "cover" ? sanitizeAvatar(upload.body, upload.mime, "cover") : sanitizeAvatar(upload.body, upload.mime));
        approval = await (slot === "cover" ? this.moderation.approveImage(actor.userId, sanitized, "cover") : this.moderation.approveImage(actor.userId, sanitized));
        key = `${randomBytes(32).toString("hex")}.png`;
        stagedBytes = await this.stage(key, sanitized);
      }
      const result = await this.mutations.runIdempotent({ ...receipt, execute: async client => {
        const current = await client.query<{version: number; public_player_id: string}>("SELECT version,public_player_id FROM player_social_profiles WHERE user_id = $1 FOR UPDATE", [actor.userId]);
        if ((current.rows[0]?.version ?? 0) !== expected || (upload && (current.rows[0]?.public_player_id ?? null) !== (snapshot?.public_player_id ?? null))) throw conflict("VERSION_CONFLICT", "Профиль изменился. Обновите данные.");
        if (key) {
          // GC uses the same row lock. If it already collected this stage, abort
          // rather than publish a missing file. No disk/provider I/O under actor lock.
          const journal = await client.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1 FOR UPDATE", [key]);
          if (!journal.rowCount) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Загрузка фото пока недоступна");
        }
        // The journal row lock prevents our collector from deleting this file.
        // Read the ACTUAL staged bytes immediately before publishing, rather
        // than trusting a buffer captured earlier. The bounded local read is
        // necessary inside the transaction to bind disk bytes to the receipt.
        // Missing or substituted bytes must not become a committed avatar.
        let verifiedBytes: Buffer | undefined;
        if (key) {
          try {
            verifiedBytes = await readFile(this.filename(key));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Загрузка фото пока недоступна");
          }
          if (!stagedBytes || !verifiedBytes.equals(stagedBytes)) {
            throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Загрузка фото пока недоступна");
          }
        }
        const approvalId = key && approval && verifiedBytes ? await (slot === "cover" ? this.moderation.bindImage(client, approval, verifiedBytes, "cover") : this.moderation.bindImage(client, approval, verifiedBytes)) : null;
        const updated = current.rows[0]
          ? await client.query<{version: number}>(`UPDATE player_social_profiles SET ${column}_key = $2, ${column}_moderation_approval_id = $3, version = version + 1, updated_at = now() WHERE user_id = $1 RETURNING version`, [actor.userId, key ?? null, approvalId])
          : await client.query<{version: number}>(`INSERT INTO player_social_profiles(user_id, ${column}_key, ${column}_moderation_approval_id, display_name) SELECT id, $2, $3, display_name FROM users WHERE id = $1 RETURNING version`, [actor.userId, key ?? null, approvalId]);
        if (key) await client.query("DELETE FROM avatar_media_gc WHERE storage_key = $1", [key]);
        return { statusCode: 200, body: { version: updated.rows[0]!.version, ...await presentation(client) } };
      } });
      return result.body;
    } finally {
      // Winners remove their journal atomically. Losers/rollbacks keep it,
      // including ambiguous COMMIT; GC checks references before deleting bytes.
      if (key) await this.pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1", [key])
        .catch(() => this.logger.warn("Avatar cleanup deferred"));
      await this.cleanup().catch(() => this.logger.warn("Avatar cleanup deferred"));
      if (upload) this.processing--;
    }
  }
  async stage(key: string, sanitized: Buffer): Promise<Buffer> {
    const file = this.filename(key);
    // Durable journal BEFORE disk write. Only this journal row is locked during
    // filesystem work, so even an expired/crashed stage cannot race the collector.
    await this.pool.query("INSERT INTO avatar_media_gc(storage_key, not_before) VALUES ($1, now() + interval '1 hour')", [key]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const journal = await client.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1 FOR UPDATE", [key]);
      if (!journal.rowCount) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Загрузка фото пока недоступна");
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(sanitized); await handle.sync(); } finally { await handle.close(); }
      const directory = await open(path.dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
      const bytes = await readFile(file);
      await client.query("COMMIT");
      return bytes;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  async read(key: string): Promise<Buffer> {
    const file = this.filename(key);
    const current = await this.pool.query(`SELECT 1 FROM player_social_profiles p JOIN users u ON u.id = p.user_id WHERE p.avatar_key = $1 AND u.status = 'active' AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["account.access", "profile.public"])}`, [key]);
    if (!current.rowCount) throw notFound("AVATAR_UNAVAILABLE", "Фото недоступно");
    try { return await readFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound("AVATAR_UNAVAILABLE", "Фото недоступно");
      throw error;
    }
  }
  async readCover(key: string, viewerId: string | null): Promise<Buffer> {
    const file = this.filename(key);
    const current = await this.pool.query(`SELECT 1 FROM player_social_profiles p
      JOIN users u ON u.id=p.user_id JOIN content_moderation_approvals a ON a.id=p.cover_moderation_approval_id
      WHERE p.cover_key=$1 AND u.status='active' AND a.decision='allow' AND a.surface_key='cover_image'
        AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["account.access", "profile.public"])}
        AND (p.user_id=$2::uuid OR (${this.env.SOCIAL_DIRECTORY_ENABLED ? "TRUE" : "FALSE"} AND p.directory_visible AND p.social_eligible
          AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["social.directory"]) }
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
            (b.blocker_user_id=$2::uuid AND b.blocked_user_id=p.user_id) OR
            (b.blocked_user_id=$2::uuid AND b.blocker_user_id=p.user_id))))`, [key, viewerId]);
    if (!current.rowCount) throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
    try { return await readFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
      throw error;
    }
  }
  /** Venue derivatives are public only while the current owning row and approval allow them. */
  async readVenueCover(key: string): Promise<Buffer> {
    const file = this.filename(key);
    const current = await this.pool.query("SELECT 1 FROM venues WHERE cover_key=$1 AND venue_cover_url(id) IS NOT NULL", [key]);
    if (!current.rowCount) throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
    try { return await readFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
      throw error;
    }
  }
  async assertGameCoverCurrent(key: string): Promise<void> {
    const current = await this.pool.query("SELECT 1 FROM games WHERE cover_key=$1 AND game_own_cover_url(id) IS NOT NULL", [key]);
    if (!current.rowCount) throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
  }
  /** Caller must separately authorize the Game for this viewer. No generic media route uses this. */
  async readGameCover(key: string): Promise<Buffer> {
    const file = this.filename(key);
    await this.assertGameCoverCurrent(key);
    try { return await readFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
      throw error;
    }
  }
  async releaseStage(key: string): Promise<void> {
    await this.pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1", [key])
      .catch(() => this.logger.warn("Venue cover cleanup deferred"));
  }
  async verifyStage(client: import("pg").PoolClient, key: string, expected: Buffer): Promise<Buffer> {
    const journal = await client.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1 FOR UPDATE", [key]);
    if (!journal.rowCount) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Фото недоступно");
    const bytes = await readFile(this.filename(key));
    if (!bytes.equals(expected)) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Фото недоступно");
    return bytes;
  }
  /** Retryable journal includes the account-deletion status transition and explicit profile deletion; never removes a referenced key. */
  async cleanup(): Promise<void> {
    if (this.sweeping || !this.env.AVATAR_MEDIA_ROOT) return;
    this.sweeping = true;
    try {
      const rows = await this.pool.query<{storage_key: string}>("SELECT storage_key FROM avatar_media_gc WHERE not_before <= now() ORDER BY queued_at LIMIT 100");
      for (const row of rows.rows) {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          // Serialize collectors and publication/staging on the journal only.
          const journal = await client.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1 AND not_before<=now() FOR UPDATE SKIP LOCKED", [row.storage_key]);
          if (journal.rowCount) {
            const ref = await client.query("SELECT 1 FROM player_social_profiles WHERE avatar_key = $1 OR cover_key = $1 UNION ALL SELECT 1 FROM venues WHERE cover_key=$1 UNION ALL SELECT 1 FROM games WHERE cover_key=$1", [row.storage_key]);
            if (!ref.rowCount) {
              try { await unlink(this.filename(row.storage_key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
              await client.query("DELETE FROM avatar_media_gc WHERE storage_key = $1", [row.storage_key]);
            }
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally { client.release(); }
      }
    } finally { this.sweeping = false; }
  }
}
