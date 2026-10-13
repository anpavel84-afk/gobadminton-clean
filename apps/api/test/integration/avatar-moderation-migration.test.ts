import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("M1 upgrade from applied 0019",()=>{
  it("preserves legacy bytes/version with NULL approval and retains provider-independent retirement",async()=>{
    const base=process.env.DATABASE_URL!;const url=new URL(base);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Migration test requires disposable loopback PostgreSQL");
    const admin=new Pool({connectionString:base});const name=`m1_upgrade_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;const pool=new Pool({connectionString:url.href});
    try{
      await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
      const dir=path.resolve(__dirname,"../../migrations");const files=(await readdir(dir)).filter(f=>f.endsWith(".sql")&&f<"0020").sort();
      for(const file of files){const client=await pool.connect();try{await client.query("BEGIN");await client.query(await readFile(path.join(dir,file),"utf8"));await client.query("INSERT INTO schema_migrations(id) VALUES ($1)",[file.replace(/\.sql$/,"")]);await client.query("COMMIT");}finally{client.release();}}
      const user=randomUUID();const key="a".repeat(64)+".png";
      await pool.query("INSERT INTO users(id,display_name) VALUES ($1,'Synthetic legacy')",[user]);
      await pool.query("INSERT INTO player_social_profiles(user_id,display_name,avatar_key,version) VALUES ($1,'Synthetic legacy',$2,8)",[user,key]);
      execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:{...process.env,NODE_ENV:"test",DATABASE_URL:url.href,PUBLIC_API_ORIGIN:"http://127.0.0.1:3000"},stdio:"inherit"});
      expect((await pool.query("SELECT avatar_key,avatar_moderation_approval_id,version FROM player_social_profiles WHERE user_id=$1",[user])).rows[0]).toEqual({avatar_key:key,avatar_moderation_approval_id:null,version:8});
      expect((await pool.query("SELECT 1 FROM content_moderation_approvals")).rowCount).toBe(0);
      await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[user]);
      expect((await pool.query("SELECT avatar_key,avatar_moderation_approval_id,version FROM player_social_profiles WHERE user_id=$1",[user])).rows[0]).toEqual({avatar_key:null,avatar_moderation_approval_id:null,version:9});
      expect((await pool.query("SELECT storage_key FROM avatar_media_gc")).rows).toEqual([{storage_key:key}]);
    }finally{await pool.end();await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
  });
});
