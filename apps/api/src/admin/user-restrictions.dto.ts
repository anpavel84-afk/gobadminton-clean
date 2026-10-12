import { z } from "zod";
import { reason, uuid } from "./dto";
import { USER_CAPABILITIES } from "../restrictions/policy";
const version = z.number().int().positive().max(2147483646);
const common = { expectedVersion: version, reasonCode: reason };
export const userRestrictionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restrict"), ...common, capability: z.enum(USER_CAPABILITIES), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal("revoke_restriction"), ...common, restrictionId: uuid }).strict(),
  z.object({ action: z.literal("revoke_consumer_sessions"), ...common }).strict(),
]);
export type UserRestrictionCommand = z.infer<typeof userRestrictionCommandSchema>;
export const restrictionHistoryQuerySchema = z.object({ beforeVersion: z.coerce.number().int().positive().max(2147483647).optional() }).strict();
