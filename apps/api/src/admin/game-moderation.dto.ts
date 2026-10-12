import { z } from "zod";
import { reason, uuid } from "./dto";
const version = z.number().int().positive().max(2147483646);
const common = { expectedModerationVersion: version, reasonCode: reason };
export const gameModerationCommandSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("hide"),...common}).strict(),
  z.object({action:z.literal("takedown"),...common}).strict(),
  z.object({action:z.literal("lock_requests"),...common}).strict(),
  z.object({action:z.literal("restore_moderation"),...common}).strict(),
  z.object({action:z.literal("force_cancel"),...common,expectedGameVersion:version}).strict(),
]);
export type GameModerationCommand = z.infer<typeof gameModerationCommandSchema>;
export const gameListQuerySchema = z.object({cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict();
export const gameDetailQuerySchema = z.object({historyCursor:z.string().max(256).optional()}).strict();
