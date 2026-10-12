import { unrestrictedSql } from "../restrictions/policy";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { AuthenticatedConsumer } from "../auth/consumer-auth.service";
import { badRequest, conflict, notFound, serviceUnavailable } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import type { AppEnv } from "../config/env";
import { ContentModerationService, type ImageApproval } from "../moderation/moderation.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { AVATAR_KEY, sanitizeAvatar } from "./avatar-image";
import { avatarForUser } from "./avatar-presentation";

@Injectable()
export class AvatarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvatarService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, @Inject(APP_ENV) private readonly env: AppEnv, private readonly fence: ActorFenceService, private readonly moderation: ContentModerationService) {}
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
  async mutate(actor: AuthenticatedConsumer, versionHeader: unknown, upload?: { body: unknown; mime: string }) {
    if (typeof versionHeader !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(versionHeader)) throw badRequest("VERSION_REQUIRED", "Обновите профиль перед изменением фото");
    const expected = Number(versionHeader);
    if (upload && this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
    if (upload) this.processing++;
    try {
      const result = await this.commitMutation(actor, expected, upload);
      await this.cleanup().catch(() => this.logger.warn("Avatar cleanup deferred"));
      return result;
    } finally { if (upload) this.processing--; }
  }
  private async commitMutation(actor: AuthenticatedConsumer, expected: number, upload?: { body: unknown; mime: string }) {
    const key = upload ? `${randomBytes(32).toString("hex")}.png` : null;
    let approval: ImageApproval | undefined;
    // Public player ID is an immutable generation fence even if a profile is deleted/recreated.
    const snapshot = upload ? (await this.pool.query<{version: number; public_player_id: string}>(
      "SELECT version,public_player_id FROM player_social_profiles WHERE user_id=$1", [actor.userId])).rows[0] : undefined;
    if (upload && (snapshot?.version ?? 0) !== expected) throw conflict("VERSION_CONFLICT", "Профиль изменился. Обновите данные.");
    if (key && upload) {
      const file = this.filename(key);
      const sanitized = await sanitizeAvatar(upload.body, upload.mime);
      approval = await this.moderation.approveImage(actor.userId, sanitized);
      // Journal BEFORE disk write: a crash at any later stage is recoverable.
      await this.pool.query("INSERT INTO avatar_media_gc(storage_key, not_before) VALUES ($1, now() + interval '1 hour')", [key]);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(sanitized); await handle.sync(); } finally { await handle.close(); }
      const directory = await open(path.dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await this.fence.assertActiveConsumerInTransaction(client, { actorId: actor.userId, sessionId: actor.sessionId });
      const current = await client.query<{version: number; public_player_id: string}>("SELECT version,public_player_id FROM player_social_profiles WHERE user_id = $1 FOR UPDATE", [actor.userId]);
      if ((current.rows[0]?.version ?? 0) !== expected || (upload && (current.rows[0]?.public_player_id ?? null) !== (snapshot?.public_player_id ?? null))) throw conflict("VERSION_CONFLICT", "Профиль изменился. Обновите данные.");
      const approvalId = key && approval ? await this.moderation.bindImage(client, approval, await readFile(this.filename(key))) : null;
      const updated = current.rows[0]
        ? await client.query<{version: number}>("UPDATE player_social_profiles SET avatar_key = $2, avatar_moderation_approval_id = $3, version = version + 1, updated_at = now() WHERE user_id = $1 RETURNING version", [actor.userId, key, approvalId])
        : await client.query<{version: number}>("INSERT INTO player_social_profiles(user_id, avatar_key, avatar_moderation_approval_id, display_name) SELECT id, $2, $3, display_name FROM users WHERE id = $1 RETURNING version", [actor.userId, key, approvalId]);
      if (key) await client.query("DELETE FROM avatar_media_gc WHERE storage_key = $1", [key]);
      const result = { version: updated.rows[0]!.version, avatar: await avatarForUser(client, actor.userId) };
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Keep staged journal even on ambiguous COMMIT; never delete a possibly committed image.
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
  /** Retryable journal includes the account-deletion status transition and explicit profile deletion; never removes a referenced key. */
  async cleanup(): Promise<void> {
    if (this.sweeping || !this.env.AVATAR_MEDIA_ROOT) return;
    this.sweeping = true;
    try {
      const rows = await this.pool.query<{storage_key: string}>("SELECT storage_key FROM avatar_media_gc WHERE not_before <= now() ORDER BY queued_at LIMIT 100");
      for (const row of rows.rows) {
        const ref = await this.pool.query("SELECT 1 FROM player_social_profiles WHERE avatar_key = $1", [row.storage_key]);
        if (ref.rowCount) continue;
        try { await unlink(this.filename(row.storage_key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await this.pool.query("DELETE FROM avatar_media_gc WHERE storage_key = $1", [row.storage_key]);
      }
    } finally { this.sweeping = false; }
  }
}
