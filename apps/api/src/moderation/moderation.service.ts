import { Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { problem, ProblemHttpException } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { IMAGE_CATEGORIES, MODERATION_MODEL, MODERATION_PROVIDER, ModerationProviderError, type ContentModerationProvider, type ImageDecision } from "./provider";

export const IMAGE_POLICY = "avatar-image-v1";
export type ImageApproval = Readonly<{
  fingerprint: string;
  providerKey: "openai" | "fake";
  providerModel: string;
  policy: string;
  checkedAt: Date;
  decision: ImageDecision;
}>;
@Injectable()
export class ContentModerationService {
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(MODERATION_PROVIDER) private readonly provider: ContentModerationProvider) {
    if (provider.key === "fake" && (env.NODE_ENV !== "test" || env.APP_ENV !== "local")) throw new Error("Fake moderation requires local NODE_ENV=test");
  }
  fingerprint(bytes: Buffer): string {
    if (!this.env.CONTENT_MODERATION_FINGERPRINT_SECRET) throw problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка фото временно недоступна");
    return createHmac("sha256", this.env.CONTENT_MODERATION_FINGERPRINT_SECRET)
      .update("moderation-fingerprint:v1:avatar_image:").update(bytes).digest("hex");
  }
  private unavailable(retry?: number) { return problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка фото временно недоступна", undefined, retry); }
  private mismatch() { return problem(503, "MODERATION_POLICY_MISMATCH", "Проверка фото временно недоступна"); }
  private validateDecision(decision: ImageDecision) {
    if (!decision || decision.model !== MODERATION_MODEL || IMAGE_CATEGORIES.some(key => typeof decision.categories?.[key] !== "boolean") ||
      typeof decision.flagged !== "boolean" || (decision.responseId !== null && (typeof decision.responseId !== "string" || decision.responseId.length > 200)) ||
      (decision.flagged && !IMAGE_CATEGORIES.some(key => decision.categories[key]))) throw this.mismatch();
  }
  async approveImage(actorId: string, bytes: Buffer): Promise<ImageApproval> {
    // Defense in depth at the port: original/noncanonical bytes cannot reach any provider.
    const metadata = await sharp(bytes).metadata();
    if (bytes.length > 2 * 1024 * 1024 || metadata.format !== "png" || metadata.width !== 512 || metadata.height !== 512 ||
      (metadata.pages ?? 1) !== 1 || metadata.exif || metadata.icc || metadata.xmp) throw this.mismatch();
    const fingerprint = this.fingerprint(bytes);
    const cached = await this.pool.query<{category_flags: ImageDecision["categories"]; provider_response_id: string | null; checked_at: Date}>(
      `SELECT category_flags,provider_response_id,checked_at FROM content_moderation_approvals
       WHERE surface_key='avatar_image' AND content_type='image' AND fingerprint_version=1 AND content_fingerprint=$1
       AND policy_version=$2 AND local_policy_version='none' AND provider_key=$3 AND provider_model=$4 AND decision='allow'`,
      [fingerprint, IMAGE_POLICY, this.provider.key, this.provider.model]);
    const row = cached.rows[0];
    let decision: ImageDecision;
    if (row) {
      decision = {model: this.provider.model, responseId: row.provider_response_id, flagged: false, categories: row.category_flags};
    } else {
      if (this.processing >= 8) throw this.unavailable(1);
      this.processing++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        decision = await Promise.race([
          this.provider.moderateImage({mime: "image/png", bytes: Buffer.from(bytes), signal: controller.signal,
            beforeAttempt: () => this.reserveAttempt(actorId)}),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {controller.abort(); reject(new ModerationProviderError("unavailable"));}, 6000); }),
        ]);
      } catch (error) {
        if (error instanceof ModerationProviderError) throw error.kind === "schema" ? this.mismatch() : this.unavailable(error.retryAfterSeconds);
        // Preserve our own product budget error, never forward arbitrary provider exceptions.
        if (error instanceof ProblemHttpException && (error.getResponse() as {code?: string}).code === "MODERATION_RATE_LIMITED") throw error;
        throw this.unavailable();
      } finally { if (timer) clearTimeout(timer); controller.abort(); this.processing--; }
    }
    this.validateDecision(decision);
    if (IMAGE_CATEGORIES.some(key => decision.categories[key])) throw problem(422, "PUBLIC_IMAGE_CONTENT_REJECTED", "Выберите другое фото");
    return Object.freeze({fingerprint, providerKey: this.provider.key, providerModel: this.provider.model,
      policy: IMAGE_POLICY, checkedAt: row?.checked_at ?? new Date(),
      decision: {...decision, categories: {...decision.categories}}});
  }
  private async reserveAttempt(actorId: string): Promise<void> {
    // Single autocommit statement, including concurrent initial reservations; no lock spans provider I/O.
    const result = await this.pool.query(`
      INSERT INTO content_moderation_rate_budgets(user_id,bucket,window_started_at,count,day_started_at,day_count)
      VALUES ($1,'image',now(),1,now(),1)
      ON CONFLICT(user_id,bucket) DO UPDATE SET
        window_started_at=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN now() ELSE content_moderation_rate_budgets.window_started_at END,
        count=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN 1 ELSE content_moderation_rate_budgets.count+1 END,
        day_started_at=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN now() ELSE content_moderation_rate_budgets.day_started_at END,
        day_count=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN 1 ELSE content_moderation_rate_budgets.day_count+1 END,
        updated_at=now()
      WHERE (content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' OR content_moderation_rate_budgets.count < 10)
        AND (content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' OR content_moderation_rate_budgets.day_count < 50)
        AND (content_moderation_rate_budgets.next_allowed_at IS NULL OR content_moderation_rate_budgets.next_allowed_at <= now())
      RETURNING user_id`, [actorId]);
    if (!result.rowCount) throw problem(429, "MODERATION_RATE_LIMITED", "Слишком много проверок фото. Попробуйте позже.", undefined, 900);
  }
  /** Called only under owning AvatarService publication transaction after actor/version fence. */
  async bindImage(client: PoolClient, approval: ImageApproval, currentBytes: Buffer): Promise<string> {
    if (approval.fingerprint !== this.fingerprint(currentBytes) || approval.policy !== IMAGE_POLICY ||
      approval.providerKey !== this.provider.key || approval.providerModel !== MODERATION_MODEL) throw this.mismatch();
    this.validateDecision(approval.decision);
    if (IMAGE_CATEGORIES.some(key => approval.decision.categories[key])) throw this.mismatch();
    const flags = Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, approval.decision.categories[key]]));
    const result = await client.query<{id: string}>(`
      INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,
        policy_version,local_policy_version,provider_key,provider_model,provider_response_id,category_flags,decision,checked_at)
      VALUES ('image','avatar_image',1,$1,$2,'none',$3,$4,$5,$6::jsonb,'allow',$7)
      ON CONFLICT(surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model)
      DO UPDATE SET decision='allow',category_flags=excluded.category_flags,checked_at=excluded.checked_at,
        provider_response_id=excluded.provider_response_id RETURNING id`,
    [approval.fingerprint, IMAGE_POLICY, approval.providerKey, approval.providerModel, approval.decision.responseId, JSON.stringify(flags), approval.checkedAt]);
    return result.rows[0]!.id;
  }
}
