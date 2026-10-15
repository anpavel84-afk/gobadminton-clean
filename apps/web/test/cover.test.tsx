import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileCover, CoverEditor } from "../src/components/consumer/players/CoverEditor";
import { changeMyCover, getMyCover } from "../src/lib/api-client";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("profile cover",()=>{
  it("renders authorized derivative or safe branded default; refuses external and active URLs",()=>{
    const url="/v1/media/covers/"+"a".repeat(64)+".png";
    expect(renderToStaticMarkup(<ProfileCover url={url}/>)).toContain(url);
    for(const value of [null,"https://evil.invalid/photo.png","javascript:alert(1)","/v1/media/covers/../../private"]){
      const html=renderToStaticMarkup(<ProfileCover url={value}/>);expect(html).toContain('data-cover="default"');expect(html).toContain('/canonical/ce252.svg');
    }
  });
  it("exposes keyboard button with locked state and no automatic upload",()=>{
    const change=vi.fn();const html=renderToStaticMarkup(<CoverEditor version={1} csrfToken="synthetic" disabled onBusy={vi.fn()} onChange={change} onUnauthorized={vi.fn()}/>);
    expect(html).toContain("Изменить обложку");expect(html).toContain("disabled");expect(change).not.toHaveBeenCalled();
  });
  it("sends only the confirmed derivative with CSRF, shared version and a replay key; delete sends an explicit CAS command",async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({version:8,cover:{uploadedUrl:null}}),{status:200}));vi.stubGlobal("fetch",fetch);vi.stubGlobal("window",{});
    const derivative=new Blob(["synthetic derivative"],{type:"image/webp"});
    await changeMyCover(derivative,7,"csrf");
    const [url,init]=fetch.mock.calls[0]!;expect(url).toBe("/v1/me/cover");expect(init.body).toBe(derivative);expect(init.method).toBe("PUT");expect(init.credentials).toBe("include");expect(init.headers.get("X-Profile-Version")).toBe("7");expect(init.headers.get("X-CSRF-Token")).toBe("csrf");expect(init.headers.get("Idempotency-Key")).toBeTruthy();
    fetch.mockResolvedValue(new Response(JSON.stringify({version:9,cover:{uploadedUrl:null}}),{status:200}));await changeMyCover(null,8,"csrf");expect(fetch.mock.calls[1]![1].method).toBe("DELETE");expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({expectedVersion:8});expect(fetch.mock.calls[1]![1].headers.get("Content-Type")).toBe("application/json");
  });
  it("times out hung saves and reconciles by bounded authenticated read",async()=>{
    vi.useFakeTimers();const fetch=vi.fn().mockReturnValue(new Promise(()=>{}));vi.stubGlobal("fetch",fetch);vi.stubGlobal("window",{});
    const pending=changeMyCover(null,7,"csrf");await vi.advanceTimersByTimeAsync(20000);expect(await pending).toMatchObject({ok:false,status:0});expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    const read=getMyCover();await vi.advanceTimersByTimeAsync(5000);expect(await read).toMatchObject({ok:false,status:0});expect(fetch.mock.calls[1]![0]).toBe("/v1/me/cover");expect(fetch.mock.calls[1]![1].headers.has("X-Profile-Version")).toBe(false);
  });
});
