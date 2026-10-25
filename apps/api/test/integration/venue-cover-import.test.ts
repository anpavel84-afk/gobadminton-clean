import { randomUUID, createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { loadEnv } from "../../src/config/env";
import { importVenueCovers, main } from "../../src/database/import-venue-covers";
import { validateManifest } from "../../src/venues/venue-cover-import";
import { AvatarService } from "../../src/profiles/avatar.service";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { safeImageDecision } from "../../src/moderation/provider";
import { VenuesService } from "../../src/venues/venues.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";

const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("venue cover import: disposable PostGIS",()=>{
  const dbName="venue_import_"+randomUUID().replaceAll("-","");
  let admin:Pool|undefined, pool:Pool|undefined, root:string|undefined;
  let media:AvatarService,moderation:ContentModerationService,fake:FakeModerationProvider;
  let actor:string,userId:string;
  let cliEnv:NodeJS.ProcessEnv;
  let venues:VenuesService;
  const city="a0000000-0000-4000-8000-000000000001";
  function db(){if(!pool)throw new Error("Missing disposable DB");return pool;}
  beforeAll(async()=>{
    if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required for disposable PostGIS");
    const url=new URL(process.env.DATABASE_URL);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Disposable loopback DB required");
    admin=new Pool({connectionString:url.href});await admin.query('CREATE DATABASE "'+dbName+'"');
    url.pathname="/"+dbName;pool=new Pool({connectionString:url.href});
    await db().query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    const migrations=path.resolve(__dirname,"../../migrations");
    for(const file of (await readdir(migrations)).filter(f=>f.endsWith(".sql")).sort()){
      await db().query(await readFile(path.join(migrations,file),"utf8"));
      await db().query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
    }
    root=await mkdtemp(path.join(tmpdir(),"venue-import-"));
    const env=loadEnv({...process.env,DATABASE_URL:url.href,NODE_ENV:"test",APP_ENV:"local",
      PUBLIC_API_ORIGIN:"http://127.0.0.1:19441",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:19442",ALLOWED_WEB_ORIGINS:"http://127.0.0.1:19442",
      AUTH_PEPPER:"synthetic-cover-import-pepper-32chars",AVATAR_MEDIA_ROOT:root,CONTENT_MODERATION_PROVIDER:"fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET:"synthetic-cover-import-fingerprint-32chars"});
    cliEnv={NODE_ENV:"test",APP_ENV:"stage",DATABASE_URL:url.href,
      PUBLIC_API_ORIGIN:"https://dev.gobadminton.ru",PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",
      ALLOWED_WEB_ORIGINS:"https://dev.gobadminton.ru",AVATAR_MEDIA_ROOT:root,
      AUTH_PEPPER:"synthetic-cover-import-pepper-32chars",CONTENT_MODERATION_PROVIDER:"openai",
      OPENAI_MODERATION_API_KEY:"synthetic-unused-key",
      CONTENT_MODERATION_FINGERPRINT_SECRET:"synthetic-cover-import-fingerprint-32chars"};
    fake=new FakeModerationProvider(env);moderation=new ContentModerationService(db(),env,fake);
    const idempotency=new IdempotencyService(db(),env);
    const mutations=new MutationRunner(db(),idempotency,new ActorFenceService(env),env);
    media=new AvatarService(db(),env,mutations,moderation,idempotency);
    venues=new VenuesService(db(),idempotency,mutations);
    const user=(await db().query<{id:string}>("INSERT INTO users(display_name) VALUES('Synthetic importer') RETURNING id")).rows[0];
    if(!user)throw new Error("fixture user");userId=user.id;
    const principal=(await db().query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0];
    if(!principal)throw new Error("fixture actor");actor=principal.id;
    await db().query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','synthetic')",[actor]);
  },120000);
  afterAll(async()=>{
    await pool?.end();
    if(admin){await admin.query('DROP DATABASE IF EXISTS "'+dbName+'"');await admin.end();}
    if(root)await rm(root,{recursive:true,force:true});
  });
  async function batch(kinds:readonly ("photo"|"logo"|"illustration")[]){
    const bytes=await sharp({create:{width:900,height:600,channels:3,background:"#123456"}}).jpeg().toBuffer();
    const items=[];
    const images=new Map<string,Buffer>();
    for(const kind of kinds){
      const id=randomUUID();
      await db().query(`INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
        VALUES($1,$2,'Synthetic venue','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$3,'unverified',$4,$5)`,[id,city,userId,id,id]);
      images.set(id,bytes);items.push({venueId:id,file:id+".jpg",sha256:createHash("sha256").update(bytes).digest("hex"),kind,
        credit_text:kind==="photo"?"Фото: Клуб":kind==="logo"?"Логотип: Клуб":"Иллюстрация",source_page_url:kind==="illustration"?null:"https://example.com",basis_note:"PRIVATE BASIS"});
    }
    return {manifest:validateManifest({schema:"VENUE_COVER_BATCH_V1",batch:"synthetic",count:items.length,items}),images};
  }
  it("dry-run has no writes/provider calls; apply publishes three credits; replay writes nothing",async()=>{
    const input=await batch(["photo","logo","illustration"]), lines:object[]=[];
    const counts=async()=> (await db().query("SELECT (SELECT count(*) FROM privileged_audit_events) audits,(SELECT count(*) FROM avatar_media_gc) stages,(SELECT count(*) FROM content_moderation_approvals) approvals")).rows;
    const before=await counts(),calls=fake.calls;
    expect(await importVenueCovers(db(),input,actor,false,{media,moderation},l=>lines.push(l))).toBe(0);
    expect(await counts()).toEqual(before);expect(fake.calls).toBe(calls);
    expect(await readdir(root??"")).toEqual([]);
    expect(await importVenueCovers(db(),input,actor,true,{media,moderation},l=>lines.push(l))).toBe(0);
    for(const item of input.manifest.items){
      const row=(await db().query<{cover_key:string;version:number;cover_credit_kind:string;cover_credit_text:string;cover_credit_url:string|null;url:string|null}>("SELECT *,venue_cover_url(id) AS url FROM venues WHERE id=$1",[item.venueId])).rows[0];
      if(!row||!root)throw new Error("Missing result");
      const payload=await venues.getById(item.venueId);
      expect(payload.cover).toEqual({uploadedUrl:row.url,credit:{kind:item.kind,text:item.credit_text,url:item.source_page_url}});
      expect(JSON.stringify(payload)).not.toContain("PRIVATE BASIS");
      expect(JSON.stringify(payload)).not.toContain(root);
      expect(row.version).toBe(2);expect(row.cover_credit_kind).toBe(item.kind);expect(row.cover_credit_text).toBe(item.credit_text);expect(row.cover_credit_url).toBe(item.source_page_url);expect(row.url).toContain(row.cover_key);
      expect(await sharp(await readFile(path.join(root,row.cover_key))).metadata()).toMatchObject({format:"png",width:1200,height:400});
      expect((await db().query("SELECT 1 FROM venue_admin_actions WHERE venue_id=$1 AND action='cover'",[item.venueId])).rowCount).toBe(1);
      expect((await db().query("SELECT 1 FROM privileged_audit_events WHERE target_id=$1 AND reason_code='venue_cover_batch_import'",[item.venueId])).rowCount).toBe(1);
    }
    const snapshots=(await db().query("SELECT id,version,cover_key,cover_credit_kind,cover_credit_text,cover_credit_url FROM venues ORDER BY id")).rows;
    const files=await Promise.all((await readdir(root??"")).map(async file=>[file,await readFile(path.join(root??"",file))]));
    const after=await counts(),callsAfter=fake.calls;
    expect(await importVenueCovers(db(),input,actor,true,{media,moderation},l=>lines.push(l))).toBe(0);
    expect(await counts()).toEqual(after);expect(fake.calls).toBe(callsAfter);
    expect((await db().query("SELECT id,version,cover_key,cover_credit_kind,cover_credit_text,cover_credit_url FROM venues ORDER BY id")).rows).toEqual(snapshots);
    expect(await Promise.all((await readdir(root??"")).map(async file=>[file,await readFile(path.join(root??"",file))]))).toEqual(files);
    expect(JSON.stringify(lines)).not.toContain("PRIVATE BASIS");expect(JSON.stringify(lines)).not.toContain(root);
    expect(JSON.stringify(lines)).not.toContain("synthetic-cover-import");
  });
  it("continues unknown rows, skips retired venues, and releases refused stages",async()=>{
    const input=await batch(["photo","logo","illustration"]);
    const [unknown,retired,refused]=input.manifest.items;if(!unknown||!retired||!refused)throw new Error("fixture");
    await db().query("DELETE FROM venues WHERE id=$1",[unknown.venueId]);
    await db().query("UPDATE venues SET lifecycle_state='retired' WHERE id=$1",[retired.venueId]);
    // Distinct bytes avoid the earlier allow cache.
    const bytes=await sharp({create:{width:900,height:600,channels:3,background:"red"}}).jpeg().toBuffer();
    input.images.set(refused.venueId,bytes);
    fake.fixture=async()=>{const d=safeImageDecision();return {...d,flagged:true,categories:{...d.categories,violence:true}};};
    const lines:object[]=[];
    try{
      expect(await importVenueCovers(db(),input,actor,true,{media,moderation},l=>lines.push(l))).toBe(1);
      expect((await db().query("SELECT 1 FROM venues WHERE id=ANY($1) AND cover_key IS NOT NULL",[[retired.venueId,refused.venueId]])).rowCount).toBe(0);
      expect((await db().query("SELECT 1 FROM avatar_media_gc WHERE not_before<=now()")).rowCount).toBeGreaterThan(0);
      expect(lines).toContainEqual(expect.objectContaining({venueId:unknown.venueId,action:"FAILED"}));
      expect(lines).toContainEqual(expect.objectContaining({venueId:retired.venueId,action:"SKIPPED"}));
    }finally{fake.fixture=async()=>safeImageDecision();}
  });
  it("CLI apply rejects inactive principals, inactive users and missing superadmin grants before writes",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"venue-import-cli-"));
    try {
      // Empty validated batch makes the entry authority guard observable even with no rows to import.
      await writeFile(path.join(dir,"batch.json"),JSON.stringify({schema:"VENUE_COVER_BATCH_V1",batch:"actor-guards",count:0,items:[]}));
      const args=["--dir",dir,"--manifest","batch.json","--actor-principal-id",actor,"--apply"];
      const snapshot=async()=> (await db().query(`SELECT
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM venues v) venues,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM venue_admin_actions a) actions,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM privileged_audit_events a) audits,
        (SELECT count(*) FROM avatar_media_gc) stages,
        (SELECT count(*) FROM content_moderation_approvals) approvals`)).rows;
      const refused=async()=>{
        const before=await snapshot();
        const files=await readdir(root??"");
        await expect(main(args,cliEnv)).rejects.toThrow("IMPORT_ACTOR_REFUSED");
        expect(await snapshot()).toEqual(before);
        expect(await readdir(root??"")).toEqual(files);
      };
      for(const [disable,enable] of [
        ["UPDATE admin_role_grants SET active=false WHERE principal_id=$1","UPDATE admin_role_grants SET active=true WHERE principal_id=$1"],
        ["UPDATE admin_principals SET status='suspended' WHERE id=$1","UPDATE admin_principals SET status='active' WHERE id=$1"],
      ]){
        if(!disable||!enable)throw new Error("fixture");
        await db().query(disable,[actor]);try{await refused();}finally{await db().query(enable,[actor]);}
      }
      await db().query("UPDATE users SET status='deletion_pending' WHERE id=$1",[userId]);
      try{await refused();}
      finally{await db().query("UPDATE users SET status='active' WHERE id=$1",[userId]);}
    } finally {await rm(dir,{recursive:true,force:true});}
  });
});
