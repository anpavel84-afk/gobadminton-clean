import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashSecret } from "../auth/crypto";
import { z } from "zod";
import { ADMIN_ROLES } from "./rbac";
import { conflict } from "../auth/problem";
export async function adminTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One consistent A0a authority lock order, including revoke/bootstrap/MFA.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('gobadminton_admin_authority'))",
    );
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export type AuditActor = {
  principalId: string;
  sessionId?: string;
  roles: readonly string[];
};
export async function appendAudit(
  client: PoolClient,
  input: {
    actor?: AuditActor;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    permission: string;
    before?: object;
    after?: object;
    keyHash?: string;
    requestId?: string;
    reversalOf?: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO privileged_audit_events
    (actor_id,system_actor,session_id,roles_snapshot,permission_key,action_key,target_type,target_id,reason_code,before_diff,after_diff,request_id,idempotency_hash,reversal_of)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      input.actor?.principalId ?? null,
      input.actor ? null : "system_bootstrap",
      input.actor?.sessionId ?? null,
      JSON.stringify(input.actor?.roles ?? []),
      input.permission,
      input.action,
      input.targetType,
      input.targetId,
      input.reason,
      JSON.stringify(input.before ?? {}),
      JSON.stringify(input.after ?? {}),
      input.requestId ?? randomUUID(),
      input.keyHash ?? null,
      input.reversalOf ?? null,
    ],
  );
  return result.rows[0]!.id;
}
// Trusted operator primitive; CLI enforces the environment and explicit operator opt-in.
export async function bootstrapFirstAdmin(
  pool: Pool,
  pepper: string,
  input: { userId: string; operationId: string; activationToken: string; reasonCode?: string },
) {
  return adminTransaction(pool, async (client) => {
    const activeUser = await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [input.userId]);
    if (!activeUser.rowCount) throw conflict("ADMIN_EXISTING_USER_REQUIRED", "Existing active user required");
    const hash = hashSecret(pepper, input.activationToken);
    const existing = (
      await client.query<{
        operation_id: string;
        principal_id: string;
        activation_hash: string;
        user_id: string;
        status: string;
        reason_code: string;
      }>(
        `SELECT b.*,p.user_id,p.status,a.reason_code FROM admin_bootstrap_state b JOIN admin_principals p ON p.id=b.principal_id JOIN privileged_audit_events a ON a.request_id=b.operation_id AND a.action_key='admin.bootstrap'`,
      )
    ).rows[0];
    if (existing) {
      if (
        existing.operation_id === input.operationId &&
        existing.user_id === input.userId &&
        existing.activation_hash === hash &&
        existing.reason_code === (input.reasonCode ?? "first_bootstrap") &&
        ["pending_mfa", "active"].includes(existing.status)
      )
        return { principalId: existing.principal_id, replayed: true };
      throw conflict(
        "ADMIN_BOOTSTRAP_CONSUMED",
        "First Admin bootstrap already consumed",
      );
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM admin_role_grants WHERE role='superadmin' AND active=true",
        )
      ).rowCount
    )
      throw conflict("ADMIN_BOOTSTRAP_CONSUMED", "Superadmin already exists");
    const user = (
      await client.query(
        "SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",
        [input.userId],
      )
    ).rows[0];
    if (!user)
      throw conflict(
        "ADMIN_EXISTING_USER_REQUIRED",
        "Existing active user required",
      );
    if (
      (
        await client.query("SELECT 1 FROM admin_principals WHERE user_id=$1", [
          input.userId,
        ])
      ).rowCount
    )
      throw conflict("ADMIN_PRINCIPAL_EXISTS", "Principal already exists");
    const id = (
      await client.query<{ id: string }>(
        "INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",
        [input.userId],
      )
    ).rows[0]!.id;
    await client.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin',$2)",
      [id, input.reasonCode ?? "first_bootstrap"],
    );
    await client.query(
      "INSERT INTO admin_activation_tokens(principal_id,token_hash) VALUES($1,$2)",
      [id, hash],
    );
    await client.query(
      "INSERT INTO admin_bootstrap_state(operation_id,principal_id,activation_hash) VALUES($1,$2,$3)",
      [input.operationId, id, hash],
    );
    await appendAudit(client, {
      action: "admin.bootstrap",
      targetType: "admin_principal",
      targetId: id,
      reason: input.reasonCode ?? "first_bootstrap",
      permission: "identity.manage",
      after: { status: "pending_mfa", roles: ["superadmin"] },
      requestId: input.operationId,
    });
    return { principalId: id, replayed: false };
  });
}

export const operatorProvisionSchema = z.object({
  userId: z.string().uuid(), operationId: z.string().uuid(),
  activationToken: z.string().min(32).max(256),
  reasonCode: z.string().regex(/^[a-zA-Z0-9_-]{3,100}$/),
  role: z.enum(ADMIN_ROLES),
}).strict();

// No sessions, credentials, identity bindings or users are created here.
// Authority lock and immutable audit provide serialized, exact operation replay.
export async function provisionAdmin(pool: Pool, pepper: string, raw: z.input<typeof operatorProvisionSchema>) {
  const input = operatorProvisionSchema.parse(raw);
  return adminTransaction(pool, async c => {
    const user = await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [input.userId]);
    if (!user.rowCount) throw conflict("ADMIN_EXISTING_USER_REQUIRED", "Existing active user required");
    const fingerprint = hashSecret(pepper, JSON.stringify(input));
    const receipt = (await c.query<{target_id: string; idempotency_hash: string}>(
      "SELECT target_id,idempotency_hash FROM privileged_audit_events WHERE request_id=$1 AND action_key='admin.operator_provision'", [input.operationId])).rows[0];
    if (receipt) {
      const principal = (await c.query("SELECT status FROM admin_principals WHERE id=$1", [receipt.target_id])).rows[0];
      if (receipt.idempotency_hash !== fingerprint || !principal || !["pending_mfa", "active"].includes(principal.status))
        throw conflict("ADMIN_OPERATION_CONFLICT", "Operation changed or principal inactive");
      return {principalId: receipt.target_id, replayed: true};
    }
    if ((await c.query("SELECT 1 FROM admin_principals WHERE user_id=$1", [input.userId])).rowCount)
      throw conflict("ADMIN_PRINCIPAL_EXISTS", "Use existing authenticated lifecycle commands");
    if (!(await c.query("SELECT 1 FROM admin_bootstrap_state")).rowCount)
      throw conflict("ADMIN_BOOTSTRAP_REQUIRED", "First bootstrap required");
    const id = (await c.query<{id: string}>("INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id", [input.userId])).rows[0]!.id;
    await c.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,$3)", [id,input.role,input.reasonCode]);
    await c.query("INSERT INTO admin_activation_tokens(principal_id,token_hash) VALUES($1,$2)", [id,hashSecret(pepper,input.activationToken)]);
    await appendAudit(c, {action:"admin.operator_provision",targetType:"admin_principal",targetId:id,
      reason:input.reasonCode,permission:"identity.manage",requestId:input.operationId,keyHash:fingerprint,
      after:{status:"pending_mfa",roles:[input.role]}});
    return {principalId:id,replayed:false};
  });
}
