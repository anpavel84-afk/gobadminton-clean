import { createHash } from "node:crypto";
import { z } from "zod";

const itemSchema = z.object({
  venueId: z.string().uuid(), file: z.string(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  kind: z.enum(["photo", "logo", "illustration"]), credit_text: z.string().max(120),
  source_page_url: z.string().max(300).url().refine(s => s.startsWith("https://")).nullable(),
  basis_note: z.string().max(600),
}).strict().superRefine((v, ctx) => {
  if (v.file !== `${v.venueId}.jpg`) ctx.addIssue({code:"custom",message:"INVALID_FILE"});
  if (v.kind === "illustration" ? v.credit_text !== "Иллюстрация" || v.source_page_url !== null
    : v.source_page_url === null || !v.credit_text.startsWith(v.kind === "photo" ? "Фото: " : "Логотип: "))
    ctx.addIssue({code:"custom",message:"INVALID_CREDIT"});
});
const manifestSchema = z.object({schema:z.literal("VENUE_COVER_BATCH_V1"),
  batch:z.string().regex(/^[a-z0-9-]{1,40}$/), count:z.number().int().min(0).max(50),
  items:z.array(itemSchema).max(50),
}).strict().superRefine((v,ctx) => {
  if (v.count !== v.items.length || new Set(v.items.map(i=>i.venueId)).size !== v.count ||
    new Set(v.items.map(i=>i.file)).size !== v.count) ctx.addIssue({code:"custom",message:"INVALID_COUNT_OR_DUPLICATE"});
});
export type CoverManifest = z.infer<typeof manifestSchema>;
export function validateManifest(raw: unknown): CoverManifest { return manifestSchema.parse(raw); }
export function manifestDigest(manifest: CoverManifest): string {
  return createHash("sha256").update(manifest.items.map(i=>i.sha256.toLowerCase()).sort().join("\n")).digest("hex");
}
export function validateImage(bytes: Buffer, expected: string): void {
  if (bytes.length > 2*1024*1024 || bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
    createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase()) throw new Error("INVALID_IMAGE");
}
export type VenueSnapshot = {name:string; lifecycle_state:string; cover_key:string|null; cover_credit_kind:string|null; version:number};
export function planCover(row: VenueSnapshot | undefined): {action:"READY"|"SKIPPED"|"FAILED";reason:string} {
  if (!row) return {action:"FAILED",reason:"VENUE_NOT_FOUND"};
  if (!["unverified","verified"].includes(row.lifecycle_state)) return {action:"SKIPPED",reason:"VENUE_INELIGIBLE"};
  if (row.cover_key !== null || row.cover_credit_kind !== null) return {action:"SKIPPED",reason:"EXISTING_COVER"};
  return {action:"READY",reason:"EMPTY_COVER"};
}
