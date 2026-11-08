import { z } from "zod";
import { badRequest } from "../auth/problem";
import { ADMIN_ROLES } from "./rbac";
export const uuid = z.string().uuid();
export const reason = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
export const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_principal"),
      userId: uuid,
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("role"),
      principalId: uuid,
      role: z.enum(ADMIN_ROLES),
      active: z.boolean(),
      expectedVersion: z.number().int().positive(),
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      principalId: uuid,
      status: z.enum(["suspended", "revoked"]),
      expectedVersion: z.number().int().positive(),
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("recover_mfa"),
      principalId: uuid,
      expectedVersion: z.number().int().positive(),
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke_sessions"),
      principalId: uuid,
      expectedVersion: z.number().int().positive(),
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke_credential"),
      principalId: uuid,
      credentialId: z.string().min(1).max(1024),
      expectedVersion: z.number().int().positive(),
      reasonCode: reason,
    })
    .strict(),
]);
export type AdminCommand = z.infer<typeof commandSchema>;
export const optionsSchema = z
  .object({
    purpose: z.enum(["enroll", "login", "step_up"]),
    activationToken: z.string().min(32).max(256).optional(),
  })
  .strict();
export const verifySchema = z
  .object({
    challengeId: uuid,
    response: z.record(z.string(), z.unknown()),
    activationToken: z.string().min(32).max(256).optional(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw badRequest("ADMIN_INVALID_REQUEST", "Invalid Admin request");
  return result.data;
}

export const emptyBodySchema = z.object({}).strict();

/** Bounded metadata-only moderation history filters (D2). No free-text / raw body search. */
export const moderationAuditQuerySchema = z
  .object({
    surface: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
    decision: z.enum(["allow", "review"]).optional(),
    policy: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
    model: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
    checkedFrom: z.iso.datetime({ offset: true }).optional(),
    checkedTo: z.iso.datetime({ offset: true }).optional(),
    beforeCheckedAt: z.iso.datetime({ offset: true }).optional(),
    beforeId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCursorTime = value.beforeCheckedAt !== undefined;
    const hasCursorId = value.beforeId !== undefined;
    if (hasCursorTime !== hasCursorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "beforeCheckedAt and beforeId must be supplied together",
      });
    }
    if (
      value.checkedFrom &&
      value.checkedTo &&
      Date.parse(value.checkedFrom) > Date.parse(value.checkedTo)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkedFrom must be <= checkedTo",
      });
    }
  });
export type ModerationAuditQuery = z.infer<typeof moderationAuditQuerySchema>;
