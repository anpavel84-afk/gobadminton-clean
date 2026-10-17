import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST, PUT } from "../src/app/v1/admin/[...path]/route";
const origin="http://localhost:18920", id="00000000-0000-4000-8000-000000000001";
const route=`venues/${id}/cover`;
const context=(path=route)=>({params:Promise.resolve({path:path.split("/")})});
let server:Server|undefined;
afterEach(async()=>{vi.unstubAllEnvs();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}});
describe("Admin cover BFF with real loopback HTTP upstream (synthetic, no authenticated DEV evidence)",()=>{
 async function start(){
  const seen:{method:string|undefined;url:string|undefined;headers:Record<string,unknown>;body:Buffer}[]=[];
  server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));seen.push({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks)});res.writeHead(409,{"Content-Type":"application/json"});res.end(JSON.stringify({code:"VENUE_VERSION_CONFLICT"}));});
  server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw new Error("No loopback address");
  for(const [name,value]of Object.entries({ADMIN_INTERNAL_APP_ENABLED:"1",ADMIN_TEST_ORIGIN:origin,ADMIN_TEST_API_URL:`http://127.0.0.1:${address.port}`,ADMIN_DEV_ENABLED:"0",ADMIN_DEV_PATH_ENABLED:"0",NEXT_PUBLIC_ADMIN_BASE_PATH:"",APP_ENV:"local",NODE_ENV:"test"}))vi.stubEnv(name,value);
  return seen;
 }
 const headers={origin,"content-type":"image/png","x-csrf-token":"synthetic-csrf","idempotency-key":"synthetic-replay-key","x-venue-version":"7",cookie:"__Host-gb_session=consumer; __Host-gb_admin_session=synthetic-admin",authorization:"Bearer consumer"};
 it("preserves binary PUT and DELETE bytes, CAS/replay/CSRF headers, Admin-only cookies and rejection semantics",async()=>{
  const seen=await start(),bytes=new Uint8Array([0,255,128,13,10,0,195,40]);
  const response=await PUT(new Request(`${origin}/v1/admin/${route}`,{method:"PUT",headers,body:bytes}),context());
  expect(response.status).toBe(409);expect(await response.json()).toEqual({code:"VENUE_VERSION_CONFLICT"});
  expect(seen[0]?.body).toEqual(Buffer.from(bytes));expect(seen[0]?.url).toBe(`/v1/admin/${route}`);
  expect(seen[0]?.headers).toMatchObject({"x-venue-version":"7","x-csrf-token":"synthetic-csrf","idempotency-key":"synthetic-replay-key",cookie:"__Host-gb_admin_session=synthetic-admin"});expect(seen[0]?.headers.authorization).toBeUndefined();
  const body=JSON.stringify({expectedVersion:7});
  await DELETE(new Request(`${origin}/v1/admin/${route}`,{method:"DELETE",headers:{...headers,"content-type":"application/json"},body}),context());
  expect(seen[1]?.method).toBe("DELETE");expect(seen[1]?.body.toString()).toBe(body);
 });
 it("rejects cover method/path/origin/type/size/query violations before upstream",async()=>{
  const seen=await start();
  for(const path of [`venues/${"-".repeat(36)}/cover`,route+"/arbitrary",route+"/access"]){expect((await PUT(new Request(`${origin}/v1/admin/${path}`,{method:"PUT",headers,body:"x"}),context(path))).status).toBe(404);}
  expect((await POST(new Request(`${origin}/v1/admin/${route}`,{method:"POST",headers,body:"{}"}),context())).status).toBe(404);
  for(const method of ["PUT","DELETE"] as const){const h={...headers};delete (h as Partial<typeof h>).origin;expect((await (method==="PUT"?PUT:DELETE)(new Request(`${origin}/v1/admin/${route}`,{method,headers:{...h,"sec-fetch-site":"same-origin"},body:"x"}),context())).status).toBe(403);}
  expect((await PUT(new Request(`${origin}/v1/admin/${route}`,{method:"PUT",headers:{...headers,"content-type":"text/plain"},body:"x"}),context())).status).toBe(415);
  expect((await PUT(new Request(`${origin}/v1/admin/${route}`,{method:"PUT",headers,body:new Uint8Array(5*1024*1024+1)}),context())).status).toBe(413);
  expect((await DELETE(new Request(`${origin}/v1/admin/${route}`,{method:"DELETE",headers,body:"x".repeat(65537)}),context())).status).toBe(413);
  expect((await GET(new Request(`${origin}/v1/admin/${route}?url=evil`,{headers}),context())).status).toBe(400);
  expect(seen).toHaveLength(0);
 });
});
