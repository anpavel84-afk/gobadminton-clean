import "reflect-metadata";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { loadEnv, type AppEnv } from "../config/env";
import { hashSecret, secretsEqual } from "../auth/crypto";
import { adminTransaction, appendAudit } from "./admin-db";
import { DEV_QA_LABEL, DEV_QA_USER_ID, devQaKeyAllowed } from "./dev-qa-policy";

export async function provisionDevQa(pool: Pool, env: AppEnv, key: string) {
  if (!devQaKeyAllowed(env) || !/^[A-Za-z0-9_-]{64}$/.test(key)) throw new Error("DEV_QA_PROVISION_REFUSED");
  return adminTransaction(pool, async c => {
    const hash = hashSecret(env.ADMIN_AUTH_PEPPER!, "admin-dev-qa-key:" + key);
    const existing = (await c.query<{id:string;principal_id:string;key_hash:string;expires_at:Date}>(
      "SELECT * FROM admin_dev_qa_credentials WHERE label=$1 AND revoked_at IS NULL FOR UPDATE", [DEV_QA_LABEL])).rows[0];
    if (existing) {
      if (!secretsEqual(existing.key_hash, hash) || existing.expires_at.getTime() <= Date.now()) throw new Error("DEV_QA_EXISTING_CREDENTIAL_INSPECT_REQUIRED");
      return {credentialId:existing.id,principalId:existing.principal_id,created:false};
    }
    if ((await c.query("SELECT 1 FROM admin_dev_qa_credentials WHERE key_hash=$1",[hash])).rowCount) throw new Error("DEV_QA_REVOKED_KEY_NOT_REUSABLE");
    const before = (await c.query<{status:string;display_name:string}>("SELECT status,display_name FROM users WHERE id=$1 FOR UPDATE",[DEV_QA_USER_ID])).rows[0];
    if (before && (before.status !== "disabled" || before.display_name !== DEV_QA_LABEL)) throw new Error("DEV_QA_USER_COLLISION");
    if (!before) await c.query("INSERT INTO users(id,status,display_name) VALUES($1,'disabled',$2)",[DEV_QA_USER_ID,DEV_QA_LABEL]);
    const identities=(await c.query(`SELECT 1 FROM external_identities WHERE user_id=$1
      UNION ALL SELECT 1 FROM app_sessions WHERE user_id=$1
      UNION ALL SELECT 1 FROM email_auth_methods WHERE user_id=$1
      UNION ALL SELECT 1 FROM player_social_profiles WHERE user_id=$1`,[DEV_QA_USER_ID])).rowCount;
    if (identities) throw new Error("DEV_QA_CONSUMER_IDENTITY_COLLISION");
    let principal = (await c.query<{id:string;status:string}>("SELECT id,status FROM admin_principals WHERE user_id=$1 FOR UPDATE",[DEV_QA_USER_ID])).rows[0];
    if (!principal) principal=(await c.query<{id:string;status:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id,status",[DEV_QA_USER_ID])).rows[0]!;
    if (principal.status !== "active") throw new Error("DEV_QA_PRINCIPAL_NOT_ACTIVE");
    if ((await c.query("SELECT 1 FROM admin_role_grants WHERE principal_id=$1 AND role<>'pilot_viewer' AND active",[principal.id])).rowCount) throw new Error("DEV_QA_ROLE_COLLISION");
    if ((await c.query("SELECT 1 FROM admin_webauthn_credentials WHERE principal_id=$1",[principal.id])).rowCount) throw new Error("DEV_QA_WEBAUTHN_COLLISION");
    await c.query(`INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'pilot_viewer','owner_dev_qa_480')
      ON CONFLICT(principal_id,role) DO UPDATE SET active=true,reason_code='owner_dev_qa_480',updated_at=clock_timestamp()`,[principal.id]);
    const qa=(await c.query<{id:string}>(`WITH stamp AS (SELECT clock_timestamp() AS at) INSERT INTO admin_dev_qa_credentials(principal_id,label,key_hash,created_at,expires_at)
      SELECT $1,$2,$3,at,at+interval '7 days' FROM stamp RETURNING id`,[principal.id,DEV_QA_LABEL,hash])).rows[0]!;
    await appendAudit(c,{action:"admin.dev_qa_provision",targetType:"admin_dev_qa_credential",targetId:qa.id,permission:"pilot.read",reason:"owner_dev_qa_480",after:{principalId:principal.id,role:"pilot_viewer",consumerLogin:false}});
    return {credentialId:qa.id,principalId:principal.id,created:true};
  });
}
export async function revokeDevQa(pool: Pool) {
  return adminTransaction(pool, async c => {
    const creds=(await c.query<{id:string;principal_id:string}>("SELECT id,principal_id FROM admin_dev_qa_credentials WHERE label=$1 FOR UPDATE",[DEV_QA_LABEL])).rows;
    const ids=creds.map(q=>q.id);
    const credential=await c.query("UPDATE admin_dev_qa_credentials SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",[ids]);
    const sessions=await c.query("UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE auth_method='dev_qa_key' AND qa_credential_id=ANY($1::uuid[]) AND revoked_at IS NULL",[ids]);
    if (credential.rowCount || sessions.rowCount) await appendAudit(c,{action:"admin.dev_qa_revoke",targetType:"admin_dev_qa_credential",targetId:DEV_QA_LABEL,permission:"pilot.read",reason:"owner_dev_qa_480",after:{credentials:credential.rowCount,sessions:sessions.rowCount}});
    const left=(await c.query<{credentials:number;sessions:number}>(`SELECT
      (SELECT count(*)::int FROM admin_dev_qa_credentials WHERE label=$1 AND revoked_at IS NULL) AS credentials,
      (SELECT count(*)::int FROM admin_sessions WHERE auth_method='dev_qa_key' AND qa_credential_id=ANY($2::uuid[]) AND revoked_at IS NULL) AS sessions`,[DEV_QA_LABEL,ids])).rows[0]!;
    if (left.credentials || left.sessions) throw new Error("DEV_QA_REVOKE_READBACK_FAILED");
    return {revokedCredentials:credential.rowCount,revokedSessions:sessions.rowCount,remaining:left};
  });
}
if (require.main === module) {
  void (async()=>{
    const env=loadEnv();
    if (env.PUBLIC_WEB_ORIGIN!=="https://dev.gobadminton.ru" || env.PUBLIC_API_ORIGIN!=="https://dev.gobadminton.ru" || !["mvp","stage"].includes(env.APP_ENV)) throw new Error("DEV_QA_OPS_DEV_ONLY");
    const pool=new PgPool({connectionString:env.DATABASE_URL,max:1});
    try {
      if (process.argv[2]==="provision") {
        const chunks:Buffer[]=[];let bytes=0;
        for await (const value of process.stdin) { const chunk=Buffer.from(value);bytes+=chunk.length;if(bytes>128)throw new Error("DEV_QA_INPUT_REFUSED");chunks.push(chunk); }
        console.log(JSON.stringify(await provisionDevQa(pool,env,Buffer.concat(chunks).toString("utf8").trim())));
      } else if (process.argv[2]==="revoke") console.log(JSON.stringify(await revokeDevQa(pool)));
      else throw new Error("DEV_QA_OPS_COMMAND_REFUSED");
    } finally { await pool.end(); }
  })().catch(()=>{console.error("DEV_QA_OPS_FAILED");process.exitCode=1;});
}
