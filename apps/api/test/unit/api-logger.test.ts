import { Writable } from "node:stream";
import Fastify from "fastify";
import { ConsoleLogger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { apiLogger, ApiApplicationLogger } from "../../src/common/api-logger";

describe("production API logger pipeline", () => {
  it("redacts only native transaction path credentials, including invalid actions, without changing routing", async () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    if (!apiLogger || typeof apiLogger !== "object") throw new Error("Logger must be enabled");
    const app = Fastify({ logger: { ...apiLogger, stream } });
    const credential = "TRANSACTION_BINDING_SECRET_CANARY";
    const prefix = "/v1/auth/native/transactions/";
    const handled: string[] = [];
    for (const action of ["bind", "complete", "cancel"]) {
      app.post(`${prefix}:id/${action}`, async req => {
        expect(req.params).toEqual({ id: credential });
        expect(req.url).toBe(`${prefix}${credential}/${action}?keep=raw`);
        handled.push(action);
        req.log.info({ req, responseTime: 12, body: credential }, credential);
        return { ok: true };
      });
    }
    const unrelated = ["/v1/auth/native/transactions", "/v1/games/visible-id/details",
      "/v1/auth/native/transactions-extra/visible-id/bind", "/v1/admin/auth/native/transactions/visible-id/bind"];
    for (const path of unrelated) app.get(path, async () => ({ ok: true }));
    const suffixes = ["/bind", "/complete", "/cancel", "/invalidaction", "/invalid/nested", ""];
    try {
      for (const suffix of suffixes) {
        const response = await app.inject({ method: "POST", url: `${prefix}${credential}${suffix}?keep=raw` });
        expect(response.statusCode).toBe(["/bind", "/complete", "/cancel"].includes(suffix) ? 200 : 404);
      }
      // Even malformed identifiers on not-found URLs are credentials at this location.
      await app.inject({ url: `${prefix}ENCODED%2FSECRET_CANARY/unknown` });
      for (const url of unrelated) expect((await app.inject({ url })).statusCode).toBe(200);
    } finally { await app.close(); }
    expect(handled).toEqual(["bind", "complete", "cancel"]);
    expect(output).not.toContain(credential);
    expect(output).not.toContain("ENCODED%2FSECRET_CANARY");
    const records = output.trim().split("\n").map(line => JSON.parse(line));
    for (const suffix of suffixes) expect(records.some(r => r.req?.method === "POST" &&
      r.req.path === `${prefix}[REDACTED]${suffix}` && r.reqId)).toBe(true);
    for (const path of unrelated) expect(records.some(r => r.req?.path === path)).toBe(true);
    expect(records.some(r => r.responseTime === 12 && r.msg === "api_event")).toBe(true);
    expect(records.some(r => r.res?.statusCode === 404)).toBe(true);
  });

  it("retains request correlation and handler inputs without logging credentials, including errors", async () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    if (!apiLogger || typeof apiLogger !== "object") throw new Error("Logger must be enabled");
    const app = Fastify({ logger: { ...apiLogger, stream } });
    const secrets = ["CODE_CANARY", "STATE_CANARY", "COOKIE_CANARY", "BEARER_CANARY", "CSRF_CANARY", "ACTIVATION_CANARY", "TICKET_CANARY", "SESSION_CANARY", "QA_KEY_CANARY"];
    const query = new URLSearchParams({ code: secrets[0]!, state: secrets[1]!, activation: secrets[5]!, ticket: secrets[6]!, session: secrets[7]! }).toString();
    const headers = { cookie: `session=${secrets[2]}`, authorization: `Bearer ${secrets[3]}`, "x-csrf-token": secrets[4]! };
    app.post("/v1/auth/native/exchange", async req => {
      req.log.error({req,body:req.body,err:new Error("native credential")},"native credential");
      return {ok:true};
    });
    let callbacks = 0;
    for (const path of ["/v1/admin/auth/yandex/callback", "/v1/auth/yandex/callback"]) {
      app.get(path, async (req) => {
        expect(req.query).toMatchObject({ code: secrets[0], state: secrets[1] });
        callbacks++;
        return { ok: true };
      });
      app.get(`${path}/error`, async () => { throw new Error(secrets.join(" ")); });
    }
    app.post("/v1/admin/activation", async (req) => {
      req.log.error({ req, err: new Error(secrets.join(" ")), body: req.body }, secrets.join(" "));
      return { ok: true };
    });
    app.post("/v1/admin/auth/dev-qa-key", async (req) => {
      req.log.error({req,body:req.body,err:new Error(secrets.join(" "))},secrets.join(" "));
      return {ok:true};
    });
    try {
      await app.inject({method:"POST",url:"/v1/auth/native/exchange?code="+secrets[0],headers,payload:{code:secrets[0],verifier:secrets[1],accessToken:secrets[3],refreshToken:secrets[7]}});
      await app.inject({method:"POST",url:"/v1/admin/auth/dev-qa-key?key="+secrets[8],headers,payload:{key:secrets[8],requestNonce:secrets[4]}});
      for (const path of ["/v1/admin/auth/yandex/callback", "/v1/auth/yandex/callback"]) {
        expect((await app.inject({ url: `${path}?${query}`, headers })).statusCode).toBe(200);
        expect((await app.inject({ url: `${path}/error?${query}`, headers })).statusCode).toBe(500);
      }
      await app.inject({ url: `/missing?${query}`, headers });
      await app.inject({ method: "POST", url: "/v1/admin/activation", headers, payload: { activation: secrets[5], ticket: secrets[6], session: secrets[7] } });
    } finally { await app.close(); }
    expect(callbacks).toBe(2);
    expect(output.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).not.toContain("?code=");
    const records = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(records.some((r) => r.req?.method === "GET" && r.req.path === "/v1/admin/auth/yandex/callback" && r.reqId)).toBe(true);
    expect(records.some((r) => r.res?.statusCode === 500)).toBe(true);
    expect(records.some((r) => r.err?.type === "RequestError" &&
      r.err.message === "Request failed" && r.err.stack === "Error details suppressed")).toBe(true);
  });

  it("suppresses Nest exception details before the console sink", () => {
    const sink = vi.spyOn(ConsoleLogger.prototype, "error").mockImplementation(() => undefined);
    try {
      new ApiApplicationLogger().error("PROVIDER_SECRET_CANARY", new Error("STACK_SECRET_CANARY").stack);
      expect(JSON.stringify(sink.mock.calls)).not.toContain("CANARY");
      expect(sink).toHaveBeenCalledOnce();
    } finally { sink.mockRestore(); }
  });
});
