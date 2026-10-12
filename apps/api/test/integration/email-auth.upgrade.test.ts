import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("E1/E3 additive upgrade from current 0024",()=>{
  it("backfills session freshness, preserves OAuth metadata, enforces active uniqueness and purpose constraints",async()=>{
    // Separate schema on the assigned disposable database, never existing/live data.
    const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
    const schema=`e1_upgrade_${Date.now()}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
      await client.query("CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public");
      const root=path.resolve(__dirname,"../../migrations");
      for(const f of readdirSync(root).filter(f=>f.endsWith('.sql')&&f<'0025').sort()) await client.query(readFileSync(path.join(root,f),'utf8'));
      const user=(await client.query<{id:string}>("INSERT INTO users(display_name) VALUES('Upgrade synthetic') RETURNING id")).rows[0]!.id;
      await client.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,email) VALUES($1,'vk','upgrade','synthetic','same@example.test')",[user]);
      const session=(await client.query<{id:string}>("INSERT INTO app_sessions(user_id,session_hash,csrf_ciphertext,expires_at,created_at) VALUES($1,'upgrade-hash','sealed',now()+interval '1 day',now()-interval '1 hour') RETURNING id",[user])).rows[0]!.id;
      await client.query(readFileSync(path.join(root,'0025_email_auth_foundation.sql'),'utf8'));
      await client.query(readFileSync(path.join(root,'0026_email_auth_method_changes.sql'),'utf8'));
      expect((await client.query("SELECT authenticated_at=created_at AS same FROM app_sessions WHERE id=$1",[session])).rows[0]!.same).toBe(true);
      expect((await client.query("SELECT * FROM email_auth_methods")).rows).toHaveLength(0);
      await client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,'one@example.test','One@example.test')",[user]);
      await expect(client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,'two@example.test','two@example.test')",[user])).rejects.toMatchObject({code:'23505'});
      const other=(await client.query<{id:string}>("INSERT INTO users DEFAULT VALUES RETURNING id")).rows[0]!.id;
      await expect(client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,'one@example.test','one@example.test')",[other])).rejects.toMatchObject({code:'23505'});
      await expect(client.query("INSERT INTO email_auth_challenges(purpose,email_canonical,email_display,origin,return_path,code_hash,expires_at,resend_after) VALUES('link','x@example.test','x@example.test','http://localhost','/','hash',now(),now())")).rejects.toMatchObject({code:'23514'});
      await client.query("UPDATE email_auth_methods SET status='revoked',revoked_at=now() WHERE user_id=$1",[user]);
      await client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,'one@example.test','one@example.test')",[other]);
      expect((await client.query("SELECT email FROM external_identities WHERE user_id=$1",[user])).rows[0]!.email).toBe('same@example.test');
    } finally {await client.query("RESET search_path");await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();}
  });
});
