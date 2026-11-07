import { Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { problem, ProblemHttpException } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { evaluateLocalText, LOCAL_TEXT_POLICY_VERSION } from "./local-text-policy";
import {
  IMAGE_CATEGORIES,
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  TEXT_CATEGORIES,
  type ContentModerationProvider,
  type ImageDecision,
  type TextBatchDecision,
  type TextItemDecision,
} from "./provider";
import {
  BindingKind,
  EntityKind,
  isReviewTextSurface,
  PUBLIC_TEXT_POLICY_VERSION,
  REVIEW_HARD_REJECT_CATEGORIES,
  REVIEW_QUEUE_CATEGORIES,
  TEXT_FIELD_HINTS,
  TEXT_SURFACE_KIND,
  type TextClassificationDecision,
  type TextFieldCandidate,
  type TextSurface,
} from "./text-policy";

export const IMAGE_POLICY = "avatar-image-v1";
export type ImageApproval = Readonly<{
  fingerprint: string;
  providerKey: "openai" | "fake";
  providerModel: string;
  policy: string;
  checkedAt: Date;
  decision: ImageDecision;
}>;

export type TextFieldApproval = Readonly<{
  surface: TextSurface;
  fieldId: string;
  text: string;
  fingerprint: string;
  providerKey: "openai" | "fake";
  providerModel: string;
  policy: string;
  localPolicy: string;
  checkedAt: Date;
  decision: TextItemDecision;
  /** Persisted approvals.decision — allow for A/B1a; allow|review for B1b (never forge allow). */
  classification: TextClassificationDecision;
  responseId: string | null;
}>;

export type TextBatchApproval = Readonly<{
  fields: readonly TextFieldApproval[];
}>;

/** B1b review assessment: classifier ALLOW still requires independent human approval. */
export type ReviewTextBatchAssessment = Readonly<{
  fields: readonly TextFieldApproval[];
}>;

@Injectable()
export class ContentModerationService {
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(MODERATION_PROVIDER) private readonly provider: ContentModerationProvider) {
    if (provider.key === "fake" && (env.NODE_ENV !== "test" || env.APP_ENV !== "local")) throw new Error("Fake moderation requires local NODE_ENV=test");
  }
  fingerprint(bytes: Buffer, slot: "avatar" | "cover" = "avatar"): string {
    if (!this.env.CONTENT_MODERATION_FINGERPRINT_SECRET) throw problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка фото временно недоступна");
    return createHmac("sha256", this.env.CONTENT_MODERATION_FINGERPRINT_SECRET)
      .update(`moderation-fingerprint:v1:${slot}_image:`).update(bytes).digest("hex");
  }
  textFingerprint(surface: TextSurface, text: string): string {
    if (!this.env.CONTENT_MODERATION_FINGERPRINT_SECRET) {
      throw problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка текста временно недоступна");
    }
    return createHmac("sha256", this.env.CONTENT_MODERATION_FINGERPRINT_SECRET)
      .update(`moderation-fingerprint:v1:text:${surface}:`)
      .update(text, "utf8")
      .digest("hex");
  }
  private unavailableImage(retry?: number) { return problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка фото временно недоступна", undefined, retry); }
  private unavailableText(retry?: number) {
    return problem(503, "MODERATION_TEMPORARILY_UNAVAILABLE", "Проверка текста временно недоступна", undefined, retry);
  }
  private mismatchImage() { return problem(503, "MODERATION_POLICY_MISMATCH", "Проверка фото временно недоступна"); }
  private mismatchText() { return problem(503, "MODERATION_POLICY_MISMATCH", "Проверка текста временно недоступна"); }
  private rejectText(fields: Record<string, string>) {
    return problem(
      422,
      "PUBLIC_TEXT_CONTENT_REJECTED",
      "Измените текст и попробуйте снова",
      undefined,
      undefined,
      fields,
    );
  }
  private validateDecision(decision: ImageDecision) {
    if (!decision || decision.model !== MODERATION_MODEL || IMAGE_CATEGORIES.some(key => typeof decision.categories?.[key] !== "boolean") ||
      typeof decision.flagged !== "boolean" || (decision.responseId !== null && (typeof decision.responseId !== "string" || decision.responseId.length > 200)) ||
      (decision.flagged && !IMAGE_CATEGORIES.some(key => decision.categories[key]))) throw this.mismatchImage();
  }
  private validateTextItem(decision: TextItemDecision) {
    if (
      !decision ||
      typeof decision.flagged !== "boolean" ||
      TEXT_CATEGORIES.some((key) => typeof decision.categories?.[key] !== "boolean") ||
      (decision.flagged && !TEXT_CATEGORIES.some((key) => decision.categories[key]))
    ) {
      throw this.mismatchText();
    }
  }
  async approveImage(actorId: string, bytes: Buffer, slot: "avatar" | "cover" = "avatar"): Promise<ImageApproval> {
    // Defense in depth at the port: original/noncanonical bytes cannot reach any provider.
    const metadata = await sharp(bytes).metadata();
    if (bytes.length > 2 * 1024 * 1024 || metadata.format !== "png" || metadata.width !== (slot === "cover" ? 1200 : 512) || metadata.height !== (slot === "cover" ? 400 : 512) ||
      (metadata.pages ?? 1) !== 1 || metadata.exif || metadata.icc || metadata.xmp) throw this.mismatchImage();
    const fingerprint = this.fingerprint(bytes, slot);
    const cached = await this.pool.query<{category_flags: ImageDecision["categories"]; provider_response_id: string | null; checked_at: Date}>(
      `SELECT category_flags,provider_response_id,checked_at FROM content_moderation_approvals
       WHERE surface_key=$5 AND content_type='image' AND fingerprint_version=1 AND content_fingerprint=$1
       AND policy_version=$2 AND local_policy_version='none' AND provider_key=$3 AND provider_model=$4 AND decision='allow'`,
      [fingerprint, IMAGE_POLICY, this.provider.key, this.provider.model, `${slot}_image`]);
    const row = cached.rows[0];
    let decision: ImageDecision;
    if (row) {
      decision = {model: this.provider.model, responseId: row.provider_response_id, flagged: false, categories: row.category_flags};
    } else {
      if (this.processing >= 8) throw this.unavailableImage(1);
      this.processing++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        decision = await Promise.race([
          this.provider.moderateImage({mime: "image/png", bytes: Buffer.from(bytes), signal: controller.signal,
            beforeAttempt: () => this.reserveAttempt(actorId, "image")}),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {controller.abort(); reject(new ModerationProviderError("unavailable"));}, 6000); }),
        ]);
      } catch (error) {
        if (error instanceof ModerationProviderError) throw error.kind === "schema" ? this.mismatchImage() : this.unavailableImage(error.retryAfterSeconds);
        // Preserve our own product budget error, never forward arbitrary provider exceptions.
        if (error instanceof ProblemHttpException && (error.getResponse() as {code?: string}).code === "MODERATION_RATE_LIMITED") throw error;
        throw this.unavailableImage();
      } finally { if (timer) clearTimeout(timer); controller.abort(); this.processing--; }
    }
    this.validateDecision(decision);
    if (IMAGE_CATEGORIES.some(key => decision.categories[key])) throw problem(422, "PUBLIC_IMAGE_CONTENT_REJECTED", "Выберите другое фото");
    return Object.freeze({fingerprint, providerKey: this.provider.key, providerModel: this.provider.model,
      policy: IMAGE_POLICY, checkedAt: row?.checked_at ?? new Date(),
      decision: {...decision, categories: {...decision.categories}}});
  }

  /**
   * Preflight public text fields for one resource mutation. Empty strings are skipped.
   * Unchanged fields with matching allow evidence reuse cache (no provider I/O).
   * Must run outside owning-service locks. Missing provider fails closed.
   */
  async approveTexts(actorId: string, fields: readonly TextFieldCandidate[]): Promise<TextBatchApproval> {
    if (fields.length > 16) throw this.mismatchText();
    const prepared: TextFieldCandidate[] = [];
    const rejectHints: Record<string, string> = {};
    for (const field of fields) {
      const text = field.text;
      if (text.length === 0) continue;
      const local = evaluateLocalText(text, TEXT_SURFACE_KIND[field.surface]);
      if (local.kind === "reject") {
        rejectHints[field.fieldId] = TEXT_FIELD_HINTS[field.surface];
        continue;
      }
      prepared.push(field);
    }
    if (Object.keys(rejectHints).length > 0) throw this.rejectText(rejectHints);

    const approvals: TextFieldApproval[] = [];
    const needProvider: TextFieldCandidate[] = [];
    const needIndex: number[] = [];

    for (const field of prepared) {
      const fingerprint = this.textFingerprint(field.surface, field.text);
      const cached = await this.pool.query<{
        category_flags: TextItemDecision["categories"];
        provider_response_id: string | null;
        checked_at: Date;
      }>(
        `SELECT category_flags, provider_response_id, checked_at
         FROM content_moderation_approvals
         WHERE surface_key=$1 AND content_type='text' AND fingerprint_version=1
           AND content_fingerprint=$2 AND policy_version=$3 AND local_policy_version=$4
           AND provider_key=$5 AND provider_model=$6 AND decision='allow'`,
        [
          field.surface,
          fingerprint,
          PUBLIC_TEXT_POLICY_VERSION,
          LOCAL_TEXT_POLICY_VERSION,
          this.provider.key,
          this.provider.model,
        ],
      );
      const row = cached.rows[0];
      if (row) {
        const decision: TextItemDecision = {
          flagged: false,
          categories: row.category_flags,
        };
        this.validateTextItem(decision);
        approvals.push(
          Object.freeze({
            surface: field.surface,
            fieldId: field.fieldId,
            text: field.text,
            fingerprint,
            providerKey: this.provider.key,
            providerModel: this.provider.model,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: row.checked_at,
            decision: { ...decision, categories: { ...decision.categories } },
            classification: "allow" as const,
            responseId: row.provider_response_id,
          }),
        );
      } else {
        needIndex.push(approvals.length);
        approvals.push(null as unknown as TextFieldApproval);
        needProvider.push(field);
      }
    }

    if (needProvider.length > 0) {
      const batch = await this.runTextProvider(actorId, needProvider.map((f) => f.text));
      const providerReject: Record<string, string> = {};
      for (let i = 0; i < needProvider.length; i++) {
        const field = needProvider[i]!;
        const item = batch.results[i]!;
        this.validateTextItem(item);
        // Ordinary A/B1a: any provider flag rejects. Review surfaces must use assessReviewTexts.
        if (isReviewTextSurface(field.surface)) throw this.mismatchText();
        if (item.flagged || TEXT_CATEGORIES.some((key) => item.categories[key])) {
          providerReject[field.fieldId] = TEXT_FIELD_HINTS[field.surface];
          continue;
        }
        const fingerprint = this.textFingerprint(field.surface, field.text);
        approvals[needIndex[i]!] = Object.freeze({
          surface: field.surface,
          fieldId: field.fieldId,
          text: field.text,
          fingerprint,
          providerKey: this.provider.key,
          providerModel: this.provider.model,
          policy: PUBLIC_TEXT_POLICY_VERSION,
          localPolicy: LOCAL_TEXT_POLICY_VERSION,
          checkedAt: new Date(),
          decision: { ...item, categories: { ...item.categories } },
          classification: "allow" as const,
          responseId: batch.responseId,
        });
      }
      if (Object.keys(providerReject).length > 0) throw this.rejectText(providerReject);
    }

    return Object.freeze({ fields: Object.freeze(approvals.filter(Boolean)) });
  }

  /**
   * B1b public role-review/reply assessment. Hard-safety categories → 422.
   * Soft/queue categories → classification=review (never forged allow).
   * Clean allow still enters the existing mandatory human intake — does not publish.
   * Must run outside owning-service / admin locks. No raw body in metadata.
   */
  async assessReviewTexts(
    actorId: string,
    fields: readonly TextFieldCandidate[],
  ): Promise<ReviewTextBatchAssessment> {
    if (fields.length === 0 || fields.length > 16) throw this.mismatchText();
    for (const field of fields) {
      if (!isReviewTextSurface(field.surface) || field.text.length === 0) throw this.mismatchText();
    }
    const rejectHints: Record<string, string> = {};
    const prepared: TextFieldCandidate[] = [];
    for (const field of fields) {
      const local = evaluateLocalText(field.text, TEXT_SURFACE_KIND[field.surface]);
      if (local.kind === "reject") {
        rejectHints[field.fieldId] = TEXT_FIELD_HINTS[field.surface];
        continue;
      }
      prepared.push(field);
    }
    if (Object.keys(rejectHints).length > 0) throw this.rejectText(rejectHints);

    const approvals: TextFieldApproval[] = [];
    const needProvider: TextFieldCandidate[] = [];
    const needIndex: number[] = [];

    for (const field of prepared) {
      const fingerprint = this.textFingerprint(field.surface, field.text);
      const cached = await this.pool.query<{
        category_flags: TextItemDecision["categories"];
        provider_response_id: string | null;
        checked_at: Date;
        decision: string;
      }>(
        `SELECT category_flags, provider_response_id, checked_at, decision
         FROM content_moderation_approvals
         WHERE surface_key=$1 AND content_type='text' AND fingerprint_version=1
           AND content_fingerprint=$2 AND policy_version=$3 AND local_policy_version=$4
           AND provider_key=$5 AND provider_model=$6
           AND decision IN ('allow', 'review')`,
        [
          field.surface,
          fingerprint,
          PUBLIC_TEXT_POLICY_VERSION,
          LOCAL_TEXT_POLICY_VERSION,
          this.provider.key,
          this.provider.model,
        ],
      );
      const row = cached.rows[0];
      if (row && (row.decision === "allow" || row.decision === "review")) {
        const item: TextItemDecision = {
          flagged: TEXT_CATEGORIES.some((key) => row.category_flags[key]),
          categories: row.category_flags,
        };
        this.validateTextItem(item);
        // Cached review must never be upgraded to forged allow.
        const recomputed = this.classifyReviewItem(item);
        if (recomputed === "reject") {
          rejectHints[field.fieldId] = TEXT_FIELD_HINTS[field.surface];
          continue;
        }
        if (row.decision === "review" && recomputed === "allow") {
          throw this.mismatchText();
        }
        const classification: TextClassificationDecision =
          row.decision === "review" ? "review" : recomputed;
        approvals.push(
          Object.freeze({
            surface: field.surface,
            fieldId: field.fieldId,
            text: field.text,
            fingerprint,
            providerKey: this.provider.key,
            providerModel: this.provider.model,
            policy: PUBLIC_TEXT_POLICY_VERSION,
            localPolicy: LOCAL_TEXT_POLICY_VERSION,
            checkedAt: row.checked_at,
            decision: { ...item, categories: { ...item.categories } },
            classification,
            responseId: row.provider_response_id,
          }),
        );
      } else {
        needIndex.push(approvals.length);
        approvals.push(null as unknown as TextFieldApproval);
        needProvider.push(field);
      }
    }
    if (Object.keys(rejectHints).length > 0) throw this.rejectText(rejectHints);

    if (needProvider.length > 0) {
      const batch = await this.runTextProvider(actorId, needProvider.map((f) => f.text));
      for (let i = 0; i < needProvider.length; i++) {
        const field = needProvider[i]!;
        const item = batch.results[i]!;
        this.validateTextItem(item);
        const classification = this.classifyReviewItem(item);
        if (classification === "reject") {
          rejectHints[field.fieldId] = TEXT_FIELD_HINTS[field.surface];
          continue;
        }
        const fingerprint = this.textFingerprint(field.surface, field.text);
        approvals[needIndex[i]!] = Object.freeze({
          surface: field.surface,
          fieldId: field.fieldId,
          text: field.text,
          fingerprint,
          providerKey: this.provider.key,
          providerModel: this.provider.model,
          policy: PUBLIC_TEXT_POLICY_VERSION,
          localPolicy: LOCAL_TEXT_POLICY_VERSION,
          checkedAt: new Date(),
          decision: { ...item, categories: { ...item.categories } },
          classification,
          responseId: batch.responseId,
        });
      }
      if (Object.keys(rejectHints).length > 0) throw this.rejectText(rejectHints);
    }

    return Object.freeze({ fields: Object.freeze(approvals.filter(Boolean)) });
  }

  private classifyReviewItem(item: TextItemDecision): TextClassificationDecision | "reject" {
    if (REVIEW_HARD_REJECT_CATEGORIES.some((key) => item.categories[key])) return "reject";
    if (
      item.flagged ||
      REVIEW_QUEUE_CATEGORIES.some((key) => item.categories[key]) ||
      TEXT_CATEGORIES.some((key) => item.categories[key])
    ) {
      // Ambiguous / soft flags stay review — never forge provider ALLOW.
      return "review";
    }
    return "allow";
  }

  private async runTextProvider(actorId: string, texts: readonly string[]): Promise<TextBatchDecision> {
    if (this.processing >= 8) throw this.unavailableText(1);
    this.processing++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const batch = await Promise.race([
        this.provider.moderateTexts({
          texts,
          signal: controller.signal,
          beforeAttempt: () => this.reserveAttempt(actorId, "text"),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ModerationProviderError("unavailable"));
          }, 6000);
        }),
      ]);
      if (
        !batch ||
        batch.model !== MODERATION_MODEL ||
        batch.results.length !== texts.length ||
        (batch.responseId !== null &&
          (typeof batch.responseId !== "string" || batch.responseId.length > 200))
      ) {
        throw this.mismatchText();
      }
      return batch;
    } catch (error) {
      if (error instanceof ModerationProviderError) {
        throw error.kind === "schema"
          ? this.mismatchText()
          : this.unavailableText(error.retryAfterSeconds);
      }
      if (
        error instanceof ProblemHttpException &&
        (error.getResponse() as { code?: string }).code === "MODERATION_RATE_LIMITED"
      ) {
        throw error;
      }
      if (
        error instanceof ProblemHttpException &&
        (error.getResponse() as { code?: string }).code === "MODERATION_POLICY_MISMATCH"
      ) {
        throw error;
      }
      throw this.unavailableText();
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      this.processing--;
    }
  }

  private async reserveAttempt(actorId: string, bucket: "image" | "text"): Promise<void> {
    // Single autocommit statement, including concurrent initial reservations; no lock spans provider I/O.
    const result = await this.pool.query(`
      INSERT INTO content_moderation_rate_budgets(user_id,bucket,window_started_at,count,day_started_at,day_count)
      VALUES ($1,$2,now(),1,now(),1)
      ON CONFLICT(user_id,bucket) DO UPDATE SET
        window_started_at=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN now() ELSE content_moderation_rate_budgets.window_started_at END,
        count=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN 1 ELSE content_moderation_rate_budgets.count+1 END,
        day_started_at=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN now() ELSE content_moderation_rate_budgets.day_started_at END,
        day_count=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN 1 ELSE content_moderation_rate_budgets.day_count+1 END,
        updated_at=now()
      WHERE (content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' OR content_moderation_rate_budgets.count < 10)
        AND (content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' OR content_moderation_rate_budgets.day_count < 50)
        AND (content_moderation_rate_budgets.next_allowed_at IS NULL OR content_moderation_rate_budgets.next_allowed_at <= now())
      RETURNING user_id`, [actorId, bucket]);
    if (!result.rowCount) {
      throw problem(
        429,
        "MODERATION_RATE_LIMITED",
        bucket === "image"
          ? "Слишком много проверок фото. Попробуйте позже."
          : "Слишком много проверок текста. Попробуйте позже.",
        undefined,
        900,
      );
    }
  }
  /** Called only under owning AvatarService publication transaction after actor/version fence. */
  async bindImage(client: PoolClient, approval: ImageApproval, currentBytes: Buffer, slot: "avatar" | "cover" = "avatar"): Promise<string> {
    if (approval.fingerprint !== this.fingerprint(currentBytes, slot) || approval.policy !== IMAGE_POLICY ||
      approval.providerKey !== this.provider.key || approval.providerModel !== MODERATION_MODEL) throw this.mismatchImage();
    this.validateDecision(approval.decision);
    if (IMAGE_CATEGORIES.some(key => approval.decision.categories[key])) throw this.mismatchImage();
    const flags = Object.fromEntries(IMAGE_CATEGORIES.map(key => [key, approval.decision.categories[key]]));
    const result = await client.query<{id: string}>(`
      INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,
        policy_version,local_policy_version,provider_key,provider_model,provider_response_id,category_flags,decision,checked_at)
      VALUES ('image',$8,1,$1,$2,'none',$3,$4,$5,$6::jsonb,'allow',$7)
      ON CONFLICT(surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model)
      DO UPDATE SET decision='allow',category_flags=excluded.category_flags,checked_at=excluded.checked_at,
        provider_response_id=excluded.provider_response_id RETURNING id`,
    [approval.fingerprint, IMAGE_POLICY, approval.providerKey, approval.providerModel, approval.decision.responseId, JSON.stringify(flags), approval.checkedAt, `${slot}_image`]);
    return result.rows[0]!.id;
  }

  /**
   * Bind prepared text approvals to exact committed field values under the owning
   * service transaction. Never performs network I/O. Ordinary A/B1a allow-only.
   */
  async bindTexts(
    client: PoolClient,
    batch: TextBatchApproval,
    committed: ReadonlyArray<{ surface: TextSurface; text: string }>,
    meta: {
      entityKind: EntityKind;
      entityId: string;
      resourceVersion: number;
      actorUserId: string;
      actorPrincipalId?: string | null;
      bindingKind: BindingKind;
    },
  ): Promise<void> {
    for (const field of batch.fields) {
      if (field.classification !== "allow" || isReviewTextSurface(field.surface)) {
        throw this.mismatchText();
      }
    }
    await this.bindTextRows(client, batch.fields, committed, meta, null);
  }

  /**
   * B1b/B1c: bind classifier evidence (allow|review) to exact revision.
   * Never overwrites a provider review decision to allow. Human
   * role_reputation_decision_id XOR venue_review_decision_id is required for
   * publication and omitted from SQL when absent (candidate rows must not
   * name 0063/0064-only FK columns so N-1 fixtures stay compatible).
   */
  async bindReviewTexts(
    client: PoolClient,
    batch: ReviewTextBatchAssessment,
    committed: ReadonlyArray<{ surface: TextSurface; text: string }>,
    meta: {
      entityKind: "role_review_revision" | "role_reply_revision" | "venue_review_revision";
      entityId: string;
      resourceVersion: number;
      actorUserId: string;
      actorPrincipalId?: string | null;
      bindingKind: BindingKind;
      roleReputationDecisionId?: string | null;
      venueReviewDecisionId?: string | null;
    },
  ): Promise<void> {
    for (const field of batch.fields) {
      if (!isReviewTextSurface(field.surface)) throw this.mismatchText();
      if (field.classification !== "allow" && field.classification !== "review") {
        throw this.mismatchText();
      }
    }
    const roleDecision = meta.roleReputationDecisionId ?? null;
    const venueDecision = meta.venueReviewDecisionId ?? null;
    if (roleDecision && venueDecision) throw this.mismatchText();
    if (meta.entityKind === "venue_review_revision") {
      if (roleDecision) throw this.mismatchText();
      if (meta.bindingKind === "publication") {
        if (!venueDecision) throw this.mismatchText();
      } else if (venueDecision) {
        throw this.mismatchText();
      }
    } else {
      if (venueDecision) throw this.mismatchText();
      if (meta.bindingKind === "publication") {
        if (!roleDecision) throw this.mismatchText();
      } else if (roleDecision) {
        throw this.mismatchText();
      }
    }
    await this.bindTextRows(
      client,
      batch.fields,
      committed,
      meta,
      roleDecision,
      venueDecision,
    );
  }

  private async bindTextRows(
    client: PoolClient,
    fields: readonly TextFieldApproval[],
    committed: ReadonlyArray<{ surface: TextSurface; text: string }>,
    meta: {
      entityKind: EntityKind;
      entityId: string;
      resourceVersion: number;
      actorUserId: string;
      actorPrincipalId?: string | null;
      bindingKind: BindingKind;
    },
    roleReputationDecisionId: string | null,
    venueReviewDecisionId: string | null = null,
  ): Promise<void> {
    const bySurface = new Map(fields.map((f) => [f.surface, f]));
    for (const item of committed) {
      if (item.text.length === 0) continue;
      const approval = bySurface.get(item.surface);
      if (!approval) throw this.mismatchText();
      const fingerprint = this.textFingerprint(item.surface, item.text);
      if (
        approval.fingerprint !== fingerprint ||
        approval.text !== item.text ||
        approval.policy !== PUBLIC_TEXT_POLICY_VERSION ||
        approval.localPolicy !== LOCAL_TEXT_POLICY_VERSION ||
        approval.providerKey !== this.provider.key ||
        approval.providerModel !== MODERATION_MODEL
      ) {
        throw this.mismatchText();
      }
      this.validateTextItem(approval.decision);
      const classification = approval.classification;
      if (classification === "allow") {
        if (
          approval.decision.flagged ||
          TEXT_CATEGORIES.some((key) => approval.decision.categories[key])
        ) {
          throw this.mismatchText();
        }
      } else if (classification === "review") {
        if (REVIEW_HARD_REJECT_CATEGORIES.some((key) => approval.decision.categories[key])) {
          throw this.mismatchText();
        }
        // review must retain at least one soft/ambiguous signal — never forge allow.
        if (
          !approval.decision.flagged &&
          !REVIEW_QUEUE_CATEGORIES.some((key) => approval.decision.categories[key]) &&
          !TEXT_CATEGORIES.some((key) => approval.decision.categories[key])
        ) {
          throw this.mismatchText();
        }
      } else {
        throw this.mismatchText();
      }
      const flags = Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, approval.decision.categories[key]]),
      );
      // Preserve existing review classification on conflict — never overwrite review→allow.
      const inserted = await client.query<{ id: string; decision: string }>(
        `INSERT INTO content_moderation_approvals(
           content_type, surface_key, fingerprint_version, content_fingerprint,
           policy_version, local_policy_version, provider_key, provider_model,
           provider_response_id, category_flags, decision, checked_at)
         VALUES ('text',$1,1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT(surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model)
         DO UPDATE SET
           decision = CASE
             WHEN content_moderation_approvals.decision = 'review' THEN 'review'
             WHEN EXCLUDED.decision = 'review' THEN 'review'
             ELSE EXCLUDED.decision
           END,
           category_flags = CASE
             WHEN content_moderation_approvals.decision = 'review' THEN content_moderation_approvals.category_flags
             WHEN EXCLUDED.decision = 'review' THEN EXCLUDED.category_flags
             ELSE EXCLUDED.category_flags
           END,
           checked_at = CASE
             WHEN content_moderation_approvals.decision = 'review' THEN content_moderation_approvals.checked_at
             ELSE EXCLUDED.checked_at
           END,
           provider_response_id = CASE
             WHEN content_moderation_approvals.decision = 'review' THEN content_moderation_approvals.provider_response_id
             ELSE EXCLUDED.provider_response_id
           END
         RETURNING id, decision`,
        [
          item.surface,
          fingerprint,
          PUBLIC_TEXT_POLICY_VERSION,
          LOCAL_TEXT_POLICY_VERSION,
          approval.providerKey,
          approval.providerModel,
          approval.responseId,
          JSON.stringify(flags),
          classification,
          approval.checkedAt,
        ],
      );
      if (
        classification === "review" &&
        inserted.rows[0]!.decision !== "review"
      ) {
        throw this.mismatchText();
      }
      // Ordinary A/comment and candidate binds must not name 0063/0064 FK columns
      // (N-1 fixtures lack them). Only human publication writes the matching FK.
      if (roleReputationDecisionId !== null) {
        await client.query(
          `INSERT INTO content_moderation_bindings(
             entity_kind, entity_id, surface_key, resource_version, approval_id,
             actor_user_id, actor_principal_id, binding_kind, role_reputation_decision_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (entity_kind, entity_id, surface_key, resource_version, binding_kind)
           DO UPDATE SET approval_id = excluded.approval_id,
             actor_user_id = excluded.actor_user_id,
             actor_principal_id = excluded.actor_principal_id,
             role_reputation_decision_id = COALESCE(
               excluded.role_reputation_decision_id,
               content_moderation_bindings.role_reputation_decision_id
             )`,
          [
            meta.entityKind,
            meta.entityId,
            item.surface,
            meta.resourceVersion,
            inserted.rows[0]!.id,
            meta.actorUserId,
            meta.actorPrincipalId ?? null,
            meta.bindingKind,
            roleReputationDecisionId,
          ],
        );
      } else if (venueReviewDecisionId !== null) {
        await client.query(
          `INSERT INTO content_moderation_bindings(
             entity_kind, entity_id, surface_key, resource_version, approval_id,
             actor_user_id, actor_principal_id, binding_kind, venue_review_decision_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (entity_kind, entity_id, surface_key, resource_version, binding_kind)
           DO UPDATE SET approval_id = excluded.approval_id,
             actor_user_id = excluded.actor_user_id,
             actor_principal_id = excluded.actor_principal_id,
             venue_review_decision_id = COALESCE(
               excluded.venue_review_decision_id,
               content_moderation_bindings.venue_review_decision_id
             )`,
          [
            meta.entityKind,
            meta.entityId,
            item.surface,
            meta.resourceVersion,
            inserted.rows[0]!.id,
            meta.actorUserId,
            meta.actorPrincipalId ?? null,
            meta.bindingKind,
            venueReviewDecisionId,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO content_moderation_bindings(
             entity_kind, entity_id, surface_key, resource_version, approval_id,
             actor_user_id, actor_principal_id, binding_kind)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (entity_kind, entity_id, surface_key, resource_version, binding_kind)
           DO UPDATE SET approval_id = excluded.approval_id,
             actor_user_id = excluded.actor_user_id,
             actor_principal_id = excluded.actor_principal_id`,
          [
            meta.entityKind,
            meta.entityId,
            item.surface,
            meta.resourceVersion,
            inserted.rows[0]!.id,
            meta.actorUserId,
            meta.actorPrincipalId ?? null,
            meta.bindingKind,
          ],
        );
      }
    }
  }
}
