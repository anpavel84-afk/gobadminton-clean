import { z } from "zod";
import { reason, uuid } from "./dto";
export const CASE_STATUSES = ["open", "in_review", "resolved", "closed"] as const;
export const CASE_NOTES = ["review_started", "awaiting_information", "information_checked", "escalated", "resolution_recorded"] as const;
const common = { expectedVersion: z.number().int().positive().max(2147483646), reasonCode: reason };
export const caseCreateSchema = z.object({ reportId: uuid, reasonCode: reason }).strict();
export const caseCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ...common, principalId: uuid.nullable() }).strict(),
  z.object({ action: z.literal("status"), ...common, status: z.enum(CASE_STATUSES) }).strict(),
  z.object({ action: z.literal("note"), ...common, noteCode: z.enum(CASE_NOTES) }).strict(),
  z.object({ action: z.literal("link_report"), ...common, reportId: uuid }).strict(),
  z.object({ action: z.literal("link_game"), ...common, gameId: uuid }).strict(),
  z.object({ action: z.literal("capture_evidence"), ...common, linkId: uuid }).strict(),
]);
export type CaseCommand = z.infer<typeof caseCommandSchema>;
export const casePageSchema = z.object({ beforeId: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const caseHistorySchema = z.object({ beforeVersion: z.coerce.number().int().positive().max(2147483647).optional() }).strict();
export const reportPageSchema = casePageSchema.extend({ reportId: uuid.optional() }).strict();
