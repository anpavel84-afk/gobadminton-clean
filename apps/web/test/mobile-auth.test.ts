import { afterEach, describe, expect, it, vi } from "vitest";
import { listAuthProviders, startAuth } from "../src/lib/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("mobile protected CTA OAuth transport", () => {
  it.each(["vk", "yandex"] as const)("keeps the chosen %s provider and exact return query on the same origin", async (provider) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authorizationUrl: "https://provider.example/authorize" })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {});
    const returnPath = "/my-games?tab=created&view=history";
    await startAuth(provider, returnPath);
    const [target, init] = fetch.mock.calls[0]!;
    expect(target).toBe(`/v1/auth/${provider}/start?${new URLSearchParams({ returnPath })}`);
    expect(init.credentials).toBe("include");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ providers: ["vk", "yandex"] }, { providers: ["yandex"] }, { providers: [] }])("provider discovery does not start OAuth: $providers", async ({ providers }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ providers })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {});
    const result = await listAuthProviders();
    expect(result.ok && result.data.providers).toEqual(providers);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe("/v1/auth/providers");
  });
});
