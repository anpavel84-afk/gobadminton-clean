import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/v1/admin/[...path]/route";

// Contract checks at the existing BFF seam, using a mocked upstream only.
// The admitted export lacks candidate allowlisting/binary forwarding in route.ts.
// That repair is outside this source operation's allowed paths; these checks expose it.
const origin = "http://localhost:18921";
const venue = "a0000000-0000-4000-8000-000000000001";
const candidate = "b0000000-0000-4000-8000-000000000001";
const root = `venues/${venue}/photo-candidates`;
const context = (path:string) => ({params:Promise.resolve({path:path.split("/")})});
const headers = {
  origin, cookie:"__Host-gb_session=synthetic-consumer; __Host-gb_admin_session=synthetic-admin",
  authorization:"Bearer synthetic-consumer", "x-csrf-token":"synthetic-csrf", "idempotency-key":"synthetic-stable-decision-key",
};
beforeEach(()=>{
  for(const [name,value] of Object.entries({ADMIN_INTERNAL_APP_ENABLED:"1",ADMIN_TEST_ORIGIN:origin,
    ADMIN_TEST_API_URL:"http://127.0.0.1:18922",ADMIN_DEV_ENABLED:"0",ADMIN_DEV_PATH_ENABLED:"0",
    NEXT_PUBLIC_ADMIN_BASE_PATH:"",APP_ENV:"local",NODE_ENV:"test"})) vi.stubEnv(name,value);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("Admin selected-venue candidate HTTP contract (mock upstream; no authenticated runtime evidence)",()=>{
  it("forwards scoped queue and exact decision packet with only the real Admin cookie",async()=>{
    const upstream=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({items:[]}));
    vi.stubGlobal("fetch",upstream);
    const queue=await GET(new Request(`${origin}/v1/admin/${root}`,{headers}),context(root));
    expect(queue.status).toBe(200);
    const body=JSON.stringify({action:"accept",expectedVersion:31,expectedCandidateVersion:1});
    const path=`${root}/${candidate}/decision`;
    expect((await POST(new Request(`${origin}/v1/admin/${path}`,{method:"POST",headers:{...headers,"content-type":"application/json"},body}),context(path))).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[0]![0])).toBe(`http://127.0.0.1:18922/v1/admin/${root}`);
    const forwarded=upstream.mock.calls[1]![1]!;
    expect(new Headers(forwarded.headers).get("cookie")).toBe("__Host-gb_admin_session=synthetic-admin");
    expect(new Headers(forwarded.headers).get("authorization")).toBeNull();
    expect(new Headers(forwarded.headers).get("x-csrf-token")).toBe("synthetic-csrf");
    expect(new Headers(forwarded.headers).get("idempotency-key")).toBe("synthetic-stable-decision-key");
    expect(new Headers(forwarded.headers).get("origin")).toBe(origin);
    expect(new TextDecoder().decode(forwarded.body as ArrayBuffer)).toBe(body);
  });
  it("forwards private PNG byte-exact/no-store without text decoding",async()=>{
    const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,255,195,40,128]);
    const upstream=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes,{headers:{"Content-Type":"image/png"}}));
    vi.stubGlobal("fetch",upstream);
    const path=`${root}/${candidate}/content`;
    const response=await GET(new Request(`${origin}/v1/admin/${path}`,{headers}),context(path));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
