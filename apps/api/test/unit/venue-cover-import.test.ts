import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, it, expect } from "vitest";
import { validateManifest, validateImage, manifestDigest, planCover } from "../../src/venues/venue-cover-import";
import { guardImportEnv, loadBatch, readBatchFile, main } from "../../src/database/import-venue-covers";

function fixture() {
  const items = (["photo","logo","illustration"] as const).map(kind=>{
    const venueId=randomUUID();
    return {venueId,file:venueId+".jpg",sha256:"a".repeat(64),kind,
      credit_text:kind==="photo"?"Фото: Клуб":kind==="logo"?"Логотип: Клуб":"Иллюстрация",
      source_page_url:kind==="illustration"?null:"https://example.com",basis_note:"private basis"};
  });
  return {schema:"VENUE_COVER_BATCH_V1",batch:"reviewed-1",count:3,items};
}
describe("venue cover batch validation",()=>{
  it("accepts three kinds and computes the specified lowercase sorted digest",()=>{
    const raw=fixture(); const first=raw.items[0];if(!first)throw new Error("fixture");
    first.sha256="B".repeat(64);
    const parsed=validateManifest(raw);
    expect(manifestDigest(parsed)).toBe(createHash("sha256").update(["a".repeat(64),"a".repeat(64),"b".repeat(64)].join("\n")).digest("hex"));
  });
  it.each([
    {extra:true},{schema:"wrong"},{batch:"INVALID"},{count:2},
  ])("rejects invalid root %j",patch=>expect(()=>validateManifest({...fixture(),...patch})).toThrow());
  it.each([
    {extra:true},{file:"../escape.jpg"},{file:"wrong.jpg"},{sha256:"no"},{credit_text:"wrong"},
    {source_page_url:null},{source_page_url:"http://example.com"},{credit_text:"x".repeat(121)},{basis_note:"x".repeat(601)},
  ])("rejects malformed photo %j",patch=>{
    const raw=fixture();raw.items=raw.items.map((i,n)=>n===0?{...i,...patch}:i);
    expect(()=>validateManifest(raw)).toThrow();
  });
  it("rejects duplicate identities and files, illustration credits and logo credits",()=>{
    const raw=fixture(), first=raw.items[0];if(!first)throw new Error("fixture");
    expect(()=>validateManifest({...raw,items:[first,first,first]})).toThrow();
    for(const patch of [{source_page_url:"https://example.com"},{credit_text:"Wrong"}])
      expect(()=>validateManifest({...raw,items:raw.items.map(i=>i.kind==="illustration"?{...i,...patch}:i)})).toThrow();
    for(const patch of [{source_page_url:null},{credit_text:"Фото: Клуб"}])
      expect(()=>validateManifest({...raw,items:raw.items.map(i=>i.kind==="logo"?{...i,...patch}:i)})).toThrow();
  });
  it("checks generated JPEG bytes, sizes, hashes and rejects file/manifest symlinks",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"cover-import-unit-"));
    try {
      const bytes=await sharp({create:{width:50,height:50,channels:3,background:"red"}}).jpeg().toBuffer();
      const hash=createHash("sha256").update(bytes).digest("hex");
      validateImage(bytes,hash);
      for(const [input,digest] of [[bytes,"0".repeat(64)],[Buffer.from("not jpeg"),hash],[Buffer.alloc(2*1024*1024+1),hash]] as const)
        expect(()=>validateImage(input,digest)).toThrow();
      const raw=fixture();raw.items=raw.items.map(i=>({...i,sha256:hash}));
      for(const i of raw.items)await writeFile(path.join(dir,i.file),bytes);
      await writeFile(path.join(dir,"batch.json"),JSON.stringify(raw));
      expect((await loadBatch(dir,"batch.json")).manifest.count).toBe(3);
      await symlink(path.join(dir,"batch.json"),path.join(dir,"link.json"));
      await expect(loadBatch(dir,"link.json")).rejects.toThrow();
      const first=raw.items[0];if(!first)throw new Error("fixture");
      await rm(path.join(dir,first.file));await symlink(path.join(dir,"batch.json"),path.join(dir,first.file));
      await expect(loadBatch(dir,"batch.json")).rejects.toThrow();
      await expect(readBatchFile(dir,"../batch.json",100)).rejects.toThrow();
      await writeFile(path.join(dir,"large.json"),Buffer.alloc(256*1024+1));
      await expect(loadBatch(dir,"large.json")).rejects.toThrow();
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("plans only eligible empty venues",()=>{
    expect(planCover(undefined).action).toBe("FAILED");
    const row={name:"Synthetic",lifecycle_state:"verified",cover_key:null,cover_credit_kind:null,version:1};
    expect(planCover(row).action).toBe("READY");
    for(const patch of [{lifecycle_state:"retired"},{lifecycle_state:"merged"},{cover_key:"key"},{cover_credit_kind:"photo"}])
      expect(planCover({...row,...patch}).action).toBe("SKIPPED");
  });
  it("CLI refuses unsafe environment before loading files or connecting",async()=>{
    const safe={APP_ENV:"stage",PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",AVATAR_MEDIA_ROOT:"/synthetic",CONTENT_MODERATION_PROVIDER:"openai"};
    expect(()=>guardImportEnv(safe)).not.toThrow();
    for(const patch of [{APP_ENV:"prod"},{PUBLIC_WEB_ORIGIN:"https://gobadminton.ru"},{AVATAR_MEDIA_ROOT:""},{CONTENT_MODERATION_PROVIDER:"fake"}])
      await expect(main([],{...safe,...patch})).rejects.toThrow("IMPORT_ENV_REFUSED");
  });
});
