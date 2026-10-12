import { afterEach, describe, expect, it, vi } from "vitest";
import { emailCommand, emailErrorCopy, listAuthMethods, listOwnAuthMethods, requestEmail, unlinkEmail } from "../src/lib/email-auth";
import { safeAuthReturnPath } from "../src/lib/auth-return";
afterEach(() => vi.unstubAllGlobals());
function transport(body = {}) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body))); vi.stubGlobal("fetch", fetch); vi.stubGlobal("window", {}); return fetch; }
describe("Email consumer wire protocol", () => {
  it("discovery/inventory are independent reads and never start a login", async () => {
    const fetch = transport({items: []}); await listAuthMethods(); await listOwnAuthMethods();
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["/v1/auth/methods", "/v1/me/auth-methods"]);
  });
  it.each(["login_signup", "link", "change_current", "change"] as const)("uses the %s purpose and exact cookie/JSON/custom flow binding", async purpose => {
    const fetch = transport(); await requestEmail(purpose, purpose === "change_current" ? {} : {email: "fixture@example.test"}, purpose === "login_signup" ? undefined : "csrf");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toContain(purpose === "login_signup" ? "/auth/email/" : purpose === "change_current" ? "/email/change/current/" : `/email/${purpose}/`);
    expect(init.credentials).toBe("include"); expect(init.cache).toBe("no-store");
    expect(init.headers.get("X-GB-Email-Auth")).toBe("1"); expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(init.headers.get("X-CSRF-Token")).toBe(purpose === "login_signup" ? null : "csrf");
  });
  it("browser status POST carries flow+CSRF and revoke sends an explicit command body", async () => {
    const fetch = transport(); await emailCommand("link", "/id/status", {}, "csrf"); await unlinkEmail("csrf");
    expect(fetch.mock.calls[0]![1].method).toBe("POST"); expect(fetch.mock.calls[1]![1].method).toBe("DELETE");
    expect(fetch.mock.calls[1]![1].body).toBe("{}"); expect(fetch.mock.calls[1]![1].headers.get("X-CSRF-Token")).toBe("csrf");
  });
  it.each(["//evil.test", "/%2f%2fevil.test", "/%255c%255cevil.test", "https://evil.test", "/v1/auth/email/challenges", "/profile/setup"])("rejects unsafe completion destination %s", raw => expect(safeAuthReturnPath(raw)).toBe("/games"));
  it("preserves an explicit destination without running an action", () => expect(safeAuthReturnPath("/games/fixture?intent=join#details")).toBe("/games/fixture?intent=join#details"));
  it("gives useful recovery/freshness/last-method errors", () => {
    expect(emailErrorCopy("RECENT_AUTH_REQUIRED",403)).toContain("Войдите снова");
    expect(emailErrorCopy("LAST_AUTH_METHOD",409)).toContain("последний");
    expect(emailErrorCopy(undefined,0)).toContain("Ответ не получен");
    expect(emailErrorCopy("EMAIL_ALREADY_LINKED",409)).toContain("не объединяются");
  });
});
