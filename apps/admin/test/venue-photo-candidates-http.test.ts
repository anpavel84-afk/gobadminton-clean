import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST, PUT } from "../src/app/v1/admin/[...path]/route";

// Contract checks at the existing BFF seam, using a mocked upstream only.
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
  it("rejects wrong methods, non-exact paths/UUIDs and every candidate query before upstream",async()=>{
    const upstream=vi.fn<typeof fetch>();
    vi.stubGlobal("fetch",upstream);
    for(const [path,methods] of [
      [root,["POST","PUT","DELETE"]],
      [`${root}/${candidate}/content`,["POST","PUT","DELETE"]],
      [`${root}/${candidate}/decision`,["GET","PUT","DELETE"]],
    ] as const) {
      for(const method of methods) {
        const handler={GET,POST,PUT,DELETE}[method];
        expect((await handler(new Request(`${origin}/v1/admin/${path}`,{method,headers}),context(path))).status).toBe(404);
      }
    }
    for(const path of [
      "photo-candidates", "venues/photo-candidates", `${root}/`, `${root}/${candidate}`,
      `${root}/${candidate}/content/extra`, `${root}/${candidate}/decision/extra`,
      `venues/${"-".repeat(36)}/photo-candidates`, `${root}/${"-".repeat(36)}/content`,
      `venues/${venue.toUpperCase()}/photo-candidates`, `${root}/${candidate.toUpperCase()}/decision`,
    ]) {
      for(const method of ["GET","POST"] as const) {
        expect((await {GET,POST}[method](new Request(`${origin}/v1/admin/${path}`,{method,headers}),context(path))).status).toBe(404);
      }
    }
    for(const [path,handler,method] of [
      [root,GET,"GET"], [`${root}/${candidate}/content`,GET,"GET"], [`${root}/${candidate}/decision`,POST,"POST"],
    ] as const) {
      expect((await handler(new Request(`${origin}/v1/admin/${path}?limit=1`,{method,headers}),context(path))).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("keeps Origin and browser request fences on all three routes",async()=>{
    const upstream=vi.fn<typeof fetch>();
    vi.stubGlobal("fetch",upstream);
    const noOrigin={cookie:headers.cookie,"sec-fetch-site":"cross-site"};
    for(const [path,handler,method] of [
      [root,GET,"GET"], [`${root}/${candidate}/content`,GET,"GET"], [`${root}/${candidate}/decision`,POST,"POST"],
    ] as const) {
      for(const requestHeaders of [{...headers,origin:"https://foreign.example"},noOrigin]) {
        const response=await handler(new Request(`${origin}/v1/admin/${path}`,{method,headers:requestHeaders}),context(path));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({code:"ADMIN_ORIGIN_REJECTED"});
      }
    }
    const path=`${root}/${candidate}/decision`;
    expect((await POST(new Request(`${origin}/v1/admin/${path}`,{method:"POST",headers:{...noOrigin,"sec-fetch-site":"same-origin"}}),context(path))).status).toBe(403);
    expect((await GET(new Request(`http://localhost:18923/v1/admin/${root}`,{headers}),context(root))).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("never promotes consumer credentials or client authority and preserves upstream JSON errors/status",async()=>{
    const upstream=vi.fn<typeof fetch>();
    vi.stubGlobal("fetch",upstream);
    for(const [path,handler,method,status,code] of [
      [root,GET,"GET",401,"ADMIN_SESSION_REQUIRED"],
      [`${root}/${candidate}/content`,GET,"GET",404,"PHOTO_CANDIDATE_UNAVAILABLE"],
      [`${root}/${candidate}/decision`,POST,"POST",409,"VENUE_VERSION_CONFLICT"],
    ] as const) {
      const problem=`{ "code": "${code}" }`;
      const responseHeaders=new Headers({"content-type":"application/json"});
      responseHeaders.append("set-cookie","__Host-gb_session=upstream-consumer; Path=/; Secure");
      responseHeaders.append("set-cookie","__Host-gb_admin_session=upstream-admin; Path=/; Secure");
      upstream.mockResolvedValueOnce(new Response(problem,{status,headers:responseHeaders}));
      const response=await handler(new Request(`${origin}/v1/admin/${path}`,{method,headers:{
        ...headers,cookie:"__Host-gb_session=synthetic-consumer; __Host-gb_admin_handoff=not-a-session",
        "x-admin-role":"super_admin","x-venue-version":"31",
      }}),context(path));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.text()).toBe(problem);
      expect(response.headers.getSetCookie()).toEqual(["__Host-gb_admin_session=upstream-admin; Path=/; Secure"]);
      const [url,init]=upstream.mock.calls.at(-1)!;
      expect(String(url)).toBe(`http://127.0.0.1:18922/v1/admin/${path}`);
      expect(init).toMatchObject({method,cache:"no-store",redirect:"manual",signal:expect.any(AbortSignal)});
      const forwarded=new Headers(init!.headers);
      expect(forwarded.get("cookie")).toBe("");
      expect(forwarded.get("authorization")).toBeNull();
      expect(forwarded.get("x-admin-role")).toBeNull();
      expect(forwarded.get("x-venue-version")).toBeNull();
    }
    expect(upstream).toHaveBeenCalledTimes(3);
  });
  it("preserves the exact DEV base path and sec-fetch/forwarded-host checks",async()=>{
    for(const [name,value] of Object.entries({ADMIN_DEV_ENABLED:"1",ADMIN_DEV_PATH_ENABLED:"1",
      NEXT_PUBLIC_ADMIN_BASE_PATH:"/admin",APP_ENV:"mvp",NODE_ENV:"production",
      PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",ADMIN_ORIGIN:"https://dev.gobadminton.ru",
      ADMIN_API_URL:"https://dev.gobadminton.ru"})) vi.stubEnv(name,value);
    vi.stubEnv("ADMIN_TEST_ORIGIN","");vi.stubEnv("ADMIN_TEST_API_URL","");
    const upstream=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({items:[]}));
    vi.stubGlobal("fetch",upstream);
    const devHeaders={...headers,origin:"https://dev.gobadminton.ru",host:"dev.gobadminton.ru",
      "x-forwarded-host":"dev.gobadminton.ru","x-forwarded-proto":"https","sec-fetch-site":"same-origin"};
    const url=`https://dev.gobadminton.ru/admin/v1/admin/${root}`;
    expect((await GET(new Request(url,{headers:devHeaders}),context(root))).status).toBe(200);
    expect((await GET(new Request(`https://0.0.0.0:3010/v1/admin/${root}`,{headers:devHeaders}),context(root))).status).toBe(200);
    expect(String(upstream.mock.calls[0]![0])).toBe(`https://dev.gobadminton.ru/v1/admin/${root}`);
    upstream.mockClear();
    for(const invalid of [{"sec-fetch-site":"cross-site"},{"x-forwarded-host":"foreign.example"}]) {
      expect((await GET(new Request(url,{headers:{...devHeaders,...invalid}}),context(root))).status).toBe(403);
    }
    expect((await GET(new Request(`https://dev.gobadminton.ru/v1/admin/${root}`,{headers:devHeaders}),context(root))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("retains the decision JSON body limit and upstream-unavailable response",async()=>{
    const upstream=vi.fn<typeof fetch>().mockRejectedValue(new TypeError("upstream unavailable"));
    vi.stubGlobal("fetch",upstream);
    const path=`${root}/${candidate}/decision`;
    const response=await POST(new Request(`${origin}/v1/admin/${path}`,{method:"POST",
      headers:{...headers,"content-type":"application/json"},body:"x".repeat(65537)}),context(path));
    expect(response.status).toBe(413);expect(upstream).not.toHaveBeenCalled();
    const unavailable=await GET(new Request(`${origin}/v1/admin/${root}`,{headers}),context(root));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({code:"ADMIN_UPSTREAM_UNAVAILABLE"});
  });
});
