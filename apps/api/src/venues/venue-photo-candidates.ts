import { Controller, Delete, Get, Header, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { ConsumerAuthService, type AuthenticatedConsumer } from "../auth/consumer-auth.service";
import { badRequest, conflict, notFound, ProblemHttpException, serviceUnavailable, type ProblemBody } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { ContentModerationService, IMAGE_POLICY, type ImageApproval } from "../moderation/moderation.service";
import { MODERATION_MODEL } from "../moderation/provider";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { AvatarService } from "../profiles/avatar.service";
import { assertCapabilities } from "../restrictions/policy";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { lockCatalogShared } from "./venue-community.query";
import { galleryEvidenceSchema, parseGalleryEvidenceHeaders, type GalleryEvidence } from "./venue-gallery";

export const VENUE_CANDIDATE_RIGHTS = "venue-candidate-rights-v1";
const unavailable = () => notFound("PHOTO_CANDIDATE_UNAVAILABLE", "Кандидат недоступен");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function candidateId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw unavailable();
  return value.toLowerCase();
}
export function candidateCommand(header: unknown, body: unknown): number {
  if (header !== "1") throw badRequest("VERSION_REQUIRED", "Требуется X-Photo-Version: 1");
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
    (body as Record<string, unknown>).expectedVersion !== 1) throw badRequest("INVALID_PHOTO_COMMAND", "Требуется expectedVersion: 1");
  return 1;
}
export type CandidateRow = {
  id: string; venue_id: string; owner_user_id: string; storage_key: string; image_sha256: string;
  image_approval_id: string; width: number; height: number; version: number;
  status: "awaiting_review" | "accepted" | "rejected" | "withdrawn";
  evidence: GalleryEvidence; content_fingerprint: string;
};
export function candidateReceipt(row: CandidateRow) {
  return { id: row.id, venueId: row.venue_id, status: row.status, version: row.version,
    width: row.width, height: row.height, evidence: row.evidence,
    previewPath: row.status === "awaiting_review" ? `/v1/me/venue-photo-candidates/${row.id}/content` : null };
}

/** Owns consumer candidates only. Privileged publication stays in VenueGalleryService. */
@Injectable()
export class VenuePhotoCandidatesService {
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner, private readonly idempotency: IdempotencyService,
    private readonly fence: ActorFenceService, private readonly media: AvatarService,
    private readonly moderation: ContentModerationService) {}

  private async transaction<T>(actor: AuthenticatedConsumer, work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='3s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await this.fence.assertActiveConsumerInTransaction(c, { actorId: actor.userId, sessionId: actor.sessionId });
      const result = await work(c); await c.query("COMMIT"); return result;
    } catch (error) { await c.query("ROLLBACK").catch(() => undefined); throw error; } finally { c.release(); }
  }
  /** Never follows a merge/dedup to confer creator authority over another canonical row. */
  async ownerVenue(c: PoolClient, owner: string, venueId: string): Promise<void> {
    await assertCapabilities(c, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, owner, ["account.access", "profile.public"]);
    await lockCatalogShared(c);
    const row = await c.query(`SELECT id FROM venues WHERE id=$1 AND created_by_user_id=$2
      AND lifecycle_state IN ('unverified','verified') AND canonical_venue_id IS NULL FOR UPDATE`, [venueId, owner]);
    if (!row.rowCount) throw unavailable();
  }
  async row(c: PoolClient, id: string, venueId: string, pending = false): Promise<CandidateRow> {
    const result = await c.query<CandidateRow>(`SELECT * FROM venue_photo_submissions
      WHERE id=$1 AND venue_id=$2 AND purpose='official_candidate' ${pending ? "AND status='awaiting_review'" : ""} FOR UPDATE`, [id, venueId]);
    if (!result.rows[0]) throw unavailable();
    return result.rows[0];
  }
  /** Exact stored ALLOW is reused, with current policy/provider/rights and sanitized-byte checks. No classifier call. */
  async approvedBytes(c: PoolClient, row: CandidateRow): Promise<Buffer> {
    const approval = await c.query<{ content_fingerprint: string }>(`SELECT a.content_fingerprint
      FROM venue_photo_submissions s JOIN content_moderation_approvals a ON a.id=s.image_approval_id
      WHERE s.id=$1 AND s.purpose='official_candidate' AND s.preset='cover' AND s.rights_version=$2
        AND a.content_type='image' AND a.surface_key='cover_image' AND a.decision='allow'
        AND a.policy_version=$3 AND a.local_policy_version='none' AND a.fingerprint_version=1
        AND a.provider_model=$4 AND a.provider_key=$5 FOR SHARE OF a`,
    [row.id, VENUE_CANDIDATE_RIGHTS, IMAGE_POLICY, MODERATION_MODEL, this.env.CONTENT_MODERATION_PROVIDER]);
    if (!approval.rows[0]) throw conflict("MODERATION_POLICY_MISMATCH", "Проверка фото устарела");
    const bytes = await this.media.readPrivateStage(c, row.storage_key, row.image_sha256);
    if (this.moderation.fingerprint(bytes, "cover") !== approval.rows[0].content_fingerprint) throw unavailable();
    return bytes;
  }
  private async current(c: PoolClient, actor: AuthenticatedConsumer, id: string): Promise<CandidateRow> {
    const snapshot = (await c.query<{ venue_id: string }>(`SELECT venue_id FROM venue_photo_submissions
      WHERE id=$1 AND owner_user_id=$2 AND purpose='official_candidate'`, [id, actor.userId])).rows[0];
    if (!snapshot) throw unavailable();
    await this.ownerVenue(c, actor.userId, snapshot.venue_id);
    const row = await this.row(c, id, snapshot.venue_id);
    if (row.owner_user_id !== actor.userId) throw unavailable();
    return row;
  }
  async upload(actor: AuthenticatedConsumer, venueId: string, key: string, rights: unknown,
    input: unknown, mime: string, evidence: GalleryEvidence) {
    venueId = candidateId(venueId);
    if (rights !== VENUE_CANDIDATE_RIGHTS) throw badRequest("PHOTO_RIGHTS_REQUIRED", "Подтвердите права на фото и согласие узнаваемых людей");
    const parsed = galleryEvidenceSchema.safeParse(evidence);
    if (!parsed.success || parsed.data.creditKind !== "photo") throw badRequest("GALLERY_EVIDENCE_INVALID", "Требуется фотография площадки с источником и правами");
    evidence = parsed.data;
    const body = Buffer.isBuffer(input) ? Buffer.from(input) : input;
    const requestHash = this.idempotency.requestHash({ venueId, rights, mime, evidence, policy: IMAGE_POLICY,
      imageSha256: Buffer.isBuffer(body) ? sha(body) : null });
    let storageKey: string | undefined;
    type Prepared = { staged: Buffer; approval?: ImageApproval; width: number; height: number; rejection?: ProblemBody };
    try {
      return await this.mutations.runWithExternalPrepare<Prepared, ReturnType<typeof candidateReceipt> | ProblemBody>({
        actorId: actor.userId, sessionId: actor.sessionId, operation: "venues.candidates.upload", key, requestHash,
        requiredCapabilities: ["profile.public"],
        authorizeReplay: async (c, saved) => {
          await this.ownerVenue(c, actor.userId, venueId);
          if ("id" in saved) await this.current(c, actor, saved.id);
        },
        prepare: async () => {
          await this.transaction(actor, c => this.ownerVenue(c, actor.userId, venueId));
          if (this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
          this.processing++;
          try {
            const sanitized = await sanitizeAvatar(body, mime, "cover");
            storageKey = `${randomBytes(32).toString("hex")}.png`;
            const staged = await this.media.stage(storageKey, sanitized);
            if (!staged.equals(sanitized)) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Фото недоступно");
            const metadata = await sharp(staged).metadata();
            try {
              return { staged, width: metadata.width!, height: metadata.height!, approval: await this.moderation.approveImage(actor.userId, staged, "cover") };
            } catch (error) {
              if (error instanceof ProblemHttpException && (error.getResponse() as ProblemBody).code === "PUBLIC_IMAGE_CONTENT_REJECTED") {
                return { staged, width: metadata.width!, height: metadata.height!, rejection: error.getResponse() as ProblemBody };
              }
              throw error;
            }
          } finally { this.processing--; }
        },
        execute: async (c, prep) => {
          await this.ownerVenue(c, actor.userId, venueId);
          if (prep.rejection) return { statusCode: 422, body: prep.rejection };
          const bytes = await this.media.verifyStage(c, storageKey!, prep.staged);
          const approval = await this.moderation.bindImage(c, prep.approval!, bytes, "cover");
          const previous = await c.query<{ storage_key: string }>(`UPDATE venue_photo_submissions SET status='withdrawn',
            version=version+1,withdrawn_at=clock_timestamp() WHERE venue_id=$1 AND purpose='official_candidate'
            AND status='awaiting_review' RETURNING storage_key`, [venueId]);
          for (const old of previous.rows) await c.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1", [old.storage_key]);
          const row = (await c.query<CandidateRow>(`INSERT INTO venue_photo_submissions
            (owner_user_id,venue_id,purpose,storage_key,image_approval_id,image_sha256,preset,width,height,rights_version,status,evidence,expires_at)
            VALUES($1,$2,'official_candidate',$3,$4,$5,'cover',$6,$7,$8,'awaiting_review',$9::jsonb,NULL) RETURNING *`,
          [actor.userId, venueId, storageKey, approval, sha(bytes), prep.width, prep.height, VENUE_CANDIDATE_RIGHTS, JSON.stringify(evidence)])).rows[0]!;
          return { statusCode: 201, body: candidateReceipt(row) };
        },
      });
    } finally { if (storageKey) await this.media.releaseStage(storageKey); }
  }
  async status(actor: AuthenticatedConsumer, id: string) {
    return this.transaction(actor, async c => candidateReceipt(await this.current(c, actor, candidateId(id))));
  }
  async content(actor: AuthenticatedConsumer, id: string) {
    return this.transaction(actor, async c => {
      const row = await this.current(c, actor, candidateId(id));
      if (row.status !== "awaiting_review") throw unavailable();
      return this.approvedBytes(c, row);
    });
  }
  async withdraw(actor: AuthenticatedConsumer, id: string, key: string, header: unknown, body: unknown) {
    id = candidateId(id); const expected = candidateCommand(header, body);
    const result = await this.mutations.runIdempotent({
      actorId: actor.userId, sessionId: actor.sessionId, operation: "venues.candidates.withdraw", key,
      requestHash: this.idempotency.requestHash({ id, expected }),
      authorizeReplay: async (c, saved: ReturnType<typeof candidateReceipt>) => {
        const row = await this.current(c, actor, id);
        if (row.status !== "withdrawn" || row.version !== saved.version) throw unavailable();
      },
      execute: async c => {
        const row = await this.current(c, actor, id);
        if (row.status !== "awaiting_review" || row.version !== expected) throw conflict("VERSION_CONFLICT", "Кандидат изменился");
        const updated = (await c.query<CandidateRow>(`UPDATE venue_photo_submissions SET status='withdrawn',version=version+1,
          withdrawn_at=clock_timestamp() WHERE id=$1 RETURNING *`, [id])).rows[0]!;
        await c.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1", [row.storage_key]);
        return { statusCode: 200, body: candidateReceipt(updated) };
      },
    });
    return result.body;
  }
}

@Controller()
export class VenuePhotoCandidatesController {
  constructor(private readonly auth: ConsumerAuthService, private readonly candidates: VenuePhotoCandidatesService,
    private readonly idempotency: IdempotencyService) {}
  @Post("venues/:venueId/photo-candidates") @Header("Cache-Control", "no-store")
  async upload(@Req() req: FastifyRequest, @Param("venueId") venueId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const actor = await this.auth.requireCookieMutation(req);
    const result = await this.candidates.upload(actor, venueId, this.idempotency.requireKey(req.headers["idempotency-key"]),
      req.headers["x-photo-rights"], req.body, req.headers["content-type"] ?? "", parseGalleryEvidenceHeaders(req.headers));
    reply.code(result.statusCode); if (result.statusCode >= 400) reply.type("application/problem+json"); return result.body;
  }
  @Get("me/venue-photo-candidates/:candidateId") @Header("Cache-Control", "no-store")
  async status(@Req() req: FastifyRequest, @Param("candidateId") id: string) {
    return this.candidates.status(await this.auth.requireSession(req), id);
  }
  @Get("me/venue-photo-candidates/:candidateId/content")
  async content(@Req() req: FastifyRequest, @Param("candidateId") id: string, @Res() reply: FastifyReply) {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type("image/png").send(await this.candidates.content(await this.auth.requireSession(req), id));
  }
  @Delete("me/venue-photo-candidates/:candidateId") @Header("Cache-Control", "no-store")
  async withdraw(@Req() req: FastifyRequest, @Param("candidateId") id: string) {
    return this.candidates.withdraw(await this.auth.requireCookieMutation(req), id,
      this.idempotency.requireKey(req.headers["idempotency-key"]), req.headers["x-photo-version"], req.body);
  }
}
