import { readFileSync } from "node:fs";
import path from "node:path";
import { GameCoverController } from "../../src/games/game-cover.controller";
import { coverDeleteVersion } from "../../src/profiles/cover-command";
import { describe, expect, it, vi } from "vitest";
const contract=JSON.parse(readFileSync(path.resolve(__dirname,"../../../../packages/contracts/openapi.json"),"utf8"));
describe("Issue47 cover wire contract",()=>{
  it("provides two edit targets only: venue and game; legacy profile is read-only",()=>{
    expect(contract.paths["/me/cover"].put).toBeUndefined();expect(contract.paths["/me/cover"].delete).toBeUndefined();
    const route=contract.paths["/games/{gameId}/cover"];
    for(const method of ["put","delete"]){
      expect(route[method].security).toEqual([{cookieSession:[]}]);
      for(const name of ["X-Game-Version","X-CSRF-Token","Idempotency-Key"])
        expect(route[method].parameters).toContainEqual(expect.objectContaining({name,required:true}));
      expect(route[method].responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/GameCoverReceipt");
    }
    expect(Object.keys(route.put.requestBody.content).sort()).toEqual(["image/jpeg","image/png","image/webp"]);
    expect(contract.components.schemas.Game.properties.cover.$ref).toBe("#/components/schemas/GameCover");
    expect(contract.components.schemas.GameMapPreview.properties.cover.$ref).toBe("#/components/schemas/GameCover");
    expect(contract.paths["/media/game-covers/{key}"].get.responses["404"]).toBeDefined();
  });
  it("requires an exact integer CAS command agreeing with the header",()=>{
    expect(coverDeleteVersion({expectedVersion:1},"1")).toBe("1");
    for(const body of [undefined,null,[],{}, {expectedVersion:"1"},{expectedVersion:-1},{expectedVersion:1.1},{expectedVersion:NaN},{expectedVersion:2147483648},{expectedVersion:1,extra:1}])expect(()=>coverDeleteVersion(body,"1")).toThrow();
    for(const header of [undefined,"01","2",["1"]])expect(()=>coverDeleteVersion({expectedVersion:1},header)).toThrow();
  });
  it("validates DELETE before media processing",async()=>{
    const actor={userId:"synthetic",sessionId:"synthetic"},mutate=vi.fn().mockResolvedValue({version:5,hasCover:false,cover:{uploadedUrl:null}});
    const controller=new GameCoverController({requireCookieMutation:vi.fn().mockResolvedValue(actor)} as never,{mutate} as never,{requireKey:()=>"key"} as never);
    const request=(body:unknown)=>({body,headers:{"x-game-version":"4","idempotency-key":"key"}} as never);
    await expect(controller.remove(request(undefined),"game")).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
    await controller.remove(request({expectedVersion:4}),"game");expect(mutate).toHaveBeenCalledWith(actor,"key","game","4");
  });
});
