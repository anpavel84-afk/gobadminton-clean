import { readFileSync } from "node:fs";
import path from "node:path";
import { CoverController } from "../../src/profiles/cover.controller";
import { coverDeleteVersion } from "../../src/profiles/cover-command";
import { describe, expect, it, vi } from "vitest";
const contract=JSON.parse(readFileSync(path.resolve(__dirname,"../../../../packages/contracts/openapi.json"),"utf8"));
describe("cover wire contract",()=>{
  it("specifies shared CAS, cookie/CSRF/replay and binary-only uploads",()=>{
    const route=contract.paths["/me/cover"];
    for(const method of ["put","delete"]){
      const op=route[method];expect(op.security).toEqual([{cookieSession:[]}]);
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"X-Profile-Version",required:true}));
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"X-CSRF-Token",required:true}));
      expect(op.parameters).toContainEqual({$ref:"#/components/parameters/IdempotencyKey"});
      expect(op.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/CoverReceipt");
    }
    expect(route.delete.requestBody.required).toBe(true);
    expect(route.delete.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/DeleteCoverCommand");
    const schema=contract.components.schemas.DeleteCoverCommand;
    expect(schema).toMatchObject({additionalProperties:false,required:["expectedVersion"],properties:{expectedVersion:{type:"integer",minimum:0,maximum:2147483647}}});
    const ids=Object.values(contract.paths as Record<string, Record<string, {responses?: unknown; operationId?: string}>>).flatMap(path=>Object.values(path).filter(op=>op && typeof op==="object" && op.responses).map(op=>op.operationId));
    expect(ids.every(Boolean)).toBe(true);expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(route.put.requestBody.content).sort()).toEqual(["image/jpeg","image/png","image/webp"]);
    expect(contract.paths["/media/covers/{key}"].get.responses["404"]).toBeDefined();
  });
});

describe("cover DELETE command validation",()=>{
  it("requires an integer CAS command agreeing with the header",()=>{
    expect(coverDeleteVersion({expectedVersion:0},"0")).toBe("0");
    expect(coverDeleteVersion({expectedVersion:2147483647},"2147483647")).toBe("2147483647");
    for(const body of [undefined,null,[],{}, {expectedVersion:"0"},{expectedVersion:-1},{expectedVersion:1.1},{expectedVersion:NaN},{expectedVersion:2147483648},{expectedVersion:0,extra:1}]) expect(()=>coverDeleteVersion(body,"0")).toThrow();
    for(const header of [undefined,"01","1",["0"]]) expect(()=>coverDeleteVersion({expectedVersion:0},header)).toThrow();
  });
});

describe("cover DELETE runtime",()=>{
  it("passes the validated command version to the mutation and rejects invalid bodies before media work",async()=>{
    const actor={userId:"synthetic"};const mutate=vi.fn().mockResolvedValue({version:5,cover:{uploadedUrl:null}});
    const controller=new CoverController({requireCookieMutation:vi.fn().mockResolvedValue(actor)} as never,{mutate} as never,{requireKey:()=>"key"} as never,{} as never);
    const request=(body:unknown)=>({body,headers:{"x-profile-version":"4","idempotency-key":"key"}} as never);
    await expect(controller.remove(request(undefined))).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await expect(controller.remove(request({expectedVersion:3}))).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await expect(controller.remove(request({expectedVersion:4}))).resolves.toEqual({version:5,cover:{uploadedUrl:null}});
    expect(mutate).toHaveBeenCalledWith(actor,"key","4",undefined,"cover");
  });
});
