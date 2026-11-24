import { readFileSync } from "node:fs";
import path from "node:path";
import { CoverController } from "../../src/profiles/cover.controller";
import { coverDeleteVersion } from "../../src/profiles/cover-command";
import { describe, expect, it, vi } from "vitest";
const contract=JSON.parse(readFileSync(path.resolve(__dirname,"../../../../packages/contracts/openapi.json"),"utf8"));
const avatarSecurity=contract.paths["/me/avatar"].put.security;
describe("cover wire contract",()=>{
  it("specifies shared CAS, cookie/CSRF/replay and binary-only uploads with native bearer parity",()=>{
    const route=contract.paths["/me/cover"];
    for(const method of ["put","delete"]){
      const op=route[method];expect(op.security).toEqual(avatarSecurity);
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"X-Profile-Version",required:true}));
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"X-CSRF-Token",required:false}));
      expect(op.parameters).toContainEqual({$ref:"#/components/parameters/IdempotencyKey"});
      expect(op.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/CoverReceipt");
    }
    expect(route.get.security).toEqual(avatarSecurity);
    expect(route.delete.requestBody.required).toBe(true);
    expect(route.delete.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/DeleteCoverCommand");
    const schema=contract.components.schemas.DeleteCoverCommand;
    expect(schema).toMatchObject({additionalProperties:false,required:["expectedVersion"],properties:{expectedVersion:{type:"integer",minimum:0,maximum:2147483647}}});
    const ids=Object.values(contract.paths as Record<string, Record<string, {responses?: unknown; operationId?: string}>>).flatMap(path=>Object.values(path).filter(op=>op && typeof op==="object" && op.responses).map(op=>op.operationId));
    expect(ids.every(Boolean)).toBe(true);expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(route.put.requestBody.content).sort()).toEqual(["image/jpeg","image/png","image/webp"]);
    expect(contract.paths["/media/covers/{key}"].get.responses["404"]).toBeDefined();
    expect(contract.paths["/media/covers/{key}"].get.security).toEqual(avatarSecurity);
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
    const controller=new CoverController({requirePrincipalMutation:vi.fn().mockResolvedValue(actor)} as never,{mutate} as never,{requireKey:()=>"key"} as never,{} as never);
    const request=(body:unknown)=>({body,headers:{"x-profile-version":"4","idempotency-key":"key"}} as never);
    await expect(controller.remove(request(undefined))).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await expect(controller.remove(request({expectedVersion:3}))).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await expect(controller.remove(request({expectedVersion:4}))).resolves.toEqual({version:5,cover:{uploadedUrl:null}});
    expect(mutate).toHaveBeenCalledWith(actor,"key","4",undefined,"cover");
  });
  it("bearer path calls requirePrincipalMutation for PUT/DELETE",async()=>{
    const actor={userId:"synthetic",sessionId:"s"};const mutate=vi.fn().mockResolvedValue({version:1,cover:{uploadedUrl:null}});
    const requirePrincipalMutation=vi.fn().mockResolvedValue(actor);
    const controller=new CoverController({requirePrincipalMutation} as never,{mutate} as never,{requireKey:()=>"key"} as never,{} as never);
    const request={body:Buffer.from([1]),headers:{"authorization":"Bearer t","x-profile-version":"0","idempotency-key":"key","content-type":"image/png"}} as never;
    await controller.replace(request);
    expect(requirePrincipalMutation).toHaveBeenCalledWith(request);
    await controller.remove({body:{expectedVersion:0},headers:{"authorization":"Bearer t","x-profile-version":"0","idempotency-key":"key"}} as never);
    expect(requirePrincipalMutation).toHaveBeenCalledTimes(2);
  });
  it("GET me/cover uses requirePrincipal; media/covers uses requirePrincipal when Authorization present else optionalSession; Vary includes Authorization",async()=>{
    const actor={userId:"owner",sessionId:"s"};
    const requirePrincipal=vi.fn().mockResolvedValue(actor);
    const optionalSession=vi.fn().mockResolvedValue(null);
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const media={readCover:vi.fn().mockRejectedValue(new Error("stop-after-auth")),readVenueCover:vi.fn()};
    const auth={requirePrincipal,optionalSession,requirePrincipalMutation:vi.fn()};
    const controller=new CoverController(auth as never,media as never,{requireKey:()=>"key"} as never,pool as never);
    await expect(controller.getOwn({headers:{authorization:"Bearer t"}} as never)).resolves.toEqual({version:0,cover:{uploadedUrl:null}});
    expect(requirePrincipal).toHaveBeenCalled();
    const replyHeaders: Record<string,string>={};
    const reply={
      header(k:string,v:string){replyHeaders[k.toLowerCase()]=v;return reply;},
      type(){return reply;},
      send(body:unknown){return body;},
    };
    requirePrincipal.mockClear();
    await expect(controller.read({headers:{}} as never,"a".repeat(64)+".png",reply as never)).rejects.toThrow("stop-after-auth");
    expect(optionalSession).toHaveBeenCalled();
    expect(requirePrincipal).not.toHaveBeenCalled();
    expect(replyHeaders.vary).toBe("Authorization, Cookie, Accept");
    optionalSession.mockClear();requirePrincipal.mockClear();
    await expect(controller.read({headers:{authorization:"Bearer t"}} as never,"a".repeat(64)+".png",reply as never)).rejects.toThrow("stop-after-auth");
    expect(requirePrincipal).toHaveBeenCalled();
    expect(optionalSession).not.toHaveBeenCalled();
  });
});

import { GameCoverController } from "../../src/games/game-cover.controller";
describe("Issue47 cover wire contract",()=>{
  it("provides independent game and venue edit targets with native bearer parity",()=>{
    const route=contract.paths["/games/{gameId}/cover"];
    const avatarSecurity=contract.paths["/me/cover"].put.security;
    for(const method of ["get","put","delete"] as const){
      expect(route[method].security).toEqual(avatarSecurity);
    }
    for(const method of ["put","delete"] as const){
      expect(route[method].parameters).toContainEqual(expect.objectContaining({name:"X-Game-Version",required:true}));
      expect(route[method].parameters).toContainEqual(expect.objectContaining({name:"X-CSRF-Token",required:false}));
      expect(route[method].parameters).toContainEqual(expect.objectContaining({name:"Idempotency-Key",required:true}));
      expect(route[method].responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/GameCoverReceipt");
    }
    expect(Object.keys(route.put.requestBody.content).sort()).toEqual(["image/jpeg","image/png","image/webp"]);
    expect(contract.components.schemas.Game.properties.cover.$ref).toBe("#/components/schemas/GameCover");
    expect(contract.components.schemas.GameMapPreview.properties.cover.$ref).toBe("#/components/schemas/GameCover");
    expect(contract.paths["/media/game-covers/{key}"].get.responses["404"]).toBeDefined();
    expect(contract.paths["/media/game-covers/{key}"].get.security).toEqual(avatarSecurity);
  });
  it("requires an exact integer CAS command agreeing with the header",()=>{
    expect(coverDeleteVersion({expectedVersion:1},"1")).toBe("1");
    for(const body of [undefined,null,[],{}, {expectedVersion:"1"},{expectedVersion:-1},{expectedVersion:1.1},{expectedVersion:NaN},{expectedVersion:2147483648},{expectedVersion:1,extra:1}])expect(()=>coverDeleteVersion(body,"1")).toThrow();
    for(const header of [undefined,"01","2",["1"]])expect(()=>coverDeleteVersion({expectedVersion:1},header)).toThrow();
  });
  it("validates DELETE before media processing",async()=>{
    const actor={userId:"synthetic",sessionId:"synthetic"},mutate=vi.fn().mockResolvedValue({version:5,hasCover:false,cover:{uploadedUrl:null}});
    const controller=new GameCoverController({requirePrincipalMutation:vi.fn().mockResolvedValue(actor)} as never,{mutate} as never,{requireKey:()=>"key"} as never);
    const request=(body:unknown)=>({body,headers:{"x-game-version":"4","idempotency-key":"key"}} as never);
    await expect(controller.remove(request(undefined),"game")).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await controller.remove(request({expectedVersion:4}),"game");expect(mutate).toHaveBeenCalledWith(actor,"key","game","4");
  });
  it("bearer path calls requirePrincipal / requirePrincipalMutation; media Vary includes Authorization",async()=>{
    const actor={userId:"synthetic",sessionId:"s"};
    const requirePrincipal=vi.fn().mockResolvedValue(actor);
    const requirePrincipalMutation=vi.fn().mockResolvedValue(actor);
    const optionalSession=vi.fn().mockResolvedValue(null);
    const covers={
      get:vi.fn().mockResolvedValue({version:1,hasCover:false,cover:{uploadedUrl:null}}),
      mutate:vi.fn().mockResolvedValue({version:2,hasCover:true,cover:{uploadedUrl:"/v1/media/game-covers/"+"a".repeat(64)+".png"}}),
      read:vi.fn().mockRejectedValue(new Error("stop-after-auth")),
    };
    const controller=new GameCoverController({requirePrincipal,requirePrincipalMutation,optionalSession} as never,covers as never,{requireKey:()=>"key"} as never);
    await controller.get({headers:{authorization:"Bearer t"}} as never,"game");
    expect(requirePrincipal).toHaveBeenCalled();
    await controller.put({body:Buffer.from([1]),headers:{authorization:"Bearer t","x-game-version":"1","idempotency-key":"key","content-type":"image/png"}} as never,"game");
    expect(requirePrincipalMutation).toHaveBeenCalled();
    await controller.remove({body:{expectedVersion:1},headers:{authorization:"Bearer t","x-game-version":"1","idempotency-key":"key"}} as never,"game");
    expect(requirePrincipalMutation).toHaveBeenCalledTimes(2);
    const replyHeaders: Record<string,string>={};
    const reply={
      header(k:string,v:string){replyHeaders[k.toLowerCase()]=v;return reply;},
      type(){return reply;},
      send(body:unknown){return body;},
    };
    requirePrincipal.mockClear();optionalSession.mockClear();
    await expect(controller.read({headers:{}} as never,"a".repeat(64)+".png",reply as never)).rejects.toThrow("stop-after-auth");
    expect(optionalSession).toHaveBeenCalled();
    expect(requirePrincipal).not.toHaveBeenCalled();
    expect(replyHeaders.vary).toBe("Authorization, Cookie, Accept");
    optionalSession.mockClear();requirePrincipal.mockClear();
    await expect(controller.read({headers:{authorization:"Bearer t"}} as never,"a".repeat(64)+".png",reply as never)).rejects.toThrow("stop-after-auth");
    expect(requirePrincipal).toHaveBeenCalled();
    expect(optionalSession).not.toHaveBeenCalled();
  });
});
