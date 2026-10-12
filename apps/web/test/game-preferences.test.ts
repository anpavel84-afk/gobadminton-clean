import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, getGamePreferences, patchGamePreferences } from "../src/lib/api-client";
import type { CreateGameInput } from "../src/lib/consumer-types";
beforeEach(() => vi.stubGlobal("window", new EventTarget()));
afterEach(() => vi.unstubAllGlobals());
describe("existing private game-contact transport", () => {
  it("reads an own-only template and clears it with version, CSRF and one idempotent PATCH", async () => {
    const request=vi.fn(async () => new Response(JSON.stringify({defaultPublicGameContact:null,version:4}),{status:200}));vi.stubGlobal("fetch",request);
    await getGamePreferences();await patchGamePreferences({expectedVersion:3,defaultPublicGameContact:null},"csrf-fixture");
    expect(request).toHaveBeenCalledTimes(2);
    const [url,init]=request.mock.calls[1]! as unknown as [string,RequestInit];expect(url).toMatch(/\/v1\/me\/game-preferences$/);expect(init.method).toBe("PATCH");expect(JSON.parse(init.body as string)).toEqual({expectedVersion:3,defaultPublicGameContact:null});
    const headers=init.headers as Headers;expect(headers.get("X-CSRF-Token")).toBe("csrf-fixture");expect(headers.get("Idempotency-Key")).toBeTruthy();expect(init.credentials).toBe("include");expect(init.cache).toBe("no-store");
  });
  it.each([401,403,409,404])("%i is returned without retry or false save success", async status => {
    const request=vi.fn(async()=>new Response(JSON.stringify({code:"VERSION_CONFLICT"}),{status}));vi.stubGlobal("fetch",request);
    const result=await patchGamePreferences({expectedVersion:3,defaultPublicGameContact:"test"},"csrf");expect(result).toMatchObject({ok:false,status});expect(request).toHaveBeenCalledTimes(1);
  });
  it("composes explicit save inside the one create command instead of a prior profile write", async () => {
    const request=vi.fn(async()=>new Response(JSON.stringify({id:"game"}),{status:201}));vi.stubGlobal("fetch",request);
    const input={hostPublicContact:"new",savePublicContactDefault:{expectedVersion:3}} as CreateGameInput;
    await createGame(input,"csrf");expect(request).toHaveBeenCalledTimes(1);const [url,init]=request.mock.calls[0]! as unknown as [string,RequestInit];expect(url).toMatch(/\/v1\/games$/);expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
