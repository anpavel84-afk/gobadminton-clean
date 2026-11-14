import { describe, expect, it } from "vitest";
import { explicitBearer, nativeBody, parseNativeClients, s256 } from "../../src/auth/native-auth-security";
import { loadEnv } from "../../src/config/env";
import { NATIVE_POLICY, SESSION_COOKIE } from "../../src/auth/constants";
const registry=JSON.stringify([{clientId:"android.dev",redirectUris:["https://app.example.test/auth/callback"]}]);
const base={NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:"postgres://test:test@localhost/test",PUBLIC_API_ORIGIN:"https://localhost:3000",PUBLIC_WEB_ORIGIN:"https://localhost:3001",COOKIE_SECURE:"true"};
describe("native auth security policy",()=>{
  it("defaults off with an empty registry and exact policy lifetimes",()=>{
    expect(loadEnv(base)).toMatchObject({NATIVE_AUTH_ENABLED:false,NATIVE_AUTH_CLIENTS:[]});
    expect(NATIVE_POLICY).toEqual({transaction:600,handoff:60,access:600,idle:604800,absolute:2592000});
    expect(loadEnv({...base,NATIVE_AUTH_ENABLED:"1",NATIVE_AUTH_CLIENTS_JSON:registry}).NATIVE_AUTH_ENABLED).toBe(true);
  });
  it.each([{}, {APP_ENV:"prod"}, {COOKIE_SECURE:"false"}, {PUBLIC_WEB_ORIGIN:"https://evil.test"}])("fails closed when enabled without an admissible registry/environment %j",override=>{
    expect(()=>loadEnv({...base,NATIVE_AUTH_ENABLED:"1",NATIVE_AUTH_CLIENTS_JSON:registry,...override,...(Object.keys(override).length ? {} : {NATIVE_AUTH_CLIENTS_JSON:"[]"})})).toThrow();
  });
  it.each(["http://app.test/cb","myapp://cb","https://app.test/cb?x=1","https://user@app.test/cb","https://app.test/cb#x","https://app.test:443/cb","https://app.test/../cb","https://127.0.0.1/cb"])("rejects nonexact or insecure redirect %s",uri=>{
    expect(()=>parseNativeClients(JSON.stringify([{clientId:"a",redirectUris:[uri]}]))).toThrow();
  });
  it("rejects duplicate IDs, invalid JSON and oversized request bodies",()=>{
    const client=JSON.parse(registry)[0];expect(()=>parseNativeClients(JSON.stringify([client,client]))).toThrow();
    expect(()=>parseNativeClients("{" )).toThrow();expect(()=>nativeBody({padding:"x".repeat(4097)})).toThrow();
  });
  it("matches RFC7636 S256 independently of provider PKCE",()=>expect(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  it("rejects malformed, duplicate and mixed explicit Authorization with no fallback",()=>{
    const request=(authorization:unknown,cookies={},rawHeaders:string[]=[])=>({headers:{authorization},cookies,raw:{rawHeaders}} as never);
    expect(explicitBearer(request(undefined))).toBeNull();expect(explicitBearer(request(`Bearer ${"a".repeat(43)}`))).toBe("a".repeat(43));
    for(const value of ["", "Basic x", "Bearer x", `Bearer ${"a".repeat(43)},Bearer ${"b".repeat(43)}`, ["Bearer a","Bearer b"]]) expect(()=>explicitBearer(request(value))).toThrow();
    expect(()=>explicitBearer(request(`Bearer ${"a".repeat(43)}`,{[SESSION_COOKIE]:"browser"}))).toThrow();
    expect(()=>explicitBearer(request(`Bearer ${"a".repeat(43)}`,{},["Authorization","a","authorization","b"]))).toThrow();
  });
});
