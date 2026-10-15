import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const contract=JSON.parse(readFileSync(path.resolve(__dirname,"../../../../packages/contracts/openapi.json"),"utf8"));
describe("venue cover additive wire contract",()=>{
  it("requires admin cookie, Origin, CSRF, replay and venue CAS with explicit DELETE command",()=>{
    const route=contract.paths["/admin/venues/{id}/cover"];
    for(const method of ["put","delete"]){
      const op=route[method];expect(op.security).toEqual([{AdminSessionCookie:[]}]);
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"Origin",required:true}));
      expect(op.parameters).toContainEqual(expect.objectContaining({name:"X-CSRF-Token",required:true}));
      expect(op.parameters).toContainEqual({$ref:"#/components/parameters/IdempotencyKey"});
    }
    expect(route.put.parameters).toContainEqual(expect.objectContaining({name:"X-Venue-Version",required:true}));
    expect(Object.keys(route.put.requestBody.content).sort()).toEqual(["image/jpeg","image/png","image/webp"]);
    expect(route.delete.requestBody).toMatchObject({required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/DeleteVenueCoverCommand"}}}});
    expect(contract.components.schemas.DeleteVenueCoverCommand).toMatchObject({additionalProperties:false,required:["expectedVersion"]});
    expect(contract.components.schemas.VenueSummary.properties.cover.$ref).toBe("#/components/schemas/VenueCover");
    expect(contract.paths["/media/venue-covers/{key}"].get.operationId).toBe("getPublicVenueCoverMedia");
  });
});
