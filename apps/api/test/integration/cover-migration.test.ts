import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("0033 additive cover upgrade and rollback",()=>{
  it("preserves prior profile/avatar, rollback refuses populated covers, account deletion journals cover",async()=>{
    const url=new URL(process.env.DATABASE_URL!);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Disposable loopback PostGIS required");
    const admin=new Pool({connectionString:url.href}),name=`cover_upgrade_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;const pool=new Pool({connectionString:url.href});
    const dir=path.resolve(__dirname,"../../migrations");
    try{
      await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
      for(const file of (await readdir(dir)).filter(f=>f.endsWith(".sql")&&f<"0033").sort())await pool.query(await readFile(path.join(dir,file),"utf8"));
      const user=randomUUID(),key="a".repeat(64)+".png";
      await pool.query("INSERT INTO users(id,display_name) VALUES ($1,'Synthetic cover migration')",[user]);
      await pool.query("INSERT INTO player_social_profiles(user_id,display_name,avatar_key,version) VALUES ($1,'Synthetic cover migration',$2,8)",[user,key]);
      const migration=await readFile(path.join(dir,"0033_owned_cover.sql"),"utf8");
      await pool.query(migration);
      expect((await pool.query("SELECT avatar_key,cover_key,cover_moderation_approval_id,version FROM player_social_profiles WHERE user_id=$1",[user])).rows[0]).toEqual({avatar_key:key,cover_key:null,cover_moderation_approval_id:null,version:8});
      const rollback=await readFile(path.join(dir,"rollback/0033_owned_cover.sql"),"utf8");
      await pool.query("BEGIN");await pool.query(rollback);await pool.query("COMMIT");await pool.query(migration);
      const approval=await pool.query(`INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at)
        VALUES ('image','cover_image',1,$1,'avatar-image-v1','none','fake','synthetic','{}','allow',now()) RETURNING id`,["b".repeat(64)]);
      const cover="c".repeat(64)+".png";
      await pool.query("UPDATE player_social_profiles SET cover_key=$2,cover_moderation_approval_id=$3 WHERE user_id=$1",[user,cover,approval.rows[0].id]);
      await pool.query("BEGIN");await expect(pool.query(rollback)).rejects.toThrow("refuses populated");await pool.query("ROLLBACK");
      await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[user]);
      expect((await pool.query("SELECT cover_key,cover_moderation_approval_id FROM player_social_profiles WHERE user_id=$1",[user])).rows[0]).toEqual({cover_key:null,cover_moderation_approval_id:null});
      expect((await pool.query("SELECT storage_key FROM avatar_media_gc ORDER BY storage_key")).rows).toEqual([{storage_key:key},{storage_key:cover}]);
      expect((await pool.query("SELECT PostGIS_Version() AS version")).rows[0].version).toBeTruthy();
    }finally{await pool.end();await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
  });
});
