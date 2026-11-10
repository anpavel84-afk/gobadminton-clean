import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { COMMUNITY_PHOTO_POLICY, ContentModerationService, IMAGE_POLICY } from "../../src/moderation/moderation.service";
import { safeImageDecision, type ContentModerationProvider } from "../../src/moderation/provider";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { IMAGE_CATEGORIES, MODERATION_MODEL, ModerationProviderError } from "../../src/moderation/provider";
import { OpenAIModerationProvider, parseImageResponse } from "../../src/moderation/openai-provider";
import { sanitizeAvatar } from "../../src/profiles/avatar-image";

const rawEnv = {NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://local@127.0.0.1/test",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000", CONTENT_MODERATION_PROVIDER: "openai",
  CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-m1-test-fingerprint-secret-32", OPENAI_MODERATION_API_KEY: "synthetic-api-key"};
const fixture = () => ({id:"synthetic-response",model:MODERATION_MODEL,results:[{flagged:false,
  categories:Object.fromEntries(IMAGE_CATEGORIES.map(key=>[key,false])),
  category_applied_input_types:Object.fromEntries(IMAGE_CATEGORIES.map(key=>[key,[]])),
  category_scores: {sexual: 0.99}}]});
describe("moderation adapter safety", () => {
  it("refuses fake outside explicit local tests; non-test missing configuration fails startup", () => {
    for (const NODE_ENV of ["development", "production"] as const) {
      expect(()=>new FakeModerationProvider({NODE_ENV,APP_ENV:"local"})).toThrow(/Fake moderation/);
      expect(()=>loadEnv({...rawEnv,NODE_ENV,CONTENT_MODERATION_PROVIDER:"fake"})).toThrow(/Fake moderation/);
      expect(()=>loadEnv({...rawEnv,NODE_ENV,CONTENT_MODERATION_PROVIDER:undefined})).toThrow(/requires OpenAI/);
    }
    expect(()=>loadEnv({...rawEnv,APP_ENV:"stage",CONTENT_MODERATION_PROVIDER:"fake"})).toThrow(/Fake moderation/);
    expect(()=>loadEnv({...rawEnv,OPENAI_MODERATION_API_KEY:undefined})).toThrow(/API key/);
    expect(()=>loadEnv({...rawEnv,CONTENT_MODERATION_FINGERPRINT_SECRET:undefined})).toThrow(/fingerprint secret/);
    for (const base of ["http://api.openai.com/v1","https://evil.invalid/v1","https://api.openai.com/v1/other","https://u:p@api.openai.com/v1"]) {
      expect(()=>loadEnv({...rawEnv,OPENAI_MODERATION_BASE_URL:base})).toThrow(/BASE_URL/);
    }
  });
  it("pins model and sends only sanitized image through the official SDK transport", async () => {
    const original=await sharp({create:{width:800,height:600,channels:3,background:"red"}}).withMetadata().jpeg().toBuffer();
    const png=await sanitizeAvatar(original,"image/jpeg");
    const beforeAttempt=vi.fn(async()=>undefined);
    const transport=vi.fn<typeof fetch>(async (_url, options)=>{
      const body=JSON.parse(String(options?.body));
      expect(body.model).toBe(MODERATION_MODEL);expect(body.input).toHaveLength(1);
      expect(Object.keys(body.input[0])).toEqual(["type","image_url"]);
      const data=body.input[0].image_url.url;expect(data.startsWith("data:image/png;base64,")).toBe(true);
      const bytes=Buffer.from(data.split(",")[1],"base64");expect(bytes.equals(png)).toBe(true);expect(bytes.equals(original)).toBe(false);
      const metadata=await sharp(bytes).metadata();expect(metadata).toMatchObject({width:512,height:512,format:"png"});expect(metadata.exif).toBeUndefined();
      return Response.json(fixture());
    });
    const adapter=new OpenAIModerationProvider(loadEnv(rawEnv),transport);
    const result=await adapter.moderateImage({mime:"image/png",bytes:png,signal:new AbortController().signal,beforeAttempt});
    expect(result.categories.sexual).toBe(false);expect(result).not.toHaveProperty("category_scores");expect(beforeAttempt).toHaveBeenCalledTimes(1);
  });
  it("validates required metadata/model/flag consistency; scores never decide", () => {
    expect(parseImageResponse(fixture()).categories.sexual).toBe(false);
    const reject=fixture();reject.results[0]!.categories.sexual=true;reject.results[0]!.category_applied_input_types.sexual=["image"] as never;
    expect(parseImageResponse(reject).categories.sexual).toBe(true);
    for (const bad of [{}, {...fixture(),model:"omni-moderation-latest"}, {...fixture(),results:[]},
      {...fixture(),results:[{...fixture().results[0],flagged:true}]},
      {...fixture(),results:[{flagged:false,categories:{}}]},
      {...fixture(),results:[{...reject.results[0],category_applied_input_types:{}}]}]) {
      expect(()=>parseImageResponse(bad)).toThrow(ModerationProviderError);
    }
  });
  it("bounds retries and redacts HTTP/transport/schema failures", async () => {
    const bytes=Buffer.from("synthetic transport input");
    for (const status of [429,500,408,401]) {
      const transport=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({error:{message:"PRIVATE_PAYLOAD synthetic-api-key"}}),{status,headers:{"retry-after":"9999"}}));
      const adapter=new OpenAIModerationProvider(loadEnv(rawEnv),transport);const reserve=vi.fn(async()=>undefined);
      await expect(adapter.moderateImage({mime:"image/png",bytes,signal:new AbortController().signal,beforeAttempt:reserve})).rejects.toMatchObject({kind:"unavailable",message:"Moderation unavailable",retryAfterSeconds:60});
      expect(transport).toHaveBeenCalledTimes(status===500 || status===408 ? 2 : 1);expect(reserve).toHaveBeenCalledTimes(transport.mock.calls.length);
    }
    const malformed=vi.fn<typeof fetch>(async()=>new Response("{invalid",{headers:{"content-type":"application/json"}}));
    await expect(new OpenAIModerationProvider(loadEnv(rawEnv),malformed).moderateImage({mime:"image/png",bytes,signal:new AbortController().signal,beforeAttempt:async()=>undefined})).rejects.toMatchObject({kind:"schema",message:"Moderation schema"});
    expect(malformed).toHaveBeenCalledTimes(1);
    const transport=vi.fn<typeof fetch>(async()=>Response.json({private:"PRIVATE_PAYLOAD"}));
    await expect(new OpenAIModerationProvider(loadEnv(rawEnv),transport).moderateImage({mime:"image/png",bytes,signal:new AbortController().signal,beforeAttempt:async()=>undefined})).rejects.toMatchObject({kind:"schema",message:"Moderation schema"});
  });
});

describe("community_photo M1 identity", () => {
  const env = loadEnv({...rawEnv,CONTENT_MODERATION_PROVIDER:"fake"});
  function harness() {
    const query = vi.fn().mockResolvedValue({rows:[],rowCount:0});
    const moderateImage = vi.fn().mockResolvedValue(safeImageDecision());
    const provider = {key:"fake",model:MODERATION_MODEL,moderateImage} as unknown as ContentModerationProvider;
    const service = new ContentModerationService({query} as unknown as Pool,env,provider);
    return {query,moderateImage,service};
  }
  it("keeps old fingerprints byte-for-byte and separates new surface/policy and actual bytes", async () => {
    const {query,moderateImage,service} = harness();
    const source = await sharp({create:{width:512,height:512,channels:3,background:"red"}}).png().toBuffer();
    for (const slot of ["avatar","cover"] as const) expect(service.fingerprint(source,slot)).toBe(
      createHmac("sha256",rawEnv.CONTENT_MODERATION_FINGERPRINT_SECRET).update(`moderation-fingerprint:v1:${slot}_image:`).update(source).digest("hex"));
    const avatar = await service.approveImage("actor",source);
    const community = await service.approveImage("actor",source,"community_photo");
    expect(avatar.policy).toBe(IMAGE_POLICY);expect(community.policy).toBe(COMMUNITY_PHOTO_POLICY);
    expect(community.fingerprint).not.toBe(avatar.fingerprint);
    expect(query.mock.calls[1]![1]).toEqual([community.fingerprint,COMMUNITY_PHOTO_POLICY,"fake",MODERATION_MODEL,"community_photo_image"]);
    expect(moderateImage.mock.calls[1]![0].bytes.equals(source)).toBe(true);
    const client = {query:vi.fn().mockResolvedValue({rows:[{id:"approval"}]})};
    await expect(service.bindImage(client as unknown as PoolClient,community,source,"community_photo")).resolves.toBe("approval");
    await expect(service.bindImage(client as unknown as PoolClient,community,source,"avatar")).rejects.toMatchObject({status:503});
    const other = await sharp({create:{width:512,height:512,channels:3,background:"blue"}}).png().toBuffer();
    await expect(service.bindImage(client as unknown as PoolClient,community,other,"community_photo")).rejects.toMatchObject({status:503});
  });
  it("reuses only the dedicated allow cache and fails closed on provider error/invalid canonical input", async () => {
    const {query,moderateImage,service} = harness();
    const bytes = await sharp({create:{width:800,height:400,channels:3,background:"red"}}).png().toBuffer();
    query.mockResolvedValueOnce({rows:[{category_flags:safeImageDecision().categories,provider_response_id:null,checked_at:new Date()}]});
    await service.approveImage("actor",bytes,"community_photo");
    expect(moderateImage).not.toHaveBeenCalled();
    moderateImage.mockRejectedValueOnce(new ModerationProviderError("unavailable"));
    await expect(service.approveImage("actor",bytes,"community_photo")).rejects.toMatchObject({status:503});
    await expect(service.approveImage("actor",bytes,"cover")).rejects.toMatchObject({status:503});
    const metadata = await sharp(bytes).withMetadata().png().toBuffer();
    await expect(service.approveImage("actor",metadata,"community_photo")).rejects.toMatchObject({status:503});
    const wide = await sharp({create:{width:1601,height:1,channels:3,background:"red"}}).png().toBuffer();
    await expect(service.approveImage("actor",wide,"community_photo")).rejects.toMatchObject({status:503});
    expect(moderateImage).toHaveBeenCalledTimes(1);
  });
});
